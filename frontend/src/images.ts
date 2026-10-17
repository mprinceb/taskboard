// Pure helpers for rendering images. SVG is deliberately excluded (the server
// also rejects SVG uploads); only raster formats are previewed inline.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name || "");

// Only the site's own file paths or https URLs may be loaded as images.
export function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (/^\/(private\/)?files\/[^\\]+$/.test(u) && !u.includes("..")) return u;
  if (/^https:\/\/[^\s\\]+$/i.test(u)) return u;
  return null;
}

const PASTE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

// Raster image files on the clipboard; anything else keeps default paste.
export function pastedImages(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files || []).filter((f) => f.type in PASTE_EXT);
}

// pasted-YYYYMMDD-HHMMSS[-n].ext (local time); n disambiguates a multi-paste.
export function pastedImageName(
  type: string,
  when: Date,
  index = 0,
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
    `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  return `pasted-${stamp}${index ? "-" + (index + 1) : ""}.${PASTE_EXT[type] || "png"}`;
}

export function imageMarkdown(url: string): string {
  return `![](${url.replace(/ /g, "%20").replace(/\)/g, "%29")})`;
}

// Insert `snippet` over the selection, padded onto its own line when needed.
export function insertSnippet(
  text: string,
  start: number,
  end: number,
  snippet: string,
): { text: string; cursor: number } {
  const before = text.slice(0, start),
    after = text.slice(end);
  const pre = before && !before.endsWith("\n") ? "\n" : "";
  const post = after && !after.startsWith("\n") ? "\n" : "";
  const out = before + pre + snippet + post + after;
  return { text: out, cursor: (before + pre + snippet).length };
}

// ---- Clipboard reading -------------------------------------------------
// Minimal shape of a DataTransfer so the logic is testable without a DOM.
export type ClipboardLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsFile(): File | null;
  }> | null;
  types?: ArrayLike<string> | null;
  getData?(format: string): string;
};

// Chrome may expose a pasted image through `files`, through `items`
// (kind "file") or both (the same image twice). Prefer `files`, fall back to
// `items`. An untyped file is kept as a candidate: its bytes are sniffed later.
export function clipboardImageCandidates(dt: ClipboardLike | null | undefined): File[] {
  if (!dt) return [];
  const usable = (f: File | null | undefined): f is File =>
    !!f && (f.type in PASTE_EXT || f.type === "");
  const fromFiles = Array.from(dt.files || []).filter(usable);
  if (fromFiles.length) return fromFiles;
  const out: File[] = [];
  for (const it of Array.from(dt.items || []))
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (usable(f)) out.push(f);
    }
  return out;
}

// Identify a raster image from its first bytes (null when not an image).
export function sniffImageType(b: Uint8Array): string | null {
  const at = (i: number, s: string) =>
    [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF8")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(0, "BM")) return "image/bmp";
  if (at(4, "ftypavif")) return "image/avif";
  return null;
}

// A paste that looks like an image but carries no readable image file, e.g.
// only `<img src="blob:...">` HTML. Returns a user-facing reason or null.
export function clipboardImageProblem(dt: ClipboardLike | null | undefined): string | null {
  if (!dt) return null;
  const types = Array.from(dt.types || []);
  if (types.includes("text/plain")) return null;
  if (clipboardImageCandidates(dt).length) return null;
  const hasFile = Array.from(dt.items || []).some((i) => i.kind === "file");
  const html = types.includes("text/html") ? dt.getData?.("text/html") || "" : "";
  if (hasFile || /<img[\s>]/i.test(html))
    return "That clipboard image could not be read. Save the image and attach it with the paperclip instead.";
  return null;
}
