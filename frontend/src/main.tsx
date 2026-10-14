import React, {
  useState,
  useEffect,
  useRef,
  FormEvent,
  ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CalendarDays,
  Plus,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Users,
  Lock,
  Search,
  Bell,
  Paperclip,
  MessageSquare,
  AlignLeft,
  Clock,
  Check,
  Archive,
  Settings,
  LogOut,
  ArrowLeft,
  Download,
  Trash2,
  GripVertical,
  ExternalLink,
  RefreshCw,
  Mail,
  CheckCircle2,
  Hash,
  ListChecks,
  Link2,
} from "lucide-react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  get,
  auth,
  upload,
  Board,
  Card,
  Column,
  Detail,
  Member,
  Attachment,
  CardRef,
  Backlink,
} from "./api";
import {
  CARDREF_PROTOCOL,
  linkifyRefs,
  syncChecklist,
  checklistProgress,
  doneFromRefs,
  extractIds,
} from "./cardrefs";
import "./style.css";
import { Tooltips } from "./tooltips";
import { DatePicker } from "./dates";
import { BoardView } from "./board";
import { Timeline, NewCardSeed } from "./timeline";
import { placeCard } from "./planning";
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => day(new Date());
const dateLabel = (value: string | null) =>
  value
    ? new Date(value + "T12:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
const fullDate = (value: string) =>
  new Date(value.replace(" ", "T")).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const initials = (s: string) =>
  (s || "?")
    .split(/[ @._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
function Avatar({
  user,
  members = [],
  small = false,
}: {
  user: string;
  members?: Member[];
  small?: boolean;
}) {
  const m = members.find((x) => x.user === user);
  let hash = 0;
  for (const c of user) hash += c.charCodeAt(0);
  return (
    <span
      className={"avatar " + (small ? "small" : "")}
      style={{
        background: ["#e9d5ff", "#bfdbfe", "#fde68a", "#a7f3d0", "#fecdd3"][
          hash % 5
        ],
      }}
      data-tooltip={m?.full_name || user}
    >
      {initials(m?.full_name || user)}
    </span>
  );
}
const normalizeDetail = (d: Detail): Detail => ({
  ...d,
  references: d.references || [],
  backlinks: d.backlinks || [],
});
function CardChip({
  id,
  refs,
  open,
}: {
  id: string;
  refs: Map<string, CardRef>;
  open?: (id: string) => void;
}) {
  const r = refs.get(id);
  if (!r || !r.exists)
    return (
      <span
        className="cardref unavailable"
        data-tooltip="This card was deleted or you do not have access to it"
      >
        <Link2 size={12} aria-hidden="true" />
        <span className="cardref-title">Unavailable card</span>
      </span>
    );
  const state = r.is_done ? "Done" : r.list_title;
  return (
    <button
      type="button"
      className={
        "cardref " + (r.is_done ? "done " : "") + (r.archived ? "archived" : "")
      }
      data-tooltip={`${r.title} · ${r.is_done ? "Done" : r.list_title}${r.archived ? " · Archived" : ""}`}
      aria-label={`Open card ${r.title}, ${state}${r.archived ? ", archived" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open?.(id);
      }}
    >
      {r.is_done ? (
        <Check size={12} aria-hidden="true" />
      ) : (
        <span className="cardref-dot" aria-hidden="true" />
      )}
      <span className="cardref-title">{r.title}</span>
      <span className="cardref-state">{state}</span>
    </button>
  );
}
function Md({
  text,
  refs = [],
  open,
  progress = false,
}: {
  text: string;
  refs?: CardRef[];
  open?: (id: string) => void;
  progress?: boolean;
}) {
  const byId = new Map(refs.map((r) => [r.name, r]));
  const done = doneFromRefs(refs);
  const stats = progress ? checklistProgress(text, done) : null;
  const source = linkifyRefs(syncChecklist(text, done)).replace(
    /@\[([^\]]+)\]/g,
    "@$1",
  );
  return (
    <div className="markdown">
      {stats && stats.total > 0 && (
        <div
          className="checklist-progress"
          role="group"
          aria-label={`${stats.done} of ${stats.total} linked cards done`}
        >
          <span>
            {stats.done}/{stats.total} done
          </span>
          <progress max={stats.total} value={stats.done} aria-hidden="true" />
        </div>
      )}
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith(CARDREF_PROTOCOL) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ children, href, ...props }) =>
            href?.startsWith(CARDREF_PROTOCOL) ? (
              <CardChip
                id={href.slice(CARDREF_PROTOCOL.length)}
                refs={byId}
                open={open}
              />
            ) : (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
          img: () => null,
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
function CardPicker({
  board,
  exclude,
  label,
  compact = false,
  onPick,
}: {
  board: Board;
  exclude: string;
  label: string;
  compact?: boolean;
  onPick: (id: string) => void;
}) {
  const [openPopover, setOpenPopover] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [archived, setArchived] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    button = useRef<HTMLButtonElement>(null),
    uid = useRef("cp" + Math.random().toString(36).slice(2, 8)).current;
  const q = query.trim().toLowerCase();
  const listTitle = (id: string) =>
    board.lists.find((l) => l.name === id)?.title || "";
  const options = board.cards
    .filter(
      (c) =>
        c.name !== exclude &&
        (archived || !c.archived) &&
        (!q ||
          c.title.toLowerCase().includes(q) ||
          listTitle(c.list_id).toLowerCase().includes(q)),
    )
    .slice(0, 50);
  useEffect(() => {
    if (openPopover) input.current?.focus();
  }, [openPopover]);
  useEffect(() => setActive(0), [query, archived]);
  const close = () => {
    setOpenPopover(false);
    setQuery("");
    button.current?.focus();
  };
  const pick = (id: string) => {
    onPick(id);
    close();
  };
  return (
    <span className="card-picker">
      <button
        ref={button}
        type="button"
        className={
          compact ? "subtle picker-button compact" : "subtle picker-button"
        }
        aria-haspopup="listbox"
        aria-expanded={openPopover}
        aria-label={label}
        data-tooltip={label}
        onClick={() => setOpenPopover(!openPopover)}
      >
        <Hash size={13} aria-hidden="true" /> {compact ? "Card" : "Link a card"}
      </button>
      {openPopover && (
        <div
          className="picker-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(Math.min(active + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(active - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (options[active]) pick(options[active].name);
            }
          }}
        >
          <input
            ref={input}
            role="combobox"
            aria-label="Search cards by title"
            aria-expanded="true"
            aria-controls={uid}
            aria-activedescendant={
              options[active] ? `${uid}-${options[active].name}` : undefined
            }
            placeholder="Search cards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul id={uid} role="listbox" aria-label="Cards">
            {options.map((c, i) => (
              <li
                key={c.name}
                id={`${uid}-${c.name}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.name)}
              >
                <span className="picker-title">{c.title}</span>
                <small>{listTitle(c.list_id)}</small>
              </li>
            ))}
            {options.length === 0 && (
              <li className="picker-empty" role="presentation">
                No matching cards
              </li>
            )}
          </ul>
          <label className="picker-archived">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Include archived
          </label>
        </div>
      )}
    </span>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon"
          aria-label="Close dialog"
          data-tooltip="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function App() {
  const [board, setBoard] = useState<Board | null>(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState(""),
    [error, setError] = useState(""),
    [view, setView] = useState<"board" | "timeline">("board"),
    [query, setQuery] = useState(""),
    [assignee, setAssignee] = useState(""),
    [overdue, setOverdue] = useState(false),
    [card, setCard] = useState<string | null>(
      new URLSearchParams(location.search).get("card"),
    ),
    [panel, setPanel] = useState(""),
    [busy, setBusy] = useState(false),
    [inviteToken] = useState(
      new URLSearchParams(location.search).get("invite"),
    );
  const [composer, setComposer] = useState<NewCardSeed | null>(null);
  const mutation = useRef(false),
    interacting = useRef(false),
    generation = useRef(0);
  const setInteraction = (value: boolean) => {
    interacting.current = value;
    generation.current++;
  };
  const [newList, setNewList] = useState(false),
    [newTitle, setNewTitle] = useState("");
  const load = async (silent = false) => {
    if (mutation.current || interacting.current) return;
    const stamp = generation.current;
    try {
      const b = await get<Board>("board");
      if (
        stamp !== generation.current ||
        mutation.current ||
        interacting.current
      )
        return;
      setBoard(b);
      setFatal("");
    } catch (e) {
      if (!silent) setFatal((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!inviteToken) void load();
    else setLoading(false);
  }, []);
  useEffect(() => {
    if (!board) return;
    const t = setInterval(() => void load(true), 15000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [!!board]);
  const act = async (fn: () => Promise<any>) => {
    if (mutation.current) return;
    mutation.current = true;
    generation.current++;
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
      await load(true);
    }
  };
  const createCard = async (data: Record<string, unknown>) => {
    if (mutation.current)
      throw new Error("Please wait for the current change to save.");
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const result = await api<Detail>("save_card", { data }, true);
      const card = {
        ...result.card,
        assignees: result.assignees,
        comment_count: result.comments.length,
        attachment_count: result.attachments.length,
      };
      setBoard((b) =>
        b
          ? {
              ...b,
              cards: placeCard(
                b.cards,
                card,
                card.list_id,
                data.before as string | undefined,
              ),
            }
          : b,
      );
      setQuery("");
      setAssignee("");
      setOverdue(false);
      return card;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const changeCard = async (
    card: Card,
    patch: Partial<Card>,
    before?: string,
    reorder = false,
  ) => {
    if (!board || mutation.current) return;
    const previous = board;
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    const updated = {
      ...card,
      ...patch,
      completed:
        patch.list_id && patch.list_id !== card.list_id
          ? board.lists.find((l) => l.name === patch.list_id)?.is_done || 0
          : (patch.completed ?? card.completed),
    };
    setBoard({
      ...board,
      cards: reorder
        ? placeCard(board.cards, updated, updated.list_id, before)
        : board.cards.map((c) => (c.name === card.name ? updated : c)),
    });
    try {
      let result: Detail;
      if (reorder) {
        await api(
          "move_card",
          {
            name: card.name,
            list_id: updated.list_id,
            before,
            modified: card.modified,
          },
          true,
        );
        result = await get<Detail>("detail", { name: card.name });
      } else
        result = await api<Detail>(
          "save_card",
          { data: { name: card.name, modified: card.modified, ...patch } },
          true,
        );
      setBoard((b) =>
        b
          ? {
              ...b,
              cards: b.cards.map((c) =>
                c.name === card.name
                  ? { ...c, ...result.card, assignees: result.assignees }
                  : c,
              ),
            }
          : b,
      );
    } catch (e) {
      setBoard(previous);
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
      void load(true);
    }
  };
  const reorderLists = async (ids: string[]) => {
    if (!board || mutation.current) return;
    const previous = board;
    setBoard({
      ...board,
      lists: ids
        .map((id) => board.lists.find((l) => l.name === id)!)
        .concat(board.lists.filter((l) => l.archived)),
    });
    await act(async () => {
      try {
        await api("reorder_lists", { names: ids }, true);
      } catch (e) {
        setBoard(previous);
        throw e;
      }
    });
  };
  const openCard = (id: string | null) => {
    setCard(id);
    const u = new URL(location.href);
    if (id) u.searchParams.set("card", id);
    else u.searchParams.delete("card");
    history.replaceState(null, "", u);
  };
  if (inviteToken) return <Invite token={inviteToken} />;
  if (loading)
    return (
      <div className="auth-page">
        <div className="auth-box">
          <Logo />
          <p>Opening your board…</p>
        </div>
      </div>
    );
  if (!board) return <Login reason={fatal} />;
  const visibleLists = board.lists.filter((x) => !x.archived),
    filtered = board.cards.filter(
      (c) =>
        !c.archived &&
        (!query ||
          (c.title + " " + c.description)
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!assignee || c.assignees.includes(assignee)) &&
        (!overdue || (!!c.due_date && c.due_date < today() && !c.completed)),
    );
  return (
    <div className="app">
      <Tooltips />
      <nav className="topbar">
        <Logo />
        <span className="top-divider" />
        <span className="workspace">Your workspace</span>
        <div className="top-right">
          <button
            className="top-icon"
            aria-label="Notifications"
            data-tooltip="Notifications"
            onClick={() => setPanel("notifications")}
          >
            <Bell size={19} />
            {board.notifications.some((n) => !n.seen) && <i />}
          </button>
          <button
            className="profile-button"
            aria-label="Account settings"
            data-tooltip="Account settings"
            onClick={() => setPanel("account")}
          >
            <Avatar user={board.user} members={board.members} />
          </button>
        </div>
      </nav>
      <header className="board-toolbar">
        <div className="board-heading">
          <h1>{board.settings.board_title}</h1>
          <span className="private">
            <Lock size={13} /> Private
          </span>
          <span className="toolbar-divider" />
          <div className="view-tabs">
            <button
              className={view === "board" ? "active" : ""}
              onClick={() => setView("board")}
            >
              <LayoutDashboard size={16} />
              Board
            </button>
            <button
              className={view === "timeline" ? "active" : ""}
              onClick={() => setView("timeline")}
            >
              <CalendarDays size={16} />
              Timeline
            </button>
          </div>
        </div>
        <div className="board-actions">
          <button
            className="primary create-card-button"
            disabled={busy || !visibleLists.length}
            onClick={() => setComposer({ list_id: visibleLists[0]?.name })}
          >
            <Plus size={16} />
            Create card
          </button>
          <div className="avatar-stack">
            {board.members.slice(0, 4).map((m) => (
              <Avatar
                key={m.user}
                user={m.user}
                members={board.members}
                small
              />
            ))}
            {board.members.length > 4 && (
              <span className="member-overflow">
                +{board.members.length - 4}
              </span>
            )}
          </div>
          {board.role === "Admin" && (
            <button
              className="share-button"
              onClick={() => setPanel("members")}
            >
              <Users size={16} />
              Share
            </button>
          )}
          <button
            className="top-icon"
            aria-label="Board menu"
            data-tooltip="Board menu"
            onClick={() => setPanel("menu")}
          >
            <MoreHorizontal size={22} />
          </button>
        </div>
      </header>
      <div className="filterbar">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search cards"
            placeholder="Search cards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="icon"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter by member"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">All members</option>
          <option value={board.user}>Assigned to me</option>
          {board.members
            .filter((m) => m.user !== board.user)
            .map((m) => (
              <option key={m.user} value={m.user}>
                {m.full_name || m.user}
              </option>
            ))}
        </select>
        <button
          className={"filter-chip " + (overdue ? "selected" : "")}
          onClick={() => setOverdue(!overdue)}
        >
          <Clock size={14} />
          Overdue
        </button>
        <span className="card-total">{filtered.length} cards</span>
        {busy && <span className="saving">Saving…</span>}
        <button
          className="top-icon refresh"
          aria-label="Refresh board"
          data-tooltip="Refresh board"
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error && (
        <div className="error-toast" role="alert">
          {error}
          <button
            className="icon"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {view === "board" ? (
        <BoardView
          cards={filtered}
          lists={visibleLists}
          admin={board.role === "Admin"}
          busy={busy}
          open={openCard}
          editList={(id) => setPanel("list:" + id)}
          move={(c, t) => changeCard(c, { list_id: t.list }, t.before, true)}
          reorder={reorderLists}
          interaction={setInteraction}
          face={(c) => <CardFace c={c} members={board.members} board={board} />}
          complete={(c) =>
            void changeCard(c, { completed: c.completed ? 0 : 1 })
          }
          add={(list, before, close) => (
            <AddCard
              list={list}
              before={before}
              close={close}
              create={createCard}
              details={setComposer}
            />
          )}
        >
          {board.role === "Admin" && (
            <div className="new-list">
              {newList ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await api(
                        "save_list",
                        { data: { title: newTitle } },
                        true,
                      );
                      setNewTitle("");
                      setNewList(false);
                    });
                  }}
                >
                  <input
                    autoFocus
                    aria-label="List title"
                    placeholder="Enter list title…"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                  />
                  <div className="inline-actions">
                    <button className="primary" disabled={busy}>
                      Add list
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label="Cancel new list"
                      onClick={() => setNewList(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setNewList(true)}>
                  <Plus size={18} />
                  Add another list
                </button>
              )}
            </div>
          )}
        </BoardView>
      ) : (
        <Timeline
          cards={filtered}
          lists={visibleLists}
          busy={busy}
          open={openCard}
          create={setComposer}
          save={changeCard}
          interaction={setInteraction}
        />
      )}
      {composer && (
        <CardComposer
          seed={composer}
          board={board}
          close={() => setComposer(null)}
          create={createCard}
          open={openCard}
        />
      )}
      {card && (
        <CardModal
          key={card}
          name={card}
          board={board}
          close={() => openCard(null)}
          open={openCard}
          refresh={() => load(true)}
        />
      )}
      {panel === "members" && (
        <MembersModal
          board={board}
          close={() => setPanel("")}
          refresh={() => load(true)}
        />
      )}
      {panel.startsWith("list:") && (
        <ListModal
          list={board.lists.find((l) => l.name === panel.slice(5))!}
          lists={visibleLists}
          close={() => setPanel("")}
          act={act}
        />
      )}
      {panel === "menu" && (
        <Modal title="Board menu" close={() => setPanel("")}>
          <div className="panel-body">
            {board.role === "Admin" && (
              <>
                <button
                  className="menu-row"
                  onClick={() => setPanel("settings")}
                >
                  <Settings size={18} />
                  Board settings
                </button>
                <button
                  className="menu-row"
                  onClick={() => setPanel("members")}
                >
                  <Users size={18} />
                  Members and invitations
                </button>
              </>
            )}
            <button className="menu-row" onClick={() => setPanel("archive")}>
              <Archive size={18} />
              Archived items
            </button>
            <p className="muted">Taskboard · Open source · Built on Frappe</p>
          </div>
        </Modal>
      )}
      {panel === "archive" && (
        <Modal title="Archived items" close={() => setPanel("")}>
          <div className="panel-body archive-list">
            {board.cards
              .filter((c) => c.archived)
              .map((c) => (
                <div key={c.name}>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPanel("");
                      openCard(c.name);
                    }}
                  >
                    {c.title}
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        api(
                          "save_card",
                          {
                            data: {
                              name: c.name,
                              archived: 0,
                              modified: c.modified,
                            },
                          },
                          true,
                        ),
                      )
                    }
                  >
                    Restore
                  </button>
                </div>
              ))}
            {board.lists
              .filter((l) => l.archived)
              .map((l) => (
                <div key={l.name}>
                  <span>List: {l.title}</span>
                  {board.role === "Admin" && (
                    <button
                      onClick={() =>
                        void act(() =>
                          api(
                            "save_list",
                            { data: { name: l.name, archived: 0 } },
                            true,
                          ),
                        )
                      }
                    >
                      Restore list
                    </button>
                  )}
                </div>
              ))}
            {!board.cards.some((c) => c.archived) &&
              !board.lists.some((l) => l.archived) && (
                <p className="muted">No archived items.</p>
              )}
          </div>
        </Modal>
      )}
      {panel === "settings" && (
        <SettingsModal board={board} close={() => setPanel("")} act={act} />
      )}
      {panel === "account" && (
        <Modal title="Your account" close={() => setPanel("")}>
          <div className="panel-body">
            <div className="person">
              <Avatar user={board.user} members={board.members} />
              <span>{board.user}</span>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!!board.email_notifications}
                onChange={(e) =>
                  void act(() =>
                    api(
                      "preferences",
                      { email_notifications: e.target.checked ? 1 : 0 },
                      true,
                    ),
                  )
                }
              />
              Email me about assignments, mentions and due dates
            </label>
            <button
              className="menu-row"
              onClick={() =>
                void auth("logout")
                  .then(() => location.reload())
                  .catch((e) => setError(e.message))
              }
            >
              <LogOut size={18} />
              Sign out
            </button>
          </div>
        </Modal>
      )}
      {panel === "notifications" && (
        <Modal
          title="Notifications"
          close={() => {
            setPanel("");
            void act(() => api("mark_seen", {}, true));
          }}
        >
          <div className="panel-body notice-list">
            {board.notifications.length ? (
              board.notifications.map((n) => (
                <button
                  key={n.name}
                  className={n.seen ? "" : "unread"}
                  onClick={() => {
                    setPanel("");
                    openCard(n.card);
                    void act(() => api("mark_seen", {}, true));
                  }}
                >
                  <span>{n.subject}</span>
                  <small>{fullDate(n.creation)}</small>
                </button>
              ))
            ) : (
              <p className="muted">You're all caught up.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">
        <i />
        <i />
      </span>
      Taskboard
    </div>
  );
}
function Login({ reason }: { reason: string }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <form
        className="auth-box"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await auth("login", { usr: email, pwd: password });
            location.reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Logo />
        <h1>Welcome to your board</h1>
        <p>Sign in with your Frappe account.</p>
        {reason && !reason.includes("access") && (
          <p className="form-error">{reason}</p>
        )}
        <label>
          Email or username
          <input
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <a href="/login#forgot">Forgot password?</a>
        <p className="muted small-text">
          Access is by invitation. Already signed in? Ask your board admin to
          invite your account.
        </p>
      </form>
    </div>
  );
}
function Invite({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  useEffect(() => {
    get("invitation_info", { token })
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="auth-page">
      <div className="auth-box">
        <Logo />
        <h1>{accepted ? "You’re on the board" : "You’re invited"}</h1>
        {accepted ? (
          <>
            <p>Your invitation has been accepted.</p>
            <a className="primary link-button" href="/taskboard">
              Open Taskboard
            </a>
          </>
        ) : (
          <>
            {info && (
              <>
                <p>
                  Join as a {info.role.toLowerCase()} using{" "}
                  <strong>{info.email}</strong>.
                </p>
                {info.existing_user && info.signed_in !== info.email ? (
                  <>
                    <a
                      className="primary link-button"
                      href={
                        "/login?redirect-to=" +
                        encodeURIComponent("/taskboard?invite=" + token)
                      }
                    >
                      Sign in to accept
                    </a>
                  </>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        await api(
                          "accept_invitation",
                          { token, full_name: name, password },
                          true,
                        );
                        setAccepted(true);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {!info.existing_user && (
                      <>
                        <label>
                          Your name
                          <input
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoComplete="name"
                          />
                        </label>
                        <label>
                          Create password
                          <input
                            required
                            minLength={12}
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                          <small>At least 12 characters.</small>
                        </label>
                      </>
                    )}
                    <button className="primary full" disabled={busy}>
                      {busy ? "Joining…" : "Accept invitation"}
                    </button>
                  </form>
                )}
              </>
            )}
            {!info && !error && <p>Checking your invitation…</p>}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
function CardFace({
  c,
  members,
  board,
}: {
  c: Card;
  members: Member[];
  board: Board;
}) {
  // Derived from the description already in the board payload: no extra requests.
  const doneLists = new Set(
    board.lists.filter((l) => l.is_done).map((l) => l.name),
  );
  const cardsById = new Map(board.cards.map((x) => [x.name, x]));
  const check = c.description
    ? checklistProgress(c.description, (id) => {
        const t = cardsById.get(id);
        return !!t && (doneLists.has(t.list_id) || !!t.completed);
      })
    : { done: 0, total: 0 };
  return (
    <>
      <div className="card-title">{c.title}</div>
      <div className="card-meta">
        {c.due_date && (
          <span
            data-tooltip={
              (c.completed
                ? "Completed"
                : "Due " +
                  new Date(c.due_date + "T12:00:00").toLocaleDateString(
                    undefined,
                    {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    },
                  )) +
              (c.due_date < today() && !c.completed ? " · Overdue" : "")
            }
            className={
              "due " +
              (c.completed ? "complete" : c.due_date < today() ? "late" : "")
            }
          >
            <Clock size={12} />
            {c.start_date && c.start_date !== c.due_date
              ? dateLabel(c.start_date) + " – "
              : ""}
            {dateLabel(c.due_date)}
          </span>
        )}
        {c.description && (
          <span data-tooltip="This card has a description">
            <AlignLeft size={14} aria-label="Has description" />
          </span>
        )}
        {check.total > 0 && (
          <span
            data-tooltip={`${check.done} of ${check.total} linked cards done`}
            aria-label={`${check.done} of ${check.total} linked cards done`}
          >
            <ListChecks size={13} />
            {check.done}/{check.total}
          </span>
        )}
        {c.comment_count > 0 && (
          <span
            data-tooltip={`${c.comment_count} ${c.comment_count === 1 ? "comment" : "comments"}`}
            aria-label={`${c.comment_count} comments`}
          >
            <MessageSquare size={13} />
            {c.comment_count}
          </span>
        )}
        {c.attachment_count > 0 && (
          <span
            data-tooltip={`${c.attachment_count} ${c.attachment_count === 1 ? "attachment" : "attachments"}`}
            aria-label={`${c.attachment_count} attachments`}
          >
            <Paperclip size={13} />
            {c.attachment_count}
          </span>
        )}
        <div className="card-avatars">
          {c.assignees.slice(0, 3).map((u) => (
            <Avatar key={u} user={u} members={members} small />
          ))}
        </div>
      </div>
    </>
  );
}
function AddCard({
  list,
  before,
  close,
  create,
  details,
}: {
  list: Column;
  before?: string;
  close?: () => void;
  create: (data: Record<string, unknown>) => Promise<Card>;
  details: (seed: NewCardSeed) => void;
}) {
  const [editing, setEditing] = useState(!!before),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null),
    saving = useRef(false);
  const submit = async () => {
    if (!title.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await create({ title: title.trim(), list_id: list.name, before });
      setTitle("");
      requestAnimationFrame(() => {
        field.current?.focus();
        const stack = field.current
          ?.closest(".column")
          ?.querySelector(".card-stack");
        if (stack && !before) stack.scrollTop = stack.scrollHeight;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return editing ? (
    <form
      className="add-card-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={field}
        autoFocus
        required
        maxLength={500}
        aria-label={"New card in " + list.title}
        placeholder="What needs to be done?"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            close?.();
          }
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <button className="primary" disabled={busy || !title.trim()}>
          {busy ? "Adding…" : "Add card"}
        </button>
        <button
          type="button"
          className="subtle"
          disabled={busy}
          onClick={() => {
            details({ list_id: list.name, title, before });
            setEditing(false);
            close?.();
          }}
        >
          Details
        </button>
        <button
          className="icon"
          type="button"
          disabled={busy}
          aria-label="Cancel card"
          onClick={() => {
            setEditing(false);
            close?.();
          }}
        >
          <X size={19} />
        </button>
      </div>
      <small className="quick-add-hint">
        Enter to add · Shift + Enter for a new line
      </small>
    </form>
  ) : (
    <button className="add-card" onClick={() => setEditing(true)}>
      <Plus size={17} />
      Add a card
    </button>
  );
}
function CardComposer({
  seed,
  board,
  close,
  create,
  open,
}: {
  seed: NewCardSeed;
  board: Board;
  close: () => void;
  create: (data: Record<string, unknown>) => Promise<Card>;
  open: (id: string) => void;
}) {
  const [title, setTitle] = useState(seed.title || ""),
    [list, setList] = useState(
      seed.list_id || board.lists.find((l) => !l.archived)?.name || "",
    ),
    [start, setStart] = useState(seed.start_date || ""),
    [due, setDue] = useState(seed.due_date || ""),
    [description, setDescription] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [openAfter, setOpenAfter] = useState(false);
  const saving = useRef(false);
  const safeClose = () => {
    if (busy) return;
    if (
      (title !== (seed.title || "") || description) &&
      !window.confirm("Discard this card draft?")
    )
      return;
    close();
  };
  return (
    <Modal title="Create card" close={safeClose}>
      <form
        className="panel-body card-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving.current || !title.trim()) return;
          if (start && due && due < start) {
            setError("Due date must be on or after the start date.");
            return;
          }
          saving.current = true;
          setBusy(true);
          setError("");
          try {
            const c = await create({
              title: title.trim(),
              list_id: list,
              before: list === seed.list_id ? seed.before : undefined,
              start_date: start || null,
              due_date: due || null,
              description,
              assignees: selected,
            });
            close();
            if (openAfter) open(c.name);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            saving.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          Card title
          <textarea
            autoFocus
            aria-label="New card title"
            placeholder="What needs to be done?"
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <div className="composer-properties">
          <label>
            List
            <select
              value={list}
              onChange={(e) => setList(e.target.value)}
              required
            >
              {board.lists
                .filter((l) => !l.archived)
                .map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.title}
                  </option>
                ))}
            </select>
          </label>
          <DatePicker
            start={start}
            due={due}
            disabled={busy}
            onChange={(range) => {
              setStart(range.start);
              setDue(range.due);
            }}
          />
        </div>
        <label>
          Description
          <textarea
            value={description}
            placeholder="Add context, links, or a checklist…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="section-heading">
          <h3>Members</h3>
        </div>
        <div className="assignee-picker">
          {board.members.map((m) => (
            <button
              type="button"
              key={m.user}
              aria-pressed={selected.includes(m.user)}
              className={
                "member-pill " + (selected.includes(m.user) ? "chosen" : "")
              }
              onClick={() =>
                setSelected(
                  selected.includes(m.user)
                    ? selected.filter((u) => u !== m.user)
                    : [...selected, m.user],
                )
              }
            >
              <Avatar user={m.user} members={board.members} small />
              {m.full_name}
              {selected.includes(m.user) && <Check size={13} />}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={openAfter}
            onChange={(e) => setOpenAfter(e.target.checked)}
          />
          Open card after creating to add files and comments
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-footer">
          <span className="muted">Ctrl / ⌘ + Enter to create</span>
          <button type="button" onClick={safeClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !title.trim() || !list}>
            {busy ? "Creating…" : "Create card"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CardModal({
  name,
  board,
  close,
  open,
  refresh,
}: {
  name: string;
  board: Board;
  close: () => void;
  open: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [draft, setDraft] = useState<any>({}),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [comment, setComment] = useState(""),
    [commentId, setCommentId] = useState<string | undefined>(),
    [commentFiles, setCommentFiles] = useState<File[]>([]),
    [progress, setProgress] = useState<number | null>(null),
    [dirty, setDirty] = useState(false);
  const completing = useRef(false);
  const load = async () => {
    const d = normalizeDetail(await get<Detail>("detail", { name }));
    setData(d);
    setDraft(d.card);
    setSelected(d.assignees);
    setDirty(false);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [name]);
  const run = async (fn: () => Promise<any>, reload = true) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (reload) await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (key: string, value: any) => {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
  };
  const uploadFiles = async (files: File[], id?: string) => {
    for (const file of files) {
      if (file.size > board.settings.max_upload_mb * 1024 * 1024)
        throw new Error(
          `${file.name} exceeds the ${board.settings.max_upload_mb} MB limit.`,
        );
      setProgress(0);
      try {
        await upload(name, file, id, setProgress);
      } finally {
        setProgress(null);
      }
    }
  };
  const toggleComplete = async () => {
    if (!data || busy || completing.current) return;
    completing.current = true;
    const previous = data;
    const completed = data.card.completed ? 0 : 1;
    setBusy(true);
    setError("");
    // Give immediate feedback without replacing unsaved fields or comment drafts.
    setData({ ...data, card: { ...data.card, completed } });
    setDraft((current: any) => ({ ...current, completed }));
    try {
      const d = await api<Detail>(
        "save_card",
        {
          data: {
            name,
            modified: data.card.modified,
            completed,
          },
        },
        true,
      );
      setData(d);
      setDraft((current: any) => ({
        ...current,
        completed: d.card.completed,
        modified: d.card.modified,
      }));
    } catch (e) {
      setData(previous);
      setDraft((current: any) => ({
        ...current,
        completed: previous.card.completed,
      }));
      setError((e as Error).message);
      return;
    } finally {
      completing.current = false;
      setBusy(false);
    }
    // A failed board refresh must not undo an already persisted completion.
    await refresh().catch((e: Error) => setError(e.message));
  };
  const goto = (id: string) => {
    if (id === name) return;
    if (dirty || comment || commentFiles.length) {
      if (!window.confirm("Discard your unsaved changes?")) return;
    }
    open(id);
  };
  // Live board state wins for cards still on the board (renames, moves,
  // completion and archiving show immediately, and freshly inserted unsaved
  // references resolve). A target missing from the board is deleted or
  // inaccessible, so show the server entry as unavailable.
  const refsFor = (text: string): CardRef[] => {
    const known = new Map((data?.references || []).map((r) => [r.name, r]));
    return extractIds(text || "").flatMap((id): CardRef[] => {
      const c = board.cards.find((x) => x.name === id);
      if (c) {
        const l = board.lists.find((x) => x.name === c.list_id);
        return [
          {
            name: c.name,
            title: c.title,
            list_id: c.list_id,
            list_title: l?.title || "",
            is_done: !!l?.is_done || !!c.completed,
            completed: !!c.completed,
            archived: !!c.archived,
            exists: true,
          },
        ];
      }
      const r = known.get(id);
      return r ? [{ ...r, exists: false }] : [];
    });
  };
  // Backlinks are derived from the live board's per-card references so adds,
  // removals, renames, moves and deletions show while the modal is open. If the
  // board payload carries no references (older server), fall back to the detail
  // payload reconciled with the board.
  const liveBacklinks: Backlink[] = (() => {
    const listTitle = (id: string) =>
      board.lists.find((x) => x.name === id)?.title || "";
    let items: Backlink[];
    if (board.cards.some((c) => Array.isArray(c.references))) {
      items = board.cards
        .filter(
          (c) =>
            c.name !== name && c.references?.some((r) => r.name === name),
        )
        .map((c) => ({
          name: c.name,
          title: c.title,
          list_title: listTitle(c.list_id),
          source: extractIds(c.description || "").includes(name)
            ? ("description" as const)
            : ("comment" as const),
          archived: !!c.archived,
        }));
    } else {
      items = (data?.backlinks || []).flatMap((b: Backlink): Backlink[] => {
        const c = board.cards.find((x) => x.name === b.name);
        if (!c) return [];
        return [
          {
            ...b,
            title: c.title,
            list_title: listTitle(c.list_id) || b.list_title,
            archived: !!c.archived,
          },
        ];
      });
    }
    const active = items.filter((i) => !i.archived);
    return active.length ? active : items;
  })();
  const safeClose = () => {
    if (dirty || comment || commentFiles.length) {
      if (!window.confirm("Discard your unsaved changes?")) return;
    }
    close();
  };
  return (
    <Modal
      title={data ? "Card details" : "Opening card…"}
      close={safeClose}
      wide
    >
      {error && (
        <div className="form-error card-error" role="alert">
          {error}
          {error.includes("changed") && (
            <button onClick={() => void load()}>Reload latest card</button>
          )}
        </div>
      )}
      {data && (
        <>
          <div className="card-modal-title">
            <button
              className={
                "detail-complete-control " +
                (data.card.completed ? "is-complete" : "")
              }
              aria-label={
                data.card.completed
                  ? "Mark card incomplete"
                  : "Mark card complete"
              }
              aria-pressed={!!data.card.completed}
              data-tooltip={
                data.card.completed ? "Mark incomplete" : "Mark complete"
              }
              disabled={busy}
              onClick={() => void toggleComplete()}
            >
              <Check size={17} aria-hidden="true" />
            </button>
            <div>
              <input
                aria-label="Card title"
                value={draft.title}
                onChange={(e) => change("title", e.target.value)}
              />
              <p>
                in list{" "}
                <strong>
                  {board.lists.find((l) => l.name === draft.list_id)?.title}
                </strong>
                {!!data.card.archived && (
                  <span className="archive-badge">Archived</span>
                )}
              </p>
            </div>
          </div>
          <div className="card-modal-grid">
            <div className="card-main">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const d = await api<Detail>(
                      "save_card",
                      { data: { ...draft, assignees: selected } },
                      true,
                    );
                    setData(d);
                    setDraft(d.card);
                    setDirty(false);
                    setEditing(false);
                  });
                }}
              >
                <div className="card-properties">
                  <label>
                    List
                    <select
                      value={draft.list_id}
                      onChange={(e) => change("list_id", e.target.value)}
                    >
                      {board.lists
                        .filter((l) => !l.archived)
                        .map((l) => (
                          <option key={l.name} value={l.name}>
                            {l.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <DatePicker
                    start={draft.start_date}
                    due={draft.due_date}
                    disabled={busy}
                    onChange={(range) => {
                      setDraft((current: any) => ({
                        ...current,
                        start_date: range.start || null,
                        due_date: range.due || null,
                      }));
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="section-heading">
                  <Users size={18} />
                  <h3>Members</h3>
                </div>
                <div className="assignee-picker">
                  {board.members.map((m) => (
                    <button
                      type="button"
                      key={m.user}
                      className={
                        "member-pill " +
                        (selected.includes(m.user) ? "chosen" : "")
                      }
                      onClick={() => {
                        setSelected(
                          selected.includes(m.user)
                            ? selected.filter((u) => u !== m.user)
                            : [...selected, m.user],
                        );
                        setDirty(true);
                      }}
                    >
                      <Avatar user={m.user} members={board.members} small />
                      {m.full_name || m.user}
                      {selected.includes(m.user) && <Check size={13} />}
                    </button>
                  ))}
                  {board.members.length === 0 && (
                    <p className="muted">Invite your team to assign cards.</p>
                  )}
                </div>
                <div className="section-heading">
                  <AlignLeft size={19} />
                  <h3>Description</h3>
                  <button
                    className="subtle"
                    type="button"
                    onClick={() => setEditing(!editing)}
                  >
                    {editing ? "Preview" : "Edit"}
                  </button>
                </div>
                {editing ? (
                  <>
                    <textarea
                      className="description-editor"
                      aria-label="Card description"
                      value={draft.description || ""}
                      onChange={(e) => change("description", e.target.value)}
                      placeholder="What needs to be done?"
                    />
                    <small className="muted">
                      Markdown supported: **bold**, lists and links.
                    </small>
                    <select
                      aria-label="Mention in description"
                      value=""
                      onChange={(e) =>
                        change(
                          "description",
                          (draft.description || "") + ` @[${e.target.value}] `,
                        )
                      }
                    >
                      <option value="">@ Mention a member</option>
                      {board.members.map((m) => (
                        <option key={m.user} value={m.user}>
                          {m.full_name || m.user}
                        </option>
                      ))}
                    </select>
                    <CardPicker
                      board={board}
                      exclude={name}
                      label="# Link a card"
                      onPick={(id) =>
                        change(
                          "description",
                          (draft.description || "") + ` #[${id}] `,
                        )
                      }
                    />
                  </>
                ) : (
                  <div
                    className={
                      "description " + (!draft.description ? "placeholder" : "")
                    }
                    onClick={() => setEditing(true)}
                  >
                    {draft.description ? (
                      <Md
                        text={draft.description}
                        refs={refsFor(draft.description)}
                        open={goto}
                        progress
                      />
                    ) : (
                      <button type="button">
                        Add a more detailed description…
                      </button>
                    )}
                  </div>
                )}
                {dirty && (
                  <div className="save-strip">
                    <span>Unsaved changes</span>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => void load()}
                    >
                      Discard
                    </button>
                    <button className="primary" disabled={busy}>
                      Save changes
                    </button>
                  </div>
                )}
              </form>
              {liveBacklinks.length > 0 && (
                <section className="backlinks" aria-label="Mentioned in">
                  <div className="section-heading">
                    <Link2 size={18} />
                    <h3>Mentioned in</h3>
                  </div>
                  <ul>
                    {liveBacklinks.map((b: Backlink) => (
                      <li key={b.name}>
                        <button
                          type="button"
                          className={
                            "backlink " + (b.archived ? "archived" : "")
                          }
                          aria-label={`Open card ${b.title}, in ${b.list_title}, mentioned in ${b.source}`}
                          onClick={() => goto(b.name)}
                        >
                          <span className="picker-title">{b.title}</span>
                          <small>
                            {b.list_title} · {b.source}
                            {b.archived ? " · archived" : ""}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="section-heading">
                <Paperclip size={18} />
                <h3>Attachments</h3>
                <label className="subtle upload-label">
                  Add
                  <input
                    type="file"
                    multiple
                    aria-label="Upload card attachments"
                    disabled={busy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      void run(() => uploadFiles(files), false).then(() => {
                        void get<Detail>("detail", { name }).then((d) =>
                          setData(d),
                        );
                      });
                    }}
                  />
                </label>
              </div>
              <p className="attachment-help">
                Files up to {board.settings.max_upload_mb} MB · Download to open
              </p>
              {progress !== null && (
                <div className="upload-progress">
                  <progress max={100} value={progress} />
                  <span>Uploading {progress}%</span>
                </div>
              )}
              <div className="attachments">
                {data.attachments.map((f) => (
                  <FileRow
                    key={f.name}
                    file={f}
                    canRemove={f.owner === board.user || board.role === "Admin"}
                    remove={() =>
                      void run(
                        () => api("remove_attachment", { name: f.name }, true),
                        false,
                      ).then(
                        () =>
                          void get<Detail>("detail", { name }).then(setData),
                      )
                    }
                  />
                ))}
                {!data.attachments.length && (
                  <p className="empty-files">
                    Keep supporting documents, screenshots and videos here.
                  </p>
                )}
              </div>
              <div className="card-bottom">
                <span className="muted">{name}</span>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api(
                        "save_card",
                        {
                          data: {
                            name,
                            archived: data.card.archived ? 0 : 1,
                            modified: data.card.modified,
                          },
                        },
                        true,
                      ),
                    )
                  }
                >
                  <Archive size={15} />
                  {data.card.archived ? "Restore card" : "Archive card"}
                </button>
              </div>
            </div>
            <aside className="discussion">
              <div className="section-heading">
                <MessageSquare size={18} />
                <h3>Comments</h3>
                <span className="count">{data.comments.length}</span>
              </div>
              <form
                className="comment-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const id = await api<string>(
                      "save_comment",
                      { card: name, content: comment, name: commentId },
                      true,
                    );
                    setCommentId(id);
                    await uploadFiles(commentFiles, id);
                    setComment("");
                    setCommentId(undefined);
                    setCommentFiles([]);
                  }, false).then(
                    () => void get<Detail>("detail", { name }).then(setData),
                  );
                }}
              >
                <textarea
                  aria-label="Write a comment"
                  placeholder="Write a comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                />
                <div className="comment-controls">
                  <select
                    aria-label="Mention a member"
                    value=""
                    onChange={(e) =>
                      setComment(comment + ` @[${e.target.value}] `)
                    }
                  >
                    <option value="">@ Mention</option>
                    {board.members.map((m) => (
                      <option key={m.user} value={m.user}>
                        {m.full_name || m.user}
                      </option>
                    ))}
                  </select>
                  <CardPicker
                    board={board}
                    exclude={name}
                    compact
                    label="# Link a card"
                    onPick={(id) => setComment(comment + ` #[${id}] `)}
                  />
                  <label
                    className="icon upload-label"
                    title="Attach to comment"
                  >
                    <Paperclip size={16} />
                    <input
                      type="file"
                      multiple
                      aria-label="Attach files to comment"
                      onChange={(e) =>
                        setCommentFiles([
                          ...commentFiles,
                          ...Array.from(e.target.files || []),
                        ])
                      }
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !comment.trim()}
                  >
                    {commentId ? "Save" : "Send"}
                  </button>
                </div>
                {commentFiles.map((f, i) => (
                  <div key={i} className="pending-file">
                    {f.name}
                    <button
                      type="button"
                      className="icon"
                      aria-label={"Remove " + f.name}
                      onClick={() =>
                        setCommentFiles(commentFiles.filter((_, j) => i !== j))
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {commentId && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setCommentId(undefined);
                      setComment("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </form>
              <div className="comments">
                {data.comments
                  .slice()
                  .reverse()
                  .map((c) => (
                    <article key={c.name} className="comment">
                      <Avatar user={c.owner} members={board.members} small />
                      <div className="comment-body">
                        <strong>
                          {board.members.find((m) => m.user === c.owner)
                            ?.full_name || c.owner}
                        </strong>
                        <time>
                          {fullDate(c.creation)}
                          {c.modified !== c.creation ? " · edited" : ""}
                        </time>
                        <div className="comment-content">
                          <Md
                            text={c.content}
                            refs={refsFor(c.content)}
                            open={goto}
                          />
                        </div>
                        {data.attachments
                          .filter((f) => f.comment === c.name)
                          .map((f) => (
                            <a
                              className="comment-file"
                              key={f.name}
                              href={f.file_url}
                              download
                            >
                              <Paperclip size={13} />
                              {f.file_name}
                            </a>
                          ))}
                        {c.owner === board.user &&
                          c.content !== "[Comment deleted]" && (
                            <div className="comment-actions">
                              <button
                                onClick={() => {
                                  setCommentId(c.name);
                                  setComment(c.content);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() =>
                                  void run(
                                    () =>
                                      api(
                                        "delete_comment",
                                        { name: c.name },
                                        true,
                                      ),
                                    false,
                                  ).then(
                                    () =>
                                      void get<Detail>("detail", { name }).then(
                                        setData,
                                      ),
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          )}
                      </div>
                    </article>
                  ))}
                {!data.comments.length && (
                  <div className="discussion-empty">
                    <MessageSquare size={30} />
                    <p>Start the conversation</p>
                    <small>Share an update or mention a teammate.</small>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </Modal>
  );
}
function FileRow({
  file,
  canRemove,
  remove,
}: {
  file: Attachment;
  canRemove: boolean;
  remove: () => void;
}) {
  const ext = file.file_name.split(".").pop()?.slice(0, 5).toUpperCase();
  return (
    <div className="file-row">
      <div className="file-icon">{ext}</div>
      <div>
        <a href={file.file_url} download>
          {file.file_name}
        </a>
        <small>
          {file.file_size < 1024 * 1024
            ? Math.ceil(file.file_size / 1024) + " KB"
            : (file.file_size / 1024 / 1024).toFixed(1) + " MB"}{" "}
          · {fullDate(file.creation)}
        </small>
      </div>
      <a
        className="icon"
        href={file.file_url}
        download
        aria-label={"Download " + file.file_name}
      >
        <Download size={17} />
      </a>
      {canRemove && (
        <button
          className="icon"
          aria-label={"Remove attachment " + file.file_name}
          onClick={remove}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
function MembersModal({
  board,
  close,
  refresh,
}: {
  board: Board;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("Member"),
    [invitations, setInvitations] = useState<any[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => get<any[]>("invitations").then(setInvitations);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Share board" close={close}>
      <div className="panel-body">
        <p className="muted">
          Invite people to collaborate on {board.settings.board_title}.
        </p>
        <form
          className="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("invite", { email, role }, true);
              setMessage("Invitation queued for delivery.");
              setEmail("");
            });
          }}
        >
          <input
            type="email"
            required
            aria-label="Invite email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            aria-label="Invitation role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option>Member</option>
            <option>Admin</option>
          </select>
          <button className="primary" disabled={busy}>
            Invite
          </button>
        </form>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <h3>Board members</h3>
        <div className="members-list">
          {board.members.map((m) => (
            <div className="member-row" key={m.user}>
              <Avatar user={m.user} members={board.members} />
              <div>
                <strong>
                  {m.full_name || m.user}
                  {m.user === board.user ? " (you)" : ""}
                </strong>
                <small>{m.user}</small>
              </div>
              <select
                disabled={m.user === board.user || busy}
                aria-label={"Role for " + m.user}
                value={m.role}
                onChange={(e) =>
                  void run(() =>
                    api(
                      "update_member",
                      { user: m.user, role: e.target.value },
                      true,
                    ),
                  )
                }
              >
                <option>Member</option>
                <option>Admin</option>
              </select>
              {m.user !== board.user && (
                <button
                  className="icon"
                  aria-label={"Remove member " + m.user}
                  onClick={() =>
                    void run(() =>
                      api("update_member", { user: m.user, active: 0 }, true),
                    )
                  }
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <h3>Invitations</h3>
        {invitations.length ? (
          invitations.map((i) => (
            <div className="invitation-row" key={i.name}>
              <div>
                <strong>{i.email}</strong>
                <small>
                  {i.status === "Pending" && new Date(i.expires_at) < new Date()
                    ? "Expired"
                    : i.status}{" "}
                  · {i.role}
                </small>
              </div>
              {i.status === "Pending" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api("invite", { email: i.email, role: i.role }, true),
                      )
                    }
                  >
                    Resend
                  </button>
                  <button
                    className="icon"
                    aria-label={"Revoke invitation " + i.email}
                    onClick={() =>
                      void run(() =>
                        api("revoke_invitation", { name: i.name }, true),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </>
              )}
            </div>
          ))
        ) : (
          <p className="muted">No invitations yet.</p>
        )}
      </div>
    </Modal>
  );
}
function ListModal({
  list,
  lists,
  close,
  act,
}: {
  list: Column;
  lists: Column[];
  close: () => void;
  act: (fn: () => Promise<any>) => Promise<void>;
}) {
  const [title, setTitle] = useState(list.title),
    [done, setDone] = useState(!!list.is_done),
    [position, setPosition] = useState(
      lists.findIndex((l) => l.name === list.name),
    );
  return (
    <Modal title="List settings" close={close}>
      <form
        className="panel-body"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api(
              "save_list",
              { data: { name: list.name, title, is_done: done ? 1 : 0 } },
              true,
            );
            const ids = lists
              .map((l) => l.name)
              .filter((id) => id !== list.name);
            ids.splice(position, 0, list.name);
            await api("reorder_lists", { names: ids }, true);
            close();
          });
        }}
      >
        <label>
          List name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Position
          <select
            value={position}
            onChange={(e) => setPosition(+e.target.value)}
          >
            {lists.map((l, i) => (
              <option key={l.name} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => setDone(e.target.checked)}
          />
          Cards in this list are complete
        </label>
        <div className="inline-actions">
          <button className="primary">Save list</button>
          <button
            type="button"
            className="subtle"
            onClick={() =>
              void act(async () => {
                await api(
                  "save_list",
                  { data: { name: list.name, archived: 1 } },
                  true,
                );
                close();
              })
            }
          >
            <Archive size={15} />
            Archive list
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsModal({
  board,
  close,
  act,
}: {
  board: Board;
  close: () => void;
  act: (fn: () => Promise<any>) => Promise<void>;
}) {
  const [title, setTitle] = useState(board.settings.board_title),
    [limit, setLimit] = useState(board.settings.max_upload_mb);
  return (
    <Modal title="Board settings" close={close}>
      <form
        className="panel-body"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api(
              "settings",
              { data: { board_title: title, max_upload_mb: limit } },
              true,
            );
            close();
          });
        }}
      >
        <label>
          Board name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Maximum file size (MB)
          <input
            type="number"
            min={1}
            max={1024}
            value={limit}
            onChange={(e) => setLimit(+e.target.value)}
            required
          />
        </label>
        <p className="muted">
          Due-date emails are sent one day before a task is due and on its due
          date.
        </p>
        <button className="primary">Save settings</button>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
