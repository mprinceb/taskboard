import test from "node:test";
import assert from "node:assert/strict";
import {
  validDate,
  rangeError,
  monthShift,
  monthDays,
  chooseDate,
} from "./calendar";
test("date input rejects impossible dates and accepts leap days", () => {
  for (const date of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    "not-a-date",
  ])
    assert.equal(validDate(date), false, date);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(rangeError({ start: "", due: "" }), "");
  assert.equal(rangeError({ start: "", due: "2026-09-18" }), "");
  assert.equal(rangeError({ start: "2026-09-18", due: "" }), "");
  assert.match(
    rangeError({ start: "2026-09-19", due: "2026-09-18" }),
    /on or after/,
  );
});
test("calendar navigation clamps month ends and crosses years", () => {
  assert.equal(monthShift("2026-01-31", 1), "2026-02-28");
  assert.equal(monthShift("2028-01-31", 1), "2028-02-29");
  assert.equal(monthShift("2028-02-29", 12), "2029-02-28");
  assert.equal(monthShift("2026-12-15", 1), "2027-01-15");
  assert.equal(monthShift("2026-01-15", -1), "2025-12-15");
});
test("six-week calendar includes adjacent days and handles supported year limits", () => {
  const september = monthDays("2026-09-01");
  assert.equal(september.length, 42);
  assert.equal(september[0], "2026-08-30");
  assert.equal(september[41], "2026-10-10");
  assert.equal(new Set(september).size, 42);
  for (const month of ["0100-01-01", "9999-12-01"])
    for (const day of monthDays(month)) assert.ok(!day || validDate(day));
});
test("choosing a new start preserves compatible due dates and clears an earlier due date", () => {
  assert.deepEqual(
    chooseDate(
      { start: "2026-09-14", due: "2026-09-18" },
      "start",
      "2026-09-16",
    ),
    { start: "2026-09-16", due: "2026-09-18" },
  );
  assert.deepEqual(
    chooseDate(
      { start: "2026-09-14", due: "2026-09-18" },
      "start",
      "2026-09-20",
    ),
    { start: "2026-09-20", due: "" },
  );
  assert.deepEqual(chooseDate({ start: "", due: "" }, "due", "2026-09-18"), {
    start: "",
    due: "2026-09-18",
  });
});
