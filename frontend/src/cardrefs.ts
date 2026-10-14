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

/** Apply `fn` to the parts of `text` outside fenced blocks and inline code spans. */
export function mapOutsideCode(
  text: string,
  fn: (plain: string) => string,
): string {
  let fence = "";
  return text
    .split("\n")
    .map((line) => {
      const m = FENCE_RE.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length)
          fence = "";
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
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
  let fence = "";
  return (text || "")
    .split("\n")
    .map((line) => {
      const m = FENCE_RE.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length)
          fence = "";
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
      return fn(line, parseChecklistLine(line));
    })
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
