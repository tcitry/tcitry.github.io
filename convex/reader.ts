import { RateLimiter } from "@convex-dev/rate-limiter";
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

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
