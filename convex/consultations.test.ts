/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const authorId = `${issuer}|author`;
const paginationOpts = { numItems: 10, cursor: null };
const request = { title: "咨询架构", content: "这里是私人咨询内容。", requestId: "request_create_00001" };

const aliceIdentity = { issuer, subject: "alice", tokenIdentifier: `${issuer}|alice`, email: "private@example.test", v: 2, sid: "session_alice", pla: "u:pro" };

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const alice = t.withIdentity(aliceIdentity);
  const bob = t.withIdentity({ issuer, subject: "bob", tokenIdentifier: `${issuer}|bob`, v: 2, sid: "session_bob", pla: "u:free", isPro: true, role: "admin", publicMetadata: { isPro: true, pla: "u:pro" } });
  const author = t.withIdentity({ issuer, subject: "author", tokenIdentifier: authorId });
  return { t, alice, bob, author };
}

beforeEach(() => {
  vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro");
  vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", authorId);
  vi.stubEnv("CHAT_ALLOWED_ORIGINS", "https://blog.example.test");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
});
afterEach(() => { vi.unstubAllEnvs(); });

const imageOrigin = "https://blog.example.test";
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAusAAAAASUVORK5CYII="), char => char.charCodeAt(0));
async function uploadImage(client: ReturnType<typeof setup>["alice"], purpose = "consultation") {
  const response = await client.fetch(`/comment-images/upload?purpose=${purpose}`, {
    method: "POST", headers: { Origin: imageOrigin, "Content-Type": "image/png" }, body: png,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).imageId as Id<"commentImages">;
}
const imagePath = (imageId: string) => `/comment-images/file?imageId=${imageId}`;

describe("private consultation images", () => {
  test("members start and follow up with images, authors reply without Pro, and every read authorizes both parties", async () => {
    const { t, alice, bob, author } = setup();
    const imageId = await uploadImage(alice);
    const threadId = await alice.action(api.consultations.start, { ...request, content: "", imageIds: [imageId] });
    const authorImage = await uploadImage(author);
    await author.action(api.consultations.reply, { threadId, content: "", requestId: "request_image_reply", imageIds: [authorImage] });
    const followupImage = await uploadImage(alice);
    await alice.action(api.consultations.send, { threadId, content: "补充截图", requestId: "request_image_follow", imageIds: [followupImage] });
    for (const client of [alice, author]) {
      const messages = (await client.query(api.consultations.listMessages, { threadId, paginationOpts })).page;
      expect(messages.map(message => message.sender)).toEqual(["member", "author", "member"]);
      expect(messages.map(message => message.images[0].id)).toEqual([followupImage, authorImage, imageId]);
      for (const image of messages.flatMap(message => message.images)) {
        expect(image.url).toBe(`https://test.convex.site${imagePath(image.id)}`);
        const response = await client.fetch(imagePath(image.id), { headers: { Origin: imageOrigin } });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }
    }
    const wrongIssuer = t.withIdentity({ issuer: "https://other.example.test", subject: "author" });
    for (const outsider of [bob, wrongIssuer]) {
      expect((await outsider.fetch(imagePath(imageId), { headers: { Origin: imageOrigin } })).status).toBe(403);
      await expect(outsider.query(api.consultations.listMessages, { threadId, paginationOpts })).rejects.toThrow("NOT_FOUND");
    }
    expect((await t.fetch(imagePath(imageId), { headers: { Origin: imageOrigin } })).status).toBe(401);
    await expect(alice.query(api.commentImages.getUrl, { imageId })).rejects.toThrow("FORBIDDEN");
    expect(await t.query(api.comments.getSummary, { pathname: "/about/" })).toEqual({ commentCount: 0, likeCount: 0 });
  });

  test("foreign drafts and comment images cannot be bound; failed writes leave no partial thread or message", async () => {
    const { t, alice, bob, author } = setup();
    const foreignDraft = await uploadImage(bob);
    const commentImage = await uploadImage(alice, "comment");
    for (const imageId of [foreignDraft, commentImage]) {
      await expect(alice.action(api.consultations.start, { ...request, imageIds: [imageId] })).rejects.toThrow("FORBIDDEN");
    }
    expect(await t.run(ctx => ctx.db.query("consultationThreads").take(1))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("consultationMessages").take(1))).toEqual([]);
    const threadId = await alice.action(api.consultations.start, request);
    await expect(alice.action(api.consultations.send, { threadId, content: "", requestId: "request_image_stolen", imageIds: [foreignDraft] })).rejects.toThrow("FORBIDDEN");
    const aliceDraft = await uploadImage(alice);
    await expect(author.action(api.consultations.reply, { threadId, content: "", requestId: "request_image_stolen", imageIds: [aliceDraft] })).rejects.toThrow("FORBIDDEN");
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(1);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("waiting");
    expect((await t.run(ctx => ctx.db.get("commentImages", aliceDraft)))?.messageId).toBeUndefined();
  });

  test("accepted image requests replay after Pro expires, while changed attachments and new messages are rejected", async () => {
    const { t, alice, author } = setup();
    const firstImage = await uploadImage(alice);
    const start = { ...request, content: "", imageIds: [firstImage] };
    const threadId = await alice.action(api.consultations.start, start);
    const nextImage = await uploadImage(alice);
    const send = { threadId, content: "", requestId: "request_image_replay", imageIds: [nextImage] };
    const messageId = await alice.action(api.consultations.send, send);
    const lapsed = t.withIdentity({ ...aliceIdentity, pla: "u:free" });
    expect(await lapsed.action(api.consultations.start, start)).toBe(threadId);
    expect(await lapsed.action(api.consultations.send, send)).toBe(messageId);
    const unused = await uploadImage(lapsed);
    await expect(lapsed.action(api.consultations.send, { ...send, imageIds: [unused] })).rejects.toThrow("REQUEST_CONFLICT");
    await expect(lapsed.action(api.consultations.start, { ...start, imageIds: [unused] })).rejects.toThrow("REQUEST_CONFLICT");
    await expect(lapsed.action(api.consultations.send, { ...send, requestId: "request_image_newsend", imageIds: [unused] })).rejects.toThrow("PRO_REQUIRED");
    expect((await lapsed.fetch(imagePath(firstImage), { headers: { Origin: imageOrigin } })).status).toBe(200);
    expect((await lapsed.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(2);
    await expect(lapsed.mutation(api.commentImages.discard, { imageId: firstImage })).rejects.toThrow("FORBIDDEN");
    await author.mutation(api.consultations.close, { threadId });
    expect(await lapsed.action(api.consultations.send, send)).toBe(messageId);
    const authorDraft = await uploadImage(author);
    await expect(author.action(api.consultations.reply, { threadId, content: "", requestId: "request_closed_image", imageIds: [authorDraft] })).rejects.toThrow("THREAD_CLOSED");
    expect((await t.run(ctx => ctx.db.get("commentImages", authorDraft)))?.messageId).toBeUndefined();
    await author.mutation(api.commentImages.discard, { imageId: authorDraft });
  });

  test("a bound image cannot be reused in another message or thread", async () => {
    const { alice } = setup();
    const imageId = await uploadImage(alice);
    const threadId = await alice.action(api.consultations.start, { ...request, imageIds: [imageId] });
    await expect(alice.action(api.consultations.send, { threadId, content: "same image", requestId: "request_image_reuse", imageIds: [imageId] })).rejects.toThrow("FORBIDDEN");
    await expect(alice.action(api.consultations.start, { ...request, requestId: "request_other_thread", imageIds: [imageId] })).rejects.toThrow("FORBIDDEN");
    expect((await alice.query(api.consultations.listThreads, { paginationOpts })).page).toHaveLength(1);
  });

  test("each message accepts at most four distinct images, preserving the submitted image order", async () => {
    const { alice } = setup();
    const imageIds: Id<"commentImages">[] = [];
    for (let index = 0; index < 5; index++) imageIds.push(await uploadImage(alice));
    await expect(alice.action(api.consultations.start, { ...request, content: "", imageIds })).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.action(api.consultations.start, { ...request, content: "", imageIds: [imageIds[0], imageIds[0]] })).rejects.toThrow("INVALID_ARGUMENT");
    const start = { ...request, content: "", imageIds: imageIds.slice(0, 4) };
    const threadId = await alice.action(api.consultations.start, start);
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page[0].images.map(image => image.id)).toEqual(start.imageIds);
    await expect(alice.action(api.consultations.start, { ...start, imageIds: [...start.imageIds].reverse() })).rejects.toThrow("REQUEST_CONFLICT");
  });
});

describe("Clerk verified session entitlement", () => {
  test("only the exact personal plan grants Pro, including Clerk's combined scopes", async () => {
    const { t } = setup();
    for (const pla of ["u:pro", "ou:pro", "uo:pro", "o:team, u:pro", "u:free,uo:pro"]) {
      const member = t.withIdentity({ ...aliceIdentity, pla, exp: Date.now() + 60_000 });
      expect(await member.action(api.membership.getMyMembership, {})).toEqual({
        configured: true, isPro: true, isAdmin: false, consultationsReady: true, validUntil: null,
      });
    }
    for (const pla of ["o:pro", "u:pro_plus", "u:Pro", "u:free,o:pro", "u:free", "u:pro_user"]) {
      const member = t.withIdentity({ ...aliceIdentity, pla });
      expect((await member.action(api.membership.getMyMembership, {})).isPro).toBe(false);
      await expect(member.action(api.consultations.start, request)).rejects.toThrow("PRO_REQUIRED");
    }
    vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro_user");
    const member = t.withIdentity({ ...aliceIdentity, pla: "u:pro_user" });
    expect((await member.action(api.membership.getMyMembership, {})).isPro).toBe(true);
    await expect(t.withIdentity({ ...aliceIdentity, pla: "o:pro_user" }).action(api.consultations.start, request)).rejects.toThrow("PRO_REQUIRED");
  });

  test("reads the authenticated subject and ignores spoofed metadata", async () => {
    const { bob } = setup();
    const member = await bob.action(api.membership.getMyMembership, {});
    expect(member.isPro).toBe(false);
    expect(member.isAdmin).toBe(false);
    await expect(bob.action(api.consultations.start, request)).rejects.toThrow("PRO_REQUIRED");
    await expect(bob.action(api.consultations.start, {
      ...request,
      // @ts-expect-error Authorization flags are not client arguments.
      isPro: true,
    })).rejects.toThrow();
  });

  test("missing or malformed configuration fails closed", async () => {
    const { alice, t } = setup();
    for (const slug of ["", "u:pro", "pro,free", "pro user"]) {
      vi.stubEnv("CLERK_PRO_PLAN_SLUG", slug);
      expect((await alice.action(api.membership.getMyMembership, {})).configured).toBe(false);
      expect((await alice.action(api.membership.getMyMembership, {})).consultationsReady).toBe(true);
      expect(await alice.query(api.membership.getConsultationRole, {})).toEqual({ isAdmin: false, ready: true });
      await expect(alice.action(api.consultations.start, request)).rejects.toThrow("PRO_REQUIRED");
    }
    vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro");
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", "");
    expect((await alice.action(api.membership.getMyMembership, {})).consultationsReady).toBe(false);
    expect(await alice.query(api.membership.getConsultationRole, {})).toEqual({ isAdmin: false, ready: false });
    await expect(alice.action(api.consultations.start, request)).rejects.toThrow("CONSULTATION_UNAVAILABLE");
    expect(await t.run(ctx => ctx.db.query("consultationThreads").take(1))).toEqual([]);
  });

  test("unavailable claims never masquerade as a confirmed free membership", async () => {
    const { t } = setup();
    for (const claims of [
      { pla: undefined }, { pla: null }, { pla: "" }, { pla: ["u:pro"] },
      { pla: "u:pro,broken" }, { pla: "x:pro" }, { pla: "user:pro" },
      { pla: "u:pro," }, { pla: "u:pro:other" }, { pla: "u:pro, o:" },
      { v: undefined }, { v: 1 }, { v: 3 }, { v: "2" },
      { sid: undefined }, { sid: "" }, { sid: " " }, { sid: 123 },
      { sts: "pending" }, { sts: "unexpected" },
    ]) {
      const member = t.withIdentity({ ...aliceIdentity, ...claims });
      await expect(member.action(api.membership.getMyMembership, {})).rejects.toThrow("CLAIMS_UNAVAILABLE");
      await expect(member.action(api.consultations.start, request)).rejects.toThrow("CLAIMS_UNAVAILABLE");
    }
    expect(await t.run(ctx => ctx.db.query("consultationThreads").take(1))).toEqual([]);
    expect((await t.withIdentity({ ...aliceIdentity, sts: "active" }).action(api.membership.getMyMembership, {})).isPro).toBe(true);
  });

  test("atomic internal writes independently authorize identity and reject supplied entitlement", async () => {
    const { t, alice, bob } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const lapsed = t.withIdentity({ ...aliceIdentity, pla: "u:free" });
    const followup = { threadId, content: "追问", requestId: "request_internal_01" };
    await expect(bob.mutation(internal.consultations.createPaid, request)).rejects.toThrow("PRO_REQUIRED");
    await expect(lapsed.mutation(internal.consultations.insertMessage, followup)).rejects.toThrow("PRO_REQUIRED");
    await expect(bob.mutation(internal.consultations.insertMessage, followup)).rejects.toThrow("NOT_FOUND");
    await expect(alice.mutation(internal.consultations.insertReply, followup)).rejects.toThrow("FORBIDDEN");
    await expect(t.mutation(internal.consultations.createPaid, request)).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(internal.consultations.insertMessage, followup)).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(internal.consultations.insertReply, followup)).rejects.toThrow("UNAUTHENTICATED");
    await expect(bob.mutation(internal.consultations.createPaid, {
      ...request,
      // @ts-expect-error A prior lookup or caller cannot assert paid expiry.
      validUntil: Date.now() + 60_000,
    })).rejects.toThrow();
    await expect(lapsed.mutation(internal.consultations.insertMessage, {
      ...followup,
      // @ts-expect-error Authorization is derived from this mutation's identity.
      isPro: true,
    })).rejects.toThrow();
    await expect(lapsed.action(api.consultations.send, {
      ...followup,
      // @ts-expect-error Public actions cannot receive claims from the browser.
      pla: "u:pro",
    })).rejects.toThrow();
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(1);
  });
});

describe("asynchronous private consultations", () => {
  test("anonymous readers and senders are rejected", async () => {
    const { t, alice } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    for (const call of [
      () => t.action(api.membership.getMyMembership, {}),
      () => t.query(api.membership.getConsultationRole, {}),
      () => t.query(api.consultations.listThreads, { paginationOpts }),
      () => t.query(api.consultations.listInbox, { paginationOpts }),
      () => t.query(api.consultations.getThread, { threadId }),
      () => t.query(api.consultations.listMessages, { threadId, paginationOpts }),
      () => t.action(api.consultations.start, request),
      () => t.action(api.consultations.send, { threadId, content: "test", requestId: "request_send_00001" }),
      () => t.action(api.consultations.reply, { threadId, content: "test", requestId: "request_reply_0001" }),
      () => t.mutation(api.consultations.close, { threadId }),
    ]) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
  });

  test("only the owner and configured author can read or reply, including issuer isolation", async () => {
    const { t, alice, bob, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const wrongIssuer = t.withIdentity({ issuer: "https://other.example.test", subject: "author", tokenIdentifier: "https://other.example.test|author" });
    for (const outsider of [bob, wrongIssuer]) {
      expect((await outsider.query(api.consultations.listThreads, { paginationOpts })).page).toEqual([]);
      await expect(outsider.query(api.consultations.listInbox, { paginationOpts })).rejects.toThrow("FORBIDDEN");
      await expect(outsider.query(api.consultations.getThread, { threadId })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.query(api.consultations.listMessages, { threadId, paginationOpts })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.action(api.consultations.send, { threadId, content: "intrusion", requestId: "request_send_00001" })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.action(api.consultations.reply, { threadId, content: "intrusion", requestId: "request_reply_0001" })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.mutation(api.consultations.close, { threadId })).rejects.toThrow("NOT_FOUND");
    }
    expect((await author.query(api.consultations.listThreads, { paginationOpts })).page).toEqual([]);
    expect((await author.query(api.consultations.listInbox, { paginationOpts })).page).toHaveLength(1);
    const result = await author.query(api.consultations.listMessages, { threadId, paginationOpts });
    expect(result.page[0].content).toBe(request.content);
    expect(JSON.stringify(result)).not.toMatch(/private@example|senderIdentity|https:\/\/auth|owner/);
  });

  test("owner followups become waiting and trusted author replies become replied without charging author", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("waiting");
    await author.action(api.consultations.reply, { threadId, content: "博主的回复", requestId: "request_author_001" });
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("replied");
    await alice.action(api.consultations.send, { threadId, content: "继续咨询", requestId: "request_follow_001" });
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("waiting");
    const messages = await alice.query(api.consultations.listMessages, { threadId, paginationOpts });
    expect(messages.page.map(message => message.sender)).toEqual(["member", "author", "member"]);
  });

  test("member and author endpoints keep their roles even when the same account owns a consultation", async () => {
    const { t, alice, author } = setup();
    const payingAuthor = t.withIdentity({ issuer, subject: "author", tokenIdentifier: authorId, v: 2, sid: "session_author", pla: "u:pro" });
    const memberThread = await alice.action(api.consultations.start, request);
    await expect(author.action(api.consultations.send, { threadId: memberThread, content: "不能替会员追问", requestId: "request_mode_00001" })).rejects.toThrow("NOT_FOUND");
    await expect(alice.action(api.consultations.reply, { threadId: memberThread, content: "不能冒充作者", requestId: "request_mode_00002" })).rejects.toThrow("FORBIDDEN");
    const ownThread = await payingAuthor.action(api.consultations.start, request);
    const followup = { threadId: ownThread, content: "以会员身份追问", requestId: "request_mode_00003" };
    const messageId = await payingAuthor.action(api.consultations.send, followup);
    expect((await payingAuthor.query(api.consultations.getThread, { threadId: ownThread })).status).toBe("waiting");
    const reply = { threadId: ownThread, content: "以作者身份回复", requestId: "request_mode_00004" };
    const replyId = await author.action(api.consultations.reply, reply);
    expect((await author.query(api.consultations.getThread, { threadId: ownThread })).status).toBe("replied");
    expect((await author.query(api.consultations.listMessages, { threadId: ownThread, paginationOpts })).page.map(message => message.sender)).toEqual(["author", "member", "member"]);
    expect((await author.query(api.consultations.listThreads, { paginationOpts })).page.map(thread => thread._id)).toEqual([ownThread]);
    expect(new Set((await author.query(api.consultations.listInbox, { paginationOpts })).page.map(thread => thread._id))).toEqual(new Set([ownThread, memberThread]));
    await expect(payingAuthor.action(api.consultations.reply, followup)).rejects.toThrow("REQUEST_CONFLICT");
    await expect(payingAuthor.action(api.consultations.send, reply)).rejects.toThrow("REQUEST_CONFLICT");
    await expect(payingAuthor.action(api.consultations.reply, { threadId: ownThread, content: request.content, requestId: request.requestId })).rejects.toThrow("REQUEST_CONFLICT");
    const lapsedAuthor = t.withIdentity({ issuer, subject: "author", tokenIdentifier: authorId, v: 2, sid: "session_author", pla: "u:free" });
    expect(await lapsedAuthor.action(api.consultations.send, followup)).toBe(messageId);
    expect(await lapsedAuthor.action(api.consultations.reply, reply)).toBe(replyId);
    await expect(lapsedAuthor.action(api.consultations.send, { ...followup, requestId: "request_mode_00005" })).rejects.toThrow("PRO_REQUIRED");
    await lapsedAuthor.action(api.consultations.reply, { ...reply, requestId: "request_mode_00006" });
  });

  test("only the configured author can page through all incoming consultations", async () => {
    const { t, alice, bob, author } = setup();
    const payingBob = t.withIdentity({ issuer, subject: "bob", tokenIdentifier: `${issuer}|bob`, v: 2, sid: "session_bob", pla: "u:pro", role: "admin" });
    const aliceThreads = [];
    for (let i = 0; i < 3; i++) aliceThreads.push(await alice.action(api.consultations.start, { ...request, requestId: `request_inbox_${String(i).padStart(4, "0")}` }));
    const bobThread = await payingBob.action(api.consultations.start, request);
    expect((await alice.query(api.consultations.listThreads, { paginationOpts })).page).toHaveLength(3);
    expect((await bob.query(api.consultations.listThreads, { paginationOpts })).page.map(thread => thread._id)).toEqual([bobThread]);
    expect((await author.query(api.consultations.listThreads, { paginationOpts })).page).toEqual([]);
    await expect(payingBob.query(api.consultations.listInbox, { paginationOpts })).rejects.toThrow("FORBIDDEN");
    const first = await author.query(api.consultations.listInbox, { paginationOpts: { numItems: 2, cursor: null, maximumRowsRead: 2 } });
    const second = await author.query(api.consultations.listInbox, { paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(second.page).toHaveLength(2);
    expect(second.isDone).toBe(true);
    expect(new Set([...first.page, ...second.page].map(thread => thread._id))).toEqual(new Set([...aliceThreads, bobThread]));
    expect(JSON.stringify(first)).not.toMatch(/owner|subject|issuer|tokenIdentifier|private@example/);
    await expect(author.query(api.consultations.listInbox, { paginationOpts: { numItems: 51, cursor: null } })).rejects.toThrow("INVALID_ARGUMENT");
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", `${issuer}|another-author`);
    await expect(author.query(api.consultations.listInbox, { paginationOpts })).rejects.toThrow("FORBIDDEN");
    await expect(author.action(api.consultations.reply, { threadId: bobThread, content: "已撤销授权", requestId: "request_revoke_001" })).rejects.toThrow("NOT_FOUND");
  });

  test("lapsed membership preserves reads but denies all new member writes", async () => {
    const { t, alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const lapsed = t.withIdentity({ ...aliceIdentity, pla: "u:free" });
    expect((await lapsed.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(1);
    await expect(lapsed.action(api.consultations.send, { threadId, content: "new", requestId: "request_lapse_0001" })).rejects.toThrow("PRO_REQUIRED");
    await expect(lapsed.action(api.consultations.start, { ...request, requestId: "request_new_000001" })).rejects.toThrow("PRO_REQUIRED");
    await author.action(api.consultations.reply, { threadId, content: "仍可回复", requestId: "request_author_001" });
    expect((await lapsed.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(2);
  });

  test("successful retries are idempotent after lapse and conflicts cannot cross threads", async () => {
    const { t, alice } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const followup = { threadId, content: "追问", requestId: "request_follow_001" };
    const messageId = await alice.action(api.consultations.send, followup);
    const otherThread = await alice.action(api.consultations.start, { ...request, requestId: "request_create_002" });
    for (const pla of ["u:free", undefined]) {
      const changed = t.withIdentity({ ...aliceIdentity, pla });
      expect(await changed.action(api.consultations.start, request)).toBe(threadId);
      expect(await changed.action(api.consultations.send, followup)).toBe(messageId);
      await expect(changed.action(api.consultations.start, { ...request, content: "changed" })).rejects.toThrow("REQUEST_CONFLICT");
      await expect(changed.action(api.consultations.send, { ...followup, threadId: otherThread })).rejects.toThrow("REQUEST_CONFLICT");
      await expect(changed.action(api.consultations.start, { ...request, requestId: followup.requestId })).rejects.toThrow("REQUEST_CONFLICT");
    }
    expect(await t.run(ctx => ctx.db.query("consultationMessages").take(10))).toHaveLength(3);
  });

  test("identical request IDs belong to each authenticated sender, not another member", async () => {
    const { t, alice } = setup();
    const bob = t.withIdentity({ issuer, subject: "bob", tokenIdentifier: `${issuer}|bob`, v: 2, sid: "session_bob", pla: "u:pro" });
    const aliceThread = await alice.action(api.consultations.start, request);
    const bobThread = await bob.action(api.consultations.start, request);
    expect(bobThread).not.toBe(aliceThread);
    expect(await bob.action(api.consultations.start, request)).toBe(bobThread);
    const aliceMessages = await alice.query(api.consultations.listMessages, { threadId: aliceThread, paginationOpts });
    const bobMessages = await bob.query(api.consultations.listMessages, { threadId: bobThread, paginationOpts });
    expect(aliceMessages.page[0]._id).not.toBe(bobMessages.page[0]._id);
    await expect(bob.query(api.consultations.getThread, { threadId: aliceThread })).rejects.toThrow("NOT_FOUND");
    await expect(alice.query(api.consultations.getThread, { threadId: bobThread })).rejects.toThrow("NOT_FOUND");
  });

  test("closed conversations retain history, allow retry of accepted messages, and refuse further replies", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const reply = { threadId, content: "完成回复", requestId: "request_author_001" };
    const messageId = await author.action(api.consultations.reply, reply);
    await alice.mutation(api.consultations.close, { threadId });
    await alice.mutation(api.consultations.close, { threadId });
    expect(await author.action(api.consultations.reply, reply)).toBe(messageId);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("closed");
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(2);
    await expect(author.action(api.consultations.reply, { ...reply, requestId: "request_author_002" })).rejects.toThrow("THREAD_CLOSED");
  });

  test("text and pagination bounds are validated before writes and return native cursors", async () => {
    const { alice } = setup();
    for (const args of [
      { ...request, title: "" }, { ...request, title: "a".repeat(161) },
      { ...request, content: "a".repeat(10_001) }, { ...request, content: "nul\u0000" }, { ...request, requestId: "tiny" },
    ]) await expect(alice.action(api.consultations.start, args)).rejects.toThrow("INVALID_ARGUMENT");
    const threadId = await alice.action(api.consultations.start, request);
    await alice.action(api.consultations.send, { threadId, content: "<script>plain text</script>", requestId: "request_text_00001" });
    const first = await alice.query(api.consultations.listMessages, { threadId, paginationOpts: { numItems: 1, cursor: null } });
    expect(first.isDone).toBe(false);
    expect(first.page[0].content).toBe("<script>plain text</script>");
    const second = await alice.query(api.consultations.listMessages, { threadId, paginationOpts: { numItems: 1, cursor: first.continueCursor } });
    expect(second.page[0].content).toBe(request.content);
    await expect(alice.query(api.consultations.listMessages, { threadId, paginationOpts: { numItems: 51, cursor: null } })).rejects.toThrow("INVALID_ARGUMENT");
  });

  test("author replies are rate limited while replay of an accepted request remains free", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    for (let i = 0; i < 10; i++) {
      await author.action(api.consultations.reply, { threadId, content: `回复 ${i}`, requestId: `request_limit_${String(i).padStart(4, "0")}` });
    }
    await expect(author.action(api.consultations.reply, { threadId, content: "too many", requestId: "request_limit_0010" })).rejects.toThrow();
    await expect(author.action(api.consultations.reply, { threadId, content: "回复 0", requestId: "request_limit_0000" })).resolves.toBeTruthy();
  });

  test("member creation and messages share a write limit without limiting membership reads", async () => {
    const { alice } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    for (let i = 0; i < 9; i++) {
      await alice.action(api.consultations.send, { threadId, content: `追问 ${i}`, requestId: `request_limit_${String(i).padStart(4, "0")}` });
    }
    await expect(alice.action(api.consultations.start, { ...request, requestId: "request_limit_new" })).rejects.toThrow();
    await expect(alice.action(api.consultations.send, { threadId, content: "too many", requestId: "request_limit_0010" })).rejects.toThrow();
    expect(await alice.action(api.consultations.start, request)).toBe(threadId);
    await expect(alice.action(api.consultations.send, { threadId, content: "追问 0", requestId: "request_limit_0000" })).resolves.toBeTruthy();
    for (let i = 0; i < 15; i++) expect((await alice.action(api.membership.getMyMembership, {})).isPro).toBe(true);
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(10);
  });
});
