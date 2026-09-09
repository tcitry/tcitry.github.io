/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, describe, expect, test, vi} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const pathname = "/posts/example/";
const paginationOpts = {numItems: 20, cursor: null};
const comment = {pathname, authorName: "读者自己填写的昵称", body: "A thoughtful comment."};

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const alice = t.withIdentity({issuer: "https://auth.example.test", subject: "alice", name: "Private legal name", email: "private@example.test"});
  const bob = t.withIdentity({issuer: "https://auth.example.test", subject: "bob"});
  return {t, alice, bob};
}

afterEach(() => {vi.unstubAllEnvs(); vi.useRealTimers();});

describe("comment authentication and authorization", () => {
  test("anonymous callers cannot read authors, bodies, totals or mutate comments", async () => {
    const {t, alice} = setup();
    const id = await alice.mutation(api.comments.add, comment);
    await expect(t.query(api.comments.list, {pathname, paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.comments.add, comment)).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.comments.remove, {id})).rejects.toThrow("UNAUTHENTICATED");
  });

  test("authenticated readers can read comments; only the owner can delete", async () => {
    const {alice, bob} = setup();
    const id = await alice.mutation(api.comments.add, comment);
    const result = await bob.query(api.comments.list, {pathname, paginationOpts});
    expect(result.page).toMatchObject([{id, body: comment.body, authorName: comment.authorName, canDelete: false}]);
    await expect(bob.mutation(api.comments.remove, {id})).rejects.toThrow("FORBIDDEN");
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page[0].canDelete).toBe(true);
    await alice.mutation(api.comments.remove, {id});
    expect((await bob.query(api.comments.list, {pathname, paginationOpts})).page).toEqual([]);
  });

  test("identical subjects from different issuers cannot claim ownership", async () => {
    const {t, alice} = setup();
    const otherIssuer = t.withIdentity({issuer: "https://another.example.test", subject: "alice"});
    const id = await alice.mutation(api.comments.add, comment);
    await expect(otherIssuer.mutation(api.comments.remove, {id})).rejects.toThrow("FORBIDDEN");
  });

  test("only the exact configured tokenIdentifier can moderate other authors", async () => {
    const {t, alice, bob} = setup();
    const tokenIdentifier = "https://auth.example.test|admin";
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", tokenIdentifier);
    const admin = t.withIdentity({issuer: "https://auth.example.test", subject: "admin", tokenIdentifier});
    const forgedRole = t.withIdentity({issuer: "https://auth.example.test", subject: "mallory", role: "admin", email: "admin@example.test"});
    const id = await alice.mutation(api.comments.add, comment);
    await expect(forgedRole.mutation(api.comments.remove, {id})).rejects.toThrow("FORBIDDEN");
    await expect(bob.mutation(api.comments.remove, {id})).rejects.toThrow("FORBIDDEN");
    expect((await admin.query(api.comments.list, {pathname, paginationOpts})).page[0].canDelete).toBe(true);
    await admin.mutation(api.comments.remove, {id});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page).toEqual([]);
  });

  test("nickname is explicitly supplied; Clerk profile and ownership never leave the server", async () => {
    const {t, alice} = setup();
    await expect(alice.mutation(api.comments.add, {...comment, authorName: "  "})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.mutation(api.comments.add, {
      ...comment,
      // @ts-expect-error Ownership cannot be chosen by the client.
      owner: "bob",
    })).rejects.toThrow();
    await alice.mutation(api.comments.add, comment);
    const result = await alice.query(api.comments.list, {pathname, paginationOpts});
    expect(Object.keys(result.page[0]).sort()).toEqual(["authorName", "body", "canDelete", "createdAt", "id"]);
    expect(JSON.stringify(result)).not.toMatch(/Private legal name|private@example|tokenIdentifier|owner|subject|issuer/);
    const rows = await t.run(ctx => ctx.db.query("comments").take(1));
    expect(JSON.stringify(rows)).not.toMatch(/Private legal name|private@example/);
  });
});

describe("comment validation and navigation", () => {
  test("equivalent URL encodings and a trailing slash use one thread", async () => {
    const {alice} = setup();
    await alice.mutation(api.comments.add, {...comment, pathname: "/posts/%65xample"});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page).toHaveLength(1);
    expect((await alice.query(api.comments.list, {pathname: "/posts/other/", paginationOpts})).page).toEqual([]);
  });

  test("unsafe pathnames and ineligible top-level pages are rejected", async () => {
    const {alice} = setup();
    for (const value of ["https://example.test/", "//example.test/", "/posts/a?b", "/posts/a#b", "/posts/a/../b", "/posts/%2e%2e/b", "/posts/a%2fb", "/posts/a\\b", "/posts/bad%", "/tags/example/", "/categories/topic/", "/docs/", "/weekly/", "/me/", "/chat/", "/"]) {
      await expect(alice.mutation(api.comments.add, {...comment, pathname: value})).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.query(api.comments.list, {pathname: value, paginationOpts})).rejects.toThrow("INVALID_ARGUMENT");
    }
  });

  test("plain text is preserved and large or control-character payloads are rejected", async () => {
    const {alice} = setup();
    for (const body of [" ", "a".repeat(4_001), "nul\u0000byte"]) {
      await expect(alice.mutation(api.comments.add, {...comment, body})).rejects.toThrow("INVALID_ARGUMENT");
    }
    for (const authorName of ["a".repeat(41), "line\nbreak"]) {
      await expect(alice.mutation(api.comments.add, {...comment, authorName})).rejects.toThrow("INVALID_ARGUMENT");
    }
    const body = "<script>alert('text')</script>\n[link](javascript:alert(1))";
    const authorName = '<img src=x onerror="alert(1)">';
    await alice.mutation(api.comments.add, {...comment, body, authorName});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page[0]).toMatchObject({body, authorName});
  });

  test("replies stay in the same article and survive parent deletion without leaking another article", async () => {
    const {alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, comment);
    await expect(bob.mutation(api.comments.add, {...comment, pathname: "/posts/other/", parentId})).rejects.toThrow("INVALID_ARGUMENT");
    const replyId = await bob.mutation(api.comments.add, {...comment, authorName: "Bob", body: "Reply", parentId});
    const result = await alice.query(api.comments.list, {pathname, paginationOpts});
    expect(result.page.find(row => row.id === replyId)?.replyTo).toEqual({id: parentId, authorName: comment.authorName});
    await alice.mutation(api.comments.remove, {id: parentId});
    expect((await bob.query(api.comments.list, {pathname, paginationOpts})).page).toMatchObject([{id: replyId, body: "Reply"}]);
    expect((await bob.query(api.comments.list, {pathname, paginationOpts})).page[0].replyTo).toBeUndefined();
  });
});

describe("comment pagination and throttling", () => {
  test("pagination is indexed, bounded and newest first", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      for (let index = 0; index < 35; index++) await ctx.db.insert("comments", {...comment, owner: "test", createdAt: index});
      await ctx.db.insert("comments", {...comment, pathname: "/posts/other/", owner: "test", createdAt: 100});
    });
    const first = await alice.query(api.comments.list, {pathname, paginationOpts});
    expect(first.page).toHaveLength(20);
    expect(first.page[0].createdAt).toBe(34);
    expect(first.isDone).toBe(false);
    const second = await alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, cursor: first.continueCursor}});
    expect(second.page).toHaveLength(15);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row.id)).size).toBe(35);
    for (const numItems of [0, 31, -1, 1.5, NaN, Infinity]) {
      await expect(alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, numItems}})).rejects.toThrow("INVALID_ARGUMENT");
    }
    await expect(alice.query(api.comments.list, {pathname, paginationOpts: {...paginationOpts, maximumRowsRead: 61}})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("the shared rate limiter throttles each verified identity separately", async () => {
    vi.useFakeTimers();
    const {alice, bob} = setup();
    for (let index = 0; index < 3; index++) await alice.mutation(api.comments.add, comment);
    await expect(alice.mutation(api.comments.add, comment)).rejects.toThrow();
    await expect(bob.mutation(api.comments.add, comment)).resolves.toBeTruthy();
    vi.advanceTimersByTime(10_001);
    await expect(alice.mutation(api.comments.add, comment)).resolves.toBeTruthy();
  });
});
