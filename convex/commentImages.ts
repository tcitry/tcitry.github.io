import {RateLimiter} from "@convex-dev/rate-limiter";
import {ConvexError, v} from "convex/values";
import {components, internal} from "./_generated/api";
import type {Doc, Id} from "./_generated/dataModel";
import {env, httpAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx} from "./_generated/server";
import {invalid, requireCommentIdentity} from "./commentShared";

const maxBytes = 5 * 1024 * 1024;
const uploadLifetime = 24 * 60 * 60 * 1000;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploadLimiter = new RateLimiter(components.rateLimiter, {
  commentUploads: {kind: "token bucket", rate: 12, period: 60_000, capacity: 8},
});

export const imageResult = v.object({id: v.id("commentImages"), url: v.string(), contentType: v.string(), size: v.number()});

function denied(): never {
  throw new ConvexError({code: "FORBIDDEN", message: "无法使用这张图片。"});
}

function fileUrl(imageId: Id<"commentImages">) {
  return new URL(`/comment-images/file?imageId=${encodeURIComponent(imageId)}`, env.CONVEX_SITE_URL).href;
}

export async function bindImages(ctx: MutationCtx, ids: Id<"commentImages">[], commentId: Id<"comments">, owner: string) {
  for (const id of ids) {
    const image = await ctx.db.get("commentImages", id);
    if (!image || image.purpose !== "comment" || image.owner !== owner || image.commentId || image.messageId || image.createdAt + uploadLifetime <= Date.now()) denied();
    const metadata = await ctx.db.system.get("_storage", image.storageId);
    if (!metadata || metadata.size !== image.size || (metadata.contentType !== undefined && metadata.contentType !== image.contentType) || metadata.size > maxBytes || !imageTypes.has(image.contentType)) denied();
    await ctx.db.patch("commentImages", id, {commentId});
  }
}

export async function readCommentImages(ctx: QueryCtx, comment: Doc<"comments">) {
  const images = [];
  for (const id of (comment.imageIds ?? []).slice(0, 4)) {
    const image = await ctx.db.get("commentImages", id);
    if (!image || image.purpose !== "comment" || image.commentId !== comment._id || image.owner !== comment.owner) continue;
    images.push({id: image._id, url: fileUrl(image._id), contentType: image.contentType, size: image.size});
  }
  return images;
}

export async function bindConsultationImages(ctx: MutationCtx, ids: Id<"commentImages">[], threadId: Id<"consultationThreads">, messageId: Id<"consultationMessages">, owner: string) {
  for (const id of ids) {
    const image = await ctx.db.get("commentImages", id);
    if (!image || image.purpose !== "consultation" || image.owner !== owner || image.commentId || image.messageId || image.createdAt + uploadLifetime <= Date.now()) denied();
    const metadata = await ctx.db.system.get("_storage", image.storageId);
    if (!metadata || metadata.size !== image.size || (metadata.contentType !== undefined && metadata.contentType !== image.contentType) || metadata.size > maxBytes || !imageTypes.has(image.contentType)) denied();
    await ctx.db.patch("commentImages", id, {threadId, messageId});
  }
}

export async function readConsultationImages(ctx: QueryCtx, message: Doc<"consultationMessages">) {
  const images = [];
  for (const id of (message.imageIds ?? []).slice(0, 4)) {
    const image = await ctx.db.get("commentImages", id);
    if (!image || image.purpose !== "consultation" || image.messageId !== message._id || image.threadId !== message.threadId || image.owner !== message.senderIdentity) continue;
    images.push({id: image._id, url: fileUrl(image._id), contentType: image.contentType, size: image.size});
  }
  return images;
}

export async function deleteImages(ctx: MutationCtx, comment: Doc<"comments">) {
  for (const id of (comment.imageIds ?? []).slice(0, 4)) {
    const image = await ctx.db.get("commentImages", id);
    if (!image || image.purpose !== "comment" || image.commentId !== comment._id || image.owner !== comment.owner) continue;
    await ctx.storage.delete(image.storageId);
    await ctx.db.delete("commentImages", image._id);
  }
}

async function accessibleImage(ctx: QueryCtx, imageId: Id<"commentImages">, commentsOnly = false) {
  const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
  const image = await ctx.db.get("commentImages", imageId);
  if (!image) return null;
  if (commentsOnly && image.purpose !== "comment") denied();
  if (!image.commentId && !image.messageId) {
    if (image.owner !== owner || image.createdAt + uploadLifetime <= Date.now()) denied();
  } else if (image.purpose === "comment" && image.commentId) {
    const comment = await ctx.db.get("comments", image.commentId);
    if (!comment || comment.deletedAt !== undefined || comment.owner !== image.owner || !comment.imageIds?.includes(imageId)) return null;
  } else if (image.purpose === "consultation" && image.messageId && image.threadId) {
    const thread = await ctx.db.get("consultationThreads", image.threadId);
    const message = await ctx.db.get("consultationMessages", image.messageId);
    if (!thread || !message || message.threadId !== thread._id || message.senderIdentity !== image.owner || !message.imageIds?.includes(imageId)) return null;
    if (thread.owner !== owner && owner !== env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER?.trim()) denied();
  } else return null;
  return image;
}

export const getUrl = query({
  args: {imageId: v.id("commentImages")}, returns: v.union(v.string(), v.null()),
  handler: async (ctx, {imageId}) => (await accessibleImage(ctx, imageId, true)) ? fileUrl(imageId) : null,
});

export const resolveFile = internalQuery({
  args: {imageId: v.id("commentImages")}, returns: v.union(v.object({storageId: v.id("_storage"), contentType: v.string()}), v.null()),
  handler: async (ctx, {imageId}) => {
    const image = await accessibleImage(ctx, imageId);
    return image ? {storageId: image.storageId, contentType: image.contentType} : null;
  },
});

export const discard = mutation({
  args: {imageId: v.id("commentImages")}, returns: v.null(),
  handler: async (ctx, {imageId}) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const image = await ctx.db.get("commentImages", imageId);
    if (!image) return null;
    if (image.owner !== owner || image.commentId || image.messageId) denied();
    await ctx.storage.delete(image.storageId);
    await ctx.db.delete("commentImages", imageId);
    return null;
  },
});

export const beginUpload = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const result = await uploadLimiter.limit(ctx, "commentUploads", {key: owner});
    if (!result.ok) throw new ConvexError({code: "RATE_LIMITED", message: "上传过于频繁，请稍后重试。"});
    return null;
  },
});

export const register = internalMutation({
  args: {storageId: v.id("_storage"), contentType: v.string(), purpose: v.union(v.literal("comment"), v.literal("consultation"))}, returns: v.id("commentImages"),
  handler: async (ctx, {storageId, contentType, purpose}) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const metadata = await ctx.db.system.get("_storage", storageId);
    // Only the validating HTTP action calls this internal mutation. Storage's
    // optional contentType is cross-checked when supplied by the platform.
    if (!metadata || !imageTypes.has(contentType) || (metadata.contentType !== undefined && metadata.contentType !== contentType) || metadata.size < 1 || metadata.size > maxBytes) invalid("图片类型或大小不符合要求。");
    const imageId = await ctx.db.insert("commentImages", {owner, purpose, storageId, size: metadata.size, contentType, createdAt: Date.now()});
    await ctx.scheduler.runAfter(uploadLifetime, internal.commentImages.expireUpload, {imageId});
    return imageId;
  },
});

export const expireUpload = internalMutation({
  args: {imageId: v.id("commentImages")}, returns: v.null(),
  handler: async (ctx, {imageId}) => {
    const image = await ctx.db.get("commentImages", imageId);
    if (image && !image.commentId && !image.messageId && image.createdAt + uploadLifetime <= Date.now()) {
      await ctx.storage.delete(image.storageId);
      await ctx.db.delete("commentImages", imageId);
    }
    return null;
  },
});

function permittedOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configured = env.CHAT_ALLOWED_ORIGINS ?? "";
  let entries: unknown;
  try { entries = JSON.parse(configured); } catch { entries = configured.split(","); }
  return Array.isArray(entries) && entries.some(value => typeof value === "string" && value.trim() === origin) ? origin : null;
}

function cors(origin: string) {
  return {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Vary": "Origin", "Cache-Control": "private, no-store"};
}

function matchesSignature(bytes: Uint8Array, contentType: string) {
  const prefix = (...expected: number[]) => expected.every((value, index) => bytes[index] === value);
  if (contentType === "image/png") return prefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/jpeg") return prefix(0xff, 0xd8, 0xff);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (contentType === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  return contentType === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

async function limitedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) invalid("请选择图片。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ConvexError({code: "FILE_TOO_LARGE", message: "每张图片不能超过 5 MB。"});
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export const uploadOptions = httpAction(async (_ctx, request) => {
  const origin = permittedOrigin(request);
  return new Response(null, {status: origin ? 204 : 403, headers: origin ? cors(origin) : {"Vary": "Origin"}});
});

export const upload = httpAction(async (ctx, request) => {
  const origin = permittedOrigin(request);
  if (!origin) return new Response("Origin not allowed", {status: 403, headers: {"Vary": "Origin"}});
  const headers = {...cors(origin), "Content-Type": "application/json"};
  let stored: Id<"_storage"> | undefined;
  try {
    await requireCommentIdentity(ctx);
    const purpose = new URL(request.url).searchParams.get("purpose") ?? "comment";
    if (purpose !== "comment" && purpose !== "consultation") invalid("图片用途无效。");
    const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!imageTypes.has(contentType)) invalid("请上传 JPEG、PNG、WebP 或 GIF 图片。");
    await ctx.runMutation(internal.commentImages.beginUpload, {});
    const bytes = await limitedBody(request);
    if (!matchesSignature(bytes, contentType)) invalid("图片内容与文件类型不匹配。");
    stored = await ctx.storage.store(new Blob([bytes], {type: contentType}));
    const imageId: Id<"commentImages"> = await ctx.runMutation(internal.commentImages.register, {storageId: stored, contentType, purpose});
    return new Response(JSON.stringify({imageId}), {status: 201, headers});
  } catch (failure) {
    if (stored) await ctx.storage.delete(stored);
    const data = failure instanceof ConvexError && typeof failure.data === "object" && failure.data ? failure.data : null;
    const code = data && "code" in data && typeof data.code === "string" ? data.code : "UPLOAD_FAILED";
    const message = data && "message" in data && typeof data.message === "string" ? data.message : "图片上传未完成，请稍后重试。";
    const status = code === "UNAUTHENTICATED" ? 401 : code === "FILE_TOO_LARGE" ? 413 : code === "INVALID_ARGUMENT" ? 400 : code === "RATE_LIMITED" ? 429 : 500;
    return new Response(JSON.stringify({code, message}), {status, headers});
  }
});

export const download = httpAction(async (ctx, request) => {
  const origin = permittedOrigin(request);
  if (!origin) return new Response("Origin not allowed", {status: 403, headers: {"Vary": "Origin", "Cache-Control": "private, no-store"}});
  const headers = {...cors(origin), "X-Content-Type-Options": "nosniff"};
  try {
    await requireCommentIdentity(ctx);
    const imageId = new URL(request.url).searchParams.get("imageId");
    if (!imageId) return new Response(null, {status: 404, headers});
    const image = await ctx.runQuery(internal.commentImages.resolveFile, {imageId: imageId as Id<"commentImages">});
    if (!image) return new Response(null, {status: 404, headers});
    const blob = await ctx.storage.get(image.storageId);
    return new Response(blob, {status: blob ? 200 : 404, headers: {...headers, "Content-Type": image.contentType}});
  } catch (failure) {
    const data = failure instanceof ConvexError && typeof failure.data === "object" && failure.data ? failure.data : null;
    return new Response(null, {status: data && "code" in data && data.code === "UNAUTHENTICATED" ? 401 : 403, headers});
  }
});
