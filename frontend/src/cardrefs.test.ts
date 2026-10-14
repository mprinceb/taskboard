import test from "node:test";
import assert from "node:assert/strict";
import {
  extractIds,
  linkifyRefs,
  mapOutsideCode,
  parseChecklistLine,
  syncChecklist,
  checklistProgress,
  doneFromRefs,
  CardRef,
} from "./cardrefs";

const ref = (name: string, o: Partial<CardRef> = {}): CardRef => ({
  name,
  title: name,
  list_id: "l1",
  list_title: "Todo",
  is_done: false,
  completed: false,
  archived: false,
  exists: true,
  ...o,
});

test("extractIds finds distinct ids and ignores invalid ones", () => {
  const t =
    "a #[gbbhu7th7n] b #[gbbhu7th7n] #[abc12] #[UPPER12345] #[ok1234567]";
  assert.deepEqual(extractIds(t), ["gbbhu7th7n", "ok1234567"]);
  assert.deepEqual(extractIds(""), []);
});

test("code spans and fenced blocks are not transformed", () => {
  const t =
    "`#[gbbhu7th7n]` and #[aaaaaa1111]\n```\n#[bbbbbb2222]\n```\n``x `#[cccccc3333]` y``\n~~~\n#[dddddd4444]\n~~~\n#[eeeeee5555]";
  assert.deepEqual(extractIds(t), ["aaaaaa1111", "eeeeee5555"]);
  const out = linkifyRefs(t);
  assert.ok(out.includes("`#[gbbhu7th7n]`"));
  assert.ok(out.includes("[#aaaaaa1111](cardref:aaaaaa1111)"));
  assert.ok(out.includes("\n#[bbbbbb2222]\n"));
  assert.ok(out.includes("[#eeeeee5555](cardref:eeeeee5555)"));
});

test("mapOutsideCode keeps an unclosed fence open to the end", () => {
  assert.equal(
    mapOutsideCode("a\n```\nb\nc", (s) => s.toUpperCase()),
    "A\n```\nb\nc",
  );
});

test("parseChecklistLine", () => {
  assert.deepEqual(parseChecklistLine("- [ ] #[gbbhu7th7n]"), {
    id: "gbbhu7th7n",
    checked: false,
  });
  assert.deepEqual(parseChecklistLine("  * [x] #[gbbhu7th7n]  "), {
    id: "gbbhu7th7n",
    checked: true,
  });
  assert.equal(parseChecklistLine("- [ ] do #[gbbhu7th7n]"), null);
  assert.equal(parseChecklistLine("- #[gbbhu7th7n]"), null);
  assert.equal(parseChecklistLine("- [ ] #[short]"), null);
});

test("syncChecklist and progress reflect referenced cards, not literals", () => {
  const text =
    "- [x] #[aaaaaa1111]\n- [ ] #[bbbbbb2222]\n- [ ] #[cccccc3333]\n- [ ] plain\n```\n- [ ] #[dddddd4444]\n```";
  const done = doneFromRefs([
    ref("aaaaaa1111"),
    ref("bbbbbb2222", { is_done: true }),
    ref("cccccc3333", { is_done: true, exists: false }),
  ]);
  assert.equal(
    syncChecklist(text, done),
    "- [ ] #[aaaaaa1111]\n- [x] #[bbbbbb2222]\n- [ ] #[cccccc3333]\n- [ ] plain\n```\n- [ ] #[dddddd4444]\n```",
  );
  assert.deepEqual(checklistProgress(text, done), { done: 1, total: 3 });
  assert.deepEqual(checklistProgress("no list", done), { done: 0, total: 0 });
});

test("a fence is only closed by a clean closing line", () => {
  const text = "~~~\n#[aaa111]\n~~~ trailing\n#[bbb222]\n~~~\n#[ccc333]";
  assert.deepEqual(extractIds(text), ["ccc333"]);
});

test("indented code is ignored but list continuation is not", () => {
  const text =
    "para\n\n    #[aaa111]\n\n- item\n\n    #[bbb222]\n\nafter #[ccc333]";
  assert.deepEqual(extractIds(text), ["bbb222", "ccc333"]);
  assert.deepEqual(extractIds("    #[ddd444]"), []);
});

test("multiline code spans are ignored but do not cross blocks", () => {
  assert.deepEqual(extractIds("`example\n#[aaa111]\ntext` and #[bbb222]"), [
    "bbb222",
  ]);
  assert.deepEqual(extractIds("- a `x\n- b y` #[ccc333]"), ["ccc333"]);
  assert.deepEqual(extractIds("`x\n\n#[ddd444]\n\ny`"), ["ddd444"]);
});

test("escaped tokens are literal; list context survives blank lines", () => {
  assert.deepEqual(extractIds("\\#[aaa111] #[bbb222]"), ["bbb222"]);
  assert.deepEqual(extractIds("\\\\#[ccc333]"), ["ccc333"]);
  assert.equal(linkifyRefs("\\#[aaa111]"), "\\#[aaa111]");
  assert.deepEqual(extractIds("- item\n\n\n    #[ddd444]"), ["ddd444"]);
});

test("fences nested in quotes and lists are code", () => {
  assert.deepEqual(extractIds("> ```\n> #[aaa111]\n> ```\n#[bbb222]"), [
    "bbb222",
  ]);
  assert.deepEqual(extractIds("- ```\n  #[ccc333]\n  ```\n#[ddd444]"), [
    "ddd444",
  ]);
  assert.deepEqual(extractIds("> ```\n> #[eee555]\n\n#[fff666]"), ["fff666"]);
});

test("checklist progress ignores tokens that never named a card", () => {
  const text = "- [ ] #[aaa111]\n- [ ] #[typo999]";
  assert.deepEqual(
    checklistProgress(
      text,
      () => false,
      (id) => id === "aaa111",
    ),
    { done: 0, total: 1 },
  );
});
