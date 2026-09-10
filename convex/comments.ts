import {RateLimiter} from "@convex-dev/rate-limiter";
import {paginationOptsValidator, paginationResultValidator, type PaginationOptions} from "convex/server";
import {ConvexError, v} from "convex/values";
import {components} from "./_generated/api";
import {env, mutation, query, type MutationCtx, type QueryCtx} from "./_generated/server";
import {canonicalPathname, commentAuthorName, invalid, requireCommentIdentity} from "./commentShared";
import {bindImages, deleteImages, imageResult, readCommentImages} from "./commentImages";
import {notifyCommentReply} from "./notifications";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  commentWrites: {kind: "token bucket", rate: 6, period: 60_000, capacity: 3},
  likes: {kind: "token bucket", rate: 30, period: 60_000, capacity: 10},
});

function isModerator(owner: string) {
  return Boolean(owner && owner === env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER?.trim());
}

async function readStats(ctx: QueryCtx | MutationCtx, pathname: string) {
  const stats = await ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).unique();
  if (stats) return {id: stats._id, commentCount: stats.commentCount, likeCount: stats.likeCount};
  // Existing articles are initialized exactly, without an unbounded scan or a
  // silently truncated public total. Subsequent writes maintain one stats row.
  const comments = await ctx.db.query("comments").withIndex("by_pathname_and_createdAt", q => q.eq("pathname", pathname)).take(501);
  const likes = await ctx.db.query("articleLikes").withIndex("by_pathname_and_owner", q => q.eq("pathname", pathname)).take(501);
  if (comments.length > 500 || likes.length > 500) throw new ConvexError({code: "COUNTS_NOT_READY", message: "评论总数暂时无法读取，请稍后重试。"});
  return {id: null, commentCount: comments.filter(row => row.deletedAt === undefined).length, likeCount: likes.length};
}

async function updateStats(ctx: MutationCtx, pathname: string, stats: Awaited<ReturnType<typeof readStats>>, commentDelta: number, likeDelta: number) {
  const value = {commentCount: stats.commentCount + commentDelta, likeCount: stats.likeCount + likeDelta};
  if (value.commentCount < 0 || value.likeCount < 0) throw new ConvexError({code: "COUNTS_NOT_READY", message: "评论统计暂时不可用。"});
  if (stats.id) await ctx.db.patch("commentStats", stats.id, value);
  else await ctx.db.insert("commentStats", {pathname, ...value});
}

export const getSummary = query({
  args: {pathname: v.string()}, returns: v.object({commentCount: v.number(), likeCount: v.number()}),
  handler: async (ctx, args) => {
    const {commentCount, likeCount} = await readStats(ctx, canonicalPathname(args.pathname));
    return {commentCount, likeCount};
  },
});

export const getMyLike = query({
  args: {pathname: v.string()}, returns: v.boolean(),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const pathname = canonicalPathname(args.pathname);
    return Boolean(await ctx.db.query("articleLikes").withIndex("by_pathname_and_owner", q => q.eq("pathname", pathname).eq("owner", owner)).unique());
  },
});

export const setLike = mutation({
  args: {pathname: v.string(), liked: v.boolean(), title: v.optional(v.string())}, returns: v.boolean(),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = args.title?.trim();
    if (title !== undefined && (!title || title.length > 160 || /[\u0000-\u001f\u007f]/u.test(title))) invalid("文章标题须为 1–160 个字符。");
    const existing = await ctx.db.query("articleLikes").withIndex("by_pathname_and_owner", q => q.eq("pathname", pathname).eq("owner", owner)).unique();
    if (Boolean(existing) === args.liked) return args.liked;
    await rateLimiter.limit(ctx, "likes", {key: owner, throws: true});
    const stats = await readStats(ctx, pathname);
    if (existing) await ctx.db.delete("articleLikes", existing._id);
    else await ctx.db.insert("articleLikes", {pathname, owner, title, createdAt: Date.now()});
    await updateStats(ctx, pathname, stats, 0, args.liked ? 1 : -1);
    return args.liked;
  },
});

function accountPagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50 ||
    (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100)) ||
    (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) invalid("每次最多加载 50 条记录。");
}

export const listLikedArticles = query({
  args: {paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(v.object({pathname: v.string(), title: v.string(), createdAt: v.number()})),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    accountPagination(args.paginationOpts);
    const result = await ctx.db.query("articleLikes").withIndex("by_owner_and_createdAt", q => q.eq("owner", owner)).order("desc").paginate(args.paginationOpts);
    return {...result, page: result.page.map(row => ({pathname: row.pathname, title: row.title ?? row.pathname, createdAt: row.createdAt ?? row._creationTime}))};
  },
});

export const listMine = query({
  args: {paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(v.object({
    _id: v.id("comments"), pathname: v.string(), articleTitle: v.optional(v.string()),
    body: v.string(), createdAt: v.number(), parentId: v.optional(v.id("comments")), imageCount: v.number(),
  })),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    accountPagination(args.paginationOpts);
    const result = await ctx.db.query("comments")
      .withIndex("by_owner_and_deletedAt_and_createdAt", q => q.eq("owner", owner).eq("deletedAt", undefined))
      .order("desc").paginate(args.paginationOpts);
    return {...result, page: result.page.map(row => ({
      _id: row._id, pathname: row.pathname, body: row.body, createdAt: row.createdAt,
      ...(row.parentId ? {parentId: row.parentId} : {}), imageCount: Math.min(row.imageIds?.length ?? 0, 4),
    }))};
  },
});

export const setCommentLike = mutation({
  args: {pathname: v.string(), commentId: v.id("comments"), liked: v.boolean()}, returns: v.boolean(),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const pathname = canonicalPathname(args.pathname);
    const comment = await ctx.db.get("comments", args.commentId);
    if (!comment || comment.pathname !== pathname || comment.deletedAt !== undefined) invalid("评论不存在、已删除或不属于当前文章。");
    const existing = await ctx.db.query("commentLikes").withIndex("by_commentId_and_owner", q => q.eq("commentId", comment._id).eq("owner", owner)).unique();
    if (Boolean(existing) === args.liked) return args.liked;
    await rateLimiter.limit(ctx, "likes", {key: owner, throws: true});
    if (existing) await ctx.db.delete("commentLikes", existing._id);
    else await ctx.db.insert("commentLikes", {commentId: comment._id, owner});
    await ctx.db.patch("comments", comment._id, {likeCount: (comment.likeCount ?? 0) + (args.liked ? 1 : -1)});
    return args.liked;
  },
});

const publicComment = v.object({
  id: v.id("comments"), authorName: v.string(), body: v.string(), createdAt: v.number(),
  canDelete: v.boolean(), deleted: v.boolean(), likeCount: v.number(), likedByMe: v.boolean(), images: v.array(imageResult),
  replyTo: v.optional(v.object({id: v.id("comments"), authorName: v.string(), deleted: v.boolean()})),
});

export const list = query({
  args: {pathname: v.string(), paginationOpts: paginationOptsValidator}, returns: paginationResultValidator(publicComment),
  handler: async (ctx, args) => {
    const {tokenIdentifier: viewer} = await requireCommentIdentity(ctx);
    const pathname = canonicalPathname(args.pathname);
    const options = args.paginationOpts;
    if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 30 ||
      (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 60)) ||
      (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) invalid("每次最多加载 30 条评论。");
    const result = await ctx.db.query("comments").withIndex("by_pathname_and_createdAt", q => q.eq("pathname", pathname)).order("desc").paginate(options);
    return {...result, page: await Promise.all(result.page.map(async row => {
      const parent = row.parentId ? await ctx.db.get("comments", row.parentId) : null;
      const deleted = row.deletedAt !== undefined;
      const liked = deleted ? null : await ctx.db.query("commentLikes").withIndex("by_commentId_and_owner", q => q.eq("commentId", row._id).eq("owner", viewer)).unique();
      return {
        id: row._id, authorName: deleted ? "已删除的评论" : row.authorName, body: deleted ? "" : row.body, createdAt: row.createdAt,
        canDelete: !deleted && (isModerator(viewer) || row.owner === viewer), deleted,
        likeCount: deleted ? 0 : row.likeCount ?? 0, likedByMe: Boolean(liked),
        images: deleted ? [] : await readCommentImages(ctx, row),
        ...(parent && parent.pathname === pathname ? {replyTo: {id: parent._id, authorName: parent.deletedAt !== undefined ? "已删除的评论" : parent.authorName, deleted: parent.deletedAt !== undefined}} : {}),
      };
    }))};
  },
});

export const add = mutation({
  args: {pathname: v.string(), body: v.string(), parentId: v.optional(v.id("comments")), imageIds: v.optional(v.array(v.id("commentImages")))},
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    const identity = await requireCommentIdentity(ctx);
    const owner = identity.tokenIdentifier;
    const pathname = canonicalPathname(args.pathname);
    const authorName = commentAuthorName(identity);
    const body = args.body.trim();
    const imageIds = args.imageIds ?? [];
    if ((!body && !imageIds.length) || body.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) invalid("请填写 1–4,000 字的评论，或上传图片。");
    if (imageIds.length > 4 || new Set(imageIds).size !== imageIds.length) invalid("每条评论最多上传 4 张不同的图片。");
    if (args.parentId) {
      const parent = await ctx.db.get("comments", args.parentId);
      if (!parent || parent.pathname !== pathname || parent.deletedAt !== undefined) invalid("回复的评论不存在、已删除或不属于当前文章。");
    }
    await rateLimiter.limit(ctx, "commentWrites", {key: owner, throws: true});
    const stats = await readStats(ctx, pathname);
    const id = await ctx.db.insert("comments", {owner, pathname, authorName, body, createdAt: Date.now(), parentId: args.parentId, imageIds, likeCount: 0});
    await bindImages(ctx, imageIds, id, owner);
    await updateStats(ctx, pathname, stats, 1, 0);
    if (args.parentId) await notifyCommentReply(ctx, id, args.parentId);
    return id;
  },
});

export const remove = mutation({
  args: {id: v.id("comments")}, returns: v.null(),
  handler: async (ctx, args) => {
    const {tokenIdentifier: owner} = await requireCommentIdentity(ctx);
    const row = await ctx.db.get("comments", args.id);
    if (!row) return null;
    if (!isModerator(owner) && row.owner !== owner) throw new ConvexError({code: "FORBIDDEN", message: "只能删除自己的评论。"});
    if (row.deletedAt !== undefined) return null;
    await rateLimiter.limit(ctx, "commentWrites", {key: owner, throws: true});
    const stats = await readStats(ctx, row.pathname);
    await deleteImages(ctx, row);
    await ctx.db.patch("comments", row._id, {deletedAt: Date.now(), body: "", authorName: "", imageIds: [], likeCount: 0});
    await updateStats(ctx, row.pathname, stats, -1, 0);
    return null;
  },
});
