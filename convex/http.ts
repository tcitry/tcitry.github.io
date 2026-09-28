import {httpRouter} from "convex/server";
import {httpAction} from "./_generated/server";
import {internal} from "./_generated/api";
import {env} from "./_generated/server";
import {download, upload, uploadOptions} from "./commentImages";
import {verifySvixSignature} from "./emailWebhook";

const http = httpRouter();
http.route({path: "/comment-images/upload", method: "POST", handler: upload});
http.route({path: "/comment-images/upload", method: "OPTIONS", handler: uploadOptions});
http.route({path: "/comment-images/file", method: "GET", handler: download});
http.route({path: "/comment-images/file", method: "OPTIONS", handler: uploadOptions});

http.route({
  path: "/email/unsubscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim();
    if (!token) return new Response("Missing token", {status: 400});
    const category = url.searchParams.get("category");
    const body = await request.text();
    const oneClick = body.includes("List-Unsubscribe=One-Click");
    if (!oneClick && body.trim()) return new Response("Unsupported body", {status: 400});
    try {
      if (category === "commentReply" || category === "likes" || category === "newComment" || category === "newsletter") {
        await ctx.runMutation(internal.emailPreferences.unsubscribeByTokenInternal, {token, category});
      } else {
        await ctx.runMutation(internal.emailPreferences.unsubscribeByTokenInternal, {token, all: true});
      }
      return new Response(null, {status: 204});
    } catch {
      return new Response("Invalid token", {status: 404});
    }
  }),
});

http.route({
  path: "/resend/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret) return new Response("Webhook not configured", {status: 503});
    const payload = await request.text();
    const id = request.headers.get("svix-id") ?? "";
    const timestamp = request.headers.get("svix-timestamp") ?? "";
    const signature = request.headers.get("svix-signature") ?? "";
    if (!id || !timestamp || !signature) return new Response("Missing signature headers", {status: 400});
    const valid = await verifySvixSignature(secret, payload, {id, timestamp, signature});
    if (!valid) return new Response("Invalid signature", {status: 401});
    let event: unknown;
    try { event = JSON.parse(payload); } catch { return new Response("Invalid JSON", {status: 400}); }
    if (!event || typeof event !== "object") return new Response("Invalid event", {status: 400});
    const record = event as {type?: unknown; data?: unknown};
    if (typeof record.type !== "string") return new Response("Missing type", {status: 400});
    const data = record.data;
    const email = data && typeof data === "object" && "to" in data && Array.isArray((data as {to?: unknown}).to)
      ? String((data as {to: unknown[]}).to[0] ?? "")
      : data && typeof data === "object" && "email" in data
        ? String((data as {email?: unknown}).email ?? "")
        : "";
    await ctx.runMutation(internal.emailWebhook.handleResendEvent, {
      type: record.type,
      email: email || undefined,
      createdAt: Date.now(),
    });
    return new Response(null, {status: 204});
  }),
});

export default http;
