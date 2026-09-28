/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import process from "node:process";
import {api, internal} from "./_generated/api";
import type {Id} from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const pathname = "/posts/example/";
const paginationOpts = {numItems: 20, cursor: null};
const webhookSecret = "whsec_dGVzdC13ZWJob29rLXNlY3JldA==";
const aliceIdentity = {
  issuer, subject: "alice", preferredUsername: "Alice", email: "alice@example.test", emailVerified: true,
};
const bobIdentity = {issuer, subject: "bob", preferredUsername: "Bob", email: "bob@example.test", emailVerified: true};

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {
    t,
    alice: t.withIdentity(aliceIdentity),
    bob: t.withIdentity(bobIdentity),
    author: t.withIdentity({issuer, subject: "author", preferredUsername: "Author", email: "author@example.test", emailVerified: true}),
  };
}

async function latestReplyNotificationId(t: ReturnType<typeof setup>["t"], recipient?: string) {
  const rows = await t.run(ctx => ctx.db.query("notifications").order("desc").collect());
  const row = rows.find(entry => entry.kind === "comment_reply" && (!recipient || entry.recipient === recipient));
  if (!row) throw new Error("missing comment_reply notification");
  return row._id;
}

beforeEach(() => {
  process.env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER = `${issuer}|author`;
  process.env.SITE_URL = "https://yindongliang.com";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({id: "email_123"}), {status: 200})));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.SITE_URL;
  delete process.env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER;
});

describe("email preferences", () => {
  test("defaults enable comment replies and likes; site owner also gets new comments; newsletter stays off", async () => {
    const {alice, author} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    const member = await alice.query(api.emailPreferences.getMine, {});
    const owner = await author.query(api.emailPreferences.getMine, {});
    expect(member).toMatchObject({
      enabled: true, commentReply: true, likes: true, newComment: false, newsletter: false, cachedEmail: "alice@example.test",
    });
    expect(owner).toMatchObject({
      enabled: true, commentReply: true, likes: true, newComment: true, newsletter: false, cachedEmail: "author@example.test",
    });
  });

  test("unverified email is not cached and send is skipped", async () => {
    const {t, alice} = setup();
    const anon = t.withIdentity({...aliceIdentity, email: "alice@example.test", emailVerified: false});
    await anon.mutation(api.comments.add, {pathname, body: "Hello"});
    expect(await anon.query(api.emailPreferences.getMine, {})).toMatchObject({cachedEmail: null});
  });
});

describe("comment reply emails", () => {
  test("self-reply does not send email", async () => {
    const {alice, t} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent", articleTitle: "示例文章"});
    await alice.mutation(api.comments.add, {pathname, body: "Reply to self", parentId, articleTitle: "示例文章"});
    const replyNotifications = await t.run(ctx => ctx.db.query("notifications").filter(q => q.eq(q.field("kind"), "comment_reply")).collect());
    expect(replyNotifications).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("emailSendLog").collect())).toHaveLength(0);
  });

  test("reply notification sends one email with idempotency and skips duplicate processing", async () => {
    const {alice, t} = setup();
    const notificationId = await t.run(async ctx => {
      await ctx.db.insert("emailPreferences", {
        owner: `${issuer}|alice`, enabled: true, commentReply: true, likes: true, newComment: false, newsletter: false,
        unsubscribeToken: "token-alice", cachedEmail: "alice@example.test", updatedAt: Date.now(),
      });
      const parentId = await ctx.db.insert("comments", {
        pathname, owner: `${issuer}|alice`, authorName: "Alice", body: "Parent", createdAt: 1, articleTitle: "示例文章",
      });
      const replyId = await ctx.db.insert("comments", {
        pathname, owner: `${issuer}|bob`, authorName: "Bob", body: "Thanks **friend**", createdAt: 2, parentId, articleTitle: "示例文章",
      });
      void replyId;
      return await ctx.db.insert("notifications", {
        recipient: `${issuer}|alice`, kind: "comment_reply", commentId: replyId, createdAt: 2,
      });
    });
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId});
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId});
    const logs = await t.run(ctx => ctx.db.query("emailSendLog").collect());
    expect(logs.filter(row => row.status === "sent")).toHaveLength(1);
    expect(logs[0]).toMatchObject({recipient: `${issuer}|alice`, email: "alice@example.test"});
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({"Idempotency-Key": `comment-reply:${notificationId}`});
    const payload = JSON.parse(String(request.body));
    expect(payload.subject).toContain("示例文章");
    expect(payload.text).toContain("Thanks friend");
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("throttles multiple replies in the same thread within ten minutes", async () => {
    const {alice, bob, t} = setup();
    const charlie = t.withIdentity({issuer, subject: "charlie", preferredUsername: "Charlie", email: "charlie@example.test", emailVerified: true});
    const parentId = await bob.mutation(api.comments.add, {pathname, body: "Parent", articleTitle: "示例文章"});
    await alice.mutation(api.comments.add, {pathname, body: "First", parentId, articleTitle: "示例文章"});
    const firstNotification = await latestReplyNotificationId(t, `${issuer}|bob`);
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId: firstNotification});
    await charlie.mutation(api.comments.add, {pathname, body: "Second", parentId, articleTitle: "示例文章"});
    const secondNotification = await latestReplyNotificationId(t, `${issuer}|bob`);
    expect(secondNotification).not.toEqual(firstNotification);
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId: secondNotification});
    const logs = await t.run(ctx => ctx.db.query("emailSendLog").collect());
    expect(logs.filter(row => row.status === "sent")).toHaveLength(1);
    expect(logs.find(row => row.status === "skipped")?.reason).toBe("throttled");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  test("disabled preferences skip sending without breaking comments", async () => {
    const {alice, bob, t} = setup();
    await alice.mutation(api.emailPreferences.updateMine, {commentReply: false});
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    const notificationId = await latestReplyNotificationId(t);
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect((await alice.query(api.notifications.list, {paginationOpts})).page.some(row => row.kind === "comment_reply")).toBe(true);
    expect((await t.run(ctx => ctx.db.query("emailSendLog").collect())).some(row => row.reason === "preferences_disabled")).toBe(true);
  });

  test("missing resend config logs and skips without failing comments", async () => {
    const {alice, bob, t} = setup();
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Parent"});
    await bob.mutation(api.comments.add, {pathname, body: "Reply", parentId});
    const notificationId = await latestReplyNotificationId(t);
    delete process.env.RESEND_API_KEY;
    await t.action(internal.emailNotifications.sendCommentReplyEmail, {notificationId});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect((await t.run(ctx => ctx.db.query("emailSendLog").collect())).some(row => row.reason === "resend_not_configured")).toBe(true);
  });
});

describe("unsubscribe token and webhook", () => {
  test("token unsubscribe disables one category or all", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    const token = (await t.run(async ctx => (await ctx.db.query("emailPreferences").unique())?.unsubscribeToken))!;
    await t.mutation(api.emailPreferences.unsubscribeByToken, {token, category: "commentReply"});
    expect(await t.query(api.emailPreferences.getByToken, {token})).toMatchObject({commentReply: false, enabled: true});
    await t.mutation(api.emailPreferences.unsubscribeByToken, {token, all: true});
    expect(await t.query(api.emailPreferences.getByToken, {token})).toMatchObject({
      enabled: false, commentReply: false, likes: false, newComment: false, newsletter: false,
    });
  });

  test("one-click POST endpoint unsubscribes with token", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    const token = (await t.run(async ctx => (await ctx.db.query("emailPreferences").unique())?.unsubscribeToken))!;
    const response = await t.fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}&category=commentReply`, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: "List-Unsubscribe=One-Click",
    });
    expect(response.status).toBe(204);
    expect(await t.query(api.emailPreferences.getByToken, {token})).toMatchObject({commentReply: false});
  });

  test("resend hard bounce disables email for the cached address", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    const payload = JSON.stringify({type: "email.bounced", data: {to: ["alice@example.test"]}});
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = "msg_test";
    const key = webhookSecret.startsWith("whsec_") ? webhookSecret.slice(6) : webhookSecret;
    const keyBytes = Uint8Array.from(atob(key), char => char.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${id}.${timestamp}.${payload}`));
    const signature = `v1,${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    const response = await t.fetch("/resend/webhook", {
      method: "POST",
      headers: {"Content-Type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature},
      body: payload,
    });
    expect(response.status).toBe(204);
    expect(await alice.query(api.emailPreferences.getMine, {})).toMatchObject({enabled: false, emailDisabled: true});
  });
});
