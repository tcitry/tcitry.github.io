import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import agent from "@convex-dev/agent/convex.config";
import { v } from "convex/values";

const app = defineApp({ env: {
  CHAT_ALLOWED_ORIGINS: v.optional(v.string()),
  CLERK_PRO_PLAN_SLUG: v.optional(v.string()),
  CONSULTATION_ADMIN_TOKEN_IDENTIFIER: v.optional(v.string()),
  AI_SEARCH_PUBLIC_URL: v.optional(v.string()),
} });
app.use(rateLimiter);
app.use(agent);
export default app;
