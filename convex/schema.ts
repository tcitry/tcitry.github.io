import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const importSource = v.union(v.literal("github_discussion"), v.literal("giscus"));

const pageFields = {
  owner: v.string(),
  pathname: v.string(),
  title: v.string(),
  updatedAt: v.number(),
};

export default defineSchema({
  consultationThreads: defineTable({
    owner: v.string(), title: v.string(),
    status: v.union(v.literal("waiting"), v.literal("replied"), v.literal("closed")),
    createdAt: v.number(), updatedAt: v.number(), requestId: v.string(),
  }).index("by_owner_and_updatedAt", ["owner", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_owner_and_requestId", ["owner", "requestId"]),
  consultationMessages: defineTable({
    threadId: v.id("consultationThreads"),
    sender: v.union(v.literal("member"), v.literal("author")),
    content: v.string(), createdAt: v.number(), requestId: v.string(), senderIdentity: v.string(),
    imageIds: v.optional(v.array(v.id("commentImages"))),
  }).index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_senderIdentity_and_requestId", ["senderIdentity", "requestId"]),
  assistantConversations: defineTable({
    owner: v.string(), threadId: v.string(), title: v.string(),
    createdAt: v.number(), updatedAt: v.number(), activeRunId: v.optional(v.id("assistantRuns")),
  }).index("by_owner_and_updatedAt", ["owner", "updatedAt"])
    .index("by_threadId", ["threadId"]),
  assistantRuns: defineTable({
    conversationId: v.id("assistantConversations"), owner: v.string(), requestId: v.string(), promptMessageId: v.string(), promptOrder: v.number(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("canceled")),
    sources: v.array(v.object({id: v.string(), title: v.string(), url: v.string(), sourceKind: v.union(v.literal("author"), v.literal("ai-assisted"))})),
    createdAt: v.number(), deadlineAt: v.number(), completedAt: v.optional(v.number()), error: v.optional(v.string()), streamId: v.optional(v.string()),
    phase: v.optional(v.union(v.literal("thinking"), v.literal("searching"), v.literal("writing"))),
    toolCalls: v.optional(v.number()),
  }).index("by_conversationId_and_requestId", ["conversationId", "requestId"])
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_conversationId_and_promptOrder", ["conversationId", "promptOrder"]),
  // Live comments keep Clerk tokenIdentifier in `owner`. Historical giscus /
  // GitHub Discussions imports use synthetic owners `github:user:{databaseId}`
  // so rows stay distinct without claim-by-nickname. Provenance fields below
  // are optional and only populated by the import job.
  comments: defineTable({
    pathname: v.string(), authorName: v.string(), body: v.string(), createdAt: v.number(),
    articleTitle: v.optional(v.string()),
    parentId: v.optional(v.id("comments")), owner: v.string(),
    deletedAt: v.optional(v.number()), likeCount: v.optional(v.number()),
    imageIds: v.optional(v.array(v.id("commentImages"))),
    authorImageUrl: v.optional(v.string()),
    importSource: v.optional(importSource),
    externalId: v.optional(v.string()),
    sourceDiscussionNumber: v.optional(v.number()),
    githubLogin: v.optional(v.string()),
    githubUserId: v.optional(v.number()),
    sourceUrl: v.optional(v.string()),
  }).index("by_pathname_and_createdAt", ["pathname", "createdAt"])
    .index("by_owner_and_deletedAt_and_createdAt", ["owner", "deletedAt", "createdAt"])
    .index("by_externalId", ["externalId"])
    .index("by_importSource", ["importSource"]),
  commentStats: defineTable({pathname: v.string(), commentCount: v.number(), likeCount: v.number()})
    .index("by_pathname", ["pathname"]),
  articleLikes: defineTable({
    pathname: v.string(), owner: v.string(), title: v.optional(v.string()), createdAt: v.optional(v.number()),
    importSource: v.optional(importSource),
  }).index("by_pathname_and_owner", ["pathname", "owner"])
    .index("by_owner_and_createdAt", ["owner", "createdAt"])
    .index("by_importSource", ["importSource"]),
  notifications: defineTable({
    recipient: v.string(),
    kind: v.union(
      v.literal("comment_reply"),
      v.literal("new_comment"),
      v.literal("consultation_reply"),
      v.literal("consultation_message"),
    ),
    createdAt: v.number(), readAt: v.optional(v.number()),
    commentId: v.optional(v.id("comments")), threadId: v.optional(v.id("consultationThreads")),
    messageId: v.optional(v.id("consultationMessages")),
  }).index("by_recipient_and_createdAt", ["recipient", "createdAt"])
    .index("by_recipient_and_readAt", ["recipient", "readAt"]),
  commentLikes: defineTable({commentId: v.id("comments"), owner: v.string(), importSource: v.optional(importSource)})
    .index("by_commentId_and_owner", ["commentId", "owner"])
    .index("by_importSource", ["importSource"]),
  commentImages: defineTable({
    owner: v.string(), storageId: v.id("_storage"), contentType: v.string(), size: v.number(),
    purpose: v.union(v.literal("comment"), v.literal("consultation")),
    createdAt: v.number(), commentId: v.optional(v.id("comments")),
    threadId: v.optional(v.id("consultationThreads")), messageId: v.optional(v.id("consultationMessages")),
  }).index("by_owner_and_createdAt", ["owner", "createdAt"]),
  bookmarks: defineTable(pageFields)
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
  readingProgress: defineTable({ ...pageFields, progress: v.number() })
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
  privateNotes: defineTable({ ...pageFields, note: v.string() })
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
  emailPreferences: defineTable({
    owner: v.string(),
    enabled: v.boolean(),
    commentReply: v.boolean(),
    likes: v.boolean(),
    newComment: v.boolean(),
    newsletter: v.boolean(),
    unsubscribeToken: v.string(),
    cachedEmail: v.optional(v.string()),
    emailDisabledAt: v.optional(v.number()),
    resendContactId: v.optional(v.string()),
    resendLastSyncedAt: v.optional(v.number()),
    resendOutboundSyncAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_owner", ["owner"])
    .index("by_unsubscribeToken", ["unsubscribeToken"])
    .index("by_cachedEmail", ["cachedEmail"]),
  emailSendLog: defineTable({
    notificationId: v.optional(v.id("notifications")),
    recipient: v.string(),
    email: v.string(),
    status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")),
    resendId: v.optional(v.string()),
    reason: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_notificationId", ["notificationId"])
    .index("by_recipient_and_createdAt", ["recipient", "createdAt"]),
  emailThreadThrottle: defineTable({
    recipient: v.string(),
    threadKey: v.string(),
    lastSentAt: v.number(),
  }).index("by_recipient_and_threadKey", ["recipient", "threadKey"]),
});
