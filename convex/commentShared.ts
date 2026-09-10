import {ConvexError} from "convex/values";
import type {UserIdentity} from "convex/server";
import type {ActionCtx, MutationCtx, QueryCtx} from "./_generated/server";

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

// These are signed OIDC claims from the Clerk session, never form fields. The
// instance must map preferred_username to user.username in its session claims.
export function commentAuthorName(identity: UserIdentity) {
  for (const value of [identity.preferredUsername, identity.nickname]) {
    if (typeof value === "string" && value.trim() && value.trim().length <= 80 && !/[\u0000-\u001f\u007f]/u.test(value)) return value.trim();
  }
  throw new ConvexError({code: "USERNAME_UNAVAILABLE", message: "当前登录信息缺少用户名，暂时无法发布评论。"});
}
