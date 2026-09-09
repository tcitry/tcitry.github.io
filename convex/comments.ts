import {RateLimiter} from "@convex-dev/rate-limiter";
import {paginationOptsValidator, paginationResultValidator} from "convex/server";
import {ConvexError, v} from "convex/values";
import {components} from "./_generated/api";
import {env, mutation, query, type MutationCtx, type QueryCtx} from "./_generated/server";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  commentWrites: {kind: "token bucket", rate: 6, period: 60_000, capacity: 3},
});

function invalid(message: string): never {
  throw new ConvexError({code: "INVALID_ARGUMENT", message});
}

// Match the reader's durable URL keys, including normalized percent encodings.
function canonicalPathname(value: string) {
  if (!value || value.length > 1_024 || !value.startsWith("/") ||
    value.includes("//") || /[\\?#\u0000-\u0020\u007f]/u.test(value)) invalid("页面路径无效。");
  const segments = value.split("/").filter(Boolean).map(segment => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return invalid("页面路径编码无效。"); }
    if (decoded === "." || decoded === ".." || /[/\\?#\u0000-\u001f\u007f]/u.test(decoded)) invalid("页面路径无效。");
    return encodeURIComponent(decoded);
  });
  const pathname = `/${segments.join("/")}/`;
  if (pathname.length > 1_024 || !(pathname === "/about/" || /^\/(docs|posts|weekly|links)\/.+\/$/.test(pathname))) {
    invalid("此页面不开放评论。");
  }
  return pathname;
}

function plainText(value: string, max: number, label: string, multiline = false) {
  const text = value.trim();
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (!text || text.length > max || controls.test(text)) invalid(`${label}须为 1–${max.toLocaleString("en-US")} 个字符，不能包含控制字符。`);
  return text;
}

async function requireOwner(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({code: "UNAUTHENTICATED", message: "请先登录。"});
  return identity.tokenIdentifier;
}

function isModerator(owner: string | undefined) {
  const admin = env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER?.trim();
  return Boolean(owner && admin && owner === admin);
}

const publicComment = v.object({
  id: v.id("comments"), authorName: v.string(), body: v.string(), createdAt: v.number(),
  canDelete: v.boolean(),
  replyTo: v.optional(v.object({id: v.id("comments"), authorName: v.string()})),
});

export const list = query({
  args: {pathname: v.string(), paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(publicComment),
  handler: async (ctx, args) => {
    const viewer = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const options = args.paginationOpts;
    if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 30 ||
      (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 60)) ||
      (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) {
      invalid("每次最多加载 30 条评论。");
    }
    const result = await ctx.db.query("comments").withIndex("by_pathname_and_createdAt", q => q.eq("pathname", pathname))
      .order("desc").paginate(args.paginationOpts);
    return {...result, page: await Promise.all(result.page.map(async row => {
      const parent = row.parentId ? await ctx.db.get("comments", row.parentId) : null;
      return {
        id: row._id, authorName: row.authorName, body: row.body, createdAt: row.createdAt,
        canDelete: isModerator(viewer) || row.owner === viewer,
        ...(parent && parent.pathname === pathname ? {replyTo: {id: parent._id, authorName: parent.authorName}} : {}),
      };
    }))};
  },
});

export const add = mutation({
  args: {pathname: v.string(), authorName: v.string(), body: v.string(), parentId: v.optional(v.id("comments"))},
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const pathname = canonicalPathname(args.pathname);
    const authorName = plainText(args.authorName, 40, "公开昵称");
    const body = plainText(args.body, 4_000, "评论", true);
    if (args.parentId) {
      const parent = await ctx.db.get("comments", args.parentId);
      if (!parent || parent.pathname !== pathname) invalid("回复的评论不存在或不属于当前文章。");
    }
    await rateLimiter.limit(ctx, "commentWrites", {key: owner, throws: true});
    return await ctx.db.insert("comments", {owner, pathname, authorName, body, createdAt: Date.now(), parentId: args.parentId});
  },
});

export const remove = mutation({
  args: {id: v.id("comments")}, returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const row = await ctx.db.get("comments", args.id);
    if (!row) return null;
    if (!isModerator(owner) && row.owner !== owner) {
      throw new ConvexError({code: "FORBIDDEN", message: "只能删除自己的评论。"});
    }
    await rateLimiter.limit(ctx, "commentWrites", {key: owner, throws: true});
    await ctx.db.delete("comments", args.id);
    return null;
  },
});
