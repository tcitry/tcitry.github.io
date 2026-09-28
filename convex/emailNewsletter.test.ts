/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import process from "node:process";
import {api, internal} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const pathname = "/posts/example/";
const webhookSecret = "whsec_dGVzdC13ZWJob29rLXNlY3JldA==";
const audienceId = "aud_test_newsletter";
const aliceIdentity = {
  issuer, subject: "alice", preferredUsername: "Alice", email: "alice@example.test", emailVerified: true,
};

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {
    t,
    alice: t.withIdentity(aliceIdentity),
  };
}

function resendFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "https://api.resend.com/contacts" && method === "POST") {
      return new Response(JSON.stringify({id: "contact_new"}), {status: 200});
    }
    if (url.includes("/contacts/") && method === "PATCH") {
      return new Response(JSON.stringify({id: "contact_existing"}), {status: 200});
    }
    if (url.includes("/segments/") && method === "POST") {
      return new Response(JSON.stringify({id: audienceId}), {status: 200});
    }
    if (url.startsWith("https://api.resend.com/contacts?")) {
      return new Response(JSON.stringify({object: "list", has_more: false, data: []}), {status: 200});
    }
    return new Response(JSON.stringify({message: "unexpected"}), {status: 500});
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.SITE_URL = "https://yindongliang.com";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  process.env.RESEND_AUDIENCE_ID = audienceId;
  vi.stubGlobal("fetch", resendFetchMock());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_AUDIENCE_ID;
  delete process.env.SITE_URL;
});

describe("newsletter audience sync", () => {
  test("toggle on schedules contact upsert into Resend audience", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    await alice.mutation(api.emailPreferences.updateMine, {enabled: true, newsletter: true});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const prefs = await t.run(ctx => ctx.db.query("emailPreferences").unique());
    expect(prefs).toMatchObject({
      resendContactId: "contact_new",
      resendLastSyncedAt: expect.any(Number),
      resendOutboundSyncAt: expect.any(Number),
    });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "https://api.resend.com/contacts" && init?.method === "POST");
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toMatchObject({
      email: "alice@example.test",
      unsubscribed: false,
      segments: [{id: audienceId}],
    });
  });

  test("toggle off marks contact unsubscribed in Resend", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    await alice.mutation(api.emailPreferences.updateMine, {enabled: true, newsletter: true});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await alice.mutation(api.emailPreferences.updateMine, {newsletter: false});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const fetchMock = vi.mocked(fetch);
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/contacts/") && init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String(patchCall?.[1]?.body));
    expect(body).toMatchObject({unsubscribed: true});
  });

  test("skips sync when audience env is unset", async () => {
    const {alice, t} = setup();
    delete process.env.RESEND_AUDIENCE_ID;
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    await alice.mutation(api.emailPreferences.updateMine, {enabled: true, newsletter: true});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const prefs = await t.run(ctx => ctx.db.query("emailPreferences").unique());
    expect(prefs?.resendLastSyncedAt).toBeUndefined();
  });

  test("contact.updated webhook writes newsletter=false without scheduling outbound sync loop", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    await alice.mutation(api.emailPreferences.updateMine, {enabled: true, newsletter: true});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const eventAt = Date.now() + 120_000;
    await t.mutation(internal.emailWebhook.handleResendEvent, {
      type: "contact.updated",
      email: "alice@example.test",
      createdAt: eventAt,
      unsubscribed: true,
      contactId: "contact_remote",
      audienceId,
    });
    expect(await alice.query(api.emailPreferences.getMine, {})).toMatchObject({newsletter: false});
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });

  test("contact.updated http webhook applies unsubscribe write-back", async () => {
    const {alice, t} = setup();
    await alice.mutation(api.comments.add, {pathname, body: "Hello"});
    await alice.mutation(api.emailPreferences.updateMine, {enabled: true, newsletter: true});
    const payload = JSON.stringify({
      type: "contact.updated",
      data: {
        id: "contact_remote",
        audience_id: audienceId,
        email: "alice@example.test",
        unsubscribed: true,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = "msg_contact_updated";
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
    expect(await alice.query(api.emailPreferences.getMine, {})).toMatchObject({newsletter: false});
  });

  test("reconcile action no-ops when unconfigured", async () => {
    const {t} = setup();
    delete process.env.RESEND_AUDIENCE_ID;
    const result = await t.action(internal.emailNewsletter.reconcileNewsletterAudience, {});
    expect(result).toMatchObject({done: true, processed: 0, cursor: null});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
