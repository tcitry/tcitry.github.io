import {ConvexError} from "convex/values";
import type {PaginationOptions, UserIdentity} from "convex/server";
import type {ActionCtx, MutationCtx, QueryCtx} from "./_generated/server";
import {isConsultationAuthor} from "./membership";

export function invalid(message: string): never {
  throw new ConvexError({code: "INVALID_ARGUMENT", message});
}

export function canonicalPathname(value: string) {
  if (!value || value.length > 1_024 || !value.startsWith("/") || value.includes("//") || /[\\?#\u0000-\u0020\u007f]/u.test(value)) invalid("页面路径无效。");
  const segments = value.split("/").filter(Boolean).map(segment => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return invalid("页面路径编码无效。"); }
    if (decoded === "." || decoded === ".." || /[/\\?#\u0000-\u001f\u007f]/u.test(decoded)) invalid("页面路径无效。");
    return encodeURIComponent(decoded);
  });
  const pathname = `/${segments.join("/")}/`;
  if (pathname.length > 1_024 || !(pathname === "/about/" || /^\/(docs|posts|weekly|links)\/.+\/$/.test(pathname))) invalid("此页面不开放评论。");
  return pathname;
}

export async function requireCommentIdentity(ctx: Pick<QueryCtx | MutationCtx | ActionCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({code: "UNAUTHENTICATED", message: "请先登录。"});
  return identity;
}

export function isCommentModerator(identity: UserIdentity) {
  return isConsultationAuthor(identity);
}

export async function requireCommentModerator(ctx: Pick<QueryCtx | MutationCtx, "auth">) {
  const identity = await requireCommentIdentity(ctx);
  if (!isCommentModerator(identity)) throw new ConvexError({code: "FORBIDDEN", message: "此操作仅供博主使用。"});
  return identity;
}

export function accountPagination(options: PaginationOptions) {
  if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50 ||
    (options.maximumRowsRead !== undefined && (!Number.isInteger(options.maximumRowsRead) || options.maximumRowsRead < 1 || options.maximumRowsRead > 100)) ||
    (options.maximumBytesRead !== undefined && (!Number.isInteger(options.maximumBytesRead) || options.maximumBytesRead < 1 || options.maximumBytesRead > 1_000_000))) invalid("每次最多加载 50 条记录。");
}

// These are signed OIDC claims from the Clerk Convex session token, never form
// fields. Map preferred_username and/or nickname to user.username in Clerk
// Dashboard session claims; this repo has no JWT template of its own.
export function commentAuthorName(identity: UserIdentity) {
  for (const value of [identity.preferredUsername, identity.nickname]) {
    if (typeof value === "string" && value.trim() && value.trim().length <= 80 && !/[\u0000-\u001f\u007f]/u.test(value)) return value.trim();
  }
  throw new ConvexError({code: "USERNAME_UNAVAILABLE", message: "当前登录信息缺少用户名，暂时无法发布评论。"});
}

// OIDC `picture` is exposed on Convex UserIdentity as `pictureUrl`. Never accept
// a client-supplied avatar URL; missing or unsafe values just omit the avatar.
const MAX_AUTHOR_IMAGE_URL_LENGTH = 2_048;

export function commentAuthorImageUrl(identity: UserIdentity) {
  const value = identity.pictureUrl;
  if (typeof value !== "string") return;
  const url = value.trim();
  if (!url || url.length > MAX_AUTHOR_IMAGE_URL_LENGTH || /[\u0000-\u001f\u007f]/u.test(url)) return;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== "https:" || !parsed.hostname) return;
  return url;
}
