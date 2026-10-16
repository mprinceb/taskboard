import test from "node:test";
import assert from "node:assert/strict";
import { taskChecklistProgress } from "./cardrefs";
test("task progress combines ordinary items and live linked tasks, ignoring code and invalid references", () => {
  const text = "- [x] Done item\n- [ ] Pending item\n- [ ] #[abcdef]\n- [x] #[badbad]\n\n```\n- [x] Sample\n```";
  assert.deepEqual(taskChecklistProgress(text, (id) => id === "abcdef", (id) => id === "abcdef"), { done: 2, total: 3 });
});
test("nested ordinary checklist items are counted once", () => {
  assert.deepEqual(taskChecklistProgress("- [ ] Parent\n  - [x] Child", () => false), {done: 1, total: 2});
});
