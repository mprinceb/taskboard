import test from "node:test";
import assert from "node:assert/strict";
import { isImageName, safeImageSrc } from "./images";

test("safeImageSrc allows site files and https only", () => {
  assert.equal(safeImageSrc("/files/a b.png"), "/files/a b.png");
  assert.equal(safeImageSrc("/private/files/a.png"), "/private/files/a.png");
  assert.equal(safeImageSrc("https://x.org/a.png"), "https://x.org/a.png");
  for (const bad of [
    "http://x.org/a.png",
    "//evil.com/files/a.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,AAAA",
    "/api/method/x",
    "/files/../app/x",
    "/files",
    "",
    undefined,
  ])
    assert.equal(safeImageSrc(bad), null, String(bad));
});

test("isImageName matches raster images only", () => {
  assert.ok(isImageName("Photo.JPG"));
  assert.ok(isImageName("a.webp"));
  assert.ok(!isImageName("a.svg"));
  assert.ok(!isImageName("a.pdf"));
});

import {
  imageMarkdown,
  insertSnippet,
  pastedImageName,
  pastedImages,
} from "./images";

test("pasted image helpers", () => {
  const d = new Date(2026, 0, 5, 7, 8, 9);
  assert.equal(pastedImageName("image/png", d), "pasted-20260105-070809.png");
  assert.equal(pastedImageName("image/jpeg", d, 1), "pasted-20260105-070809-2.jpg");
  const f = (type: string) => ({ type }) as File;
  assert.equal(
    pastedImages([f("image/png"), f("text/plain"), f("image/svg+xml")]).length,
    1,
  );
  assert.equal(pastedImages(null).length, 0);
  assert.equal(imageMarkdown("/private/files/a b.png"), "![](/private/files/a%20b.png)");
});

test("insertSnippet places images on their own line", () => {
  assert.deepEqual(insertSnippet("", 0, 0, "X"), { text: "X", cursor: 1 });
  assert.equal(insertSnippet("ab", 2, 2, "X").text, "ab\nX");
  assert.equal(insertSnippet("ab\n", 3, 3, "X").text, "ab\nX");
  assert.equal(insertSnippet("ab cd", 2, 3, "X").text, "ab\nX\ncd");
});

import {
  clipboardImageCandidates,
  clipboardImageProblem,
  sniffImageType,
} from "./images";

const file = (type: string, name = "image.png") => ({ type, name }) as File;
const item = (kind: string, f: File | null, type = f?.type || "") => ({
  kind,
  type,
  getAsFile: () => f,
});

test("clipboardImageCandidates reads files, then items", () => {
  const png = file("image/png");
  assert.deepEqual(clipboardImageCandidates({ files: [png], items: [item("file", png)] }), [png]);
  // Chrome case: .files empty, image only in items
  assert.deepEqual(clipboardImageCandidates({ files: [], items: [item("string", null, "text/html"), item("file", png)] }), [png]);
  // untyped file is a candidate (bytes sniffed later); non-image files are not
  const untyped = file("");
  assert.deepEqual(clipboardImageCandidates({ files: [untyped, file("application/pdf")] }), [untyped]);
  assert.deepEqual(clipboardImageCandidates({ files: [file("image/svg+xml")] }), []);
  assert.deepEqual(clipboardImageCandidates(null), []);
  assert.deepEqual(clipboardImageCandidates({ items: [item("file", null, "image/png")] }), []);
});

test("sniffImageType identifies raster signatures", () => {
  const b = (...n: number[]) => Uint8Array.from([...n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffImageType(b(0x89, 0x50, 0x4e, 0x47)), "image/png");
  assert.equal(sniffImageType(b(0xff, 0xd8, 0xff)), "image/jpeg");
  assert.equal(sniffImageType(b(0x47, 0x49, 0x46, 0x38)), "image/gif");
  const webp = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))));
  assert.equal(sniffImageType(webp), "image/webp");
  assert.equal(sniffImageType(Uint8Array.from([...("<svg>").split("").map((c) => c.charCodeAt(0))])), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
});

test("clipboardImageProblem flags unreadable image pastes only", () => {
  const html = '<img src="blob:https://web.whatsapp.com/x">';
  const dt = (types: string[], h = "", items: any[] = []) => ({
    types,
    items,
    files: [],
    getData: (t: string) => (t === "text/html" ? h : ""),
  });
  assert.match(clipboardImageProblem(dt(["text/html"], html)) || "", /could not be read/);
  assert.match(clipboardImageProblem(dt(["Files"], "", [item("file", null, "image/heic")])) || "", /could not be read/);
  assert.equal(clipboardImageProblem(dt(["text/plain", "text/html"], html)), null);
  assert.equal(clipboardImageProblem(dt(["text/html"], "<b>hi</b>")), null);
  assert.equal(clipboardImageProblem(dt(["Files"], "", [item("file", file("image/png"))])), null);
  assert.equal(clipboardImageProblem(null), null);
});
