import type { Card } from "./api";
// UTC date-only arithmetic avoids 23/25-hour days around daylight-saving changes.
export const dateNumber = (value: string) =>
  Date.parse(value + "T00:00:00Z") / 86400000;
export const shiftDate = (value: string, days: number) =>
  new Date((dateNumber(value) + days) * 86400000).toISOString().slice(0, 10);
export function cardRange(
  card: Pick<Card, "start_date" | "due_date">,
  fallback: string,
) {
  const start = card.start_date || card.due_date || fallback;
  return { start, end: card.due_date || card.start_date || fallback };
}
export function editRange(
  start: string,
  end: string,
  mode: "move" | "start" | "end",
  delta: number,
) {
  if (mode === "move")
    return { start: shiftDate(start, delta), end: shiftDate(end, delta) };
  if (mode === "start")
    return {
      start: shiftDate(
        start,
        Math.min(delta, dateNumber(end) - dateNumber(start)),
      ),
      end,
    };
  return {
    start,
    end: shiftDate(end, Math.max(delta, dateNumber(start) - dateNumber(end))),
  };
}
export function placeCard(
  cards: Card[],
  card: Card,
  list: string,
  before?: string,
) {
  const remaining = cards.filter((c) => c.name !== card.name);
  const rows = remaining.filter((c) => c.list_id === list);
  const index = before ? rows.findIndex((c) => c.name === before) : rows.length;
  rows.splice(index < 0 ? rows.length : index, 0, { ...card, list_id: list });
  const positions = new Map(rows.map((c, i) => [c.name, i * 1024]));
  return [
    ...remaining.filter((c) => c.list_id !== list),
    ...rows.map((c) => ({ ...c, position: positions.get(c.name)! })),
  ].sort((a, b) => a.position - b.position);
}

// Inclusive date ranges: cards ending and starting on the same day overlap.
export function packCards(cards: Card[], fallback: string): Card[][] {
  const rows: Card[][] = [];
  for (const card of [...cards].sort((a, b) => {
    const ar = cardRange(a, fallback),
      br = cardRange(b, fallback);
    return (
      ar.start.localeCompare(br.start) ||
      ar.end.localeCompare(br.end) ||
      a.position - b.position ||
      a.name.localeCompare(b.name)
    );
  })) {
    const start = cardRange(card, fallback).start;
    const row = rows.find(
      (row) => cardRange(row[row.length - 1], fallback).end < start,
    );
    if (row) row.push(card);
    else rows.push([card]);
  }
  return rows;
}
