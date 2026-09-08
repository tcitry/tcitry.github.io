import type { AuthConfig } from "convex/server";

// Set this on each Convex deployment. Dev and production use separate Clerk
// instances; this value must match that instance's JWT issuer exactly.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
