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
    author: t.withIdentity({issuer, subject: "author"}),
  };
}
afterEach(() => vi.unstubAllEnvs());

describe("private reply notifications", () => {
  test("comment replies notify only the saved parent owner without storing bodies or images", async () => {
    const {t, alice, bob} = setup();
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(false);
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Private parent content"});
    const replyId = await bob.mutation(api.comments.add, {pathname, body: "Private reply content", parentId});
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await bob.query(api.notifications.hasUnread, {})).toBe(false);
    const aliceInbox = (await alice.query(api.notifications.list, {paginationOpts})).page;
    expect(aliceInbox).toEqual([{
      _id: expect.any(String), kind: "comment_reply", createdAt: expect.any(Number), readAt: null,
      target: {kind: "comment", pathname, commentId: replyId},
    }]);
    expect((await bob.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    const raw = await t.run(ctx => ctx.db.query("notifications").take(5));
    expect(raw[0].recipient).toBe(`${issuer}|alice`);
    expect(JSON.stringify(raw)).not.toMatch(/Private|body|images|authorName/);
    const nextReply = await alice.mutation(api.comments.add, {pathname, body: "Reply to Bob", parentId: replyId});
    expect((await bob.query(api.notifications.list, {paginationOpts})).page[0].target).toEqual({kind: "comment", pathname, commentId: nextReply});
    await alice.mutation(api.comments.add, {pathname, body: "Reply to self", parentId});
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toHaveLength(1);
  });

  test("anonymous and other accounts cannot list or mark another recipient's notification", async () => {
    const {t, alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    const id = (await alice.query(api.notifications.list, {paginationOpts})).page[0]._id;
    await expect(t.query(api.notifications.list, {paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.query(api.notifications.hasUnread, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.notifications.markRead, {id})).rejects.toThrow("UNAUTHENTICATED");
    for (const outsider of [bob, t.withIdentity({...aliceIdentity, issuer: "https://other.example.test"})]) {
      expect((await outsider.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
      expect(await outsider.query(api.notifications.hasUnread, {})).toBe(false);
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
    expect(await alice.query(api.notifications.hasUnread, {})).toBe(true);
  });

  test("only successful author replies create one notification; replay is idempotent and expired members retain access", async () => {
    const {t, alice, bob, author} = setup();
    const threadId = await alice.action(api.consultations.start, {title: "Private consultation title", content: "Private first message", requestId: "request_create_0001"});
    const reply = {threadId, content: "Private author reply", requestId: "request_reply_00001"};
    await expect(bob.action(api.consultations.reply, reply)).rejects.toThrow("NOT_FOUND");
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    const messageId = await author.action(api.consultations.reply, reply);
    await author.action(api.consultations.reply, reply);
    await alice.action(api.consultations.send, {threadId, content: "Private followup", requestId: "request_followup_01"});
    const lapsed = t.withIdentity({...aliceIdentity, pla: "u:free"});
    const notifications = (await lapsed.query(api.notifications.list, {paginationOpts})).page;
    expect(await lapsed.query(api.notifications.hasUnread, {})).toBe(true);
    expect(await author.query(api.notifications.hasUnread, {})).toBe(false);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({kind: "consultation_reply", target: {kind: "consultation", threadId, messageId, title: "Private consultation title"}});
    expect(JSON.stringify(notifications)).not.toMatch(/Private author reply|Private first message|Private followup/);
    expect(JSON.stringify(await t.run(ctx => ctx.db.query("notifications").take(5)))).not.toMatch(/Private/);
    expect((await author.query(api.notifications.list, {paginationOpts})).page).toEqual([]);
    await alice.mutation(api.consultations.close, {threadId});
    await expect(author.action(api.consultations.reply, {...reply, requestId: "request_closed_0001"})).rejects.toThrow("THREAD_CLOSED");
    expect((await alice.query(api.notifications.list, {paginationOpts})).page).toHaveLength(1);
    // Reading a stored notification rechecks current consultation access.
    await t.run(ctx => ctx.db.patch("consultationThreads", threadId, {owner: `${issuer}|other`}));
    expect((await alice.query(api.notifications.list, {paginationOpts})).page[0].target).toBeNull();
  });

  test("failed cross-page replies create no notifications and callers cannot supply recipients", async () => {
    const {t, alice, bob} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await expect(bob.mutation(api.comments.add, {pathname: "/posts/other/", body: "Wrong page", parentId})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(bob.mutation(api.comments.add, {
      pathname, body: "Forged recipient", parentId,
      // @ts-expect-error Reply recipients cannot be chosen by the sender.
      recipient: `${issuer}|other`,
    })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("notifications").take(1))).toEqual([]);
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
      const first = await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", createdAt: 1});
      const second = await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "consultation_reply", createdAt: 2});
      for (let index = 0; index < 30; index++) {
        await ctx.db.insert("notifications", {recipient: `${issuer}|alice`, kind: "comment_reply", createdAt: 10 + index, readAt: index});
      }
      await ctx.db.insert("notifications", {recipient: `${issuer}|bob`, kind: "comment_reply", createdAt: 100});
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
    expect(await bob.query(api.notifications.hasUnread, {})).toBe(true);
    expect((await t.run(ctx => ctx.db.get("notifications", oldUnread)))?.readAt).toEqual(expect.any(Number));
  });
});
