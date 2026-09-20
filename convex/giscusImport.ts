import {ConvexError, v} from "convex/values";
import type {Id} from "./_generated/dataModel";
import {internalMutation, type MutationCtx} from "./_generated/server";
import {canonicalPathname} from "./commentShared";

const importSource = v.union(v.literal("github_discussion"), v.literal("giscus"));

const importRow = v.object({
  pathname: v.string(),
  externalId: v.string(),
  body: v.string(),
  createdAt: v.number(),
  parentExternalId: v.union(v.string(), v.null()),
  owner: v.string(),
  authorName: v.string(),
  sourceDiscussionNumber: v.number(),
  githubLogin: v.optional(v.string()),
  githubUserId: v.optional(v.number()),
  sourceUrl: v.optional(v.string()),
});

const importResult = v.object({
  inserted: v.number(),
  skipped: v.number(),
  pathnames: v.record(v.string(), v.number()),
});

function validateImportBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed)) {
    throw new ConvexError({code: "INVALID_ARGUMENT", message: "Imported comment body is empty or invalid."});
  }
  return trimmed;
}

function validateAuthorName(authorName: string) {
  const trimmed = authorName.trim();
  if (!trimmed || trimmed.length > 80 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new ConvexError({code: "INVALID_ARGUMENT", message: "Imported author name is invalid."});
  }
  return trimmed;
}

async function readStats(ctx: MutationCtx, pathname: string) {
  const stats = await ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).unique();
  if (stats) return {id: stats._id, commentCount: stats.commentCount, likeCount: stats.likeCount};
  const comments = await ctx.db.query("comments").withIndex("by_pathname_and_createdAt", q => q.eq("pathname", pathname)).take(501);
  const likes = await ctx.db.query("articleLikes").withIndex("by_pathname_and_owner", q => q.eq("pathname", pathname)).take(501);
  if (comments.length > 500 || likes.length > 500) throw new ConvexError({code: "COUNTS_NOT_READY", message: "Comment totals are not ready for import."});
  return {id: null, commentCount: comments.filter(row => row.deletedAt === undefined).length, likeCount: likes.length};
}

async function updateStats(ctx: MutationCtx, pathname: string, stats: Awaited<ReturnType<typeof readStats>>, commentDelta: number) {
  const value = {commentCount: stats.commentCount + commentDelta, likeCount: stats.likeCount};
  if (value.commentCount < 0) throw new ConvexError({code: "COUNTS_NOT_READY", message: "Comment totals are not ready for import."});
  if (stats.id) await ctx.db.patch("commentStats", stats.id, value);
  else await ctx.db.insert("commentStats", {pathname, ...value});
}

async function existingByExternalId(ctx: MutationCtx, externalId: string) {
  return ctx.db.query("comments").withIndex("by_externalId", q => q.eq("externalId", externalId)).unique();
}

export const importBatch = internalMutation({
  args: {
    rows: v.array(importRow),
    importSource,
  },
  returns: importResult,
  handler: async (ctx, args) => {
    const sorted = [...args.rows].sort((left, right) => left.createdAt - right.createdAt);
    const externalToId = new Map<string, Id<"comments">>();
    const pathDelta = new Map<string, number>();
    const statsByPath = new Map<string, Awaited<ReturnType<typeof readStats>>>();
    let inserted = 0;
    let skipped = 0;

    for (const row of sorted) {
      const pathname = canonicalPathname(row.pathname);
      if (!statsByPath.has(pathname)) statsByPath.set(pathname, await readStats(ctx, pathname));
      const existing = await existingByExternalId(ctx, row.externalId);
      if (existing) {
        externalToId.set(row.externalId, existing._id);
        skipped += 1;
        continue;
      }
      if (!row.owner.startsWith("github:user:")) {
        throw new ConvexError({code: "INVALID_ARGUMENT", message: "Imported comments must use synthetic GitHub owners."});
      }
      let parentId: Id<"comments"> | undefined;
      if (row.parentExternalId) {
        parentId = externalToId.get(row.parentExternalId) ?? (await existingByExternalId(ctx, row.parentExternalId))?._id;
        if (!parentId) throw new ConvexError({code: "INVALID_ARGUMENT", message: `Missing parent comment ${row.parentExternalId} for ${row.externalId}.`});
        const parent = await ctx.db.get("comments", parentId);
        if (!parent || parent.pathname !== pathname) {
          throw new ConvexError({code: "INVALID_ARGUMENT", message: `Parent comment ${row.parentExternalId} does not belong to ${pathname}.`});
        }
      }
      const id = await ctx.db.insert("comments", {
        pathname,
        owner: row.owner,
        authorName: validateAuthorName(row.authorName),
        body: validateImportBody(row.body),
        createdAt: row.createdAt,
        parentId,
        likeCount: 0,
        importSource: args.importSource,
        externalId: row.externalId,
        sourceDiscussionNumber: row.sourceDiscussionNumber,
        ...(row.githubLogin ? {githubLogin: row.githubLogin} : {}),
        ...(row.githubUserId !== undefined ? {githubUserId: row.githubUserId} : {}),
        ...(row.sourceUrl ? {sourceUrl: row.sourceUrl} : {}),
      });
      externalToId.set(row.externalId, id);
      pathDelta.set(pathname, (pathDelta.get(pathname) ?? 0) + 1);
      inserted += 1;
    }

    for (const [pathname, delta] of pathDelta) {
      const stats = statsByPath.get(pathname) ?? await readStats(ctx, pathname);
      await updateStats(ctx, pathname, stats, delta);
    }

    return {
      inserted,
      skipped,
      pathnames: Object.fromEntries(pathDelta),
    };
  },
});

export const rollback = internalMutation({
  args: {importSource},
  returns: v.object({deleted: v.number(), pathnames: v.record(v.string(), v.number())}),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("comments").withIndex("by_importSource", q => q.eq("importSource", args.importSource)).collect();
    const notifications = await ctx.db.query("notifications").collect();
    const pathDelta = new Map<string, number>();
    const statsByPath = new Map<string, Awaited<ReturnType<typeof readStats>>>();
    let deleted = 0;

    for (const row of rows) {
      if (row.deletedAt !== undefined) continue;
      if (!statsByPath.has(row.pathname)) statsByPath.set(row.pathname, await readStats(ctx, row.pathname));
      const likes = await ctx.db.query("commentLikes").withIndex("by_commentId_and_owner", q => q.eq("commentId", row._id)).collect();
      await Promise.all(likes.map(like => ctx.db.delete("commentLikes", like._id)));
      await Promise.all(notifications
        .filter(note => note.commentId === row._id)
        .map(note => ctx.db.delete("notifications", note._id)));
      await ctx.db.delete("comments", row._id);
      pathDelta.set(row.pathname, (pathDelta.get(row.pathname) ?? 0) + 1);
      deleted += 1;
    }

    for (const [pathname, delta] of pathDelta) {
      const stats = statsByPath.get(pathname) ?? await readStats(ctx, pathname);
      await updateStats(ctx, pathname, stats, -delta);
    }

    return {deleted, pathnames: Object.fromEntries(pathDelta)};
  },
});
