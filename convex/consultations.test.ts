/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { proEntitlement } from "./membership";
import schema from "./schema";

const { lookup, makeClient } = vi.hoisted(() => ({ lookup: vi.fn(), makeClient: vi.fn() }));
vi.mock("@clerk/backend", () => ({ createClerkClient: makeClient }));
const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const authorId = `${issuer}|author`;
const paginationOpts = { numItems: 10, cursor: null };
const request = { title: "咨询架构", content: "这里是私人咨询内容。", requestId: "request_create_00001" };

function subscription(overrides: Partial<Parameters<typeof proEntitlement>[0]["subscriptionItems"][number]> = {}) {
  return { subscriptionItems: [{
    plan: { slug: "pro" }, status: "active", periodStart: Date.now() - 60_000,
    periodEnd: Date.now() + 60_000, endedAt: null, ...overrides,
  }] };
}

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const alice = t.withIdentity({ issuer, subject: "alice", tokenIdentifier: `${issuer}|alice`, email: "private@example.test" });
  const bob = t.withIdentity({ issuer, subject: "bob", tokenIdentifier: `${issuer}|bob`, isPro: true, role: "admin", publicMetadata: { isPro: true } });
  const author = t.withIdentity({ issuer, subject: "author", tokenIdentifier: authorId });
  return { t, alice, bob, author };
}

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "fixture-clerk-key");
  vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro");
  vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", authorId);
  lookup.mockReset().mockResolvedValue(subscription());
  makeClient.mockReset().mockReturnValue({ billing: { getUserBillingSubscription: lookup } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Clerk billing entitlement", () => {
  test("only the exact plan in a current active or canceled period grants Pro", () => {
    const now = Date.now();
    expect(proEntitlement(subscription(), "pro", now).isPro).toBe(true);
    expect(proEntitlement(subscription({ status: "canceled" }), "pro", now).isPro).toBe(true);
    for (const status of ["upcoming", "past_due", "ended", "expired", "incomplete", "abandoned", "trialing"]) {
      expect(proEntitlement(subscription({ status }), "pro", now).isPro).toBe(false);
    }
    for (const value of [
      subscription({ plan: { slug: "pro_plus" } }), subscription({ plan: null }),
      subscription({ periodEnd: now }), subscription({ periodEnd: null }),
      subscription({ periodStart: now + 1 }), subscription({ endedAt: now }),
    ]) expect(proEntitlement(value, "pro", now).isPro).toBe(false);
    expect(proEntitlement(subscription(), "", now).isPro).toBe(false);
  });

  test("reads the authenticated subject and ignores spoofed metadata", async () => {
    const { bob } = setup();
    lookup.mockResolvedValue(subscription({ plan: { slug: "free" } }));
    const member = await bob.action(api.membership.getMyMembership, {});
    expect(member.isPro).toBe(false);
    expect(member.isAdmin).toBe(false);
    expect(lookup).toHaveBeenCalledWith("bob");
    expect(makeClient).toHaveBeenCalledWith({ secretKey: "fixture-clerk-key" });
    await expect(bob.action(api.consultations.start, request)).rejects.toThrow("PRO_REQUIRED");
    await expect(bob.action(api.consultations.start, {
      ...request,
      // @ts-expect-error Authorization flags are not client arguments.
      isPro: true,
    })).rejects.toThrow();
  });

  test("configuration and upstream errors fail closed without exposing upstream details", async () => {
    const { alice, t } = setup();
    vi.stubEnv("CLERK_PRO_PLAN_SLUG", "");
    expect((await alice.action(api.membership.getMyMembership, {})).configured).toBe(false);
    await expect(alice.action(api.consultations.start, request)).rejects.toThrow("CONSULTATION_UNAVAILABLE");
    expect(lookup).not.toHaveBeenCalled();
    vi.stubEnv("CLERK_PRO_PLAN_SLUG", "pro");
    lookup.mockRejectedValue(new Error("secret upstream request detail"));
    await expect(alice.action(api.consultations.start, request)).rejects.toThrow("BILLING_UNAVAILABLE");
    expect(await t.run(ctx => ctx.db.query("consultationThreads").take(1))).toEqual([]);
    lookup.mockRejectedValue({ status: 404 });
    expect((await alice.action(api.membership.getMyMembership, {})).isPro).toBe(false);
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
      () => t.query(api.consultations.getThread, { threadId }),
      () => t.query(api.consultations.listMessages, { threadId, paginationOpts }),
      () => t.action(api.consultations.start, request),
      () => t.action(api.consultations.send, { threadId, content: "test", requestId: "request_send_00001" }),
      () => t.mutation(api.consultations.close, { threadId }),
    ]) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
  });

  test("only the owner and configured author can read or reply, including issuer isolation", async () => {
    const { t, alice, bob, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const wrongIssuer = t.withIdentity({ issuer: "https://other.example.test", subject: "author", tokenIdentifier: "https://other.example.test|author" });
    for (const outsider of [bob, wrongIssuer]) {
      expect((await outsider.query(api.consultations.listThreads, { paginationOpts })).page).toEqual([]);
      await expect(outsider.query(api.consultations.getThread, { threadId })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.query(api.consultations.listMessages, { threadId, paginationOpts })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.action(api.consultations.send, { threadId, content: "intrusion", requestId: "request_send_00001" })).rejects.toThrow("NOT_FOUND");
      await expect(outsider.mutation(api.consultations.close, { threadId })).rejects.toThrow("NOT_FOUND");
    }
    expect((await author.query(api.consultations.listThreads, { paginationOpts })).page).toHaveLength(1);
    const result = await author.query(api.consultations.listMessages, { threadId, paginationOpts });
    expect(result.page[0].content).toBe(request.content);
    expect(JSON.stringify(result)).not.toMatch(/private@example|senderIdentity|https:\/\/auth|owner/);
  });

  test("owner followups become waiting and trusted author replies become replied without charging author", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("waiting");
    lookup.mockRejectedValue(new Error("author needs no billing"));
    await author.action(api.consultations.send, { threadId, content: "博主的回复", requestId: "request_author_001" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("replied");
    lookup.mockResolvedValue(subscription());
    await alice.action(api.consultations.send, { threadId, content: "继续咨询", requestId: "request_follow_001" });
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("waiting");
    const messages = await alice.query(api.consultations.listMessages, { threadId, paginationOpts });
    expect(messages.page.map(message => message.sender)).toEqual(["member", "author", "member"]);
  });

  test("lapsed membership preserves reads but denies all new member writes", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    lookup.mockResolvedValue(subscription({ status: "canceled", periodEnd: Date.now() - 1 }));
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(1);
    await expect(alice.action(api.consultations.send, { threadId, content: "new", requestId: "request_lapse_0001" })).rejects.toThrow("PRO_REQUIRED");
    await expect(alice.action(api.consultations.start, { ...request, requestId: "request_new_000001" })).rejects.toThrow("PRO_REQUIRED");
    await author.action(api.consultations.send, { threadId, content: "仍可回复", requestId: "request_author_001" });
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(2);
  });

  test("successful retries are idempotent after lapse and conflicts cannot cross threads", async () => {
    const { t, alice } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const followup = { threadId, content: "追问", requestId: "request_follow_001" };
    const messageId = await alice.action(api.consultations.send, followup);
    const otherThread = await alice.action(api.consultations.start, { ...request, requestId: "request_create_002" });
    lookup.mockRejectedValue(new Error("retry should not contact billing"));
    expect(await alice.action(api.consultations.start, request)).toBe(threadId);
    expect(await alice.action(api.consultations.send, followup)).toBe(messageId);
    expect(lookup).toHaveBeenCalledTimes(3);
    await expect(alice.action(api.consultations.start, { ...request, content: "changed" })).rejects.toThrow("REQUEST_CONFLICT");
    await expect(alice.action(api.consultations.send, { ...followup, threadId: otherThread })).rejects.toThrow("REQUEST_CONFLICT");
    await expect(alice.action(api.consultations.start, { ...request, requestId: followup.requestId })).rejects.toThrow("REQUEST_CONFLICT");
    expect(await t.run(ctx => ctx.db.query("consultationMessages").take(10))).toHaveLength(3);
  });

  test("closed conversations retain history, allow retry of accepted messages, and refuse further replies", async () => {
    const { alice, author } = setup();
    const threadId = await alice.action(api.consultations.start, request);
    const reply = { threadId, content: "完成回复", requestId: "request_author_001" };
    const messageId = await author.action(api.consultations.send, reply);
    await alice.mutation(api.consultations.close, { threadId });
    await alice.mutation(api.consultations.close, { threadId });
    expect(await author.action(api.consultations.send, reply)).toBe(messageId);
    expect((await alice.query(api.consultations.getThread, { threadId })).status).toBe("closed");
    expect((await alice.query(api.consultations.listMessages, { threadId, paginationOpts })).page).toHaveLength(2);
    await expect(author.action(api.consultations.send, { ...reply, requestId: "request_author_002" })).rejects.toThrow("THREAD_CLOSED");
  });

  test("text and pagination bounds are validated before writes and return native cursors", async () => {
    const { alice } = setup();
    for (const args of [
      { ...request, title: "" }, { ...request, title: "a".repeat(161) },
      { ...request, content: "a".repeat(10_001) }, { ...request, content: "nul\u0000" }, { ...request, requestId: "tiny" },
    ]) await expect(alice.action(api.consultations.start, args)).rejects.toThrow("INVALID_ARGUMENT");
    expect(lookup).not.toHaveBeenCalled();
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
      await author.action(api.consultations.send, { threadId, content: `回复 ${i}`, requestId: `request_limit_${String(i).padStart(4, "0")}` });
    }
    await expect(author.action(api.consultations.send, { threadId, content: "too many", requestId: "request_limit_0010" })).rejects.toThrow();
    await expect(author.action(api.consultations.send, { threadId, content: "回复 0", requestId: "request_limit_0000" })).resolves.toBeTruthy();
  });
});
