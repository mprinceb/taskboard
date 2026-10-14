// Pure helpers for `#[card_name]` card references. No React or DOM here.
export const REF_SOURCE = "#\\[([a-z0-9]{6,20})\\]";
const REF_RE = () => new RegExp(REF_SOURCE, "g");
const CHECK_RE = new RegExp(
  "^(\\s*[-*+]\\s+)\\[([ xX])\\](\\s+)" + REF_SOURCE + "\\s*$",
);
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

const QUOTE_RE = /^\s{0,3}(?:>\s?)+/;
const LIST_PREFIX_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
type Fence = { marker: string; rest: string; quoted: boolean; nested: boolean };

/**
 * Match a code fence on `line`, including fences nested in a blockquote or a
 * list item (`> ```` / `- ````), where indentation is not limited to 3.
 */
function fenceOf(line: string, inList: boolean): Fence | null {
  const q = QUOTE_RE.exec(line);
  const body = q ? line.slice(q[0].length) : line;
  const loose = !!q || inList;
  let m = (
    loose ? /^\s*(`{3,}|~{3,})(.*)$/ : /^\s{0,3}(`{3,}|~{3,})(.*)$/
  ).exec(body);
  let nested = loose;
  if (!m) {
    const lm = LIST_PREFIX_RE.exec(body);
    if (lm) {
      m = /^(`{3,}|~{3,})(.*)$/.exec(body.slice(lm[0].length));
      nested = true;
    }
  }
  return m ? { marker: m[1], rest: m[2], quoted: !!q, nested } : null;
}

/**
 * Which lines are Markdown code (fenced blocks including their fences, and
 * indented code blocks). An indented line is code only after a blank line or
 * another code line and outside a list, where it is list continuation. A fence
 * opened inside a blockquote ends where the quote does.
 */
export function codeLineMask(lines: string[]): boolean[] {
  let fence = "",
    fenceQuoted = false,
    fenceNested = false,
    prevBlank = true,
    inIndented = false,
    inList = false;
  return lines.map((line) => {
    if (fence && fenceQuoted && !QUOTE_RE.test(line)) {
      fence = "";
      fenceQuoted = false;
      prevBlank = true;
    }
    if (fence) {
      const c = fenceOf(line, fenceNested);
      if (
        c &&
        c.marker[0] === fence[0] &&
        c.marker.length >= fence.length &&
        !c.rest.trim()
      ) {
        fence = "";
        fenceQuoted = false;
        prevBlank = true;
      }
      return true;
    }
    const o = fenceOf(line, inList);
    if (o && !(o.marker[0] === "`" && o.rest.includes("`"))) {
      fence = o.marker;
      fenceQuoted = o.quoted;
      fenceNested = o.nested;
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

// A new block starts here, so an inline code span cannot continue across it.
const BLOCK_START_RE =
  /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s|^\s{0,3}#{1,6}(?:\s|$)|^\s{0,3}>/;

function mapInline(chunk: string, fn: (plain: string) => string): string {
  let out = "",
    last = 0;
  for (const code of chunk.matchAll(INLINE_CODE_RE)) {
    out += fn(chunk.slice(last, code.index)) + code[0];
    last = code.index! + code[0].length;
  }
  return out + fn(chunk.slice(last));
}

/**
 * Apply `fn` to the parts of `text` outside code blocks and inline code spans.
 * Inline spans may cross line breaks within a paragraph (CommonMark), so
 * consecutive plain lines are matched together; blank lines, code lines and
 * new block starts end a paragraph.
 */
export function mapOutsideCode(
  text: string,
  fn: (plain: string) => string,
): string {
  const lines = text.split("\n");
  const mask = codeLineMask(lines);
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) out.push(mapInline(chunk.join("\n"), fn));
    chunk = [];
  };
  lines.forEach((line, i) => {
    if (mask[i] || !line.trim()) {
      flush();
      out.push(line);
      return;
    }
    if (BLOCK_START_RE.test(line)) flush();
    chunk.push(line);
  });
  flush();
  return out.join("\n");
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
