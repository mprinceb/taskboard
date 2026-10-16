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
