import { RateLimiter } from "@convex-dev/rate-limiter";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { consultationConfigured, isConsultationAuthor, requireMemberIdentity, requireProMembership } from "./membership";

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
  content: v.string(), createdAt: v.number(),
});
const threadArgs = { threadId: v.id("consultationThreads") };
const createArgs = { title: v.string(), content: v.string(), requestId: v.string() };
const sendArgs = { ...threadArgs, content: v.string(), requestId: v.string() };

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
function assertPaidUntil(validUntil: number) {
  if (!Number.isFinite(validUntil) || validUntil <= Date.now()) fail("PRO_REQUIRED", "会员状态已变化，请刷新后重试。");
}

export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(threadView),
  handler: async (ctx, args) => {
    pagination(args.paginationOpts);
    const identity = await requireMemberIdentity(ctx);
    const rows = isConsultationAuthor(identity)
      ? ctx.db.query("consultationThreads").withIndex("by_updatedAt")
      : ctx.db.query("consultationThreads").withIndex("by_owner_and_updatedAt", q => q.eq("owner", identity.tokenIdentifier));
    const result = await rows.order("desc").paginate(args.paginationOpts);
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
    return { ...result, page: result.page.map(displayMessage) };
  },
});

export const findCreated = internalQuery({
  args: createArgs,
  returns: v.union(v.id("consultationThreads"), v.null()),
  handler: async (ctx, args) => {
    const identity = await requireMemberIdentity(ctx);
    const title = text(args.title, 160), content = text(args.content, 10_000), requestId = requestKey(args.requestId);
    const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
    if (!previous) return null;
    const { thread } = await accessibleThread(ctx, previous.threadId);
    if (thread.requestId !== requestId || thread.title !== title || previous.content !== content) {
      fail("REQUEST_CONFLICT", "此请求已用于其他内容，请刷新后重试。");
    }
    return thread._id;
  },
});

export const createPaid = internalMutation({
  args: { ...createArgs, validUntil: v.number() },
  returns: v.id("consultationThreads"),
  handler: async (ctx, args) => {
    const identity = await requireMemberIdentity(ctx);
    const title = text(args.title, 160), content = text(args.content, 10_000), requestId = requestKey(args.requestId);
    const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
    if (previous) {
      const { thread } = await accessibleThread(ctx, previous.threadId);
      if (thread.requestId !== requestId || thread.title !== title || previous.content !== content) fail("REQUEST_CONFLICT", "此请求已用于其他内容。");
      return thread._id;
    }
    assertPaidUntil(args.validUntil);
    if (!consultationConfigured()) fail("CONSULTATION_UNAVAILABLE", "私人咨询尚未开放。");
    await limiter.limit(ctx, "consultationWrites", { key: identity.tokenIdentifier, throws: true });
    const now = Date.now();
    const threadId = await ctx.db.insert("consultationThreads", {
      owner: identity.tokenIdentifier, title, status: "waiting", requestId, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("consultationMessages", {
      threadId, sender: "member", senderIdentity: identity.tokenIdentifier, content, requestId, createdAt: now,
    });
    return threadId;
  },
});

export const start = action({
  args: createArgs,
  returns: v.id("consultationThreads"),
  handler: async (ctx, args): Promise<Id<"consultationThreads">> => {
    const previous: Id<"consultationThreads"> | null = await ctx.runQuery(internal.consultations.findCreated, args);
    if (previous) return previous;
    const validUntil = await requireProMembership(ctx);
    return ctx.runMutation(internal.consultations.createPaid, { ...args, validUntil });
  },
});

export const checkSend = internalQuery({
  args: sendArgs,
  returns: v.object({ isAdmin: v.boolean(), previous: v.union(v.id("consultationMessages"), v.null()) }),
  handler: async (ctx, args) => {
    const { thread, identity } = await accessibleThread(ctx, args.threadId);
    const content = text(args.content, 10_000), requestId = requestKey(args.requestId);
    const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
    if (previous && (previous.threadId !== args.threadId || previous.content !== content)) fail("REQUEST_CONFLICT", "此请求已用于其他内容。");
    if (!previous && thread.status === "closed") fail("THREAD_CLOSED", "这条咨询已结束。");
    return { isAdmin: isConsultationAuthor(identity), previous: previous?._id ?? null };
  },
});

export const insertMessage = internalMutation({
  args: { ...sendArgs, validUntil: v.union(v.number(), v.null()) },
  returns: v.id("consultationMessages"),
  handler: async (ctx, args) => {
    const { thread, identity } = await accessibleThread(ctx, args.threadId);
    const content = text(args.content, 10_000), requestId = requestKey(args.requestId);
    const previous = await existingMessage(ctx, identity.tokenIdentifier, requestId);
    if (previous) {
      if (previous.threadId !== args.threadId || previous.content !== content) fail("REQUEST_CONFLICT", "此请求已用于其他内容。");
      return previous._id;
    }
    if (thread.status === "closed") fail("THREAD_CLOSED", "这条咨询已结束。");
    const author = isConsultationAuthor(identity);
    if (!author) assertPaidUntil(args.validUntil ?? 0);
    await limiter.limit(ctx, "consultationWrites", { key: identity.tokenIdentifier, throws: true });
    const now = Math.max(Date.now(), thread.updatedAt + 1);
    const messageId = await ctx.db.insert("consultationMessages", {
      threadId: args.threadId, sender: author ? "author" : "member", senderIdentity: identity.tokenIdentifier,
      content, requestId, createdAt: now,
    });
    await ctx.db.patch("consultationThreads", thread._id, { status: author ? "replied" : "waiting", updatedAt: now });
    return messageId;
  },
});

export const send = action({
  args: sendArgs,
  returns: v.id("consultationMessages"),
  handler: async (ctx, args): Promise<Id<"consultationMessages">> => {
    const check: { isAdmin: boolean; previous: Id<"consultationMessages"> | null } = await ctx.runQuery(internal.consultations.checkSend, args);
    if (check.previous) return check.previous;
    const validUntil = check.isAdmin ? null : await requireProMembership(ctx);
    return ctx.runMutation(internal.consultations.insertMessage, { ...args, validUntil });
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
