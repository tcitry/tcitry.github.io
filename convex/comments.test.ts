/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, describe, expect, test, vi} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const pathname = "/posts/example/";
const paginationOpts = {numItems: 20, cursor: null};
const comment = {pathname, body: "A thoughtful comment."};
const aliceIdentity = {issuer: "https://auth.example.test", subject: "alice", preferredUsername: "Alice", name: "Private legal name", email: "private@example.test"};
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {t, alice: t.withIdentity(aliceIdentity), bob: t.withIdentity({issuer: aliceIdentity.issuer, subject: "bob", preferredUsername: "Bob"})};
}
afterEach(() => {vi.unstubAllEnvs(); vi.useRealTimers();});

describe("public comment summaries", () => {
  test("anonymous totals expose only numbers, including replies and article likes", async () => {
    const {t, alice, bob} = setup();
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 0, likeCount: 0});
    const parentId = await alice.mutation(api.comments.add, comment);
    await bob.mutation(api.comments.add, {...comment, parentId});
    await bob.mutation(api.comments.add, {...comment, pathname: "/posts/other/"});
    await bob.mutation(api.comments.setLike, {pathname, liked: true});
    await bob.mutation(api.comments.setCommentLike, {pathname, commentId: parentId, liked: true});
    const result = await t.query(api.comments.getSummary, {pathname});
    expect(result).toEqual({commentCount: 2, likeCount: 1});
    expect(Object.values(result).every(value => typeof value === "number")).toBe(true);
    expect(await t.query(api.comments.getSummary, {pathname: "/posts/%65xample"})).toEqual(result);
    await alice.mutation(api.comments.remove, {id: parentId});
    await alice.mutation(api.comments.remove, {id: parentId});
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 1, likeCount: 1});
  });

  test("bounded initialization is exact for existing rows and refuses truncated totals", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      for (let index = 0; index < 501; index++) await ctx.db.insert("comments", {...comment, authorName: "Existing author", owner: "test", createdAt: index});
    });
    await expect(t.query(api.comments.getSummary, {pathname})).rejects.toThrow("COUNTS_NOT_READY");
    await expect(alice.mutation(api.comments.add, comment)).rejects.toThrow("COUNTS_NOT_READY");
    expect(await t.run(ctx => ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).first())).toBeNull();
  });

  test("materialized counts serve large articles without scanning the comments", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      for (let index = 0; index < 501; index++) await ctx.db.insert("comments", {...comment, authorName: "Existing author", owner: "test", createdAt: index});
      await ctx.db.insert("commentStats", {pathname, commentCount: 501, likeCount: 0});
    });
    await alice.mutation(api.comments.add, comment);
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 502, likeCount: 0});
  });
});

describe("comment identity and deletion", () => {
  test("my comments require login and include only the same verified account's comments and replies", async () => {
    const {t, alice, bob} = setup();
    await expect(t.query(api.comments.listMine, {paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    const parentId = await bob.mutation(api.comments.add, {...comment, body: "Bob's private text"});
    const replyId = await alice.mutation(api.comments.add, {...comment, body: "Alice's reply", parentId});
    const ownId = await alice.mutation(api.comments.add, {...comment, pathname: "/posts/other/", body: "Alice's comment"});
    const rows = (await alice.query(api.comments.listMine, {paginationOpts})).page;
    expect(new Set(rows.map(row => row._id))).toEqual(new Set([replyId, ownId]));
    expect(rows.find(row => row._id === replyId)).toMatchObject({pathname, body: "Alice's reply", parentId, imageCount: 0});
    expect(JSON.stringify(rows)).not.toMatch(/Bob's private text|owner|tokenIdentifier|authorName|storageId|imageIds|https:/);
    const otherIssuer = t.withIdentity({...aliceIdentity, issuer: "https://other.example.test"});
    expect((await otherIssuer.query(api.comments.listMine, {paginationOpts})).page).toEqual([]);
    await expect(bob.query(api.comments.listMine, {
      paginationOpts,
      // @ts-expect-error A caller cannot choose whose comments to list.
      owner: `${aliceIdentity.issuer}|alice`,
    })).rejects.toThrow();
    await alice.mutation(api.comments.remove, {id: ownId});
    expect((await alice.query(api.comments.listMine, {paginationOpts})).page.map(row => row._id)).toEqual([replyId]);
    expect((await bob.query(api.comments.listMine, {paginationOpts})).page.map(row => row._id)).toEqual([parentId]);
  });

  test("my comments paginate active rows directly without deleted comments consuming page slots", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      for (let index = 0; index < 55; index++) await ctx.db.insert("comments", {
        ...comment, owner: `${aliceIdentity.issuer}|alice`, authorName: "Alice", createdAt: index,
        ...(index % 2 === 0 ? {deletedAt: 100, body: ""} : {}),
      });
    });
    const first = await alice.query(api.comments.listMine, {paginationOpts});
    const second = await alice.query(api.comments.listMine, {paginationOpts: {...paginationOpts, cursor: first.continueCursor}});
    expect(first.page).toHaveLength(20);
    expect(first.page[0].createdAt).toBe(53);
    expect(second.page).toHaveLength(7);
    expect(second.isDone).toBe(true);
    expect([...first.page, ...second.page].every(row => row.createdAt % 2 === 1)).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row._id)).size).toBe(27);
    for (const numItems of [0, 51, 1.5]) await expect(alice.query(api.comments.listMine, {paginationOpts: {numItems, cursor: null}})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.comments.listMine, {paginationOpts: {...paginationOpts, maximumRowsRead: 101}})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.comments.listMine, {paginationOpts: {...paginationOpts, maximumBytesRead: 1_000_001}})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("anonymous callers cannot read bodies, own likes or write", async () => {
    const {t, alice} = setup();
    const id = await alice.mutation(api.comments.add, comment);
    for (const call of [
      () => t.query(api.comments.list, {pathname, paginationOpts}),
      () => t.query(api.comments.getMyLike, {pathname}),
      () => t.mutation(api.comments.add, comment),
      () => t.mutation(api.comments.remove, {id}),
      () => t.mutation(api.comments.setLike, {pathname, liked: true}),
      () => t.mutation(api.comments.setCommentLike, {pathname, commentId: id, liked: true}),
    ]) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
  });

  test("the signed username is the sole public author; client author and private profile are rejected", async () => {
    const {alice} = setup();
    await expect(alice.mutation(api.comments.add, {
      ...comment,
      // @ts-expect-error Public names cannot be selected in the comment form.
      authorName: "Forged author",
    })).rejects.toThrow();
    await expect(alice.mutation(api.comments.add, {
      ...comment,
      // @ts-expect-error Ownership always comes from verified identity.
      owner: "bob",
    })).rejects.toThrow();
    await alice.mutation(api.comments.add, comment);
    const result = await alice.query(api.comments.list, {pathname, paginationOpts});
    expect(result.page[0].authorName).toBe("Alice");
    expect(JSON.stringify(result)).not.toMatch(/Private legal name|private@example|tokenIdentifier|owner|subject|issuer/);
  });

  test("missing username never falls back to email, full name, or user ID", async () => {
    const {t} = setup();
    for (const preferredUsername of [undefined, "", "\n", "x".repeat(81)]) {
      const user = t.withIdentity({...aliceIdentity, preferredUsername});
      await expect(user.mutation(api.comments.add, comment)).rejects.toThrow("USERNAME_UNAVAILABLE");
    }
    const nicknamed = t.withIdentity({...aliceIdentity, preferredUsername: undefined, nickname: "PublicNickname"});
    await nicknamed.mutation(api.comments.add, comment);
    expect((await nicknamed.query(api.comments.list, {pathname, paginationOpts})).page[0].authorName).toBe("PublicNickname");
  });

  test("only the owner or exact configured moderator may delete", async () => {
    const {t, alice, bob} = setup();
    const id = await alice.mutation(api.comments.add, comment);
    const otherIssuer = t.withIdentity({...aliceIdentity, issuer: "https://another.example.test"});
    const forgedRole = t.withIdentity({issuer: aliceIdentity.issuer, subject: "mallory", role: "admin"});
    for (const other of [bob, otherIssuer, forgedRole]) await expect(other.mutation(api.comments.remove, {id})).rejects.toThrow("FORBIDDEN");
    const tokenIdentifier = "https://auth.example.test|admin";
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", tokenIdentifier);
    const admin = t.withIdentity({issuer: aliceIdentity.issuer, subject: "admin", tokenIdentifier});
    expect((await admin.query(api.comments.list, {pathname, paginationOpts})).page[0].canDelete).toBe(true);
    await admin.mutation(api.comments.remove, {id});
    const deleted = (await alice.query(api.comments.list, {pathname, paginationOpts})).page[0];
    expect(deleted).toMatchObject({id, deleted: true, body: "", authorName: "已删除的评论", images: [], canDelete: false});
    expect(await t.run(ctx => ctx.db.get("comments", id))).toMatchObject({body: "", authorName: ""});
  });
});

describe("discussion and pagination", () => {
  test("multi-level replies retain their parent after deletion and across pagination", async () => {
    const {alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, comment);
    await expect(bob.mutation(api.comments.add, {...comment, pathname: "/posts/other/", parentId})).rejects.toThrow("INVALID_ARGUMENT");
    const replyId = await bob.mutation(api.comments.add, {...comment, body: "First reply", parentId});
    const followUpId = await alice.mutation(api.comments.add, {...comment, body: "A reply to Bob", parentId: replyId});
    const first = await bob.query(api.comments.list, {pathname, paginationOpts: {numItems: 1, cursor: null}});
    expect(first.page).toMatchObject([{id: followUpId, replyTo: {id: replyId, authorName: "Bob", deleted: false}}]);
    await alice.mutation(api.comments.remove, {id: parentId});
    const rows = (await bob.query(api.comments.list, {pathname, paginationOpts})).page;
    expect(rows.find(row => row.id === replyId)?.replyTo).toEqual({id: parentId, authorName: "已删除的评论", deleted: true});
    expect(rows.find(row => row.id === parentId)?.deleted).toBe(true);
    await expect(bob.mutation(api.comments.add, {...comment, parentId})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("corrupt cross-page parent links never disclose another article's author", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      const parentId = await ctx.db.insert("comments", {...comment, pathname: "/posts/other/", authorName: "Other article author", owner: "other", createdAt: 1});
      await ctx.db.insert("comments", {...comment, authorName: "Test", parentId, owner: "test", createdAt: 2});
    });
    const result = await alice.query(api.comments.list, {pathname, paginationOpts});
    expect(result.page[0].replyTo).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Other article author");
  });

  test("unsafe paths and ineligible pages are rejected by public and private endpoints", async () => {
    const {t, alice} = setup();
    for (const path of ["https://example.test/", "//example.test/", "/posts/a?b", "/posts/a#b", "/posts/a/../b", "/posts/%2e%2e/b", "/posts/a%2fb", "/posts/a\\b", "/posts/bad%", "/tags/example/", "/docs/", "/weekly/", "/chat/", "/"]) {
      await expect(t.query(api.comments.getSummary, {pathname: path})).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.query(api.comments.list, {pathname: path, paginationOpts})).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.mutation(api.comments.add, {...comment, pathname: path})).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.mutation(api.comments.setLike, {pathname: path, liked: true})).rejects.toThrow("INVALID_ARGUMENT");
    }
  });

  test("pagination is newest first, bounded and stable", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      for (let index = 0; index < 35; index++) await ctx.db.insert("comments", {...comment, authorName: "Test", owner: "test", createdAt: index});
    });
    const first = await alice.query(api.comments.list, {pathname, paginationOpts});
    const second = await alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, cursor: first.continueCursor}});
    expect(first.page).toHaveLength(20);
    expect(first.page[0].createdAt).toBe(34);
    expect(second.page).toHaveLength(15);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row.id)).size).toBe(35);
    for (const numItems of [0, 31, -1, 1.5, NaN, Infinity]) await expect(alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, numItems}})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, maximumRowsRead: 61}})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("plain text is preserved, empty comments and invalid bodies are rejected", async () => {
    const {alice} = setup();
    for (const body of [" ", "x".repeat(4_001), "nul\u0000byte"]) await expect(alice.mutation(api.comments.add, {...comment, body})).rejects.toThrow("INVALID_ARGUMENT");
    const body = "<script>alert('text')</script>\n[link](javascript:alert(1))";
    await alice.mutation(api.comments.add, {...comment, body});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page[0].body).toBe(body);
  });
});

describe("likes and throttling", () => {
  test("liked article lists use the same rows, isolate accounts and reflect unlike immediately", async () => {
    const {t, alice, bob} = setup();
    await expect(t.query(api.comments.listLikedArticles, {paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    await alice.mutation(api.comments.setLike, {pathname, liked: true, title: "Example article"});
    await bob.mutation(api.comments.setLike, {pathname: "/posts/other/", liked: true, title: "Other article"});
    const rows = (await alice.query(api.comments.listLikedArticles, {paginationOpts})).page;
    expect(rows).toEqual([{pathname, title: "Example article", createdAt: expect.any(Number)}]);
    expect(JSON.stringify(rows)).not.toMatch(/owner|tokenIdentifier|Other article/);
    const otherIssuer = t.withIdentity({...aliceIdentity, issuer: "https://other.example.test"});
    expect((await otherIssuer.query(api.comments.listLikedArticles, {paginationOpts})).page).toEqual([]);
    await expect(alice.query(api.comments.listLikedArticles, {
      paginationOpts,
      // @ts-expect-error A caller cannot select another user's likes.
      owner: "bob",
    })).rejects.toThrow();
    await alice.mutation(api.comments.setLike, {pathname, liked: false});
    expect((await alice.query(api.comments.listLikedArticles, {paginationOpts})).page).toEqual([]);
    expect((await bob.query(api.comments.listLikedArticles, {paginationOpts})).page).toHaveLength(1);
  });

  test("liked articles page newest first, retain legacy rows and validate metadata", async () => {
    const {t, alice} = setup();
    const owner = `${aliceIdentity.issuer}|${aliceIdentity.subject}`;
    await t.run(async ctx => {
      await ctx.db.insert("articleLikes", {pathname: "/posts/legacy/", owner});
      for (let index = 0; index < 25; index++) await ctx.db.insert("articleLikes", {pathname: `/posts/article-${index}/`, owner, title: `Article ${index}`, createdAt: index});
    });
    const first = await alice.query(api.comments.listLikedArticles, {paginationOpts});
    const second = await alice.query(api.comments.listLikedArticles, {paginationOpts: {...paginationOpts, cursor: first.continueCursor}});
    expect(first.page[0].title).toBe("Article 24");
    expect(first.page).toHaveLength(20);
    expect(second.page).toHaveLength(6);
    expect(second.page.at(-1)).toMatchObject({pathname: "/posts/legacy/", title: "/posts/legacy/", createdAt: expect.any(Number)});
    expect(new Set([...first.page, ...second.page].map(row => row.pathname)).size).toBe(26);
    for (const title of ["", "x".repeat(161), "bad\u0000title"]) await expect(alice.mutation(api.comments.setLike, {pathname, liked: true, title})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.comments.listLikedArticles, {paginationOpts: {numItems: 51, cursor: null}})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.comments.listLikedArticles, {paginationOpts: {...paginationOpts, maximumRowsRead: 101}})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("article likes are canonical, unique by verified identity and idempotent", async () => {
    const {t, alice, bob} = setup();
    for (let index = 0; index < 15; index++) await alice.mutation(api.comments.setLike, {pathname: "/posts/%65xample", liked: true});
    expect(await bob.query(api.comments.getMyLike, {pathname})).toBe(false);
    await bob.mutation(api.comments.setLike, {pathname, liked: true});
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 0, likeCount: 2});
    await alice.mutation(api.comments.setLike, {pathname, liked: false});
    await alice.mutation(api.comments.setLike, {pathname, liked: false});
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 0, likeCount: 1});
    expect(await bob.query(api.comments.getMyLike, {pathname})).toBe(true);
    await expect(alice.mutation(api.comments.setLike, {
      pathname, liked: true,
      // @ts-expect-error Likes cannot be attributed to another identity.
      owner: "bob",
    })).rejects.toThrow();
  });

  test("comment likes are isolated, idempotent and unavailable after deletion", async () => {
    const {t, alice, bob} = setup();
    const commentId = await alice.mutation(api.comments.add, comment);
    for (let index = 0; index < 15; index++) await bob.mutation(api.comments.setCommentLike, {pathname, commentId, liked: true});
    const aliceView = (await alice.query(api.comments.list, {pathname, paginationOpts})).page[0];
    const bobView = (await bob.query(api.comments.list, {pathname, paginationOpts})).page[0];
    expect(aliceView).toMatchObject({likeCount: 1, likedByMe: false});
    expect(bobView).toMatchObject({likeCount: 1, likedByMe: true});
    expect((await t.query(api.comments.getSummary, {pathname})).likeCount).toBe(0);
    await expect(bob.mutation(api.comments.setCommentLike, {pathname: "/posts/other/", commentId, liked: false})).rejects.toThrow("INVALID_ARGUMENT");
    await bob.mutation(api.comments.setCommentLike, {pathname, commentId, liked: false});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page[0].likeCount).toBe(0);
    await alice.mutation(api.comments.remove, {id: commentId});
    await expect(bob.mutation(api.comments.setCommentLike, {pathname, commentId, liked: true})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("concurrent likes preserve one identity row and an exact total", async () => {
    const {t, alice, bob} = setup();
    await Promise.all([alice.mutation(api.comments.setLike, {pathname, liked: true}), alice.mutation(api.comments.setLike, {pathname, liked: true}), bob.mutation(api.comments.setLike, {pathname, liked: true})]);
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 0, likeCount: 2});
  });

  test("writes throttle identities separately, while idempotent likes do not consume extra quota", async () => {
    vi.useFakeTimers();
    const {alice, bob} = setup();
    for (let index = 0; index < 3; index++) await alice.mutation(api.comments.add, comment);
    await expect(alice.mutation(api.comments.add, comment)).rejects.toThrow();
    await expect(bob.mutation(api.comments.add, comment)).resolves.toBeTruthy();
    for (let index = 0; index < 10; index++) await alice.mutation(api.comments.setLike, {pathname, liked: index % 2 === 0});
    await expect(alice.mutation(api.comments.setLike, {pathname, liked: true})).rejects.toThrow();
    await expect(bob.mutation(api.comments.setLike, {pathname, liked: true})).resolves.toBe(true);
    vi.advanceTimersByTime(10_001);
    await expect(alice.mutation(api.comments.add, comment)).resolves.toBeTruthy();
  });
});
