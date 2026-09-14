import { ReactNode, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  closestCenter,
  DragEndEvent,
  DragOverEvent,
  CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  MoreHorizontal,
  CheckCircle2,
  Check,
  Pencil,
  Plus,
} from "lucide-react";
import { Card, Column } from "./api";

type Target = { list: string; before?: string };
type Props = {
  cards: Card[];
  lists: Column[];
  admin: boolean;
  busy: boolean;
  open: (id: string) => void;
  editList: (id: string) => void;
  move: (card: Card, target: Target) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  interaction: (active: boolean) => void;
  face: (card: Card) => ReactNode;
  complete: (card: Card) => void;
  add: (list: Column, before?: string, close?: () => void) => ReactNode;
  children: ReactNode;
};

function SortableCard({
  card,
  disabled,
  open,
  complete,
  children,
}: {
  card: Card;
  disabled: boolean;
  open: () => void;
  complete: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.name,
    data: { type: "card", list: card.list_id },
    disabled,
  });
  return (
    <article
      ref={setNodeRef}
      className={
        "task-card movable-card" +
        (card.completed ? " is-complete" : "") +
        (isDragging ? " drag-source" : "")
      }
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        className="card-complete-control"
        aria-label={
          (card.completed ? "Mark incomplete: " : "Mark complete: ") +
          card.title
        }
        aria-pressed={!!card.completed}
        data-tooltip={card.completed ? "Mark incomplete" : "Mark complete"}
        disabled={disabled}
        onClick={complete}
      >
        {card.completed ? <Check size={12} /> : null}
      </button>
      <button
        className="card-edit-control icon"
        aria-label={"Edit card " + card.title}
        data-tooltip="Edit card"
        disabled={disabled}
        onClick={open}
      >
        <Pencil size={15} />
      </button>
      <button
        className="card-drag-handle"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={"Move card " + card.title}
        data-tooltip="Drag to move · Space then arrow keys to move with keyboard"
      >
        <GripVertical size={15} />
      </button>
      <div
        className="card-open-area"
        role="button"
        tabIndex={0}
        aria-label={"Open card " + card.title}
        {...listeners}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        {children}
      </div>
    </article>
  );
}
function ListColumn({
  list,
  count,
  admin,
  disabled,
  edit,
  children,
  activeTarget,
}: {
  list: Column;
  count: number;
  admin: boolean;
  disabled: boolean;
  edit: () => void;
  children: ReactNode;
  activeTarget: boolean;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: "list:" + list.name,
    data: { type: "list", list: list.name },
    disabled: disabled || !admin,
  });
  const { setNodeRef: setDrop } = useDroppable({
    id: "column:" + list.name,
    data: { type: "column", list: list.name },
    disabled,
  });
  return (
    <section
      ref={setNodeRef}
      className={
        "column" +
        (activeTarget ? " drop-column" : "") +
        (isDragging ? " drag-source" : "")
      }
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className="column-header">
        <div className="column-title">
          {admin && (
            <button
              className="list-drag-handle"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={"Move list " + list.title}
              data-tooltip="Drag to move list"
            >
              <GripVertical size={14} />
            </button>
          )}
          {!!list.is_done && <CheckCircle2 size={15} className="green" />}
          <h2>{list.title}</h2>
          <span>{count}</span>
        </div>
        {admin && (
          <button
            className="icon"
            aria-label={"Edit list " + list.title}
            data-tooltip="List options"
            onClick={edit}
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </header>
      <div ref={setDrop} className="column-drop-zone">
        {children}
      </div>
    </section>
  );
}
export function BoardView(p: Props) {
  const [inserting, setInserting] = useState<{
    list: string;
    before: string;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null),
    [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null),
    suppressClick = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const collision: CollisionDetection = (args) => {
    const isList = args.active.data.current?.type === "list";
    const droppableContainers = args.droppableContainers.filter((c) =>
      isList
        ? c.data.current?.type === "list"
        : c.data.current?.type !== "list",
    );
    const options = { ...args, droppableContainers };
    const pointer = pointerWithin(options);
    return pointer.length
      ? pointer.filter((c) => !String(c.id).startsWith("column:")).length
        ? pointer.filter((c) => !String(c.id).startsWith("column:"))
        : pointer
      : args.pointerCoordinates
        ? []
        : closestCenter(options);
  };
  const over = ({ active, over }: DragOverEvent) => {
    if (active.data.current?.type !== "card" || !over) {
      targetRef.current = null;
      setTarget(null);
      return;
    }
    const list = String(over.data.current?.list || "");
    if (!list) return;
    if (over.id === active.id) {
      targetRef.current = null;
      setTarget(null);
      return;
    }
    let before: string | undefined;
    if (over.data.current?.type === "card") {
      const rows = p.cards.filter(
        (c) => c.list_id === list && c.name !== active.id,
      );
      const index = rows.findIndex((c) => c.name === over.id);
      const rect = active.rect.current.translated;
      const after = rect
        ? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
        : false;
      before = index < 0 ? undefined : rows[index + (after ? 1 : 0)]?.name;
    }
    const next = { list, before };
    targetRef.current = next;
    setTarget(next);
  };
  const end = (e: DragEndEvent) => {
    const dest = targetRef.current;
    setActive(null);
    setTarget(null);
    targetRef.current = null;
    p.interaction(false);
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 200);
    if (!e.over) return;
    if (e.active.data.current?.type === "card" && dest) {
      const card = p.cards.find((c) => c.name === e.active.id);
      if (card) void p.move(card, dest);
    } else if (e.active.data.current?.type === "list") {
      const ids = p.lists.map((l) => l.name),
        from = ids.indexOf(String(e.active.data.current.list)),
        to = ids.indexOf(String(e.over.data.current?.list));
      if (from >= 0 && to >= 0 && from !== to) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void p.reorder(ids);
      }
    }
  };
  const activeCard = p.cards.find((c) => c.name === active),
    activeList = p.lists.find((l) => "list:" + l.name === active);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => {
        setActive(String(e.active.id));
        p.interaction(true);
      }}
      onDragOver={over}
      onDragMove={over}
      onDragEnd={end}
      onDragCancel={() => {
        setActive(null);
        setTarget(null);
        targetRef.current = null;
        p.interaction(false);
      }}
    >
      <main className="board-canvas">
        <SortableContext
          items={p.lists.map((l) => "list:" + l.name)}
          strategy={horizontalListSortingStrategy}
        >
          {p.lists.map((list) => {
            const cards = p.cards.filter((c) => c.list_id === list.name);
            return (
              <ListColumn
                key={list.name}
                list={list}
                count={cards.length}
                admin={p.admin}
                disabled={p.busy}
                edit={() => p.editList(list.name)}
                activeTarget={target?.list === list.name}
              >
                <div className="card-stack">
                  <SortableContext
                    items={cards.map((c) => c.name)}
                    strategy={verticalListSortingStrategy}
                  >
                    {cards.map((c) => (
                      <div key={c.name}>
                        {inserting?.before === c.name &&
                        inserting.list === list.name ? (
                          p.add(list, c.name, () => setInserting(null))
                        ) : (
                          <div className="card-insert-slot">
                            <button
                              className="card-insert-button"
                              aria-label={"Add a card before " + c.title}
                              data-tooltip="Add a card here"
                              disabled={!!active || p.busy}
                              onClick={() =>
                                setInserting({
                                  list: list.name,
                                  before: c.name,
                                })
                              }
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                        {target?.list === list.name &&
                          target.before === c.name && (
                            <div className="card-drop-marker" />
                          )}
                        <SortableCard
                          card={c}
                          disabled={p.busy}
                          complete={() => p.complete(c)}
                          open={() => {
                            if (!active && !suppressClick.current)
                              p.open(c.name);
                          }}
                        >
                          {p.face(c)}
                        </SortableCard>
                      </div>
                    ))}
                  </SortableContext>
                  {target?.list === list.name && !target.before && (
                    <div className="card-drop-marker" />
                  )}
                  {!cards.length && activeCard && (
                    <div className="empty-drop">Drop card here</div>
                  )}
                </div>
                {p.add(list)}
              </ListColumn>
            );
          })}
        </SortableContext>
        {p.children}
      </main>
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
        {activeCard ? (
          <div className="task-card card-drag-overlay">
            {p.face(activeCard)}
          </div>
        ) : activeList ? (
          <div className="list-drag-overlay">{activeList.title}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
