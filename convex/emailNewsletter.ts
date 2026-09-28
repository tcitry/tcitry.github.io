import {v} from "convex/values";
import type {Doc} from "./_generated/dataModel";
import {internal} from "./_generated/api";
import {env, internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx} from "./_generated/server";
import {
  NEWSLETTER_SYNC_MAX_ATTEMPTS,
  RESEND_OUTBOUND_SYNC_GRACE_MS,
  effectiveNewsletterSubscribed,
  newsletterAudienceConfigured,
  resendAudienceId,
} from "./emailShared";

const syncPayload = v.union(
  v.object({
    kind: v.literal("subscribe"),
    preferencesId: v.id("emailPreferences"),
    owner: v.string(),
    email: v.string(),
    resendContactId: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal("unsubscribe"),
    preferencesId: v.id("emailPreferences"),
    owner: v.string(),
    email: v.union(v.string(), v.null()),
    resendContactId: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal("skip"),
    owner: v.string(),
    reason: v.string(),
  }),
);

const reconcilePage = v.object({
  done: v.boolean(),
  processed: v.number(),
  cursor: v.union(v.string(), v.null()),
});

function resendHeaders() {
  return {
    Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
    "Content-Type": "application/json",
  };
}

export async function scheduleNewsletterSync(ctx: Pick<MutationCtx, "scheduler">, owner: string) {
  await ctx.scheduler.runAfter(0, internal.emailNewsletter.syncContact, {owner, attempt: 0});
}

export const prepareNewsletterSync = internalQuery({
  args: {owner: v.string()},
  returns: syncPayload,
  handler: async (ctx, {owner}) => {
    if (!newsletterAudienceConfigured()) {
      return {kind: "skip" as const, owner, reason: "audience_not_configured"};
    }
    const doc = await ctx.db.query("emailPreferences").withIndex("by_owner", q => q.eq("owner", owner)).unique();
    if (!doc) return {kind: "skip" as const, owner, reason: "preferences_missing"};
    const subscribed = effectiveNewsletterSubscribed(doc);
    const email = doc.cachedEmail?.trim().toLowerCase() ?? null;
    if (subscribed && email) {
      return {
        kind: "subscribe" as const,
        preferencesId: doc._id,
        owner,
        email,
        resendContactId: doc.resendContactId ?? null,
      };
    }
    return {
      kind: "unsubscribe" as const,
      preferencesId: doc._id,
      owner,
      email,
      resendContactId: doc.resendContactId ?? null,
    };
  },
});

export const markNewsletterSync = internalMutation({
  args: {
    preferencesId: v.id("emailPreferences"),
    resendContactId: v.optional(v.string()),
    syncedAt: v.number(),
    outbound: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, {preferencesId, resendContactId, syncedAt, outbound}) => {
    const patch: Partial<Doc<"emailPreferences">> = {
      resendLastSyncedAt: syncedAt,
      updatedAt: syncedAt,
    };
    if (resendContactId) patch.resendContactId = resendContactId;
    if (outbound) patch.resendOutboundSyncAt = syncedAt;
    await ctx.db.patch("emailPreferences", preferencesId, patch);
    return null;
  },
});

async function parseResendJson(response: Response) {
  return await response.json().catch(() => ({})) as {id?: string; message?: string; name?: string};
}

async function createOrSubscribeContact(email: string, audienceId: string) {
  const response = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: resendHeaders(),
    body: JSON.stringify({
      email,
      unsubscribed: false,
      segments: [{id: audienceId}],
    }),
  });
  const body = await parseResendJson(response);
  if (response.ok) {
    return {ok: true as const, contactId: typeof body.id === "string" ? body.id : undefined};
  }
  if (response.status === 409 || response.status === 422) {
    const identifier = encodeURIComponent(email);
    const update = await fetch(`https://api.resend.com/contacts/${identifier}`, {
      method: "PATCH",
      headers: resendHeaders(),
      body: JSON.stringify({unsubscribed: false}),
    });
    const updateBody = await parseResendJson(update);
    if (!update.ok) {
      return {ok: false as const, reason: typeof updateBody.message === "string" ? updateBody.message : `http_${update.status}`};
    }
    const segment = await fetch(`https://api.resend.com/contacts/${identifier}/segments/${encodeURIComponent(audienceId)}`, {
      method: "POST",
      headers: resendHeaders(),
    });
    if (!segment.ok && segment.status !== 409) {
      const segmentBody = await parseResendJson(segment);
      return {ok: false as const, reason: typeof segmentBody.message === "string" ? segmentBody.message : `segment_http_${segment.status}`};
    }
    return {ok: true as const, contactId: typeof updateBody.id === "string" ? updateBody.id : undefined};
  }
  return {ok: false as const, reason: typeof body.message === "string" ? body.message : `http_${response.status}`};
}

async function unsubscribeContact(email: string | null, contactId: string | null) {
  const identifier = contactId?.trim() || (email ? encodeURIComponent(email) : "");
  if (!identifier) return {ok: true as const};
  const response = await fetch(`https://api.resend.com/contacts/${identifier}`, {
    method: "PATCH",
    headers: resendHeaders(),
    body: JSON.stringify({unsubscribed: true}),
  });
  const body = await parseResendJson(response);
  if (response.ok || response.status === 404) return {ok: true as const};
  return {ok: false as const, reason: typeof body.message === "string" ? body.message : `http_${response.status}`};
}

function scheduleRetry(ctx: Pick<ActionCtx, "scheduler">, owner: string, attempt: number) {
  const delayMs = Math.min(60_000 * 2 ** attempt, 300_000);
  return ctx.scheduler.runAfter(delayMs, internal.emailNewsletter.syncContact, {owner, attempt: attempt + 1});
}

export const syncContact = internalAction({
  args: {
    owner: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, {owner, attempt = 0}) => {
    const prepared = await ctx.runQuery(internal.emailNewsletter.prepareNewsletterSync, {owner});
    if (prepared.kind === "skip") {
      console.info("newsletter_sync_skipped", {owner, reason: prepared.reason});
      return null;
    }
    const now = Date.now();
    const audienceId = resendAudienceId();
    let result: {ok: boolean; contactId?: string; reason?: string};
    if (prepared.kind === "subscribe") {
      result = await createOrSubscribeContact(prepared.email, audienceId);
    } else {
      result = await unsubscribeContact(prepared.email, prepared.resendContactId);
    }
    if (!result.ok) {
      console.info("newsletter_sync_failed", {owner, reason: result.reason, attempt});
      if (attempt + 1 < NEWSLETTER_SYNC_MAX_ATTEMPTS) {
        await scheduleRetry(ctx, owner, attempt);
      }
      return null;
    }
    await ctx.runMutation(internal.emailNewsletter.markNewsletterSync, {
      preferencesId: prepared.preferencesId,
      resendContactId: result.contactId ?? prepared.resendContactId ?? undefined,
      syncedAt: now,
      outbound: true,
    });
    return null;
  },
});

export const listReconcileOwners = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    owners: v.array(v.string()),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, {cursor, limit}) => {
    const page = await ctx.db
      .query("emailPreferences")
      .paginate({numItems: limit, cursor});
    const owners = page.page
      .filter(doc => effectiveNewsletterSubscribed(doc))
      .map(doc => doc.owner);
    return {owners, nextCursor: page.isDone ? null : page.continueCursor};
  },
});

type ReconcilePage = {done: boolean; processed: number; cursor: string | null};

export const reconcileNewsletterAudience = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    audienceCursor: v.optional(v.union(v.string(), v.null())),
    phase: v.optional(v.union(v.literal("convex"), v.literal("resend"))),
  },
  returns: reconcilePage,
  handler: async (ctx, args): Promise<ReconcilePage> => {
    if (!newsletterAudienceConfigured()) {
      console.info("newsletter_reconcile_skipped", {reason: "audience_not_configured"});
      return {done: true, processed: 0, cursor: null};
    }
    const phase = args.phase ?? "convex";
    if (phase === "convex") {
      const page = await ctx.runQuery(internal.emailNewsletter.listReconcileOwners, {
        cursor: args.cursor ?? null,
        limit: 50,
      });
      const {owners, nextCursor} = page;
      for (const owner of owners) {
        await ctx.runAction(internal.emailNewsletter.syncContact, {owner, attempt: 0});
      }
      if (nextCursor) {
        await ctx.scheduler.runAfter(0, internal.emailNewsletter.reconcileNewsletterAudience, {
          cursor: nextCursor,
          audienceCursor: args.audienceCursor ?? null,
          phase: "convex",
        });
        return {done: false, processed: owners.length, cursor: nextCursor};
      }
      await ctx.scheduler.runAfter(0, internal.emailNewsletter.reconcileNewsletterAudience, {
        cursor: null,
        audienceCursor: null,
        phase: "resend",
      });
      return {done: false, processed: owners.length, cursor: null};
    }
    const audienceId = resendAudienceId();
    const url = new URL("https://api.resend.com/contacts");
    url.searchParams.set("segment_id", audienceId);
    if (args.audienceCursor) url.searchParams.set("after", args.audienceCursor);
    const response = await fetch(url, {headers: resendHeaders()});
    const body = await parseResendJson(response) as {
      data?: Array<{id?: string; email?: string; unsubscribed?: boolean}>;
      has_more?: boolean;
    };
    if (!response.ok) {
      console.info("newsletter_reconcile_failed", {reason: "list_contacts_failed", status: response.status});
      return {done: true, processed: 0, cursor: null};
    }
    let processed = 0;
    for (const contact of body.data ?? []) {
      const email = typeof contact.email === "string" ? contact.email.trim().toLowerCase() : "";
      if (!email) continue;
      const doc = await ctx.runQuery(internal.emailNewsletter.findPreferencesByEmail, {email});
      const shouldSubscribe = doc ? effectiveNewsletterSubscribed(doc) : false;
      if (!shouldSubscribe && contact.unsubscribed !== true) {
        await unsubscribeContact(email, typeof contact.id === "string" ? contact.id : null);
        processed += 1;
      }
    }
    const last = body.data?.at(-1);
    const nextAudienceCursor = body.has_more && typeof last?.id === "string" ? last.id : null;
    if (nextAudienceCursor) {
      await ctx.scheduler.runAfter(0, internal.emailNewsletter.reconcileNewsletterAudience, {
        cursor: null,
        audienceCursor: nextAudienceCursor,
        phase: "resend",
      });
      return {done: false, processed, cursor: nextAudienceCursor};
    }
    return {done: true, processed, cursor: null};
  },
});

const preferencesSnapshot = v.object({
  owner: v.string(),
  enabled: v.boolean(),
  newsletter: v.boolean(),
  cachedEmail: v.union(v.string(), v.null()),
  emailDisabledAt: v.union(v.number(), v.null()),
});

export const findPreferencesByEmail = internalQuery({
  args: {email: v.string()},
  returns: v.union(preferencesSnapshot, v.null()),
  handler: async (ctx, {email}) => {
    const doc = await ctx.db.query("emailPreferences").withIndex("by_cachedEmail", q => q.eq("cachedEmail", email)).unique();
    if (!doc) return null;
    return {
      owner: doc.owner,
      enabled: doc.enabled,
      newsletter: doc.newsletter,
      cachedEmail: doc.cachedEmail ?? null,
      emailDisabledAt: doc.emailDisabledAt ?? null,
    };
  },
});

export async function applyResendNewsletterUnsubscribeImpl(
  ctx: Pick<MutationCtx, "db">,
  args: {email: string; contactId?: string; eventAt: number},
) {
  const normalized = args.email.trim().toLowerCase();
  const doc = await ctx.db.query("emailPreferences").withIndex("by_cachedEmail", q => q.eq("cachedEmail", normalized)).unique();
  if (!doc) return;
  if (doc.resendOutboundSyncAt !== undefined && args.eventAt - doc.resendOutboundSyncAt < RESEND_OUTBOUND_SYNC_GRACE_MS) {
    return;
  }
  const patch: Partial<Doc<"emailPreferences">> = {
    newsletter: false,
    updatedAt: args.eventAt,
    resendLastSyncedAt: args.eventAt,
  };
  if (args.contactId) patch.resendContactId = args.contactId;
  await ctx.db.patch("emailPreferences", doc._id, patch);
}

export const applyResendNewsletterUnsubscribe = internalMutation({
  args: {email: v.string(), contactId: v.optional(v.string()), eventAt: v.number()},
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyResendNewsletterUnsubscribeImpl(ctx, args);
    return null;
  },
});
