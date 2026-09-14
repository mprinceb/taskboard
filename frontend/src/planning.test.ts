import test from "node:test";
import assert from "node:assert/strict";
import {
  dateNumber,
  shiftDate,
  editRange,
  cardRange,
  placeCard,
  packCards,
} from "./planning";
import type { Card } from "./api";
test("date-only movement preserves duration across DST and year boundaries", () => {
  for (const start of ["2026-03-07", "2026-11-01", "2026-12-31"]) {
    const end = shiftDate(start, 3),
      moved = editRange(start, end, "move", 7);
    assert.equal(dateNumber(moved.end) - dateNumber(moved.start), 3);
    assert.equal(dateNumber(moved.start) - dateNumber(start), 7);
  }
  assert.equal(shiftDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});
test("resizing never inverts start and due dates", () => {
  assert.deepEqual(editRange("2026-09-14", "2026-09-17", "start", 10), {
    start: "2026-09-17",
    end: "2026-09-17",
  });
  assert.deepEqual(editRange("2026-09-14", "2026-09-17", "end", -10), {
    start: "2026-09-14",
    end: "2026-09-14",
  });
  assert.deepEqual(editRange("2026-09-14", "2026-09-17", "start", -2), {
    start: "2026-09-12",
    end: "2026-09-17",
  });
});
test("undated and partially dated cards get usable ranges", () => {
  assert.deepEqual(
    cardRange({ start_date: null, due_date: "2026-09-18" }, "2026-09-14"),
    { start: "2026-09-18", end: "2026-09-18" },
  );
  assert.deepEqual(
    cardRange({ start_date: "2026-09-18", due_date: null }, "2026-09-14"),
    { start: "2026-09-18", end: "2026-09-18" },
  );
  assert.deepEqual(
    cardRange({ start_date: null, due_date: null }, "2026-09-14"),
    { start: "2026-09-14", end: "2026-09-14" },
  );
});
const c = (name: string, list_id: string, position: number) =>
  ({ name, list_id, position }) as Card;
test("drop positions support moving down, up, empty lists and appending", () => {
  const cards = [
    c("a", "one", 0),
    c("b", "one", 1024),
    c("c", "one", 2048),
    c("x", "two", 0),
  ];
  const names = (xs: Card[], list = "one") =>
    xs.filter((c) => c.list_id === list).map((c) => c.name);
  assert.deepEqual(names(placeCard(cards, cards[0], "one", "c")), [
    "b",
    "a",
    "c",
  ]);
  assert.deepEqual(names(placeCard(cards, cards[2], "one", "a")), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(names(placeCard(cards, cards[0], "two"), "two"), ["x", "a"]);
  assert.deepEqual(names(placeCard(cards, cards[0], "empty"), "empty"), ["a"]);
  assert.equal(cards[0].list_id, "one");
});

test("compact lanes share non-overlapping ranges and stack overlaps", () => {
  const items = [
    ["a", "2026-09-14", "2026-09-16"],
    ["b", "2026-09-17", "2026-09-19"],
    ["c", "2026-09-16", "2026-09-18"],
    ["d", "2026-09-20", "2026-09-20"],
  ].map(([name, start_date, due_date], i) => ({
    ...c(name, "one", i),
    start_date,
    due_date,
  }));
  const rows = packCards(items, "2026-09-14");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows[0].map((c) => c.name),
    ["a", "b", "d"],
  );
  assert.deepEqual(
    rows[1].map((c) => c.name),
    ["c"],
  );
  for (const row of rows)
    for (let i = 1; i < row.length; i++)
      assert.ok(cardRange(row[i - 1], "").end < cardRange(row[i], "").start);
  assert.deepEqual(
    items.map((c) => c.name),
    ["a", "b", "c", "d"],
  );
});
