/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {describe, expect, test} from "vitest";
import {internal} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);

const pathname = "/posts/example/";
const baseRow = {
  pathname,
  externalId: "1001",
  body: "Imported comment body.",
  createdAt: 1_700_000_000_000,
  parentExternalId: null,
  owner: "github:user:5220740",
  authorName: "tcitry",
  sourceDiscussionNumber: 149,
  githubLogin: "tcitry",
  githubUserId: 5220740,
  sourceUrl: "https://github.com/tcitry/tcitry.github.io/discussions/149#discussioncomment-1001",
};

describe("giscus import mutations", () => {
  test("importBatch is idempotent via externalId and preserves parent links", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const parent = {...baseRow, externalId: "1000", body: "Parent comment."};
    const reply = {...baseRow, externalId: "1001", body: "Reply comment.", parentExternalId: "1000", createdAt: baseRow.createdAt + 1};
    const first = await t.mutation(internal.giscusImport.importBatch, {rows: [parent, reply], importSource: "github_discussion"});
    expect(first).toEqual({inserted: 2, skipped: 0, pathnames: {[pathname]: 2}});
    const second = await t.mutation(internal.giscusImport.importBatch, {rows: [parent, reply], importSource: "github_discussion"});
    expect(second).toEqual({inserted: 0, skipped: 2, pathnames: {}});
    const rows = await t.run(ctx => ctx.db.query("comments").withIndex("by_pathname_and_createdAt", q => q.eq("pathname", pathname)).collect());
    expect(rows).toHaveLength(2);
    const child = rows.find(row => row.externalId === "1001");
    const root = rows.find(row => row.externalId === "1000");
    expect(child?.parentId).toEqual(root?._id);
    expect(root?.importSource).toBe("github_discussion");
    expect(root?.owner).toBe("github:user:5220740");
    const summary = await t.run(async ctx => {
      const stats = await ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).unique();
      return stats?.commentCount ?? 0;
    });
    expect(summary).toBe(2);
  });

  test("rollback deletes imported rows and updates stats", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.mutation(internal.giscusImport.importBatch, {rows: [baseRow], importSource: "github_discussion"});
    const rolledBack = await t.mutation(internal.giscusImport.rollback, {importSource: "github_discussion"});
    expect(rolledBack).toEqual({deleted: 1, pathnames: {[pathname]: 1}});
    expect(await t.run(ctx => ctx.db.query("comments").collect())).toEqual([]);
    const stats = await t.run(ctx => ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).unique());
    expect(stats?.commentCount).toBe(0);
  });

  test("importReactions writes article and comment likes once without notifications", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.mutation(internal.giscusImport.importBatch, {rows: [baseRow], importSource: "github_discussion"});
    const reactions = {
      articleLikes: [
        {pathname, owner: "github:user:1", title: "Example", createdAt: 1_700_000_100_000},
        {pathname: "/about/", owner: "github:user:2", createdAt: 1_700_000_200_000},
      ],
      commentLikes: [{externalId: "1001", owner: "github:user:1"}],
      importSource: "github_discussion" as const,
    };
    const first = await t.mutation(internal.giscusImport.importReactions, reactions);
    expect(first).toEqual({inserted: 3, skipped: 0, pathnames: {[pathname]: 1, "/about/": 1}, comments: {"1001": 1}});
    const second = await t.mutation(internal.giscusImport.importReactions, reactions);
    expect(second).toEqual({inserted: 0, skipped: 3, pathnames: {}, comments: {}});

    const state = await t.run(async ctx => ({
      likes: await ctx.db.query("articleLikes").collect(),
      commentLikes: await ctx.db.query("commentLikes").collect(),
      stats: await ctx.db.query("commentStats").collect(),
      comment: await ctx.db.query("comments").withIndex("by_externalId", q => q.eq("externalId", "1001")).unique(),
      notifications: await ctx.db.query("notifications").collect(),
    }));
    expect(state.likes.map(row => [row.pathname, row.owner, row.title, row.createdAt, row.importSource])).toEqual([
      [pathname, "github:user:1", "Example", 1_700_000_100_000, "github_discussion"],
      ["/about/", "github:user:2", undefined, 1_700_000_200_000, "github_discussion"],
    ]);
    expect(state.commentLikes.map(row => [row.owner, row.importSource])).toEqual([["github:user:1", "github_discussion"]]);
    expect(Object.fromEntries(state.stats.map(row => [row.pathname, row.likeCount]))).toEqual({[pathname]: 1, "/about/": 1});
    expect(state.stats.find(row => row.pathname === pathname)?.commentCount).toBe(1);
    expect(state.comment?.likeCount).toBe(1);
    expect(state.notifications).toEqual([]);
  });

  test("importReactions rejects likes for comments that were not imported", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await expect(t.mutation(internal.giscusImport.importReactions, {
      articleLikes: [],
      commentLikes: [{externalId: "404", owner: "github:user:1"}],
      importSource: "github_discussion",
    })).rejects.toThrow(/404/);
    await expect(t.mutation(internal.giscusImport.importReactions, {
      articleLikes: [{pathname, owner: "user|clerk", createdAt: 1}],
      commentLikes: [],
      importSource: "github_discussion",
    })).rejects.toThrow(/synthetic GitHub owners/);
  });

  test("rollbackReactions removes only imported likes and restores counts without going negative", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.mutation(internal.giscusImport.importBatch, {rows: [baseRow], importSource: "github_discussion"});
    await t.mutation(internal.giscusImport.importReactions, {
      articleLikes: [{pathname, owner: "github:user:1", createdAt: 1}, {pathname: "/about/", owner: "github:user:2", createdAt: 2}],
      commentLikes: [{externalId: "1001", owner: "github:user:1"}],
      importSource: "github_discussion",
    });
    await t.run(async ctx => {
      await ctx.db.insert("articleLikes", {pathname, owner: "user|live", createdAt: 3});
      const stats = await ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", pathname)).unique();
      if (stats) await ctx.db.patch("commentStats", stats._id, {likeCount: stats.likeCount + 1});
      const comment = await ctx.db.query("comments").withIndex("by_externalId", q => q.eq("externalId", "1001")).unique();
      if (comment) {
        await ctx.db.insert("commentLikes", {commentId: comment._id, owner: "user|live"});
        await ctx.db.patch("comments", comment._id, {likeCount: 2});
      }
      const about = await ctx.db.query("commentStats").withIndex("by_pathname", q => q.eq("pathname", "/about/")).unique();
      if (about) await ctx.db.patch("commentStats", about._id, {likeCount: 0});
    });

    const rolledBack = await t.mutation(internal.giscusImport.rollbackReactions, {importSource: "github_discussion"});
    expect(rolledBack).toEqual({deleted: 3, pathnames: {[pathname]: 1, "/about/": 1}, comments: {"1001": 1}});

    const state = await t.run(async ctx => ({
      likes: await ctx.db.query("articleLikes").collect(),
      commentLikes: await ctx.db.query("commentLikes").collect(),
      stats: await ctx.db.query("commentStats").collect(),
      comment: await ctx.db.query("comments").withIndex("by_externalId", q => q.eq("externalId", "1001")).unique(),
    }));
    expect(state.likes.map(row => row.owner)).toEqual(["user|live"]);
    expect(state.commentLikes.map(row => row.owner)).toEqual(["user|live"]);
    expect(Object.fromEntries(state.stats.map(row => [row.pathname, row.likeCount]))).toEqual({[pathname]: 1, "/about/": 0});
    expect(state.comment?.likeCount).toBe(1);
    expect(await t.mutation(internal.giscusImport.rollbackReactions, {importSource: "github_discussion"})).toEqual({deleted: 0, pathnames: {}, comments: {}});
  });
});
