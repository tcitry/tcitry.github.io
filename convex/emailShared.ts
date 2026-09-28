import type {UserIdentity} from "convex/server";
import {env} from "./_generated/server";

export type EmailCategory = "commentReply" | "likes" | "newComment" | "newsletter";

export const EMAIL_THROTTLE_MS = 10 * 60 * 1000;
export const DEFAULT_SITE_URL = "https://yindongliang.com";
export const DEFAULT_EMAIL_FROM = "尹东亮的博客 <notify@notify.yindongliang.com>";

export function siteUrl() {
  const value = env.SITE_URL?.trim();
  if (!value) return DEFAULT_SITE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function emailFrom() {
  const value = env.EMAIL_FROM?.trim();
  return value || DEFAULT_EMAIL_FROM;
}

export function resendConfigured() {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function verifiedEmail(identity: UserIdentity) {
  const email = identity.email;
  if (typeof email !== "string" || !email.trim()) return null;
  const verified = identity.emailVerified ?? identity.email_verified;
  if (verified !== true) return null;
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) return null;
  return normalized;
}

export function defaultEmailFlags() {
  return {
    enabled: false,
    commentReply: false,
    likes: false,
    newComment: false,
    newsletter: false,
  };
}

export function newUnsubscribeToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function markdownExcerpt(body: string, maxLen = 200) {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "（无文字内容）";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function articleTitleFromPath(pathname: string) {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  if (!segment) return "文章";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function commentThreadKey(pathname: string, parentId: string, rootId: string) {
  return `${pathname}#${rootId || parentId}`;
}
