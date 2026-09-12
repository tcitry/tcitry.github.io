import type { UserIdentity } from "convex/server";
import { ConvexError, v } from "convex/values";
import { action, env, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";

type IdentityContext = Pick<ActionCtx | QueryCtx | MutationCtx, "auth">;

export async function requireMemberIdentity(ctx: IdentityContext) {
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

function claimsUnavailable(): never {
  throw new ConvexError({ code: "CLAIMS_UNAVAILABLE", message: "暂时无法核验会员状态，请刷新登录状态后重试。" });
}

// Convex has verified the Clerk JWT before exposing this identity. Only the
// default v2 session's active-plan claim grants membership; client flags and
// custom publicMetadata are never authorization inputs. Clerk's scope encoding
// uses u for users, o for organizations, and ou/uo for both.
export function hasPersonalProPlan(identity: UserIdentity, slug: string) {
  if (identity.v !== 2 || typeof identity.sid !== "string" || !identity.sid.trim()
    || (identity.sts !== undefined && identity.sts !== "active")
    || typeof identity.pla !== "string" || !identity.pla.trim()) claimsUnavailable();
  const plans = identity.pla.split(",").map(plan => plan.trim());
  if (plans.some(plan => !/^(u|o|ou|uo):[a-zA-Z0-9_-]+$/.test(plan))) claimsUnavailable();
  return plans.some(plan => ["u", "ou", "uo"].some(scope => plan === `${scope}:${slug}`));
}

export async function verifiedMembership(ctx: IdentityContext) {
  const identity = await requireMemberIdentity(ctx);
  const slug = env.CLERK_PRO_PLAN_SLUG?.trim();
  const base = {
    isAdmin: isConsultationAuthor(identity),
    consultationsReady: consultationConfigured(),
  };
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return { ...base, configured: false, isPro: false, validUntil: null };
  // Session claims express current access, not the subscription's period end.
  // In particular, JWT expiry must never be displayed as membership expiry.
  return { ...base, configured: true, isPro: hasPersonalProPlan(identity, slug), validUntil: null };
}

export async function requireProMembership(ctx: IdentityContext) {
  const membership = await verifiedMembership(ctx);
  if (!membership.consultationsReady) {
    throw new ConvexError({ code: "CONSULTATION_UNAVAILABLE", message: "私人咨询尚未开放，请稍后再来。" });
  }
  if (!membership.configured || !membership.isPro) {
    throw new ConvexError({ code: "PRO_REQUIRED", message: "发送私人咨询需要有效的 Pro 会员。已有对话仍可查看。" });
  }
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
