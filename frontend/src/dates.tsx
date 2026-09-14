import { useId, useLayoutEffect, useRef, useState, KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  DateRange,
  chooseDate,
  monthDays,
  monthShift,
  rangeError,
  validDate,
} from "./calendar";
import { shiftDate } from "./planning";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const format = (
  day: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) =>
  new Date(day + "T12:00:00Z").toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
export function DatePicker({
  start,
  due,
  onChange,
  disabled = false,
}: {
  start?: string | null;
  due?: string | null;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label =
    start && due
      ? `${format(start)} – ${format(due)}`
      : due
        ? `Due ${format(due)}`
        : start
          ? `Starts ${format(start)}`
          : "Add dates";
  return (
    <div className="date-picker-field">
      <span>Dates</span>
      <button
        ref={trigger}
        type="button"
        className="date-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Edit dates: ${label}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={16} />
        <span>{label}</span>
      </button>
      {open && (
        <DateEditor
          start={start || ""}
          due={due || ""}
          anchor={trigger.current!}
          close={() => setOpen(false)}
          apply={(range) => {
            onChange(range);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
function DateEditor({
  start,
  due,
  anchor,
  close,
  apply,
}: {
  start: string;
  due: string;
  anchor: HTMLButtonElement;
  close: () => void;
  apply: (range: DateRange) => void;
}) {
  const today = localToday(),
    initial = due || start || today;
  const [range, setRange] = useState<DateRange>({ start, due }),
    [edge, setEdge] = useState<"start" | "due">("due"),
    [month, setMonth] = useState(initial.slice(0, 7) + "-01"),
    [focused, setFocused] = useState(initial),
    [hover, setHover] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    cells = useRef(new Map<string, HTMLButtonElement>()),
    requestFocus = useRef(false);
  const heading = useId(),
    hint = useId();
  const error = rangeError(range),
    days = monthDays(month),
    validStart = validDate(range.start) ? range.start : "",
    validDue = validDate(range.due) ? range.due : "";
  const preview =
    edge === "due" && validStart && !validDue && hover && hover >= validStart
      ? hover
      : validDue;
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0,
        top = viewport?.offsetTop || 0;
      const width = viewport?.width || innerWidth,
        height = viewport?.height || innerHeight;
      el.style.maxHeight = Math.max(100, height - 16) + "px";
      const r = anchor.getBoundingClientRect(),
        w = el.offsetWidth,
        h = el.offsetHeight;
      el.style.left =
        Math.max(left + 8, Math.min(left + width - w - 8, r.left)) + "px";
      el.style.top =
        Math.max(top + 8, Math.min(top + height - h - 8, r.bottom + 8)) + "px";
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(el);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    cells.current.get(initial)?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      el.close();
      anchor.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (requestFocus.current) {
      cells.current.get(focused)?.focus({ preventScroll: true });
      requestFocus.current = false;
    }
  }, [month, focused]);
  const focusDay = (day: string) => {
    if (!validDate(day)) return;
    requestFocus.current = true;
    setMonth(day.slice(0, 7) + "-01");
    setFocused(day);
  };
  const select = (day: string) => {
    requestFocus.current = true;
    setRange((current) => chooseDate(current, edge, day));
    setFocused(day);
    setMonth(day.slice(0, 7) + "-01");
    if (edge === "start") setEdge("due");
    setHover(null);
  };
  const keyboard = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string | undefined;
    const weekday = new Date(day + "T00:00:00Z").getUTCDay();
    switch (e.key) {
      case "ArrowLeft":
        next = shiftDate(day, -1);
        break;
      case "ArrowRight":
        next = shiftDate(day, 1);
        break;
      case "ArrowUp":
        next = shiftDate(day, -7);
        break;
      case "ArrowDown":
        next = shiftDate(day, 7);
        break;
      case "Home":
        next = shiftDate(day, -weekday);
        break;
      case "End":
        next = shiftDate(day, 6 - weekday);
        break;
      case "PageUp":
        next = monthShift(day, e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = monthShift(day, e.shiftKey ? 12 : 1);
        break;
    }
    if (next) {
      e.preventDefault();
      focusDay(next);
    }
  };
  const typeDate = (key: "start" | "due", value: string) => {
    setRange((current) => ({ ...current, [key]: value }));
    if (validDate(value)) {
      setMonth(value.slice(0, 7) + "-01");
      setFocused(value);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="date-popover"
      aria-labelledby={heading}
      aria-describedby={hint}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          ) {
            e.stopPropagation();
            close();
          }
        }
      }}
    >
      <header className="date-popover-header">
        <h3 id={heading}>Dates</h3>
        <button
          type="button"
          className="icon"
          aria-label="Close date picker"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <div className="date-endpoints">
        {(["start", "due"] as const).map((key) => (
          <div
            key={key}
            className={edge === key ? "date-endpoint active" : "date-endpoint"}
          >
            <button
              type="button"
              className="date-endpoint-label"
              aria-pressed={edge === key}
              onClick={() => {
                setEdge(key);
                const date = range[key];
                if (validDate(date)) {
                  setMonth(date.slice(0, 7) + "-01");
                  setFocused(date);
                }
              }}
            >
              {key === "start" ? "Start date" : "Due date"}
            </button>
            <div>
              <input
                aria-label={key === "start" ? "Start date" : "Due date"}
                aria-invalid={!!range[key] && !validDate(range[key])}
                placeholder="YYYY-MM-DD"
                maxLength={10}
                value={range[key]}
                onFocus={() => setEdge(key)}
                onChange={(e) => typeDate(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!error) apply(range);
                  }
                }}
              />
              {range[key] && (
                <button
                  type="button"
                  className="date-clear-one"
                  aria-label={`Clear ${key} date`}
                  onClick={() => {
                    setRange((current) => ({ ...current, [key]: "" }));
                    setEdge(key);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="date-month-nav">
        <button
          type="button"
          className="icon"
          aria-label="Previous month"
          disabled={month <= "0100-01-01"}
          onClick={() => {
            const next = monthShift(month, -1);
            setMonth(next);
            setFocused(next);
          }}
        >
          <ChevronLeft size={18} />
        </button>
        <strong aria-live="polite">
          {format(month, { month: "long", year: "numeric" })}
        </strong>
        <button
          type="button"
          className="icon"
          aria-label="Next month"
          disabled={month >= "9999-12-01"}
          onClick={() => {
            const next = monthShift(month, 1);
            setMonth(next);
            setFocused(next);
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div
        role="grid"
        aria-label={format(month, { month: "long", year: "numeric" })}
        className="date-calendar"
        onMouseLeave={() => setHover(null)}
      >
        <div role="row" className="date-calendar-row date-weekdays">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span role="columnheader" key={day}>
              {day}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div role="row" className="date-calendar-row" key={week}>
            {days.slice(week * 7, week * 7 + 7).map((day, index) => {
              if (!day) return <div role="gridcell" key={"empty" + index} />;
              const selected = day === validStart || day === validDue,
                inRange = !!(
                  validStart &&
                  preview &&
                  day >= validStart &&
                  day <= preview
                ),
                blocked = edge === "due" && !!validStart && day < validStart;
              return (
                <div
                  role="gridcell"
                  key={day}
                  aria-selected={selected}
                  className={inRange ? "date-range-cell" : ""}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) cells.current.set(day, el);
                      else cells.current.delete(day);
                    }}
                    tabIndex={day === focused ? 0 : -1}
                    aria-label={format(day, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                    aria-current={day === today ? "date" : undefined}
                    aria-disabled={blocked}
                    className={
                      "date-day " +
                      (selected ? "selected " : "") +
                      (day.slice(0, 7) !== month.slice(0, 7)
                        ? "outside-month "
                        : "") +
                      (day === today ? "today" : "")
                    }
                    onFocus={() => setFocused(day)}
                    onMouseEnter={() => setHover(day)}
                    onKeyDown={(e) => keyboard(e, day)}
                    onClick={() => {
                      if (!blocked) select(day);
                    }}
                  >
                    {Number(day.slice(-2))}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="date-shortcuts">
        {[
          ["Today", 0],
          ["Tomorrow", 1],
          ["In a week", 7],
        ].map(([label, delta]) => {
          const day = shiftDate(today, Number(delta));
          return (
            <button
              key={label}
              type="button"
              disabled={edge === "due" && !!validStart && day < validStart}
              onClick={() => select(day)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p id={hint} className="date-picker-hint">
        {edge === "start"
          ? "Choose a start date, then a due date."
          : "Choose a due date. Start date is optional."}
      </p>
      <p className="date-picker-hint">Save the card to keep applied changes.</p>
      {error && (
        <p className="date-picker-error" role="alert">
          {error}
        </p>
      )}
      <footer className="date-picker-footer">
        <button
          type="button"
          className="subtle"
          onClick={() => {
            setRange({ start: "", due: "" });
            setHover(null);
            setEdge("due");
          }}
        >
          Clear dates
        </button>
        <button type="button" className="subtle" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!error}
          onClick={() => apply(range)}
        >
          Apply dates
        </button>
      </footer>
    </dialog>
  );
}
