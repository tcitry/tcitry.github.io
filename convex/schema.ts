import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const pageFields = {
  owner: v.string(),
  pathname: v.string(),
  title: v.string(),
  updatedAt: v.number(),
};

export default defineSchema({
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
