import {ConvexError, v} from "convex/values";
import type {UserIdentity} from "convex/server";
import type {Doc} from "./_generated/dataModel";
import {internalMutation, mutation, query, type MutationCtx, type QueryCtx} from "./_generated/server";
import {invalid, requireCommentIdentity} from "./commentShared";
import {
  defaultEmailFlags, newUnsubscribeToken, type EmailCategory, verifiedEmail,
} from "./emailShared";

const categoryValidator = v.union(
  v.literal("commentReply"),
  v.literal("likes"),
  v.literal("newComment"),
  v.literal("newsletter"),
);

const preferencesView = v.object({
  enabled: v.boolean(),
  commentReply: v.boolean(),
  likes: v.boolean(),
  newComment: v.boolean(),
  newsletter: v.boolean(),
  cachedEmail: v.union(v.string(), v.null()),
  emailDisabled: v.boolean(),
});

function viewFromDoc(doc: Doc<"emailPreferences">) {
  return {
    enabled: doc.enabled,
    commentReply: doc.commentReply,
    likes: doc.likes,
    newComment: doc.newComment,
    newsletter: doc.newsletter,
    cachedEmail: doc.cachedEmail ?? null,
    emailDisabled: doc.emailDisabledAt !== undefined,
  };
}

async function findByOwner(ctx: Pick<QueryCtx | MutationCtx, "db">, owner: string) {
  return await ctx.db.query("emailPreferences").withIndex("by_owner", q => q.eq("owner", owner)).unique();
}

async function findByToken(ctx: Pick<QueryCtx | MutationCtx, "db">, token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return await ctx.db.query("emailPreferences").withIndex("by_unsubscribeToken", q => q.eq("unsubscribeToken", trimmed)).unique();
}

export async function ensureEmailPreferences(ctx: MutationCtx, identity: UserIdentity) {
  const owner = identity.tokenIdentifier;
  const existing = await findByOwner(ctx, owner);
  const email = verifiedEmail(identity);
  const now = Date.now();
  if (existing) {
    if (email && existing.cachedEmail !== email) {
      await ctx.db.patch("emailPreferences", existing._id, {cachedEmail: email, updatedAt: now});
    }
    return existing._id;
  }
  const defaults = defaultEmailFlags(owner);
  return await ctx.db.insert("emailPreferences", {
    owner,
    ...defaults,
    unsubscribeToken: newUnsubscribeToken(),
    ...(email ? {cachedEmail: email} : {}),
    updatedAt: now,
  });
}

export const getMine = query({
  args: {},
  returns: preferencesView,
  handler: async ctx => {
    const identity = await requireCommentIdentity(ctx);
    const existing = await findByOwner(ctx, identity.tokenIdentifier);
    if (!existing) {
      const defaults = defaultEmailFlags(identity.tokenIdentifier);
      const email = verifiedEmail(identity);
      return {...defaults, cachedEmail: email, emailDisabled: false};
    }
    return viewFromDoc(existing);
  },
});

export const updateMine = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    commentReply: v.optional(v.boolean()),
    likes: v.optional(v.boolean()),
    newComment: v.optional(v.boolean()),
    newsletter: v.optional(v.boolean()),
  },
  returns: preferencesView,
  handler: async (ctx, args) => {
    const identity = await requireCommentIdentity(ctx);
    await ensureEmailPreferences(ctx, identity);
    const existing = await findByOwner(ctx, identity.tokenIdentifier);
    if (!existing) throw new ConvexError({code: "NOT_FOUND", message: "邮件偏好暂时不可用。"});
    const patch: Partial<Doc<"emailPreferences">> = {updatedAt: Date.now()};
    for (const key of ["enabled", "commentReply", "likes", "newComment", "newsletter"] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    const email = verifiedEmail(identity);
    if (email) patch.cachedEmail = email;
    if (patch.enabled === true && existing.emailDisabledAt !== undefined) patch.emailDisabledAt = undefined;
    await ctx.db.patch("emailPreferences", existing._id, patch);
    const updated = await ctx.db.get("emailPreferences", existing._id);
    if (!updated) throw new ConvexError({code: "NOT_FOUND", message: "邮件偏好暂时不可用。"});
    return viewFromDoc(updated);
  },
});

export const getByToken = query({
  args: {token: v.string()},
  returns: v.union(preferencesView, v.null()),
  handler: async (ctx, {token}) => {
    const doc = await findByToken(ctx, token);
    return doc ? viewFromDoc(doc) : null;
  },
});

async function applyUnsubscribe(ctx: MutationCtx, args: {token: string; category?: EmailCategory; all?: boolean}) {
  const doc = await findByToken(ctx, args.token);
  if (!doc) invalid("退订链接无效或已过期。");
  const patch: Partial<Doc<"emailPreferences">> = {updatedAt: Date.now()};
  if (args.all) {
    patch.enabled = false;
    patch.commentReply = false;
    patch.likes = false;
    patch.newComment = false;
    patch.newsletter = false;
  } else if (args.category) {
    patch[args.category] = false;
  } else {
    patch.commentReply = false;
  }
  await ctx.db.patch("emailPreferences", doc._id, patch);
  const updated = await ctx.db.get("emailPreferences", doc._id);
  if (!updated) invalid("退订链接无效或已过期。");
  return viewFromDoc(updated);
}

export const unsubscribeByToken = mutation({
  args: {
    token: v.string(),
    category: v.optional(categoryValidator),
    all: v.optional(v.boolean()),
  },
  returns: preferencesView,
  handler: async (ctx, args) => applyUnsubscribe(ctx, args),
});

export const unsubscribeByTokenInternal = internalMutation({
  args: {
    token: v.string(),
    category: v.optional(categoryValidator),
    all: v.optional(v.boolean()),
  },
  returns: preferencesView,
  handler: async (ctx, args) => applyUnsubscribe(ctx, args),
});

export const updateByToken = mutation({
  args: {
    token: v.string(),
    enabled: v.optional(v.boolean()),
    commentReply: v.optional(v.boolean()),
    likes: v.optional(v.boolean()),
    newComment: v.optional(v.boolean()),
    newsletter: v.optional(v.boolean()),
  },
  returns: preferencesView,
  handler: async (ctx, args) => {
    const doc = await findByToken(ctx, args.token);
    if (!doc) invalid("退订链接无效或已过期。");
    const patch: Partial<Doc<"emailPreferences">> = {updatedAt: Date.now()};
    for (const key of ["enabled", "commentReply", "likes", "newComment", "newsletter"] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    if (patch.enabled === true && doc.emailDisabledAt !== undefined) patch.emailDisabledAt = undefined;
    await ctx.db.patch("emailPreferences", doc._id, patch);
    const updated = await ctx.db.get("emailPreferences", doc._id);
    if (!updated) invalid("退订链接无效或已过期。");
    return viewFromDoc(updated);
  },
});

export async function disableEmailForAddress(ctx: MutationCtx, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  const row = await ctx.db.query("emailPreferences").withIndex("by_cachedEmail", q => q.eq("cachedEmail", normalized)).unique();
  if (!row || row.emailDisabledAt !== undefined) return 0;
  await ctx.db.patch("emailPreferences", row._id, {
    enabled: false,
    emailDisabledAt: Date.now(),
    updatedAt: Date.now(),
  });
  return 1;
}

export function categoryEnabled(doc: Doc<"emailPreferences">, category: EmailCategory) {
  if (!doc.enabled || doc.emailDisabledAt !== undefined) return false;
  return doc[category];
}
