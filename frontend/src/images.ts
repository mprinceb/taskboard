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
