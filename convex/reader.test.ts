/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const page = { pathname: "/docs/example/", title: "Example" };
const paginationOpts = { numItems: 10, cursor: null };
const readingStatuses = ["later", "skimmed", "read", "studied"] as const;

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const alice = t.withIdentity({ issuer: "https://auth.example.test", subject: "alice", name: "Private real name", email: "private@example.test" });
  const bob = t.withIdentity({ issuer: "https://auth.example.test", subject: "bob" });
  return { t, alice, bob };
}

describe("bookmark authentication and ownership", () => {
  test("every read and write rejects anonymous callers", async () => {
    const { t } = setup();
    const calls = [
      () => t.query(api.reader.getPage, { pathname: page.pathname }),
      () => t.query(api.reader.listLibrary, { paginationOpts }),
      () => t.mutation(api.reader.setBookmark, { ...page, bookmarked: true }),
      () => t.mutation(api.reader.setBookmark, { ...page, bookmarked: false }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
  });

  test("a second user can neither read nor cancel another user's bookmark", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    expect(await bob.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: false });
    expect((await bob.query(api.reader.listLibrary, { paginationOpts })).page).toEqual([]);
    await bob.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    await bob.mutation(api.reader.setBookmark, { ...page, title: "Bob's title", bookmarked: true });
    expect((await bob.query(api.reader.listLibrary, { paginationOpts })).page[0].title).toBe("Bob's title");
    expect((await alice.query(api.reader.listLibrary, { paginationOpts })).page[0].title).toBe(page.title);
    await bob.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: true });
  });

  test("the same subject from different JWT issuers does not share ownership", async () => {
    const { t, alice } = setup();
    const otherIssuer = t.withIdentity({ issuer: "https://another.example.test", subject: "alice" });
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    expect(await otherIssuer.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: false });
    expect((await otherIssuer.query(api.reader.listLibrary, { paginationOpts })).page).toEqual([]);
    await otherIssuer.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: true });
  });

  test("client supplied ownership is rejected and responses contain only bookmark fields", async () => {
    const { alice } = setup();
    await expect(alice.mutation(api.reader.setBookmark, {
      ...page, bookmarked: true,
      // @ts-expect-error The API must not allow client supplied authorization keys.
      owner: "another-user",
    })).rejects.toThrow();
    await expect(alice.query(api.reader.listLibrary, {
      paginationOpts,
      // @ts-expect-error This endpoint lists bookmarks only; the client cannot select another collection.
      kind: "notes",
    })).rejects.toThrow();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: true });
    const result = await alice.query(api.reader.listLibrary, { paginationOpts });
    expect(Object.keys(result.page[0]).sort()).toEqual(["pathname", "title", "updatedAt"]);
    expect(JSON.stringify(result)).not.toMatch(/Private real name|private@example|tokenIdentifier|owner/);
  });
});

describe("bookmark state", () => {
  test("writes are idempotent and equivalent pathnames share one row", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/%65xample", bookmarked: true });
    for (let i = 0; i < 35; i++) await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    expect((await alice.query(api.reader.listLibrary, { paginationOpts })).page).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("bookmarks").take(2))).toHaveLength(1);
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: false });
  });

  test("invalid pathnames cannot become stored keys or unsafe library links", async () => {
    const { alice } = setup();
    for (const pathname of ["https://example.test/", "//example.test/", "/a?b", "/a#b", "/a/../b", "/a/%2e%2e/b", "/a/%2fb", "/a\\b", "/bad%", "/a\u0000b"]) {
      await expect(alice.mutation(api.reader.setBookmark, { ...page, pathname, bookmarked: true })).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.query(api.reader.getPage, { pathname })).rejects.toThrow("INVALID_ARGUMENT");
    }
    expect((await alice.query(api.reader.listLibrary, { paginationOpts })).page).toEqual([]);
  });

  test("titles reject blank, excessive, or control-character input and otherwise remain plain text", async () => {
    const { alice } = setup();
    for (const title of ["", "   ", "a".repeat(241), "nul\u0000byte", "line\nbreak"]) {
      await expect(alice.mutation(api.reader.setBookmark, { ...page, title, bookmarked: true })).rejects.toThrow("INVALID_ARGUMENT");
    }
    const title = "<script>plain text</script>";
    await alice.mutation(api.reader.setBookmark, { ...page, title, bookmarked: true });
    expect((await alice.query(api.reader.listLibrary, { paginationOpts })).page[0].title).toBe(title);
  });
});

describe("bookmark bounded pagination and throttling", () => {
  test("pages follow indexed cursor order without returning another user's records", async () => {
    const { alice, bob } = setup();
    for (let i = 0; i < 7; i++) {
      await alice.mutation(api.reader.setBookmark, { ...page, pathname: `/docs/page-${i}/`, bookmarked: true });
    }
    await bob.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/bobs-page/", bookmarked: true });
    const first = await alice.query(api.reader.listLibrary, {
      paginationOpts: { numItems: 3, cursor: null, maximumRowsRead: 3 },
    });
    const second = await alice.query(api.reader.listLibrary, {
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    const third = await alice.query(api.reader.listLibrary, {
      paginationOpts: { numItems: 3, cursor: second.continueCursor },
    });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);
    expect(second.page).toHaveLength(3);
    expect(third.page).toHaveLength(1);
    expect(third.isDone).toBe(true);
    const items = [...first.page, ...second.page, ...third.page];
    const paths = items.map(item => item.pathname);
    expect(new Set(paths).size).toBe(7);
    expect(paths).not.toContain("/docs/bobs-page/");
    expect(items.map(item => item.updatedAt)).toEqual(items.map(item => item.updatedAt).sort((a, b) => b - a));
  });

  test("oversized or invalid pagination is rejected", async () => {
    const { alice } = setup();
    for (const numItems of [0, -1, 1.5, 51, NaN]) {
      await expect(alice.query(api.reader.listLibrary, { paginationOpts: { numItems, cursor: null } })).rejects.toThrow("INVALID_ARGUMENT");
    }
    for (const maximumRowsRead of [0, 101, 1.5]) {
      await expect(alice.query(api.reader.listLibrary, { paginationOpts: { ...paginationOpts, maximumRowsRead } })).rejects.toThrow("INVALID_ARGUMENT");
    }
    for (const maximumBytesRead of [0, 1_000_001, 1.5]) {
      await expect(alice.query(api.reader.listLibrary, { paginationOpts: { ...paginationOpts, maximumBytesRead } })).rejects.toThrow("INVALID_ARGUMENT");
    }
  });

  test("per-user limits reject additional writes while reads, no-ops, and other users remain available", async () => {
    const { alice, bob } = setup();
    for (let i = 0; i < 30; i++) {
      await alice.mutation(api.reader.setBookmark, { ...page, pathname: `/docs/rate-${i}/`, bookmarked: true });
    }
    await expect(alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true })).rejects.toThrow();
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: false });
    await expect(alice.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/rate-0/", bookmarked: true })).resolves.toBe(true);
    await expect(alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false })).resolves.toBe(false);
    await expect(alice.mutation(api.reader.setBookmark, { ...page, pathname: "/docs/rate-0/", bookmarked: false })).rejects.toThrow();
    expect(await alice.query(api.reader.getPage, { pathname: "/docs/rate-0/" })).toEqual({ bookmarked: true });
    await expect(bob.mutation(api.reader.setBookmark, { ...page, bookmarked: true })).resolves.toBe(true);
  });
});

describe("private reading marks", () => {
  test("all endpoints reject anonymous callers and isolate owners without leaking identity", async () => {
    const { t, alice, bob } = setup();
    for (const call of [
      () => t.query(api.reader.getReadingMark, { pathname: page.pathname }),
      () => t.query(api.reader.listReadingMarks, { paginationOpts }),
      () => t.mutation(api.reader.setReadingMark, { ...page, status: "later" }),
      () => t.mutation(api.reader.clearReadingMark, { pathname: page.pathname }),
    ]) await expect(call()).rejects.toThrow("UNAUTHENTICATED");
    await alice.mutation(api.reader.setReadingMark, { ...page, status: "studied" });
    expect(await bob.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status: null });
    expect((await bob.query(api.reader.listReadingMarks, { paginationOpts })).page).toEqual([]);
    await bob.mutation(api.reader.clearReadingMark, { pathname: page.pathname });
    await bob.mutation(api.reader.setReadingMark, { ...page, status: "later" });
    expect(await alice.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status: "studied" });
    const result = await alice.query(api.reader.listReadingMarks, { paginationOpts, status: "studied" });
    expect(result.page).toEqual([{ ...page, status: "studied", updatedAt: expect.any(Number) }]);
    expect(Object.keys(result.page[0]).sort()).toEqual(["pathname", "status", "title", "updatedAt"]);
    expect(JSON.stringify(result)).not.toMatch(/alice|Private real name|private@example|tokenIdentifier/);
  });

  test("four statuses persist on one canonical row, no-ops are idempotent, and clearing preserves bookmarks", async () => {
    const { t, alice } = setup();
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: true });
    for (const status of readingStatuses) {
      await alice.mutation(api.reader.setReadingMark, { ...page, pathname: "/docs/%65xample", status });
      expect(await alice.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status });
    }
    for (let i = 0; i < 35; i++) await alice.mutation(api.reader.setReadingMark, { ...page, status: "studied" });
    expect(await t.run(ctx => ctx.db.query("readingMarks").take(2))).toHaveLength(1);
    await alice.mutation(api.reader.setReadingMark, { ...page, title: " Renamed ", status: "studied" });
    expect((await alice.query(api.reader.listReadingMarks, { paginationOpts })).page[0].title).toBe("Renamed");
    await alice.mutation(api.reader.clearReadingMark, { pathname: "/docs/%65xample" });
    await alice.mutation(api.reader.clearReadingMark, { pathname: page.pathname });
    expect(await alice.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status: null });
    expect(await alice.query(api.reader.getPage, { pathname: page.pathname })).toEqual({ bookmarked: true });
    await alice.mutation(api.reader.setReadingMark, { ...page, status: "read" });
    await alice.mutation(api.reader.setBookmark, { ...page, bookmarked: false });
    expect(await alice.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status: "read" });
    expect(await t.run(ctx => ctx.db.query("readingProgress").take(1))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("privateNotes").take(1))).toEqual([]);
  });

  test("validates paths, titles, statuses and bounded pagination", async () => {
    const { alice } = setup();
    for (const pathname of ["https://example.test/", "//example.test/", "/a?b", "/a#b", "/a/%2e%2e/b", "/a/%2fb", "/bad%", "/a\\b"]) {
      await expect(alice.mutation(api.reader.setReadingMark, { ...page, pathname, status: "later" })).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.query(api.reader.getReadingMark, { pathname })).rejects.toThrow("INVALID_ARGUMENT");
      await expect(alice.mutation(api.reader.clearReadingMark, { pathname })).rejects.toThrow("INVALID_ARGUMENT");
    }
    for (const title of ["", "   ", "a".repeat(241), "line\nbreak"]) {
      await expect(alice.mutation(api.reader.setReadingMark, { ...page, title, status: "later" })).rejects.toThrow("INVALID_ARGUMENT");
    }
    // Runtime validation must reject clients that bypass TypeScript.
    // @ts-expect-error invalid status
    await expect(alice.mutation(api.reader.setReadingMark, { ...page, status: "finished" })).rejects.toThrow();
    // @ts-expect-error invalid filter
    await expect(alice.query(api.reader.listReadingMarks, { paginationOpts, status: "finished" })).rejects.toThrow();
    for (const options of [{ numItems: 0 }, { numItems: 51 }, { maximumRowsRead: 101 }, { maximumBytesRead: 1_000_001 }]) {
      await expect(alice.query(api.reader.listReadingMarks, { paginationOpts: { ...paginationOpts, ...options } })).rejects.toThrow("INVALID_ARGUMENT");
    }
  });

  test("filtered and unfiltered cursors return only the owner's marks in updated order", async () => {
    const { alice, bob } = setup();
    for (let i = 0; i < 8; i++) {
      await alice.mutation(api.reader.setReadingMark, { ...page, pathname: `/docs/mark-${i}/`, status: i % 2 ? "later" : "read" });
    }
    await bob.mutation(api.reader.setReadingMark, { ...page, status: "read" });
    for (const status of [undefined, "read"] as const) {
      const first = await alice.query(api.reader.listReadingMarks, { status, paginationOpts: { numItems: 3, cursor: null } });
      const rest = await alice.query(api.reader.listReadingMarks, { status, paginationOpts: { numItems: 10, cursor: first.continueCursor } });
      expect(first.page).toHaveLength(3);
      expect(first.isDone).toBe(false);
      expect(rest.isDone).toBe(true);
      const rows = [...first.page, ...rest.page];
      expect(new Set(rows.map(row => row.pathname)).size).toBe(status ? 4 : 8);
      expect(rows.map(row => row.pathname)).not.toContain(page.pathname);
      expect(rows.map(row => row.updatedAt)).toEqual(rows.map(row => row.updatedAt).sort((a, b) => b - a));
      if (status) expect(rows.every(row => row.status === status)).toBe(true);
    }
  });

  test("shares readerWrites limits while reads, no-ops and other owners remain available", async () => {
    const { alice, bob } = setup();
    await alice.mutation(api.reader.setReadingMark, { ...page, status: "later" });
    for (let i = 0; i < 29; i++) await alice.mutation(api.reader.setBookmark, { ...page, pathname: `/docs/rate-${i}/`, bookmarked: true });
    await expect(alice.mutation(api.reader.setReadingMark, { ...page, status: "read" })).rejects.toThrow();
    await expect(alice.mutation(api.reader.clearReadingMark, { pathname: page.pathname })).rejects.toThrow();
    await expect(alice.mutation(api.reader.setReadingMark, { ...page, status: "later" })).resolves.toBe("later");
    await expect(alice.mutation(api.reader.clearReadingMark, { pathname: "/docs/unmarked/" })).resolves.toBeNull();
    expect(await alice.query(api.reader.getReadingMark, { pathname: page.pathname })).toEqual({ status: "later" });
    await expect(bob.mutation(api.reader.setReadingMark, { ...page, status: "read" })).resolves.toBe("read");
  });
});
