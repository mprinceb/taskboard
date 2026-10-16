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
