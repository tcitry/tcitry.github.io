/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, describe, expect, test, vi} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const pathname = "/posts/example/";
const paginationOpts = {numItems: 20, cursor: null};
const aliceIdentity = {issuer, subject: "alice", preferredUsername: "Alice", v: 2, sid: "session_alice", pla: "u:pro"};
function setup() {
  vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro");
  vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", `${issuer}|author`);
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {
    t, alice: t.withIdentity(aliceIdentity),
    bob: t.withIdentity({issuer, subject: "bob", preferredUsername: "Bob"}),
    author: t.withIdentity({issuer, subject: "author", preferredUsername: "Author"}),
  };
}
afterEach(() => vi.unstubAllEnvs());

describe("private reply notifications", () => {
  test("comment replies notify only the saved parent owner without storing bodies or images", async () => {
    const {t, alice, bob, author} = setup();
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Private parent content"});
    expect(await author.query(api.notifications.unreadCount, {})).toBe(1);
    expect((await author.query(api.notifications.list, {paginationOpts})).page[0]).toMatchObject({
      kind: "new_comment", target: {kind: "comment", pathname, commentId: parentId, threaded: false},
    });
    const replyId = await bob.mutation(api.comments.add, {pathname, body: "Private reply content", parentId});
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await bob.query(api.notifications.hasUnread, {})).toBe(false);
    expect(await author.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(1);
    expect(await author.query(api.notifications.unreadCount, {})).toBe(2);
    const aliceInbox = (await alice.query(api.notifications.list, {paginationOpts})).page;
    expect(aliceInbox).toEqual([{
      _id: expect.any(String), kind: "comment_reply", createdAt: expect.any(Number), readAt: null,
      target: {kind: "comment", pathname, commentId: replyId},
    }]);
    expect((await bob.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    expect((await author.query(api.notifications.list, {paginationOpts})).page[0]).toEqual({
      _id: expect.any(String), kind: "new_comment", createdAt: expect.any(Number), readAt: null,
      target: {kind: "comment", pathname, commentId: replyId, threaded: true},
    });
    const raw = await t.run(ctx => ctx.db.query("notifications").take(5));
    expect(new Set(raw.map(row => row.recipient))).toEqual(new Set([`${issuer}|alice`, `${issuer}|author`]));
    expect(JSON.stringify(raw)).not.toMatch(/Private|body|images|authorName/);
    const nextReply = await alice.mutation(api.comments.add, {pathname, body: "Reply to Bob", parentId: replyId});
    expect((await bob.query(api.notifications.list, {paginationOpts})).page[0].target).toEqual({kind: "comment", pathname, commentId: nextReply});
    expect((await author.query(api.notifications.list, {paginationOpts})).page[0].target).toEqual({kind: "comment", pathname, commentId: nextReply, threaded: true});
    await alice.mutation(api.comments.add, {pathname, body: "Reply to self", parentId});
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toHaveLength(1);
    expect(await author.query(api.notifications.unreadCount, {})).toBe(4);
  });

  test("anonymous and other accounts cannot list or mark another recipient's notification", async () => {
    const {t, alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    const id = (await alice.query(api.notifications.list, {paginationOpts})).page[0]._id;
    await expect(t.query(api.notifications.list, {paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.query(api.notifications.hasUnread, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.query(api.notifications.unreadCount, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.notifications.markRead, {id})).rejects.toThrow("UNAUTHENTICATED");
    for (const outsider of [bob, t.withIdentity({...aliceIdentity, issuer: "https://other.example.test"})]) {
      expect((await outsider.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
      expect(await outsider.query(api.notifications.unreadCount, {})).toBe(0);
      await expect(outsider.mutation(api.notifications.markRead, {id})).rejects.toThrow("NOT_FOUND");
    }
    await expect(bob.query(api.notifications.list, {
      paginationOpts,
      // @ts-expect-error The recipient is always the authenticated identity.
      recipient: `${issuer}|alice`,
    })).rejects.toThrow();
    await expect(bob.query(api.notifications.hasUnread, {
      // @ts-expect-error The recipient is always the authenticated identity.
      recipient: `${issuer}|alice`,
    })).rejects.toThrow();
    await alice.mutation(api.notifications.markRead, {id});
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(0);
    const readAt = (await alice.query(api.notifications.list, {paginationOpts})).page[0].readAt;
    expect(readAt).toEqual(expect.any(Number));
    await alice.mutation(api.notifications.markRead, {id});
    expect((await alice.query(api.notifications.list, {paginationOpts})).page[0].readAt).toBe(readAt);
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
  });

  test("deleted comments never leak removed content and unavailable replies cannot be opened", async () => {
    const {alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Erase parent"});
    const replyId = await bob.mutation(api.comments.add, {pathname, body: "Erase reply", parentId});
    await alice.mutation(api.comments.remove, {id: parentId});
    const inbox = (await alice.query(api.notifications.list, {paginationOpts})).page;
    expect(inbox[0].target).toEqual({kind: "comment", pathname, commentId: replyId});
    expect(JSON.stringify(inbox)).not.toMatch(/Erase parent|Erase reply/);
    await bob.mutation(api.comments.remove, {id: replyId});
    expect((await alice.query(api.notifications.list, {paginationOpts})).page[0].target).toBeNull();
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(0);
  });

  test("only successful author replies create one notification; replay is idempotent and expired members retain access", async () => {
    const {t, alice, bob, author} = setup();
    const threadId = await alice.action(api.consultations.start, {title: "Private consultation title", content: "Private first message", requestId: "request_create_0001"});
    const reply = {threadId, content: "Private author reply", requestId: "request_reply_00001"};
    await expect(bob.action(api.consultations.reply, reply)).rejects.toThrow("NOT_FOUND");
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    expect((await author.query(api.notifications.list, {paginationOpts})).page).toEqual([{
      _id: expect.any(String), kind: "consultation_message", createdAt: expect.any(Number), readAt: null,
      target: expect.objectContaining({kind: "consultation", threadId, title: "Private consultation title"}),
    }]);
    const messageId = await author.action(api.consultations.reply, reply);
    await author.action(api.consultations.reply, reply);
    const followupId = await alice.action(api.consultations.send, {threadId, content: "Private followup", requestId: "request_followup_01"});
    const lapsed = t.withIdentity({...aliceIdentity, pla: "u:free"});
    const notifications = (await lapsed.query(api.notifications.list, {paginationOpts})).page;
    expect(await lapsed.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await author.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await author.query(api.notifications.unreadCount, {})).toBe(2);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({kind: "consultation_reply", target: {kind: "consultation", threadId, messageId, title: "Private consultation title"}});
    expect(JSON.stringify(notifications)).not.toMatch(/Private author reply|Private first message|Private followup/);
    expect(JSON.stringify(await t.run(ctx => ctx.db.query("notifications").take(5)))).not.toMatch(/Private/);
    expect((await author.query(api.notifications.list, {paginationOpts})).page.map(row => row.target)).toEqual([
      {kind: "consultation", threadId, messageId: followupId, title: "Private consultation title"},
      expect.objectContaining({kind: "consultation", threadId, title: "Private consultation title"}),
    ]);
    await alice.mutation(api.consultations.close, {threadId});
    await expect(author.action(api.consultations.reply, {...reply, requestId: "request_closed_0001"})).rejects.toThrow("THREAD_CLOSED");
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toHaveLength(1);
    // Reading a stored notification rechecks current consultation access.
    await t.run(ctx => ctx.db.patch("consultationThreads", threadId, {owner: `${issuer}|other`}));
    expect((await alice.query(api.notifications.list, {paginationOpts})).page[0].target).toBeNull();
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(0);
  });

  test("failed cross-page replies create no notifications and callers cannot supply recipients", async () => {
    const {t, alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    expect(await t.run(ctx => ctx.db.query("notifications").collect())).toHaveLength(1);
    await expect(bob.mutation(api.comments.add, {pathname: "/posts/other/", body: "Wrong page", parentId})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(bob.mutation(api.comments.add, {
      pathname, body: "Forged recipient", parentId,
      // @ts-expect-error Reply recipients cannot be chosen by the sender.
      recipient: `${issuer}|other`,
    })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("notifications").collect())).toHaveLength(1);
  });

  test("notifications paginate newest first without leaking other recipients", async () => {
    const {t, alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    const commentId = await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    await t.run(async ctx => {
      for (let index = 1; index <= 25; index++) await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", commentId, createdAt: Date.now() + index});
      await ctx.db.insert("notifications", {recipient: `${issuer}|other`, kind: "comment_reply", commentId, createdAt: Date.now() + 100});
    });
    const first = await alice.query(api.notifications.list, {paginationOpts});
    const second = await alice.query(api.notifications.list, {paginationOpts: {...paginationOpts, cursor: first.continueCursor}});
    expect(first.page).toHaveLength(20);
    expect(second.page).toHaveLength(6);
    expect(first.page[0].createdAt).toBeGreaterThan(first.page[1].createdAt);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(row => row._id)).size).toBe(26);
    await expect(alice.query(api.notifications.list, {paginationOpts: {numItems: 51, cursor: null}})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.query(api.notifications.list, {paginationOpts: {...paginationOpts, maximumRowsRead: 101}})).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("unread lookup includes older pages and ignores every defined read timestamp and other recipients", async () => {
    const {t, alice, bob} = setup();
    const [oldUnread, secondUnread] = await t.run(async ctx => {
      const parentId = await ctx.db.insert("comments", {pathname, owner: `${issuer}|alice`, authorName: "Alice", body: "Parent", createdAt: 0});
      const replyId = await ctx.db.insert("comments", {pathname, owner: `${issuer}|bob`, authorName: "Bob", body: "Reply", createdAt: 1, parentId});
      const bobParent = await ctx.db.insert("comments", {pathname, owner: `${issuer}|bob`, authorName: "Bob", body: "Bob parent", createdAt: 2});
      const bobReply = await ctx.db.insert("comments", {pathname, owner: `${issuer}|alice`, authorName: "Alice", body: "Reply to Bob", createdAt: 3, parentId: bobParent});
      const threadId = await ctx.db.insert("consultationThreads", {
        owner: `${issuer}|alice`, title: "Thread", status: "replied", createdAt: 0, updatedAt: 1, requestId: "request_unread_lookup",
      });
      const messageId = await ctx.db.insert("consultationMessages", {
        threadId, sender: "author", content: "Author reply", createdAt: 1, requestId: "request_unread_msg01", senderIdentity: `${issuer}|author`,
      });
      const first = await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", commentId: replyId, createdAt: 1});
      const second = await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "consultation_reply", threadId, messageId, createdAt: 2});
      for (let index = 0; index < 30; index++) {
        await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", commentId: replyId, createdAt: 10 + index, readAt: index});
      }
      await ctx.db.insert("notifications", {recipient: `${issuer}|bob`, kind: "comment_reply", commentId: bobReply, createdAt: 100});
      return [first, second];
    });
    const firstPage = await alice.query(api.notifications.list, {paginationOpts});
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.page.every(row => row.readAt !== null)).toBe(true);
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
    await alice.mutation(api.notifications.markRead, {id: oldUnread});
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
    await alice.mutation(api.notifications.markRead, {id: secondUnread});
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await bob.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await bob.query(api.notifications.unreadCount, {})).toBe(1);
    expect((await t.run(ctx => ctx.db.get("notifications", oldUnread)))?.readAt).toEqual(expect.any(Number));
  });

  test("author sees new comments and threaded replies without duplicating a reply on the author's own comment", async () => {
    const {t, alice, bob, author} = setup();
    const topId = await alice.mutation(api.comments.add, {pathname, body: "Top-level"});
    const authorParent = await author.mutation(api.comments.add, {pathname, body: "Author parent"});
    const replyOnAuthor = await bob.mutation(api.comments.add, {pathname, body: "Reply on author", parentId: authorParent});
    const authorOwn = await author.mutation(api.comments.add, {pathname, body: "Author reply to self", parentId: authorParent});
    expect((await author.query(api.notifications.list, {paginationOpts})).page.map(row => row.target)).toEqual([
      {kind: "comment", pathname, commentId: replyOnAuthor},
      {kind: "comment", pathname, commentId: topId, threaded: false},
    ]);
    expect((await author.query(api.notifications.list, {paginationOpts})).page.map(row => row.kind)).toEqual(["comment_reply", "new_comment"]);
    expect(await author.query(api.notifications.unreadCount, {})).toBe(2);
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    expect(JSON.stringify(await t.run(ctx => ctx.db.query("notifications").take(10)))).not.toMatch(/Top-level|Author parent|Reply on author|Author reply to self/);
    expect(authorOwn).toEqual(expect.any(String));
  });

  test("unconfigured author identity creates no site-wide notifications", async () => {
    const {t, alice, bob, author} = setup();
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", "");
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    expect((await author.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("notifications").collect())).toHaveLength(1);
  });

  test("unreadCount caps the badge without scanning every read row", async () => {
    const {t, alice} = setup();
    await t.run(async ctx => {
      const parentId = await ctx.db.insert("comments", {pathname, owner: `${issuer}|alice`, authorName: "Alice", body: "Parent", createdAt: 0});
      const commentId = await ctx.db.insert("comments", {pathname, owner: `${issuer}|bob`, authorName: "Bob", body: "Reply", createdAt: 1, parentId});
      for (let index = 0; index < 120; index++) {
        await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", commentId, createdAt: index});
      }
      for (let index = 0; index < 40; index++) {
        await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "new_comment", commentId, createdAt: 200 + index, readAt: index});
      }
    });
    expect(await alice.query(api.notifications.unreadCount, {})).toBe(100);
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
  });
});
