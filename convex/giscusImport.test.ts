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
});
