import { shiftDate } from "./planning";
export type DateRange = { start: string; due: string };
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "0100-01-01" &&
    value <= "9999-12-31" &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function rangeError({ start, due }: DateRange): string {
  if ((start && !validDate(start)) || (due && !validDate(due)))
    return "Use a valid date in YYYY-MM-DD format.";
  return start && due && due < start
    ? "Due date must be on or after the start date."
    : "";
}
export function monthShift(day: string, delta: number): string {
  const date = new Date(day + "T00:00:00Z");
  const wanted = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(wanted, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function monthDays(month: string): string[] {
  const first = month.slice(0, 7) + "-01";
  const weekday = new Date(first + "T00:00:00Z").getUTCDay();
  return Array.from({ length: 42 }, (_, i) => {
    const day = shiftDate(first, i - weekday);
    return validDate(day) ? day : "";
  });
}
export function chooseDate(
  range: DateRange,
  edge: "start" | "due",
  day: string,
): DateRange {
  if (edge === "start")
    return { start: day, due: range.due && range.due < day ? "" : range.due };
  return { ...range, due: day };
}
