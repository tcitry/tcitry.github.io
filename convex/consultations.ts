import { RateLimiter } from "@convex-dev/rate-limiter";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isConsultationAuthor, requireMemberIdentity, requireProMembership } from "./membership";
import { bindConsultationImages, imageResult, readConsultationImages } from "./commentImages";
import { notifyConsultationReply } from "./notifications";

const limiter = new RateLimiter(components.rateLimiter, {
  consultationWrites: { kind: "token bucket", rate: 30, period: 60_000, capacity: 10 },
});
const status = v.union(v.literal("waiting"), v.literal("replied"), v.literal("closed"));
const threadView = v.object({
  _id: v.id("consultationThreads"), title: v.string(), status,
  createdAt: v.number(), updatedAt: v.number(),
});
const messageView = v.object({
  _id: v.id("consultationMessages"), sender: v.union(v.literal("member"), v.literal("author")),
  content: v.string(), createdAt: v.number(), images: v.array(imageResult),
});
const threadArgs = { threadId: v.id("consultationThreads") };
const imageArgs = { imageIds: v.optional(v.array(v.id("commentImages"))) };
const createArgs = { title: v.string(), content: v.string(), requestId: v.string(), ...imageArgs };
const sendArgs = { ...threadArgs, content: v.string(), requestId: v.string(), ...imageArgs };

function fail(code: string, message: string): never { throw new ConvexError({ code, message }); }
function text(value: string, max: number) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(cleaned)) {
    fail("INVALID_ARGUMENT", `内容须为 1–${max} 个字符。`);
  }
  return cleaned;
}
function requestKey(value: string) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(value)) fail("INVALID_ARGUMENT", "请求标识无效，请刷新后重试。");
  return value;
}
function messageContent(value: string, imageIds: Id<"commentImages">[] = []) {
  if (imageIds.length > 4 || new Set(imageIds).size !== imageIds.length) fail("INVALID_ARGUMENT", "每条消息最多附加 4 张不同图片。");
  const content = value.trim();
  if ((!content && imageIds.length === 0) || content.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
    fail("INVALID_ARGUMENT", "请输入消息或附加图片，文字最多 10000 个字符。");
  }
  return content;
}
function sameImages(previous: Doc<"consultationMessages">, imageIds: Id<"commentImages">[] = []) {
  return (previous.imageIds?.length ?? 0) === imageIds.length && imageIds.every((id, index) => previous.imageIds?.[index] === id);
}
function pagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50) {
    fail("INVALID_ARGUMENT", "每次只能读取 1–50 条记录。");
  }
  if (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100)) {
    fail("INVALID_ARGUMENT", "分页读取条数无效。");
  }
  if (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000)) {
    fail("INVALID_ARGUMENT", "分页读取字节数无效。");
  }
}
const displayThread = ({ _id, title, status, createdAt, updatedAt }: Doc<"consultationThreads">) => ({ _id, title, status, createdAt, updatedAt });
const displayMessage = ({ _id, sender, content, createdAt }: Doc<"consultationMessages">) => ({ _id, sender, content, createdAt });

async function accessibleThread(ctx: QueryCtx | MutationCtx, threadId: Id<"consultationThreads">) {
  const identity = await requireMemberIdentity(ctx);
  const thread = await ctx.db.get("consultationThreads", threadId);
  if (!thread || (thread.owner !== identity.tokenIdentifier && !isConsultationAuthor(identity))) {
    fail("NOT_FOUND", "这条咨询不存在或不可访问。");
  }
  return { thread, identity };
}

async function existingMessage(ctx: QueryCtx | MutationCtx, senderIdentity: string, requestId: string) {
  return ctx.db.query("consultationMessages").withIndex("by_senderIdentity_and_requestId", q => q.eq("senderIdentity", senderIdentity).eq("requestId", requestId)).unique();
}

export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(threadView),
  handler: async (ctx, args) => {
    const identity = await requireMemberIdentity(ctx);
    pagination(args.paginationOpts);
    const result = await ctx.db.query("consultationThreads")
      .withIndex("by_owner_and_updatedAt", q => q.eq("owner", identity.tokenIdentifier))
      .order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(displayThread) };
  },
});

export const listInbox = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(threadView),
  handler: async (ctx, args) => {
    const identity = await requireMemberIdentity(ctx);
    if (!isConsultationAuthor(identity)) fail("FORBIDDEN", "此操作仅供博主使用。");
    pagination(args.paginationOpts);
    const result = await ctx.db.query("consultationThreads").withIndex("by_updatedAt")
      .order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(displayThread) };
  },
});

export const getThread = query({
  args: threadArgs,
  returns: threadView,
  handler: async (ctx, args) => displayThread((await accessibleThread(ctx, args.threadId)).thread),
});

export const listMessages = query({
  args: { ...threadArgs, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(messageView),
  handler: async (ctx, args) => {
    await accessibleThread(ctx, args.threadId);
    pagination(args.paginationOpts);
    const result = await ctx.db.query("consultationMessages")
      .withIndex("by_threadId_and_createdAt", q => q.eq("threadId", args.threadId)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map(async message => ({ ...displayMessage(message), images: await readConsultationImages(ctx, message) }))) };
  },
});

export const createPaid = internalMutation({
  args: createArgs,
  returns: v.id("consultationThreads"),
  handler: async (ctx, args) => {
    const identity = await requireMemberIdentity(ctx);
    const title = text(args.title, 160), content = messageContent(args.content, args.imageIds), requestId = requestKey(args.requestId);
    const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
    if (previous) {
      const { thread } = await accessibleThread(ctx, previous.threadId);
      if (previous.sender !== "member" || thread.owner !== identity.tokenIdentifier || thread.requestId !== requestId || thread.title !== title || previous.content !== content || !sameImages(previous, args.imageIds)) {
        fail("REQUEST_CONFLICT", "此请求已用于其他内容。");
      }
      return thread._id;
    }
    await requireProMembership(ctx);
    await limiter.limit(ctx, "consultationWrites", { key: identity.tokenIdentifier, throws: true });
    const now = Date.now();
    const threadId = await ctx.db.insert("consultationThreads", {
      owner: identity.tokenIdentifier, title, status: "waiting", requestId, createdAt: now, updatedAt: now,
    });
    const messageId = await ctx.db.insert("consultationMessages", {
      threadId, sender: "member", senderIdentity: identity.tokenIdentifier, content, requestId, createdAt: now, imageIds: args.imageIds ?? [],
    });
    await bindConsultationImages(ctx, args.imageIds ?? [], threadId, messageId, identity.tokenIdentifier);
    return threadId;
  },
});

export const start = action({
  args: createArgs,
  returns: v.id("consultationThreads"),
  handler: async (ctx, args): Promise<Id<"consultationThreads">> => {
    return ctx.runMutation(internal.consultations.createPaid, args);
  },
});

async function appendMessage(ctx: MutationCtx, args: { threadId: Id<"consultationThreads">; content: string; requestId: string; imageIds?: Id<"commentImages">[] }, sender: "member" | "author") {
  const { thread, identity } = await accessibleThread(ctx, args.threadId);
  if (sender === "author") {
    if (!isConsultationAuthor(identity)) fail("FORBIDDEN", "此操作仅供博主使用。");
  } else if (thread.owner !== identity.tokenIdentifier) {
    fail("NOT_FOUND", "这条咨询不存在或不可访问。");
  }
  const content = messageContent(args.content, args.imageIds), requestId = requestKey(args.requestId);
  const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
  if (previous) {
    if (previous.sender !== sender || previous.threadId !== args.threadId || previous.content !== content || !sameImages(previous, args.imageIds)) fail("REQUEST_CONFLICT", "此请求已用于其他内容或身份。");
    return previous._id;
  }
  if (thread.status === "closed") fail("THREAD_CLOSED", "这条咨询已结束。");
  if (sender === "member") await requireProMembership(ctx);
  await limiter.limit(ctx, "consultationWrites", { key: identity.tokenIdentifier, throws: true });
  const now = Math.max(Date.now(), thread.updatedAt + 1);
  const messageId = await ctx.db.insert("consultationMessages", {
    threadId: args.threadId, sender, senderIdentity: identity.tokenIdentifier, content, requestId, createdAt: now, imageIds: args.imageIds ?? [],
  });
  await bindConsultationImages(ctx, args.imageIds ?? [], args.threadId, messageId, identity.tokenIdentifier);
  await ctx.db.patch("consultationThreads", thread._id, { status: sender === "author" ? "replied" : "waiting", updatedAt: now });
  if (sender === "author") await notifyConsultationReply(ctx, thread._id, messageId);
  return messageId;
}

export const insertMessage = internalMutation({
  args: sendArgs,
  returns: v.id("consultationMessages"),
  handler: async (ctx, args) => appendMessage(ctx, args, "member"),
});

export const insertReply = internalMutation({
  args: sendArgs,
  returns: v.id("consultationMessages"),
  handler: async (ctx, args) => appendMessage(ctx, args, "author"),
});

export const send = action({
  args: sendArgs,
  returns: v.id("consultationMessages"),
  handler: async (ctx, args): Promise<Id<"consultationMessages">> => {
    return ctx.runMutation(internal.consultations.insertMessage, args);
  },
});

export const reply = action({
  args: sendArgs,
  returns: v.id("consultationMessages"),
  handler: async (ctx, args): Promise<Id<"consultationMessages">> => {
    return ctx.runMutation(internal.consultations.insertReply, args);
  },
});

export const close = mutation({
  args: threadArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { thread, identity } = await accessibleThread(ctx, args.threadId);
    if (thread.status !== "closed") {
      await limiter.limit(ctx, "consultationWrites", { key: identity.tokenIdentifier, throws: true });
      await ctx.db.patch("consultationThreads", thread._id, { status: "closed", updatedAt: Math.max(Date.now(), thread.updatedAt + 1) });
    }
    return null;
  },
});
