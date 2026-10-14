// Pure helpers for `#[card_name]` card references. No React or DOM here.
export const REF_SOURCE = "#\\[([a-z0-9]{6,20})\\]";
const REF_RE = () => new RegExp(REF_SOURCE, "g");
const CHECK_RE = new RegExp(
  "^(\\s*[-*+]\\s+)\\[([ xX])\\](\\s+)" + REF_SOURCE + "\\s*$",
);
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

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

const LIST_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const INDENT_RE = /^(?: {4,}|\t)/;

/**
 * Which lines are Markdown code (fenced blocks including their fences, and
 * indented code blocks). An indented line is code only after a blank line or
 * another code line and outside a list, where it is list continuation.
 */
export function codeLineMask(lines: string[]): boolean[] {
  let fence = "",
    prevBlank = true,
    inIndented = false,
    inList = false;
  return lines.map((line) => {
    const m = FENCE_RE.exec(line);
    if (fence) {
      if (
        m &&
        m[1][0] === fence[0] &&
        m[1].length >= fence.length &&
        !line.slice(m[0].length).trim()
      ) {
        fence = "";
        prevBlank = true;
      }
      return true;
    }
    if (m) {
      fence = m[1];
      inIndented = false;
      prevBlank = false;
      return true;
    }
    const blank = !line.trim();
    const indented = !blank && INDENT_RE.test(line);
    let code = false;
    if (indented && (prevBlank || inIndented) && !inList) {
      code = true;
      inIndented = true;
    } else if (!blank) {
      inIndented = false;
      if (!indented) inList = LIST_RE.test(line);
    }
    prevBlank = blank;
    return code;
  });
}

/** Apply `fn` to the parts of `text` outside code blocks and inline code spans. */
export function mapOutsideCode(
  text: string,
  fn: (plain: string) => string,
): string {
  const lines = text.split("\n");
  const mask = codeLineMask(lines);
  return lines
    .map((line, i) => {
      if (mask[i]) return line;
      let out = "",
        last = 0;
      for (const code of line.matchAll(INLINE_CODE_RE)) {
        out += fn(line.slice(last, code.index)) + code[0];
        last = code.index! + code[0].length;
      }
      return out + fn(line.slice(last));
    })
    .join("\n");
}

/** Distinct referenced card ids in order of first appearance, ignoring code. */
export function extractIds(text: string): string[] {
  const seen = new Set<string>();
  mapOutsideCode(text || "", (plain) => {
    for (const m of plain.matchAll(REF_RE())) seen.add(m[1]);
    return plain;
  });
  return [...seen];
}

export const CARDREF_PROTOCOL = "cardref:";

/** Rewrite `#[id]` outside code into `[#id](cardref:id)` links for the renderer. */
export function linkifyRefs(text: string): string {
  return mapOutsideCode(text, (plain) =>
    plain.replace(REF_RE(), (_, id) => `[#${id}](${CARDREF_PROTOCOL}${id})`),
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
): { done: number; total: number } {
  let done = 0,
    total = 0;
  eachChecklist(text, (line, item) => {
    if (item) {
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
