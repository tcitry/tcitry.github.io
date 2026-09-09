import { createClerkClient } from "@clerk/backend";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { UserIdentity } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, env, internalMutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";

const billingLimiter = new RateLimiter(components.rateLimiter, {
  billingChecks: { kind: "token bucket", rate: 30, period: 60_000, capacity: 10 },
});

export async function requireMemberIdentity(ctx: Pick<ActionCtx | QueryCtx | MutationCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "请先登录。" });
  return identity;
}

export function isConsultationAuthor(identity: UserIdentity) {
  const author = env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER?.trim();
  return Boolean(author && author === identity.tokenIdentifier);
}

export function consultationConfigured() {
  return Boolean(env.CONSULTATION_ADMIN_TOKEN_IDENTIFIER?.trim());
}

// These are Clerk Backend API fields, whose timestamps are milliseconds.
// A free trial is an active item with isFreeTrial, not a "trialing" status.
type Subscription = {
  subscriptionItems: {
    plan: { slug: string } | null;
    status: string;
    periodStart: number;
    periodEnd: number | null;
    endedAt: number | null;
  }[];
};

export function proEntitlement(subscription: Subscription, slug: string, now: number) {
  let validUntil: number | null = null;
  if (!slug.trim()) return { isPro: false, validUntil };
  for (const item of subscription.subscriptionItems) {
    if (item.plan?.slug !== slug || !["active", "canceled"].includes(item.status)) continue;
    if (!Number.isFinite(item.periodStart) || item.periodStart > now) continue;
    if (item.endedAt !== null && item.endedAt <= now) continue;
    // Paid access needs a current, bounded period. Canceled subscriptions keep
    // access until that period ends; ended/past-due/upcoming items never grant it.
    if (item.periodEnd === null || !Number.isFinite(item.periodEnd) || item.periodEnd <= now) continue;
    validUntil = Math.max(validUntil ?? 0, item.periodEnd);
  }
  return { isPro: validUntil !== null, validUntil };
}

export const limitLookup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await requireMemberIdentity(ctx);
    await billingLimiter.limit(ctx, "billingChecks", { key: identity.tokenIdentifier, throws: true });
    return null;
  },
});

export async function verifiedMembership(ctx: ActionCtx) {
  const identity = await requireMemberIdentity(ctx);
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  const slug = env.CLERK_PRO_PLAN_SLUG?.trim();
  const base = {
    isAdmin: isConsultationAuthor(identity),
    consultationsReady: consultationConfigured(),
  };
  if (!secretKey || !slug) return { ...base, configured: false, isPro: false, validUntil: null };
  await ctx.runMutation(internal.membership.limitLookup, {});
  try {
    // Never take userId or entitlement assertions from the browser. Convex has
    // verified the JWT issuer before exposing this subject.
    const clerk = createClerkClient({ secretKey });
    const subscription = await clerk.billing.getUserBillingSubscription(identity.subject);
    return { ...base, configured: true, ...proEntitlement(subscription, slug, Date.now()) };
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
      return { ...base, configured: true, isPro: false, validUntil: null };
    }
    // The upstream error can contain request details; return only a safe error.
    throw new ConvexError({ code: "BILLING_UNAVAILABLE", message: "暂时无法核验会员状态，请稍后重试。" });
  }
}

export async function requireProMembership(ctx: ActionCtx) {
  const membership = await verifiedMembership(ctx);
  if (!membership.configured || !membership.consultationsReady) {
    throw new ConvexError({ code: "CONSULTATION_UNAVAILABLE", message: "私人咨询尚未开放，请稍后再来。" });
  }
  if (!membership.isPro || membership.validUntil === null) {
    throw new ConvexError({ code: "PRO_REQUIRED", message: "发送私人咨询需要有效的 Pro 会员。已有对话仍可查看。" });
  }
  return membership.validUntil;
}

export const getMyMembership = action({
  args: {},
  returns: v.object({
    configured: v.boolean(), isPro: v.boolean(), isAdmin: v.boolean(),
    consultationsReady: v.boolean(), validUntil: v.union(v.number(), v.null()),
  }),
  handler: verifiedMembership,
});

export const getConsultationRole = query({
  args: {},
  returns: v.object({ isAdmin: v.boolean(), ready: v.boolean() }),
  handler: async (ctx) => ({
    isAdmin: isConsultationAuthor(await requireMemberIdentity(ctx)), ready: consultationConfigured(),
  }),
});
