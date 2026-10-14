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
