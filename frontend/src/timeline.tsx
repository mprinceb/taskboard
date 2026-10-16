import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
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
  AlertTriangle,
  Ban,
  X,
  ArrowUpRight,
  UserRound,
  ListChecks,
} from "lucide-react";
import { AssigneeAvatar } from "./assignee-avatar";
import { taskChecklistProgress } from "./cardrefs";
import type { Card, Column, Member } from "./api";
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
  allCards: Card[];
  allLists: Column[];
  lists: Column[];
  busy: boolean;
  members: Member[];
  selected: string | null;
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
  const checklistByCard = useMemo(() => {
    const cards = new Map(p.allCards.map((c) => [c.name, c]));
    const doneLists = new Set(p.allLists.filter((l) => l.is_done).map((l) => l.name));
    return new Map(p.allCards.map((c) => {
      const known = new Set((c.references || []).map((r) => r.name));
      return [c.name, taskChecklistProgress(c.description || "", (id) => {
        const linked = cards.get(id);
        return !!linked && (!!linked.completed || doneLists.has(linked.list_id));
      }, (id) => known.has(id))];
    }));
  }, [p.allCards, p.allLists]);
  const [scale, setScale] = useState(14),
    [anchor, setAnchor] = useState(localToday()),
    [preview, setPreview] = useState<Preview | null>(null),
    [active, setActive] = useState<Gesture | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]),
    [status, setStatus] = useState("");
  const [outsideList, setOutsideList] = useState<{ title: string; cards: Card[] } | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    dateHead = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    previewRef = useRef<Preview | null>(null),
    lastPoint = useRef({ x: 0, y: 0 }),
    suppress = useRef(false);
  const weekday = new Date(anchor + "T12:00:00").getDay();
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Leave ordinary vertical wheels and native horizontal trackpad gestures
      // alone. Only translate Shift+vertical wheel into horizontal movement.
      if (!event.shiftKey || event.ctrlKey || event.metaKey || gesture.current) return;
      if (event.deltaX || !event.deltaY) return;
      if (element.scrollWidth <= element.clientWidth + 1) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element.clientWidth : 1);
      event.preventDefault();
      element.scrollLeft += delta;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const start = shiftDate(anchor, scale === 7 ? -1 : -((weekday + 6) % 7));
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
        <details className="timeline-guide">
          <summary>Guide</summary>
          <div className="timeline-guide-panel">
      <div className="timeline-legend" aria-label="Task status legend">
        <span><AlertTriangle size={13} /> Overdue</span>
        <span><Ban size={13} /> Blocked status</span>
        <span><Check size={13} /> Completed</span>
        <span className="selected-key">Selected / focused</span>
      </div>
      <div className="timeline-hint">
        Drag cards to reschedule · Drag either edge to resize · Select empty
        dates to create a card
      </div>
          </div>
        </details>
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
      {outsideList && (
        <section className="outside-tasks" aria-label={`${outsideList.title} tasks outside range`}>
          <header><h3>{outsideList.title} · {outsideList.cards.length} tasks outside range</h3>
            <button className="icon" aria-label="Close outside-range tasks" onClick={() => setOutsideList(null)}><X size={16} /></button>
          </header>
          <ul>{outsideList.cards.map((c) => <li key={c.name}>
            <button onClick={() => p.open(c.name)}>{c.title}</button>
            <span>{c.start_date || "No start"} – {c.due_date || "No due date"}</span>
            <button onClick={() => { setAnchor(cardRange(c, start).start); setOutsideList(null); setCollapsed(collapsed.filter((id) => id !== c.list_id)); }} aria-label={`Show ${c.title} on timeline`}>Show on timeline <ArrowUpRight size={13} /></button>
          </li>)}</ul>
        </section>
      )}
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
      <div ref={scroll} className="timeline-scroll" tabIndex={0} role="region" aria-label="Scrollable task timeline">
        <div
          className="timeline-grid"
          style={{
            minWidth: `calc(var(--timeline-sidebar) + ${scale * 176}px)`,
          }}
        >
          <div className="timeline-head">
            <div>Status / tasks</div>
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
                style={{ "--lane-accent": list.is_done ? "#6ee7b7" : /blocked/i.test(list.title) ? "#fbbf72" : /review/i.test(list.title) ? "#f9c56b" : /ongoing|progress/i.test(list.title) ? "#bb9bff" : /discussion/i.test(list.title) ? "#f49ac2" : /todo|to do/i.test(list.title) ? "#7fb5ff" : "#8eaccb" } as React.CSSProperties}
                data-timeline-list={list.name}
                className={
                  "timeline-lane-group" +
                  (preview?.valid && preview.list === list.name
                    ? " timeline-drop-lane"
                    : "")
                }
              >
                <div className="timeline-list-label">
                  <div className="timeline-label-controls">
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
                      aria-expanded={outsideList?.title === list.title}
                      onClick={() => setOutsideList({
                        title: list.title,
                        cards: all.filter((c) => !visible.includes(c)),
                      })}
                    >
                      View {outside} tasks outside range <ArrowUpRight size={12} />
                    </button>
                  )}
                  </div>
                </div>
                <div className="timeline-lane-content">
                  <div className="timeline-calendar-shading" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${scale}, 1fr)` }}>
                    {dates.map((d) => <span key={d} className={[
                      [0, 6].includes(new Date(d + "T12:00:00").getDay()) ? "weekend" : "",
                      d === localToday() ? "today-column" : "",
                    ].join(" ")} />)}
                  </div>
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
                            const overdue = !c.completed && !!c.due_date && c.due_date < localToday();
                            const blocked = !c.completed && /\bblocked\b/i.test(list.title);
                            const owners = c.assignees.map((user) => p.members.find((m) => m.user === user)?.full_name || user).join(", ") || "Unassigned";
                            const progress = checklistByCard.get(c.name) || { done: 0, total: 0 };
                            const labels = (c.labels || "").split(",").map((x) => x.trim()).filter(Boolean);
                            const state = c.completed ? "Completed" : blocked ? "Blocked" : overdue ? "Overdue" : "Scheduled";
                            return (
                              <div
                                key={c.name}
                                className={
                                  "timeline-bar " +
                                  (c.completed ? "done" : blocked ? "blocked" : overdue ? "overdue" : "") +
                                  (p.selected === c.name ? " selected" : "") +
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
                                  aria-label={`${c.title} · ${state} · Owner: ${owners} · ${c.start_date || "No start date"} to ${c.due_date || "No due date"}`}
                                  data-tooltip={`${c.title}\nOwner: ${owners}\nStart: ${c.start_date || "Not set"} · Due: ${c.due_date || "Not set"}\nPriority: ${c.priority || "None"} · Labels: ${labels.join(", ") || "None"}${progress.total ? ` · Checklist: ${progress.done}/${progress.total}` : ""}\n${state} · Drag to move; arrow keys adjust dates.`}
                                  disabled={p.busy}
                                  onPointerDown={(e) =>
                                    begin(e, "move", list.name, c)
                                  }
                                  onKeyDown={(e) => keyMove(e, c, "move")}
                                  onClick={() => {
                                    if (!suppress.current) p.open(c.name);
                                  }}
                                >
                                  {c.completed ? <Check className="task-state-icon" size={14} aria-label="Completed" /> : blocked ? <Ban className="task-state-icon" size={14} aria-label="Blocked" /> : overdue ? <AlertTriangle className="task-state-icon" size={14} aria-label="Overdue" /> : null}
                                  <span className="timeline-task-copy">
                                    <span className="timeline-task-title">{c.title}</span>
                                    <span className="timeline-card-footer">
                                      <span className="timeline-task-meta">
                                        {c.due_date && <span className={"timeline-due-chip " + (c.completed ? "complete" : overdue ? "late" : c.due_date === localToday() ? "due-today" : "")}><CalendarDays size={11} />{label(c.due_date)}</span>}
                                        {c.priority && c.priority !== "None" && <span className={`task-priority priority-${c.priority.toLowerCase()}`}>{c.priority}</span>}
                                        {progress.total > 0 && <span className="timeline-checklist" aria-label={`${progress.done} of ${progress.total} checklist items complete`}><ListChecks size={12} />{progress.done}/{progress.total}</span>}
                                        {labels.map((x) => <span className="task-label" key={x}>{x}</span>)}
                                      </span>
                                      <span className="timeline-card-avatars">
                                        {c.assignees.slice(0, 2).map((user) => <AssigneeAvatar key={user} user={user} members={p.members} />)}
                                        {c.assignees.length > 2 && <span className="timeline-assignee-overflow" data-tooltip={c.assignees.slice(2).map((user) => p.members.find((m) => m.user === user)?.full_name || user).join(", ")}>+{c.assignees.length - 2}</span>}
                                        {!c.assignees.length && <span className="timeline-assignee-avatar unassigned" role="img" aria-label="Unassigned" data-tooltip="Unassigned"><UserRound size={13} /></span>}
                                      </span>
                                    </span>
                                  </span>
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
