import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import agent from "@convex-dev/agent/convex.config";
import { v } from "convex/values";

const app = defineApp({ env: {
  CHAT_ALLOWED_ORIGINS: v.optional(v.string()),
  CLERK_PRO_PLAN_SLUG: v.optional(v.string()),
  CONSULTATION_ADMIN_TOKEN_IDENTIFIER: v.optional(v.string()),
  AI_SEARCH_PUBLIC_URL: v.optional(v.string()),
  // DEV-298 search-as-tool rollout. ASSISTANT_TOOL_MODE: off | allowlist | on.
  ASSISTANT_TOOL_MODE: v.optional(v.string()),
  ASSISTANT_TOOL_OWNERS: v.optional(v.string()),
  ASSISTANT_CHAT_MODEL: v.optional(v.string()),
  ASSISTANT_CHAT_GATEWAY: v.optional(v.string()),
  CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
  CLOUDFLARE_API_TOKEN: v.optional(v.string()),
} });
app.use(rateLimiter);
app.use(agent);
export default app;
