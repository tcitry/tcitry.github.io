import { RateLimiter } from "@convex-dev/rate-limiter";
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { readingStatus } from "./schema";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  readerWrites: { kind: "token bucket", rate: 60, period: 60_000, capacity: 30 },
});

const pageArgs = { pathname: v.string() };
const pageWriteArgs = { ...pageArgs, title: v.string() };
const libraryItem = v.object({
  pathname: v.string(),
  title: v.string(),
  updatedAt: v.number(),
});

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "请先登录。" });
  return identity.tokenIdentifier;
}

function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID_ARGUMENT", message });
}

// Canonical page URLs are the durable keys, never page titles or Clerk profile data.
// Percent encodings and one trailing slash normalize equivalent pathname inputs.
function canonicalPathname(value: string) {
  if (
    value.length === 0 || value.length > 1_024 || !value.startsWith("/") ||
    value.includes("//") || /[\\?#\u0000-\u0020\u007f]/u.test(value)
  ) invalid("页面路径无效。");

  const segments = value.split("/").filter(Boolean).map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return invalid("页面路径编码无效。"); }
    if (decoded === "." || decoded === ".." || /[/\\?#\u0000-\u001f\u007f]/u.test(decoded)) {
      invalid("页面路径无效。");
    }
    return encodeURIComponent(decoded);
  });
  const pathname = segments.length ? `/${segments.join("/")}/` : "/";
  if (pathname.length > 1_024) invalid("页面路径过长。");
  return pathname;
}

function pageTitle(value: string) {
  const title = value.trim();
  if (!title || title.length > 240 || /[\u0000-\u001f\u007f]/u.test(title)) {
    invalid("标题须为 1–240 个字符。");
  }
  return title;
}

function validatePagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50) {
    invalid("每次只能读取 1–50 条记录。");
  }
  if (options.maximumRowsRead !== undefined &&
      (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100)) {
    invalid("分页最多读取 100 条记录。");
  }
  if (options.maximumBytesRead !== undefined &&
      (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000)) {
    invalid("分页读取字节数无效。");
  }
}

async function limitWrite(ctx: MutationCtx, owner: string) {
  await rateLimiter.limit(ctx, "readerWrites", { key: owner, throws: true });
}

export const getPage = query({
  args: pageArgs,
  returns: v.object({
    bookmarked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const bookmark = await ctx.db.query("bookmarks")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    return { bookmarked: bookmark !== null };
  },
});

export const setBookmark = mutation({
  args: { ...pageWriteArgs, bookmarked: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = pageTitle(args.title);
    const existing = await ctx.db.query("bookmarks")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (args.bookmarked && !existing) {
      await limitWrite(ctx, owner);
      await ctx.db.insert("bookmarks", { owner, pathname, title, updatedAt: Date.now() });
    } else if (!args.bookmarked && existing) {
      await limitWrite(ctx, owner);
      await ctx.db.delete("bookmarks", existing._id);
    }
    return args.bookmarked;
  },
});

export const listLibrary = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(libraryItem),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    validatePagination(args.paginationOpts);
    const result = await ctx.db.query("bookmarks")
      .withIndex("by_owner_and_updatedAt", q => q.eq("owner", owner))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(row => ({
        pathname: row.pathname,
        title: row.title,
        updatedAt: row.updatedAt,
      })),
    };
  },
});

export const getReadingMark = query({
  args: pageArgs,
  returns: v.object({ status: v.union(readingStatus, v.null()) }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const mark = await ctx.db.query("readingMarks")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    return { status: mark?.status ?? null };
  },
});

export const setReadingMark = mutation({
  args: { ...pageWriteArgs, status: readingStatus },
  returns: readingStatus,
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = pageTitle(args.title);
    const existing = await ctx.db.query("readingMarks")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (existing?.status === args.status && existing.title === title) return args.status;
    await limitWrite(ctx, owner);
    const fields = { owner, pathname, title, status: args.status, updatedAt: Date.now() };
    if (existing) await ctx.db.patch("readingMarks", existing._id, fields);
    else await ctx.db.insert("readingMarks", fields);
    return args.status;
  },
});

export const clearReadingMark = mutation({
  args: pageArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const existing = await ctx.db.query("readingMarks")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (existing) {
      await limitWrite(ctx, owner);
      await ctx.db.delete("readingMarks", existing._id);
    }
    return null;
  },
});

export const listReadingMarks = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(readingStatus) },
  returns: paginationResultValidator(v.object({
    pathname: v.string(), title: v.string(), status: readingStatus, updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    validatePagination(args.paginationOpts);
    const marks = args.status === undefined
      ? ctx.db.query("readingMarks").withIndex("by_owner_and_updatedAt", q => q.eq("owner", owner))
      : ctx.db.query("readingMarks").withIndex("by_owner_and_status_and_updatedAt", q => q.eq("owner", owner).eq("status", args.status!));
    const result = await marks.order("desc").paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(({ pathname, title, status, updatedAt }) => ({ pathname, title, status, updatedAt })),
    };
  },
});

function clampProgress(value: number) {
  if (!Number.isFinite(value)) invalid("进度无效。");
  return Math.min(1, Math.max(0, value));
}

// Scroll progress is monotonic. A lower or equal value is not a write, so it
// cannot roll the ratio backward or consume the shared readerWrites budget.
export const getReadingProgress = query({
  args: pageArgs,
  returns: v.object({ progress: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const row = await ctx.db.query("readingProgress")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    return { progress: row?.progress ?? null };
  },
});

export const setReadingProgress = mutation({
  args: { ...pageWriteArgs, progress: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = pageTitle(args.title);
    const progress = clampProgress(args.progress);
    const existing = await ctx.db.query("readingProgress")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (existing && progress <= existing.progress) return existing.progress;
    await limitWrite(ctx, owner);
    const updatedAt = Date.now();
    if (existing) await ctx.db.patch("readingProgress", existing._id, { title, progress, updatedAt });
    else await ctx.db.insert("readingProgress", { owner, pathname, title, progress, updatedAt });
    return progress;
  },
});

export const clearReadingProgress = mutation({
  args: pageArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const existing = await ctx.db.query("readingProgress")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (existing) {
      await limitWrite(ctx, owner);
      await ctx.db.delete("readingProgress", existing._id);
    }
    return null;
  },
});

export const listReadingProgress = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({
    pathname: v.string(), title: v.string(), progress: v.number(), updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    validatePagination(args.paginationOpts);
    const result = await ctx.db.query("readingProgress")
      .withIndex("by_owner_and_updatedAt", q => q.eq("owner", owner))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(({ pathname, title, progress, updatedAt }) => ({ pathname, title, progress, updatedAt })),
    };
  },
});
