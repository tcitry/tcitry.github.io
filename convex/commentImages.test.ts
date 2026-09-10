/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, describe, expect, test, vi} from "vitest";
import {api, internal} from "./_generated/api";
import type {Id} from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts"]);
const pathname = "/posts/example/";
const origin = "https://blog.example.test";
const paginationOpts = {numItems: 20, cursor: null};
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAusAAAAASUVORK5CYII="), char => char.charCodeAt(0));
function setup() {
  vi.stubEnv("CHAT_ALLOWED_ORIGINS", origin);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return {t, alice: t.withIdentity({issuer: "https://auth.example.test", subject: "alice", preferredUsername: "Alice"}), bob: t.withIdentity({issuer: "https://auth.example.test", subject: "bob", preferredUsername: "Bob"})};
}
type Client = ReturnType<typeof setup>["alice"];
async function upload(client: Client, purpose = "comment") {
  const response = await client.fetch(`/comment-images/upload?purpose=${purpose}`, {method: "POST", headers: {Origin: origin, "Content-Type": "image/png"}, body: png});
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).imageId as Id<"commentImages">;
}
const file = (imageId: string) => `/comment-images/file?imageId=${imageId}`;
afterEach(() => {vi.unstubAllEnvs(); vi.useRealTimers();});

describe("authenticated image upload", () => {
  test("upload and file HTTP routes enforce authentication and exact origin", async () => {
    const {t, alice} = setup();
    const request = {method: "POST", headers: {Origin: origin, "Content-Type": "image/png"}, body: png};
    expect((await t.fetch("/comment-images/upload", request)).status).toBe(401);
    expect((await alice.fetch("/comment-images/upload", {...request, headers: {...request.headers, Origin: "https://evil.example.test"}})).status).toBe(403);
    expect((await t.fetch("/comment-images/upload", {method: "OPTIONS", headers: {Origin: origin}})).status).toBe(204);
    expect((await t.fetch("/comment-images/upload", {method: "OPTIONS", headers: {Origin: "https://evil.example.test"}})).status).toBe(403);
    const imageId = await upload(alice);
    expect((await t.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(401);
    const response = await alice.fetch(file(imageId), {headers: {Origin: origin}});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  test("MIME and magic bytes must agree; SVG and HTML disguises are rejected", async () => {
    const {alice, t} = setup();
    for (const [contentType, body] of [["image/svg+xml", "<svg/>"], ["image/png", "<svg/>"], ["image/jpeg", "<html>not an image</html>"], ["text/html", "<html>"], ["image/gif", "PNG"], ["image/webp", "RIFFbad"]]) {
      const response = await alice.fetch("/comment-images/upload", {method: "POST", headers: {Origin: origin, "Content-Type": contentType}, body});
      expect(response.status).toBe(400);
    }
    expect(await t.run(ctx => ctx.db.query("commentImages").take(1))).toEqual([]);
  });

  test("JPEG, PNG, WebP and GIF signatures are allowed", async () => {
    const {alice} = setup();
    const files = [
      {contentType: "image/png", body: png},
      {contentType: "image/jpeg", body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1])},
      {contentType: "image/gif", body: new TextEncoder().encode("GIF89a")},
      {contentType: "image/webp", body: new TextEncoder().encode("RIFF1234WEBP")},
    ];
    for (const {contentType, body} of files) {
      expect((await alice.fetch("/comment-images/upload", {method: "POST", headers: {Origin: origin, "Content-Type": contentType}, body})).status).toBe(201);
    }
  });

  test("the actual body size limit is enforced even with a forged Content-Length", async () => {
    const {alice, t} = setup();
    const body = new Uint8Array(5 * 1024 * 1024 + 1);
    body.set(png);
    const response = await alice.fetch("/comment-images/upload", {method: "POST", headers: {Origin: origin, "Content-Type": "image/png", "Content-Length": "1"}, body});
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({code: "FILE_TOO_LARGE"});
    expect(await t.run(ctx => ctx.db.query("commentImages").take(1))).toEqual([]);
  });

  test("uploads are rate limited per verified identity", async () => {
    vi.useFakeTimers();
    const {alice, bob} = setup();
    for (let index = 0; index < 8; index++) await upload(alice);
    const limited = await alice.fetch("/comment-images/upload", {method: "POST", headers: {Origin: origin, "Content-Type": "image/png"}, body: png});
    expect(limited.status).toBe(429);
    await upload(bob);
  });
});

describe("image ownership and comment binding", () => {
  test("only the uploader can read or discard a draft; clients cannot claim storage IDs", async () => {
    const {t, alice, bob} = setup();
    const imageId = await upload(alice);
    await expect(t.query(api.commentImages.getUrl, {imageId})).rejects.toThrow("UNAUTHENTICATED");
    await expect(bob.query(api.commentImages.getUrl, {imageId})).rejects.toThrow("FORBIDDEN");
    expect((await bob.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(403);
    await expect(bob.mutation(api.commentImages.discard, {imageId})).rejects.toThrow("FORBIDDEN");
    await expect(bob.mutation(api.comments.add, {pathname, body: "stolen", imageIds: [imageId]})).rejects.toThrow("FORBIDDEN");
    await expect(alice.mutation(api.comments.add, {
      pathname, body: "not an accepted API",
      // @ts-expect-error Clients cannot provide bare storage IDs or ownership.
      storageId: "forged",
    })).rejects.toThrow();
    expect(await t.query(api.comments.getSummary, {pathname})).toEqual({commentCount: 0, likeCount: 0});
    await alice.mutation(api.commentImages.discard, {imageId});
    await alice.mutation(api.commentImages.discard, {imageId});
    expect((await alice.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(404);
  });

  test("binding is exclusive; attached images require login, including their HTTP URLs", async () => {
    const {t, alice, bob} = setup();
    const imageId = await upload(alice);
    const id = await alice.mutation(api.comments.add, {pathname, body: "", imageIds: [imageId]});
    await expect(alice.mutation(api.comments.add, {pathname, body: "Reuse", imageIds: [imageId]})).rejects.toThrow("FORBIDDEN");
    await expect(alice.mutation(api.commentImages.discard, {imageId})).rejects.toThrow("FORBIDDEN");
    const row = (await bob.query(api.comments.list, {pathname, paginationOpts})).page[0];
    expect(row.id).toBe(id);
    expect(row.images).toMatchObject([{id: imageId, contentType: "image/png", size: png.byteLength}]);
    expect(row.images[0].url).toBe(`https://test.convex.site${file(imageId)}`);
    expect(row.images[0].url).not.toContain("/api/storage/");
    expect(await bob.query(api.commentImages.getUrl, {imageId})).toBe(row.images[0].url);
    expect((await bob.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(200);
    expect((await t.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(401);
    expect(Object.keys(await t.query(api.comments.getSummary, {pathname})).sort()).toEqual(["commentCount", "likeCount"]);
  });

  test("a comment accepts at most four distinct images", async () => {
    const {alice, t} = setup();
    const imageIds: Id<"commentImages">[] = [];
    for (let index = 0; index < 5; index++) imageIds.push(await upload(alice));
    await expect(alice.mutation(api.comments.add, {pathname, body: "", imageIds})).rejects.toThrow("INVALID_ARGUMENT");
    await expect(alice.mutation(api.comments.add, {pathname, body: "", imageIds: [imageIds[0], imageIds[0]]})).rejects.toThrow("INVALID_ARGUMENT");
    await alice.mutation(api.comments.add, {pathname, body: "", imageIds: imageIds.slice(0, 4)});
    expect((await alice.query(api.comments.list, {pathname, paginationOpts})).page[0].images).toHaveLength(4);
    expect((await t.query(api.comments.getSummary, {pathname})).commentCount).toBe(1);
  });

  test("deleting a parent removes its bytes and author content but keeps its discussion link", async () => {
    const {t, alice, bob} = setup();
    const imageId = await upload(alice);
    const stored = await t.run(ctx => ctx.db.get("commentImages", imageId));
    const parentId = await alice.mutation(api.comments.add, {pathname, body: "Remove this", imageIds: [imageId]});
    const replyId = await bob.mutation(api.comments.add, {pathname, body: "Keep this reply", parentId});
    await alice.mutation(api.comments.remove, {id: parentId});
    expect(await t.run(ctx => ctx.db.system.get("_storage", stored!.storageId))).toBeNull();
    expect((await bob.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(404);
    const rows = (await bob.query(api.comments.list, {pathname, paginationOpts})).page;
    expect(rows.find(row => row.id === parentId)).toMatchObject({deleted: true, body: "", images: []});
    expect(rows.find(row => row.id === replyId)?.replyTo).toEqual({id: parentId, authorName: "已删除的评论", deleted: true});
  });

  test("consultation drafts cannot be accessed through comment getUrl or attached to comments", async () => {
    const {alice, bob} = setup();
    const imageId = await upload(alice, "consultation");
    await expect(alice.query(api.commentImages.getUrl, {imageId})).rejects.toThrow("FORBIDDEN");
    await expect(alice.mutation(api.comments.add, {pathname, body: "", imageIds: [imageId]})).rejects.toThrow("FORBIDDEN");
    expect((await bob.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(403);
    expect((await alice.fetch(file(imageId), {headers: {Origin: origin}})).status).toBe(200);
  });

  test("unused uploads expire, but attached files remain", async () => {
    vi.useFakeTimers();
    const {t, alice} = setup();
    const unused = await upload(alice);
    const attached = await upload(alice);
    await alice.mutation(api.comments.add, {pathname, body: "", imageIds: [attached]});
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    await t.mutation(internal.commentImages.expireUpload, {imageId: unused});
    await t.mutation(internal.commentImages.expireUpload, {imageId: attached});
    expect(await t.run(ctx => ctx.db.get("commentImages", unused))).toBeNull();
    expect(await t.run(ctx => ctx.db.get("commentImages", attached))).not.toBeNull();
  });
});
