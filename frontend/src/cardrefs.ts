// Pure helpers for `#[card_name]` card references. No React or DOM here.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export const REF_SOURCE = "#\\[([a-z0-9]{6,20})\\]";
const REF_RE = () => new RegExp(REF_SOURCE, "g");
const CHECK_RE = new RegExp(
  "^(\\s*[-*+]\\s+)\\[([ xX])\\](\\s+)" + REF_SOURCE + "\\s*$",
);

export type CardRef = {
  name: string;
  title: string;
  list_id: string;
  list_title: string;
  is_done: boolean;
  completed: boolean;
  archived: boolean;
  exists: boolean;
};
export type Backlink = {
  name: string;
  title: string;
  list_title: string;
  source: "description" | "comment";
  archived: boolean;
};

// "What is code / prose" is decided by the same parser the renderer uses
// (react-markdown + remark-gfm), never re-derived by hand.
type MdNode = {
  type: string;
  children?: MdNode[];
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
};
const parseMarkdown = (text: string): MdNode =>
  fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as unknown as MdNode;

// Text inside these is link text / alt text, not a place for card references.
const NO_REFS_INSIDE = new Set([
  "link",
  "linkReference",
  "image",
  "imageReference",
]);

/** Which lines belong to a code block (fenced or indented). */
export function codeLineMask(lines: string[]): boolean[] {
  const mask = lines.map(() => false);
  const walk = (n: MdNode) => {
    if (n.type === "code" && n.position)
      for (let l = n.position.start.line; l <= n.position.end.line; l++)
        mask[l - 1] = true;
    n.children?.forEach(walk);
  };
  walk(parseMarkdown(lines.join("\n")));
  return mask;
}

/**
 * Apply `fn` to the source of each prose text run in `text` (not code blocks,
 * inline code, raw HTML or link text) and leave everything else untouched.
 */
export function mapOutsideCode(
  text: string,
  fn: (plain: string) => string,
): string {
  const runs: [number, number][] = [];
  const walk = (n: MdNode, blocked: boolean) => {
    if (n.type === "text" && !blocked && n.position)
      runs.push([n.position.start.offset!, n.position.end.offset!]);
    const next = blocked || NO_REFS_INSIDE.has(n.type);
    n.children?.forEach((c) => walk(c, next));
  };
  walk(parseMarkdown(text), false);
  runs.sort((x, y) => x[0] - y[0]);
  let out = "",
    last = 0;
  for (const [start, end] of runs) {
    if (start < last) continue;
    out += text.slice(last, start) + fn(text.slice(start, end));
    last = end;
  }
  return out + text.slice(last);
}

/** True when the char at `idx` is backslash-escaped (odd run of backslashes). */
function isEscaped(text: string, idx: number): boolean {
  let n = 0;
  while (idx - 1 - n >= 0 && text[idx - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

/** Distinct referenced card ids in order of first appearance, ignoring code
 * and backslash-escaped tokens (`\#[id]` is literal text). */
export function extractIds(text: string): string[] {
  const seen = new Set<string>();
  mapOutsideCode(text || "", (plain) => {
    for (const m of plain.matchAll(REF_RE()))
      if (!isEscaped(plain, m.index!)) seen.add(m[1]);
    return plain;
  });
  return [...seen];
}

export const CARDREF_PROTOCOL = "cardref:";

/** Rewrite `#[id]` outside code into `[#id](cardref:id)` links for the renderer. */
export function linkifyRefs(text: string): string {
  return mapOutsideCode(text, (plain) =>
    plain.replace(REF_RE(), (match, id, offset) =>
      isEscaped(plain, offset)
        ? match
        : `[#${id}](${CARDREF_PROTOCOL}${id})`,
    ),
  );
}

export type ChecklistLine = { id: string; checked: boolean };
/** Parse `- [ ] #[id]` / `- [x] #[id]` (whole line); null otherwise. */
export function parseChecklistLine(line: string): ChecklistLine | null {
  const m = CHECK_RE.exec(line);
  return m ? { id: m[4], checked: m[2] !== " " } : null;
}

type Done = (id: string) => boolean;
function eachChecklist(
  text: string,
  fn: (line: string, item: ChecklistLine | null) => string,
): string {
  const lines = (text || "").split("\n");
  const mask = codeLineMask(lines);
  return lines
    .map((line, i) => (mask[i] ? line : fn(line, parseChecklistLine(line))))
    .join("\n");
}

/** Make the literal [ ]/[x] of checklist reference lines reflect `isDone`. */
export function syncChecklist(text: string, isDone: Done): string {
  return eachChecklist(text, (line, item) =>
    item ? line.replace(/\[[ xX]\]/, isDone(item.id) ? "[x]" : "[ ]") : line,
  );
}

/** Checklist progress over reference-only checklist lines (distinct per line). */
export function checklistProgress(
  text: string,
  isDone: Done,
  known?: (id: string) => boolean,
): { done: number; total: number } {
  let done = 0,
    total = 0;
  eachChecklist(text, (line, item) => {
    // Tokens that never named a card (typos) are not part of the progress.
    if (item && (!known || known(item.id))) {
      total++;
      if (isDone(item.id)) done++;
    }
    return line;
  });
  return { done, total };
}

/** Build a done-predicate from the detail payload's references. */
export function doneFromRefs(refs: CardRef[]): Done {
  const by = new Map(refs.map((r) => [r.name, r]));
  return (id) => {
    const r = by.get(id);
    return !!r && r.exists && r.is_done;
  };
}
