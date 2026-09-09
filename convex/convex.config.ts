import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import agent from "@convex-dev/agent/convex.config";
import { v } from "convex/values";

const app = defineApp({ env: {
  CLERK_SECRET_KEY: v.optional(v.string()),
  CLERK_PRO_PLAN_SLUG: v.optional(v.string()),
  CONSULTATION_ADMIN_TOKEN_IDENTIFIER: v.optional(v.string()),
  BLOG_RETRIEVAL_URL: v.optional(v.string()),
  RAG_BRIDGE_SECRET: v.optional(v.string()),
  CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
  CLOUDFLARE_API_TOKEN: v.optional(v.string()),
} });
app.use(rateLimiter);
app.use(agent);
export default app;
