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
  progress: v.optional(v.number()),
  note: v.optional(v.string()),
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
    progress: v.union(v.number(), v.null()),
    note: v.string(),
    noteUpdatedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const [bookmark, progress, note] = await Promise.all([
      ctx.db.query("bookmarks").withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique(),
      ctx.db.query("readingProgress").withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique(),
      ctx.db.query("privateNotes").withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique(),
    ]);
    return {
      bookmarked: bookmark !== null,
      progress: progress?.progress ?? null,
      note: note?.note ?? "",
      noteUpdatedAt: note?.updatedAt ?? null,
    };
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

// Progress is the furthest point reached. Opening a page at the top on another
// device cannot reset it; clearPage explicitly removes saved progress.
export const saveProgress = mutation({
  args: { ...pageWriteArgs, progress: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = pageTitle(args.title);
    if (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 100) {
      invalid("阅读进度须介于 0 和 100 之间。");
    }
    const progress = Math.round(args.progress * 100) / 100;
    const existing = await ctx.db.query("readingProgress")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if (existing && existing.progress >= progress) return existing.progress;
    if (!existing && progress === 0) return 0;
    await limitWrite(ctx, owner);
    if (existing) {
      await ctx.db.patch("readingProgress", existing._id, { progress, title, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("readingProgress", { owner, pathname, title, progress, updatedAt: Date.now() });
    }
    return progress;
  },
});

export const saveNote = mutation({
  args: {
    ...pageWriteArgs,
    note: v.string(),
    expectedUpdatedAt: v.union(v.number(), v.null()),
  },
  returns: v.object({ note: v.string(), updatedAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const title = pageTitle(args.title);
    if (args.note.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(args.note)) {
      invalid("笔记最多 10,000 个字符，不能包含控制字符。");
    }
    const note = args.note.trim();
    const existing = await ctx.db.query("privateNotes")
      .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
    if ((existing?.updatedAt ?? null) !== args.expectedUpdatedAt) {
      throw new ConvexError({ code: "NOTE_CONFLICT", message: "笔记已在其他页面或设备更新，请先载入最新版本。" });
    }
    if ((existing?.note ?? "") === note) return { note, updatedAt: existing?.updatedAt ?? null };
    await limitWrite(ctx, owner);
    if (!note) {
      if (existing) await ctx.db.delete("privateNotes", existing._id);
      return { note: "", updatedAt: null };
    }
    const updatedAt = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
    if (existing) {
      await ctx.db.patch("privateNotes", existing._id, { note, title, updatedAt });
    } else {
      await ctx.db.insert("privateNotes", { owner, pathname, title, note, updatedAt });
    }
    return { note, updatedAt };
  },
});

export const listLibrary = query({
  args: {
    kind: v.union(v.literal("bookmarks"), v.literal("notes"), v.literal("progress")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(libraryItem),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    validatePagination(args.paginationOpts);
    const table = args.kind === "notes" ? "privateNotes" : args.kind === "progress" ? "readingProgress" : "bookmarks";
    const result = await ctx.db.query(table)
      .withIndex("by_owner_and_updatedAt", q => q.eq("owner", owner))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(row => ({
        pathname: row.pathname,
        title: row.title,
        updatedAt: row.updatedAt,
        ...("progress" in row ? { progress: row.progress } : {}),
        ...("note" in row ? { note: row.note } : {}),
      })),
    };
  },
});

export const clearPage = mutation({
  args: pageArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    await limitWrite(ctx, owner);
    for (const table of ["bookmarks", "readingProgress", "privateNotes"] as const) {
      const row = await ctx.db.query(table)
        .withIndex("by_owner_and_pathname", q => q.eq("owner", owner).eq("pathname", pathname)).unique();
      if (row) await ctx.db.delete(table, row._id);
    }
    return null;
  },
});
