/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const page = { pathname: "/docs/example/", title: "Example" };
const paginationOpts = { numItems: 10, cursor: null };

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const alice = t.withIdentity({ issuer: "https://auth.example.test", subject: "alice", name: "Private real name", email: "private@example.test" });
  const bob = t.withIdentity({ issuer: "https://auth.example.test", subject: "bob" });
  return { t, alice, bob };
}

describe("reader authentication and ownership", () => {
  test("every private read and write rejects anonymous callers", async () => {
    const { t } = setup();
    const calls = [
      () => t.query(api.reader.getPage, { pathname: page.pathname }),
      () => t.query(api.reader.listLibrary, { kind: "notes", paginationOpts }),
      () => t.mutation(api.reader.setBookmark, { ...page, bookmarked: true }),
      () => t.mutation(api.reader.saveProgress, { ...page, progress: 50 }),
      () => t.mutation(api.reader.saveNote, { ...page, note: "Private", expectedUpdatedAt: null }),
      () => t.mutation(api.reader.clearPage, { pathname: page.pathname }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
  });

  test("a second user can neither read, overwrite, nor delete another user's state", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    await alice.mutation(api.reader.saveProgress, { ...page, progress: 65 });
    const saved = await alice.mutation(api.reader.saveNote, { ...page, note: "Only Alice", expectedUpdatedAt: null });

    expect(await bob.query(api.reader.getPage, { pathname: page.pathname })).toEqual({
      bookmarked: false, progress: null, note: "", noteUpdatedAt: null,
    });
    expect((await bob.query(api.reader.listLibrary, { kind: "notes", paginationOpts })).page).toEqual([]);
    await expect(bob.mutation(api.reader.saveNote, { ...page, note: "overwrite", expectedUpdatedAt: saved.updatedAt }))
      .rejects.toThrow("NOTE_CONFLICT");
    await bob.mutation(api.reader.saveNote, { ...page, note: "Bob's independent note", expectedUpdatedAt: null });
    await bob.mutation(api.reader.clearPage, { pathname: page.pathname });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({
      bookmarked: true, progress: 65, note: "Only Alice", noteUpdatedAt: saved.updatedAt,
    });
  });

  test("the same subject from different JWT issuers does not share ownership", async () => {
    const { t, alice } = setup();
    const otherIssuer = t.withIdentity({ issuer: "https://another.example.test", subject: "alice" });
    await alice.mutation(api.reader.saveNote, { ...page, note: "Issuer-isolated", expectedUpdatedAt: null });
    expect((await otherIssuer.query(api.reader.getPage, { pathname: page.pathname })).note).toBe("");
  });

  test("client supplied ownership fields are rejected and identity metadata is never returned", async () => {
    const { alice } = setup();
    await expect(alice.mutation(api.reader.setBookmark, {
      ...page, bookmarked: true,
      // @ts-expect-error The API must not allow client supplied authorization keys.
      owner: "another-user",
    })).rejects.toThrow();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    const result = await alice.query(api.reader.listLibrary, { kind: "bookmarks", paginationOpts });
    expect(Object.keys(result.page[0]).sort()).toEqual(["pathname", "title", "updatedAt"]);
    expect(JSON.stringify(result)).not.toMatch(/Private real name|private@example|tokenIdentifier|owner/);
  });
});

describe("reader state", () => {
  test("bookmark writes are idempotent and equivalent pathnames share one row", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/%65xample", bookmarked: true });
    for (let i = 0; i < 35; i++) await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    expect((await alice.query(api.reader.listLibrary, { kind: "bookmarks", paginationOpts })).page).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("bookmarks").take(2))).toHaveLength(1);
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    expect((await alice.query(api.reader.getPage, { pathname: page.pathname })).bookmarked).toBe(false);
  });

  test("progress validates bounds and preserves the furthest point across devices", async () => {
    const { alice } = setup();
    for (const progress of [-1, 101, NaN, Infinity]) {
      await expect(alice.mutation(api.reader.saveProgress, { ...page, progress })).rejects.toThrow("INVALID_ARGUMENT");
    }
    expect(await alice.mutation(api.reader.saveProgress, { ...page, progress: 0 })).toBe(0);
    expect((await alice.query(api.reader.listLibrary, { kind: "progress", paginationOpts })).page).toEqual([]);
    expect(await alice.mutation(api.reader.saveProgress, { ...page, progress: 75.123 })).toBe(75.12);
    expect(await alice.mutation(api.reader.saveProgress, { ...page, progress: 0 })).toBe(75.12);
    expect(await alice.mutation(api.reader.saveProgress, { ...page, progress: 100 })).toBe(100);
    expect((await alice.query(api.reader.getPage, { pathname: page.pathname })).progress).toBe(100);
  });

  test("note versions reject stale writes, advance monotonically, and permit explicit deletion", async () => {
    const { alice } = setup();
    const first = await alice.mutation(api.reader.saveNote, { ...page, note: " First\nline ", expectedUpdatedAt: null });
    expect(first.note).toBe("First\nline");
    await expect(alice.mutation(api.reader.saveNote, { ...page, note: "stale tab", expectedUpdatedAt: null }))
      .rejects.toThrow("NOTE_CONFLICT");
    const second = await alice.mutation(api.reader.saveNote, { ...page, note: "Second", expectedUpdatedAt: first.updatedAt });
    expect(second.updatedAt!).toBeGreaterThan(first.updatedAt!);
    await expect(alice.mutation(api.reader.saveNote, { ...page, note: "", expectedUpdatedAt: first.updatedAt }))
      .rejects.toThrow("NOTE_CONFLICT");
    expect(await alice.mutation(api.reader.saveNote, { ...page, note: "\n ", expectedUpdatedAt: second.updatedAt }))
      .toEqual({ note: "", updatedAt: null });
    expect((await alice.query(api.reader.listLibrary, { kind: "notes", paginationOpts })).page).toEqual([]);
  });

  test("notes stay plain text and reject excessive or control character payloads", async () => {
    const { alice } = setup();
    for (const note of ["a".repeat(10_001), "nul\u0000byte"]) {
      await expect(alice.mutation(api.reader.saveNote, { ...page, note, expectedUpdatedAt: null }))
        .rejects.toThrow("INVALID_ARGUMENT");
    }
    const text = "<script>alert('text only')</script>\n[link](javascript:alert(1))";
    await alice.mutation(api.reader.saveNote, { ...page, note: text, expectedUpdatedAt: null });
    expect((await alice.query(api.reader.getPage, { pathname: page.pathname })).note).toBe(text);
  });

  test("invalid pathnames cannot become stored keys or unsafe library links", async () => {
    const { alice } = setup();
    for (const pathname of ["https://example.test/", "//example.test/", "/a?b", "/a#b", "/a/../b", "/a/%2e%2e/b", "/a/%2fb", "/a\\b", "/bad%", "/a\u0000b"]) {
      await expect(alice.mutation(api.reader.setBookmark, { ...page, pathname, bookmarked: true }))
        .rejects.toThrow("INVALID_ARGUMENT");
    }
    expect((await alice.query(api.reader.listLibrary, { kind: "bookmarks", paginationOpts })).page).toEqual([]);
  });

  test("clearPage deletes the current owner's bookmark, progress and note", async () => {
    const { alice } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    await alice.mutation(api.reader.saveProgress, { ...page, progress: 25 });
    await alice.mutation(api.reader.saveNote, { ...page, note: "Delete me", expectedUpdatedAt: null });
    await alice.mutation(api.reader.clearPage, { pathname: page.pathname });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({
      bookmarked: false, progress: null, note: "", noteUpdatedAt: null,
    });
  });
});

describe("reader bounded pagination and throttling", () => {
  test("library pages follow indexed cursor order without returning another user's records", async () => {
    const { alice, bob } = setup();
    for (let i = 0; i < 7; i++) {
      await alice.mutation(api.reader.setBookmark, { ...page, pathname: `/docs/page-${i}/`, bookmarked: true });
    }
    await bob.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/bobs-page/", bookmarked: true });
    const first = await alice.query(api.reader.listLibrary, {
      kind: "bookmarks", paginationOpts: { numItems: 3, cursor: null, maximumRowsRead: 3 },
    });
    const second = await alice.query(api.reader.listLibrary, {
      kind: "bookmarks", paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    const third = await alice.query(api.reader.listLibrary, {
      kind: "bookmarks", paginationOpts: { numItems: 3, cursor: second.continueCursor },
    });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);
    expect(second.page).toHaveLength(3);
    expect(third.page).toHaveLength(1);
    expect(third.isDone).toBe(true);
    const paths = [...first.page, ...second.page, ...third.page].map(item => item.pathname);
    expect(new Set(paths).size).toBe(7);
    expect(paths).not.toContain("/docs/bobs-page/");
  });

  test("oversized or invalid pagination is rejected", async () => {
    const { alice } = setup();
    for (const numItems of [0, -1, 1.5, 51, NaN]) {
      await expect(alice.query(api.reader.listLibrary, { kind: "notes", paginationOpts: { numItems, cursor: null } }))
        .rejects.toThrow("INVALID_ARGUMENT");
    }
  });

  test("the component enforces per-user write limits without blocking other users", async () => {
    const { alice, bob } = setup();
    for (let i = 0; i < 30; i++) {
      await alice.mutation(api.reader.setBookmark, { ...page, pathname: `/docs/rate-${i}/`, bookmarked: true });
    }
    await expect(alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true })).rejects.toThrow();
    expect((await alice.query(api.reader.getPage, { pathname: page.pathname })).bookmarked).toBe(false);
    await expect(bob.mutation(api.reader.setBookmark, { ...page, bookmarked: true })).resolves.toBe(true);
  });
});
