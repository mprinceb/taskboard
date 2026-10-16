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
