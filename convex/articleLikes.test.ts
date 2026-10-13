/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, describe, expect, test, vi} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const issuer = "https://auth.example.test";
const authorId = `${issuer}|author`;
const paginationOpts = {numItems: 20, cursor: null};

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {
    t,
    author: t.withIdentity({issuer, subject: "author", tokenIdentifier: authorId}),
    forgedAdmin: t.withIdentity({issuer, subject: "reader", tokenIdentifier: `${issuer}|reader`, role: "admin", publicMetadata: {role: "admin"}}),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("author article-like administration", () => {
  test("paginates article hearts only and never returns reader identifiers", async () => {
    vi.stubEnv("CONSULTATION_ADMIN_TOKEN_IDENTIFIER", authorId);
    const {t, author, forgedAdmin} = setup();
    await expect(t.query(api.articleLikes.listAdmin, {paginationOpts})).rejects.toThrow("UNAUTHENTICATED");
    await expect(forgedAdmin.query(api.articleLikes.listAdmin, {paginationOpts})).rejects.toThrow("FORBIDDEN");

    await t.run(async ctx => {
      const commentId = await ctx.db.insert("comments", {pathname: "/posts/example/", authorName: "Reader", body: "A comment", owner: "private-comment-owner", createdAt: 1});
      await ctx.db.insert("commentLikes", {commentId, owner: "private-comment-liker"});
      await ctx.db.insert("articleLikes", {pathname: "/posts/first/", title: "First article", owner: "private-reader-one", createdAt: 10});
      await ctx.db.insert("articleLikes", {pathname: "/posts/second/", owner: "private-reader-two", createdAt: 20});
      await ctx.db.insert("articleLikes", {pathname: "/posts/legacy/", owner: "private-reader-three"});
    });

    const page = await author.query(api.articleLikes.listAdmin, {paginationOpts});
    expect(page.page).toHaveLength(3);
    expect(page.page[0]).toMatchObject({pathname: "/posts/second/", title: "/posts/second/", createdAt: 20});
    expect(page.page[1]).toMatchObject({pathname: "/posts/first/", title: "First article", createdAt: 10});
    expect(page.page[2]).toMatchObject({pathname: "/posts/legacy/"});
    expect(page.page[2].createdAt).toBeGreaterThan(0);
    expect(JSON.stringify(page.page)).not.toMatch(/owner|private-reader|private-comment|tokenIdentifier/);

    const first = await author.query(api.articleLikes.listAdmin, {paginationOpts: {numItems: 1, cursor: null}});
    const second = await author.query(api.articleLikes.listAdmin, {paginationOpts: {numItems: 1, cursor: first.continueCursor}});
    expect(first.page).toHaveLength(1);
    expect(second.page).toHaveLength(1);
    await expect(author.query(api.articleLikes.listAdmin, {paginationOpts: {numItems: 51, cursor: null}})).rejects.toThrow("INVALID_ARGUMENT");
  });
});
