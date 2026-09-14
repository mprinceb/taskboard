import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  GripVertical,
  Check,
} from "lucide-react";
import type { Card, Column } from "./api";
import {
  cardRange,
  dateNumber,
  editRange,
  shiftDate,
  packCards,
} from "./planning";
export type NewCardSeed = {
  before?: string;
  list_id?: string;
  start_date?: string;
  due_date?: string;
  title?: string;
};
type Props = {
  cards: Card[];
  lists: Column[];
  busy: boolean;
  open: (id: string) => void;
  create: (seed: NewCardSeed) => void;
  save: (card: Card, patch: Partial<Card>) => Promise<void>;
  interaction: (active: boolean) => void;
};
type Gesture = {
  kind: "create" | "move" | "start" | "end" | "schedule";
  card?: Card;
  list: string;
  start: string;
  end: string;
  x: number;
  y: number;
  day: number;
  moved: boolean;
  pointer: number;
  capture: HTMLElement;
};
type Preview = { list: string; start: string; end: string; valid: boolean };
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const label = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
export function Timeline(p: Props) {
  const [scale, setScale] = useState(14),
    [anchor, setAnchor] = useState(localToday()),
    [preview, setPreview] = useState<Preview | null>(null),
    [active, setActive] = useState<Gesture | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]),
    [status, setStatus] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    dateHead = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    previewRef = useRef<Preview | null>(null),
    lastPoint = useRef({ x: 0, y: 0 }),
    suppress = useRef(false);
  const weekday = new Date(anchor + "T12:00:00").getDay();
  const start = shiftDate(anchor, -((weekday + 6) % 7));
  const dates = Array.from({ length: scale }, (_, i) => shiftDate(start, i));
  const dayAt = (x: number) => {
    const r = dateHead.current!.getBoundingClientRect();
    return Math.floor((x - r.left) / (r.width / scale));
  };
  const setDraft = (value: Preview) => {
    previewRef.current = value;
    setPreview(value);
  };
  const update = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    lastPoint.current = { x, y };
    if (Math.abs(x - g.x) + Math.abs(y - g.y) > 5) g.moved = true;
    const r = scroll.current!.getBoundingClientRect();
    const target = document
      .elementsFromPoint(x, y)
      .map((e) => e.closest<HTMLElement>("[data-timeline-list]"))
      .find(Boolean);
    const valid =
      !!target &&
      x >= Math.max(dateHead.current!.getBoundingClientRect().left, r.left) &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom;
    let list = g.list,
      range = { start: g.start, end: g.end };
    if (g.kind === "create") {
      const offset = Math.max(0, Math.min(scale - 1, dayAt(x)));
      const d = shiftDate(start, offset);
      range = {
        start: d < g.start ? d : g.start,
        end: d > g.start ? d : g.start,
      };
    } else if (g.kind === "schedule") {
      const d = shiftDate(start, dayAt(x));
      range = { start: d, end: d };
      list = target?.dataset.timelineList || g.list;
    } else {
      range = editRange(g.start, g.end, g.kind, dayAt(x) - g.day);
      if (g.kind === "move") list = target?.dataset.timelineList || g.list;
    }
    setDraft({ ...range, list, valid });
  };
  const begin = (
    e: ReactPointerEvent<HTMLElement>,
    kind: Gesture["kind"],
    list: string,
    card?: Card,
  ) => {
    if (p.busy || gesture.current || e.button !== 0) return;
    e.stopPropagation();
    const range = card
      ? cardRange(card, start)
      : {
          start: shiftDate(
            start,
            Math.max(0, Math.min(scale - 1, dayAt(e.clientX))),
          ),
          end: "",
        };
    if (!range.end) range.end = range.start;
    const g: Gesture = {
      kind,
      card,
      list,
      ...range,
      x: e.clientX,
      y: e.clientY,
      day: dayAt(e.clientX),
      moved: false,
      pointer: e.pointerId,
      capture: e.currentTarget,
    };
    gesture.current = g;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(g);
    p.interaction(true);
    setDraft({ ...range, list, valid: kind !== "schedule" });
  };
  const cancel = () => {
    const g = gesture.current;
    gesture.current = null;
    previewRef.current = null;
    setActive(null);
    setPreview(null);
    if (g?.capture.hasPointerCapture(g.pointer))
      g.capture.releasePointerCapture(g.pointer);
    p.interaction(false);
  };
  const finish = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointer) return;
    update(e.clientX, e.clientY);
    const draft = previewRef.current;
    suppress.current = g.moved;
    setTimeout(() => {
      suppress.current = false;
    }, 180);
    cancel();
    if (!draft?.valid) return;
    if (g.kind === "create") {
      p.create({
        list_id: g.list,
        start_date: draft.start,
        due_date: draft.end,
      });
      return;
    }
    if (!g.moved) return;
    if (
      g.card &&
      (g.kind === "schedule" ||
        draft.start !== g.start ||
        draft.end !== g.end ||
        draft.list !== g.list)
    ) {
      // Moving a due-only card preserves its missing start date. Resizing creates an explicit range.
      const start_date =
        g.kind === "move" && !g.card.start_date ? null : draft.start;
      void p.save(g.card, {
        list_id: draft.list,
        start_date,
        due_date: draft.end,
      });
      setStatus(
        `${g.card.title}: ${label(draft.start)} to ${label(draft.end)}`,
      );
    }
  };
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        suppress.current = true;
        cancel();
        setTimeout(() => {
          suppress.current = false;
        }, 180);
      }
    };
    const blur = () => cancel();
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    let frame = 0;
    const tick = () => {
      const el = scroll.current;
      if (el && gesture.current?.moved) {
        const r = el.getBoundingClientRect(),
          { x, y } = lastPoint.current;
        if (y > r.top && y < r.bottom) {
          const dx =
            x > r.right - 45
              ? 12
              : x <
                  Math.max(
                    r.left,
                    dateHead.current!.getBoundingClientRect().left,
                  ) +
                    35
                ? -12
                : 0;
          const dy = y > r.bottom - 40 ? 10 : y < r.top + 65 ? -10 : 0;
          const before = el.scrollLeft,
            top = el.scrollTop;
          el.scrollBy(dx, dy);
          if (before !== el.scrollLeft || top !== el.scrollTop) update(x, y);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [!!active]);
  useEffect(
    () => () => {
      p.interaction(false);
    },
    [],
  );
  const barStyle = (a: string, b: string) => {
    const left = Math.max(0, dateNumber(a) - dateNumber(start)),
      right = Math.min(scale, dateNumber(b) - dateNumber(start) + 1);
    return right > left
      ? {
          left: `${(left / scale) * 100}%`,
          width: `${((right - left) / scale) * 100}%`,
        }
      : null;
  };
  const keyMove = (
    e: React.KeyboardEvent,
    card: Card,
    mode: "move" | "start" | "end",
  ) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key) || p.busy) return;
    e.preventDefault();
    e.stopPropagation();
    const r = cardRange(card, start),
      n = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1),
      next = editRange(r.start, r.end, mode, n);
    void p.save(card, {
      start_date: mode === "move" && !card.start_date ? null : next.start,
      due_date: next.end,
    });
    setStatus(`${card.title}: ${label(next.start)} to ${label(next.end)}`);
  };
  const unscheduled = p.cards.filter((c) => !c.start_date && !c.due_date);
  return (
    <main
      className={
        "timeline-wrap interactive-timeline" +
        (active ? " timeline-dragging" : "")
      }
      onPointerMove={(e) => {
        if (gesture.current && e.pointerId === gesture.current.pointer)
          update(e.clientX, e.clientY);
      }}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      <div className="timeline-tools">
        <h2>
          {new Date(anchor + "T12:00:00").toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <button
          aria-label="Previous period"
          disabled={!!active}
          onClick={() => setAnchor(shiftDate(anchor, -scale))}
        >
          <ChevronLeft size={18} />
        </button>
        <button disabled={!!active} onClick={() => setAnchor(localToday())}>
          Today
        </button>
        <button
          aria-label="Next period"
          disabled={!!active}
          onClick={() => setAnchor(shiftDate(anchor, scale))}
        >
          <ChevronRight size={18} />
        </button>
        <button
          className="primary timeline-create"
          disabled={p.busy || !p.lists.length}
          onClick={() =>
            p.create({
              list_id: p.lists[0]?.name,
              start_date: anchor,
              due_date: anchor,
            })
          }
        >
          <Plus size={15} />
          Add card
        </button>
        <select
          aria-label="Timeline scale"
          value={scale}
          disabled={!!active}
          onChange={(e) => setScale(+e.target.value)}
        >
          <option value={7}>Week</option>
          <option value={14}>Two weeks</option>
          <option value={31}>Month</option>
        </select>
      </div>
      <div className="timeline-hint">
        Drag cards to reschedule · Drag either edge to resize · Select empty
        dates to create a card
      </div>
      <div className="sr-only" aria-live="polite">
        {status}
      </div>
      {preview && active?.moved && (
        <div className="schedule-feedback" role="status">
          {preview.valid
            ? `${label(preview.start)} – ${label(preview.end)} · ${p.lists.find((l) => l.name === preview.list)?.title}`
            : "Move onto a timeline lane"}
          {p.busy ? " · Saving…" : ""}
        </div>
      )}
      <div ref={scroll} className="timeline-scroll">
        <div
          className="timeline-grid"
          style={{
            minWidth: `calc(var(--timeline-sidebar) + ${scale * 56}px)`,
          }}
        >
          <div className="timeline-head">
            <div>Cards by list</div>
            <div
              ref={dateHead}
              className="date-grid"
              style={{ gridTemplateColumns: `repeat(${scale},1fr)` }}
            >
              {dates.map((d) => (
                <span
                  key={d}
                  className={
                    (d === localToday() ? "today " : "") +
                    ([0, 6].includes(new Date(d + "T12:00:00").getDay())
                      ? "weekend"
                      : "")
                  }
                >
                  <small>
                    {new Date(d + "T12:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </small>
                  {+d.slice(-2)}
                </span>
              ))}
            </div>
          </div>
          {p.lists.map((list) => {
            const all = p.cards.filter(
              (c) => c.list_id === list.name && (c.start_date || c.due_date),
            );
            const visible = all.filter((c) => {
              const r = cardRange(c, start);
              return r.end >= start && r.start <= dates[scale - 1];
            });
            const packed = packCards(visible, start),
              folded = collapsed.includes(list.name),
              outside = all.length - visible.length;
            return (
              <section
                key={list.name}
                data-timeline-list={list.name}
                className={
                  "timeline-lane-group" +
                  (preview?.valid && preview.list === list.name
                    ? " timeline-drop-lane"
                    : "")
                }
              >
                <div className="timeline-list-label">
                  <button
                    className="lane-toggle"
                    aria-label={(folded ? "Expand " : "Collapse ") + list.title}
                    onClick={() =>
                      setCollapsed(
                        folded
                          ? collapsed.filter((x) => x !== list.name)
                          : [...collapsed, list.name],
                      )
                    }
                  >
                    {folded ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronLeft size={14} className="expanded-chevron" />
                    )}
                    <strong>{list.title}</strong>
                    <span>{all.length}</span>
                  </button>
                  <button
                    className="icon"
                    aria-label={"Add card to " + list.title}
                    onClick={() =>
                      p.create({
                        list_id: list.name,
                        start_date: anchor,
                        due_date: anchor,
                      })
                    }
                    disabled={p.busy}
                  >
                    <Plus size={15} />
                  </button>
                  {outside > 0 && (
                    <button
                      className="outside-period"
                      onClick={() => {
                        const c = all.find((c) => !visible.includes(c));
                        if (c) setAnchor(cardRange(c, start).start);
                      }}
                    >
                      {outside} outside this period →
                    </button>
                  )}
                </div>
                <div className="timeline-lane-content">
                  {!folded && (
                    <>
                      {packed.map((row, index) => (
                        <div
                          className="timeline-packed-row timeline-track"
                          key={index}
                          style={{ backgroundSize: `${100 / scale}% 100%` }}
                          onPointerDown={(e) => {
                            if (e.target === e.currentTarget)
                              begin(e, "create", list.name);
                          }}
                        >
                          {row.map((c) => {
                            const original = cardRange(c, start),
                              changing =
                                active?.card?.name === c.name && preview?.valid;
                            const range =
                              changing && preview?.list === c.list_id
                                ? preview
                                : original;
                            const style = barStyle(range.start, range.end);
                            if (!style) return null;
                            return (
                              <div
                                key={c.name}
                                className={
                                  "timeline-bar " +
                                  (c.completed
                                    ? "done"
                                    : c.due_date && c.due_date < localToday()
                                      ? "overdue"
                                      : "") +
                                  (changing ? " adjusting" : "")
                                }
                                style={style}
                              >
                                {original.start >= start && (
                                  <button
                                    className="range-handle start-handle"
                                    aria-label={"Resize start of " + c.title}
                                    data-tooltip="Drag start date · Left/Right arrow to adjust"
                                    disabled={p.busy}
                                    onPointerDown={(e) =>
                                      begin(e, "start", list.name, c)
                                    }
                                    onKeyDown={(e) => keyMove(e, c, "start")}
                                  />
                                )}
                                <button
                                  className="range-body"
                                  aria-label={"Schedule " + c.title}
                                  data-tooltip={`${c.title}: ${label(range.start)} – ${label(range.end)}. Drag to move; arrow keys move one day, Shift moves one week.`}
                                  disabled={p.busy}
                                  onPointerDown={(e) =>
                                    begin(e, "move", list.name, c)
                                  }
                                  onKeyDown={(e) => keyMove(e, c, "move")}
                                  onClick={() => {
                                    if (!suppress.current) p.open(c.name);
                                  }}
                                >
                                  {c.title}
                                </button>
                                {original.end <= dates[scale - 1] && (
                                  <button
                                    className="range-handle end-handle"
                                    aria-label={"Resize due date of " + c.title}
                                    data-tooltip="Drag due date · Left/Right arrow to adjust"
                                    disabled={p.busy}
                                    onPointerDown={(e) =>
                                      begin(e, "end", list.name, c)
                                    }
                                    onKeyDown={(e) => keyMove(e, c, "end")}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div
                        className="timeline-track timeline-create-track"
                        role="button"
                        tabIndex={0}
                        aria-label={
                          "Select dates for a new card in " + list.title
                        }
                        style={{ backgroundSize: `${100 / scale}% 100%` }}
                        onPointerDown={(e) => begin(e, "create", list.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            p.create({
                              list_id: list.name,
                              start_date: anchor,
                              due_date: anchor,
                            });
                          }
                        }}
                      >
                        <span className="lane-create-hint">
                          <Plus size={13} />
                          Select dates to add a card
                        </span>
                        {preview?.valid &&
                          preview.list === list.name &&
                          barStyle(preview.start, preview.end) && (
                            <div
                              className="timeline-range-preview"
                              style={barStyle(preview.start, preview.end)!}
                            >
                              {active?.card?.title || "New card"}
                            </div>
                          )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <section className="unscheduled">
        <h3>
          Unscheduled <span>{unscheduled.length}</span>
          <small>Drag onto a date, or schedule for today</small>
        </h3>
        <div>
          {unscheduled.map((c) => (
            <div className="unscheduled-item" key={c.name}>
              <button
                className="unscheduled-drag"
                disabled={p.busy}
                onPointerDown={(e) => begin(e, "schedule", c.list_id, c)}
                onClick={() => {
                  if (!suppress.current) p.open(c.name);
                }}
                data-tooltip="Drag onto the timeline"
              >
                <GripVertical size={14} />
                {c.title}
              </button>
              <button
                className="icon"
                disabled={p.busy}
                aria-label={"Schedule " + c.title + " for today"}
                data-tooltip="Schedule for today"
                onClick={() => {
                  setAnchor(localToday());
                  void p.save(c, {
                    start_date: localToday(),
                    due_date: localToday(),
                  });
                }}
              >
                <CalendarDays size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
