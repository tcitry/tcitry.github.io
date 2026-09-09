import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  }).index("by_conversationId_and_requestId", ["conversationId", "requestId"])
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_conversationId_and_promptOrder", ["conversationId", "promptOrder"]),
  comments: defineTable({
    pathname: v.string(), authorName: v.string(), body: v.string(), createdAt: v.number(),
    parentId: v.optional(v.id("comments")), owner: v.string(),
  }).index("by_pathname_and_createdAt", ["pathname", "createdAt"]),
  bookmarks: defineTable(pageFields)
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
  readingProgress: defineTable({ ...pageFields, progress: v.number() })
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
  privateNotes: defineTable({ ...pageFields, note: v.string() })
    .index("by_owner_and_pathname", ["owner", "pathname"])
    .index("by_owner_and_updatedAt", ["owner", "updatedAt"]),
});
