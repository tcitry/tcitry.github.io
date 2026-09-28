import {v} from "convex/values";
import type {Doc, Id} from "./_generated/dataModel";
import {internal} from "./_generated/api";
import {env, internalAction, internalMutation, type MutationCtx} from "./_generated/server";
import {
  EMAIL_THROTTLE_MS, articleTitleFromPath, commentThreadKey, emailFrom, markdownExcerpt,
  resendConfigured, siteUrl,
} from "./emailShared";
import {categoryEnabled} from "./emailPreferences";

const sendPayload = v.union(
  v.object({
    kind: v.literal("send"),
    notificationId: v.id("notifications"),
    recipient: v.string(),
    email: v.string(),
    unsubscribeToken: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.string(),
    listUnsubscribe: v.string(),
    idempotencyKey: v.string(),
    threadKey: v.string(),
  }),
  v.object({kind: v.literal("skip"), notificationId: v.id("notifications"), recipient: v.string(), reason: v.string()}),
);

async function commentRootId(ctx: Pick<MutationCtx, "db">, comment: Doc<"comments">) {
  let current = comment;
  while (current.parentId) {
    const parent = await ctx.db.get("comments", current.parentId);
    if (!parent || parent.pathname !== comment.pathname) break;
    current = parent;
  }
  return current._id;
}

export const prepareCommentReplyEmail = internalMutation({
  args: {notificationId: v.id("notifications"), now: v.number()},
  returns: sendPayload,
  handler: async (ctx, {notificationId, now}) => {
    const notification = await ctx.db.get("notifications", notificationId);
    const existingLog = await ctx.db.query("emailSendLog").withIndex("by_notificationId", q => q.eq("notificationId", notificationId)).unique();
    if (existingLog?.status === "sent") {
      return {kind: "skip" as const, notificationId, recipient: notification?.recipient ?? "", reason: "already_logged"};
    }
    if (!notification || notification.kind !== "comment_reply" || !notification.commentId) {
      return {kind: "skip" as const, notificationId, recipient: notification?.recipient ?? "", reason: "invalid_notification"};
    }
    const reply = await ctx.db.get("comments", notification.commentId);
    if (!reply || reply.deletedAt !== undefined || !reply.parentId) {
      return {kind: "skip" as const, notificationId, recipient: notification.recipient, reason: "comment_unavailable"};
    }
    const parent = await ctx.db.get("comments", reply.parentId);
    if (!parent || parent.deletedAt !== undefined || parent.owner !== notification.recipient || parent.owner === reply.owner) {
      return {kind: "skip" as const, notificationId, recipient: notification.recipient, reason: "self_or_invalid_reply"};
    }
    const prefs = await ctx.db.query("emailPreferences").withIndex("by_owner", q => q.eq("owner", notification.recipient)).unique();
    if (!prefs || !categoryEnabled(prefs, "commentReply")) {
      return {kind: "skip" as const, notificationId, recipient: notification.recipient, reason: "preferences_disabled"};
    }
    const email = prefs.cachedEmail;
    if (!email) {
      return {kind: "skip" as const, notificationId, recipient: notification.recipient, reason: "no_verified_email"};
    }
    const rootId = await commentRootId(ctx, reply);
    const threadKey = commentThreadKey(reply.pathname, reply.parentId, rootId);
    const throttle = await ctx.db.query("emailThreadThrottle").withIndex("by_recipient_and_threadKey", q => q.eq("recipient", notification.recipient).eq("threadKey", threadKey)).unique();
    if (throttle && now - throttle.lastSentAt < EMAIL_THROTTLE_MS) {
      return {kind: "skip" as const, notificationId, recipient: notification.recipient, reason: "throttled"};
    }
    const title = reply.articleTitle?.trim() || articleTitleFromPath(reply.pathname);
    const excerpt = markdownExcerpt(reply.body);
    const origin = siteUrl();
    const commentUrl = `${origin}${reply.pathname}#comment-${reply._id}`;
    const unsubscribeUrl = `${origin}/email/unsubscribe/?token=${encodeURIComponent(prefs.unsubscribeToken)}`;
    const settingsUrl = `${origin}/email/unsubscribe/?token=${encodeURIComponent(prefs.unsubscribeToken)}`;
    const subject = `「${title}」收到新回复`;
    const text = [
      `${reply.authorName} 回复了你的评论：`,
      "",
      excerpt,
      "",
      `查看回复：${commentUrl}`,
      "",
      `管理邮件通知：${settingsUrl}`,
      `退订评论回复邮件：${unsubscribeUrl}&category=commentReply`,
    ].join("\n");
    const html = `<!DOCTYPE html><html lang="zh-CN"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111;">
<p><strong>${escapeHtml(reply.authorName)}</strong> 在「${escapeHtml(title)}」回复了你的评论：</p>
<blockquote style="margin:1em 0;padding:.75em 1em;border-left:3px solid #ddd;color:#333;">${escapeHtml(excerpt)}</blockquote>
<p><a href="${escapeHtml(commentUrl)}">查看回复</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:1.5em 0;">
<p style="font-size:12px;color:#666;">
<a href="${escapeHtml(settingsUrl)}">管理邮件通知</a> ·
<a href="${escapeHtml(`${unsubscribeUrl}&category=commentReply`)}">退订评论回复</a>
</p>
</body></html>`;
    return {
      kind: "send" as const,
      notificationId,
      recipient: notification.recipient,
      email,
      unsubscribeToken: prefs.unsubscribeToken,
      subject,
      text,
      html,
      listUnsubscribe: `<${unsubscribeUrl}>`,
      idempotencyKey: `comment-reply:${notificationId}`,
      threadKey,
    };
  },
});

export const markThreadThrottle = internalMutation({
  args: {recipient: v.string(), threadKey: v.string(), sentAt: v.number()},
  returns: v.null(),
  handler: async (ctx, {recipient, threadKey, sentAt}) => {
    const throttle = await ctx.db.query("emailThreadThrottle").withIndex("by_recipient_and_threadKey", q => q.eq("recipient", recipient).eq("threadKey", threadKey)).unique();
    if (throttle) await ctx.db.patch("emailThreadThrottle", throttle._id, {lastSentAt: sentAt});
    else await ctx.db.insert("emailThreadThrottle", {recipient, threadKey, lastSentAt: sentAt});
    return null;
  },
});

export const recordEmailSend = internalMutation({
  args: {
    notificationId: v.optional(v.id("notifications")),
    recipient: v.string(),
    email: v.string(),
    status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")),
    resendId: v.optional(v.string()),
    reason: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.notificationId) {
      const existing = await ctx.db.query("emailSendLog").withIndex("by_notificationId", q => q.eq("notificationId", args.notificationId)).unique();
      if (existing) return null;
    }
    await ctx.db.insert("emailSendLog", args);
    return null;
  },
});

export const sendCommentReplyEmail = internalAction({
  args: {notificationId: v.id("notifications")},
  returns: v.null(),
  handler: async (ctx, {notificationId}) => {
    const now = Date.now();
    const prepared: {
      kind: "send" | "skip";
      notificationId: Id<"notifications">;
      recipient: string;
      email?: string;
      reason?: string;
      subject?: string;
      text?: string;
      html?: string;
      listUnsubscribe?: string;
      idempotencyKey?: string;
      threadKey?: string;
    } = await ctx.runMutation(internal.emailNotifications.prepareCommentReplyEmail, {notificationId, now});
    if (prepared.kind === "skip") {
      if (prepared.reason !== "already_logged") {
        await ctx.runMutation(internal.emailNotifications.recordEmailSend, {
          notificationId,
          recipient: prepared.recipient,
          email: "",
          status: "skipped",
          reason: prepared.reason,
          createdAt: now,
        });
      }
      return null;
    }
    if (!resendConfigured()) {
      console.info("email_send_skipped", {notificationId, reason: "resend_not_configured"});
      await ctx.runMutation(internal.emailNotifications.recordEmailSend, {
        notificationId,
        recipient: prepared.recipient,
        email: prepared.email!,
        status: "skipped",
        reason: "resend_not_configured",
        idempotencyKey: prepared.idempotencyKey,
        createdAt: now,
      });
      return null;
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
          "Content-Type": "application/json",
          "Idempotency-Key": prepared.idempotencyKey!,
        },
        body: JSON.stringify({
          from: emailFrom(),
          to: [prepared.email],
          subject: prepared.subject,
          text: prepared.text,
          html: prepared.html,
          headers: {
            "List-Unsubscribe": prepared.listUnsubscribe,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      const body = await response.json().catch(() => ({})) as {id?: string; message?: string};
      if (!response.ok) {
        console.info("email_send_failed", {notificationId, status: response.status});
        await ctx.runMutation(internal.emailNotifications.recordEmailSend, {
          notificationId,
          recipient: prepared.recipient,
          email: prepared.email!,
          status: "failed",
          reason: typeof body.message === "string" ? body.message.slice(0, 200) : `http_${response.status}`,
          idempotencyKey: prepared.idempotencyKey,
          createdAt: now,
        });
        return null;
      }
      await ctx.runMutation(internal.emailNotifications.recordEmailSend, {
        notificationId,
        recipient: prepared.recipient,
        email: prepared.email!,
        status: "sent",
        resendId: typeof body.id === "string" ? body.id : undefined,
        idempotencyKey: prepared.idempotencyKey,
        createdAt: now,
      });
      await ctx.runMutation(internal.emailNotifications.markThreadThrottle, {
        recipient: prepared.recipient,
        threadKey: prepared.threadKey!,
        sentAt: now,
      });
    } catch {
      console.info("email_send_failed", {notificationId, reason: "network_error"});
      await ctx.runMutation(internal.emailNotifications.recordEmailSend, {
        notificationId,
        recipient: prepared.recipient,
        email: prepared.email!,
        status: "failed",
        reason: "network_error",
        idempotencyKey: prepared.idempotencyKey,
        createdAt: now,
      });
    }
    return null;
  },
});

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
