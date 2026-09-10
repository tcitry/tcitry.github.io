import {paginationOptsValidator, paginationResultValidator, type PaginationOptions} from "convex/server";
import {ConvexError, v} from "convex/values";
import type {Doc, Id} from "./_generated/dataModel";
import {mutation, query, type MutationCtx, type QueryCtx} from "./_generated/server";
import {invalid, requireCommentIdentity} from "./commentShared";

// Notification recipients are derived from the saved source, never caller args.
// These helpers execute in the reply mutation's transaction.
export async function notifyCommentReply(ctx: MutationCtx, commentId: Id<"comments">, parentId: Id<"comments">) {
  const reply = await ctx.db.get("comments", commentId);
  const parent = await ctx.db.get("comments", parentId);
  if (!reply || !parent || reply.parentId !== parentId || reply.pathname !== parent.pathname || parent.owner === reply.owner) return;
  await ctx.db.insert("notifications", {recipient: parent.owner, kind: "comment_reply", commentId, createdAt: reply.createdAt});
}

export async function notifyConsultationReply(ctx: MutationCtx, threadId: Id<"consultationThreads">, messageId: Id<"consultationMessages">) {
  const thread = await ctx.db.get("consultationThreads", threadId);
  const reply = await ctx.db.get("consultationMessages", messageId);
  if (!thread || !reply || reply.threadId !== threadId || reply.sender !== "author" || thread.owner === reply.senderIdentity) return;
  await ctx.db.insert("notifications", {recipient: thread.owner, kind: "consultation_reply", threadId, messageId, createdAt: reply.createdAt});
}

const target = v.union(
  v.object({kind: v.literal("comment"), pathname: v.string(), commentId: v.id("comments")}),
  v.object({kind: v.literal("consultation"), threadId: v.id("consultationThreads"), messageId: v.id("consultationMessages"), title: v.string()}),
  v.null(),
);
const view = v.object({
  _id: v.id("notifications"), kind: v.union(v.literal("comment_reply"), v.literal("consultation_reply")),
  createdAt: v.number(), readAt: v.union(v.number(), v.null()), target,
});

function pagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50 ||
    (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100)) ||
    (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) invalid("每次最多加载 50 条消息。");
}

async function currentTarget(ctx: QueryCtx, row: Doc<"notifications">) {
  if (row.kind === "comment_reply" && row.commentId) {
    const reply = await ctx.db.get("comments", row.commentId);
    if (!reply || reply.deletedAt !== undefined || !reply.parentId) return null;
    const parent = await ctx.db.get("comments", reply.parentId);
    if (!parent || parent.owner !== row.recipient || parent.pathname !== reply.pathname) return null;
    return {kind: "comment" as const, pathname: reply.pathname, commentId: reply._id};
  }
  if (row.kind === "consultation_reply" && row.threadId && row.messageId) {
    const thread = await ctx.db.get("consultationThreads", row.threadId);
    const reply = await ctx.db.get("consultationMessages", row.messageId);
    if (!thread || thread.owner !== row.recipient || !reply || reply.threadId !== thread._id || reply.sender !== "author") return null;
    return {kind: "consultation" as const, threadId: thread._id, messageId: reply._id, title: thread.title};
  }
  return null;
}

export const list = query({
  args: {paginationOpts: paginationOptsValidator}, returns: paginationResultValidator(view),
  handler: async (ctx, args) => {
    const {tokenIdentifier: recipient} = await requireCommentIdentity(ctx);
    pagination(args.paginationOpts);
    const result = await ctx.db.query("notifications").withIndex("by_recipient_and_createdAt", q => q.eq("recipient", recipient)).order("desc").paginate(args.paginationOpts);
    return {...result, page: await Promise.all(result.page.map(async row => ({
      _id: row._id, kind: row.kind, createdAt: row.createdAt, readAt: row.readAt ?? null, target: await currentTarget(ctx, row),
    })))};
  },
});

export const hasUnread = query({
  args: {}, returns: v.boolean(),
  handler: async ctx => {
    const {tokenIdentifier: recipient} = await requireCommentIdentity(ctx);
    const unread = await ctx.db.query("notifications")
      .withIndex("by_recipient_and_readAt", q => q.eq("recipient", recipient).eq("readAt", undefined))
      .first();
    return unread !== null;
  },
});

export const markRead = mutation({
  args: {id: v.id("notifications")}, returns: v.null(),
  handler: async (ctx, {id}) => {
    const {tokenIdentifier: recipient} = await requireCommentIdentity(ctx);
    const row = await ctx.db.get("notifications", id);
    if (!row || row.recipient !== recipient) throw new ConvexError({code: "NOT_FOUND", message: "这条消息不存在或不可访问。"});
    if (row.readAt === undefined) await ctx.db.patch("notifications", id, {readAt: Date.now()});
    return null;
  },
});
