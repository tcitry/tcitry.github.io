/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assistant from "../assistant.js";
import type * as assistantModel from "../assistantModel.js";
import type * as assistantPublicSearch from "../assistantPublicSearch.js";
import type * as assistantRetrievalConfig from "../assistantRetrievalConfig.js";
import type * as commentImages from "../commentImages.js";
import type * as commentShared from "../commentShared.js";
import type * as comments from "../comments.js";
import type * as consultations from "../consultations.js";
import type * as http from "../http.js";
import type * as membership from "../membership.js";
import type * as notifications from "../notifications.js";
import type * as reader from "../reader.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assistant: typeof assistant;
  assistantModel: typeof assistantModel;
  assistantPublicSearch: typeof assistantPublicSearch;
  assistantRetrievalConfig: typeof assistantRetrievalConfig;
  commentImages: typeof commentImages;
  commentShared: typeof commentShared;
  comments: typeof comments;
  consultations: typeof consultations;
  http: typeof http;
  membership: typeof membership;
  notifications: typeof notifications;
  reader: typeof reader;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
