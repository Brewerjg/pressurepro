// =====================================================================
// Drag-to-reorder for the Routes page stop list.
//
// Only pending stops are draggable. Done / in_progress / skipped stops
// are pinned at their current sort_order because re-sequencing
// something that has already happened (or is happening now) would
// rewrite history. We surface the dnd-kit primitives lazily via
// DYNAMIC import so the Vite build succeeds before `npm install`
// pulls in @dnd-kit/*. While the module is loading the stop list
// renders as a normal, non-draggable list — operators just see the
// grip handles as visual affordances until dnd-kit lands.
//
// Pattern matches src/lib/stripe.ts + src/lib/native-init.ts.
// =====================================================================
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { RouteStop } from "./types";

// We type the dnd-kit modules as `any` to avoid pulling their types
// into the static graph. The dynamic import is gated on first use.
type DndKitModules = {
  core: any;
  sortable: any;
  utilities: any;
} | null;

let dndKitPromise: Promise<DndKitModules> | null = null;

export function loadDndKit(): Promise<DndKitModules> {
  if (!dndKitPromise) {
    dndKitPromise = (async () => {
      try {
        const coreSpec = "@dnd-kit/core";
        const sortableSpec = "@dnd-kit/sortable";
        const utilitiesSpec = "@dnd-kit/utilities";
        const [core, sortable, utilities] = await Promise.all([
          import(/* @vite-ignore */ coreSpec),
          import(/* @vite-ignore */ sortableSpec),
          import(/* @vite-ignore */ utilitiesSpec),
        ]);
        return { core, sortable, utilities };
      } catch (err) {
        console.warn(
          "[Routes] @dnd-kit/* not installed yet — reordering disabled. Run `npm install` to enable.",
          err,
        );
        return null;
      }
    })();
  }
  return dndKitPromise;
}

// Hook that resolves to the loaded dnd-kit modules (or null while
// loading / on failure). Caller renders the static fallback until
// this returns non-null.
export function useDndKit(): DndKitModules {
  const [mods, setMods] = useState<DndKitModules>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDndKit().then((m) => {
      if (!cancelled) setMods(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return mods;
}

// ---------------------------------------------------------------------
// Renormalization helper. Lawn-care routes are 8–15 stops so the row
// count never matters; we rewrite every pending stop's sort_order to
// a clean 10/20/30… scale. Using gaps of 10 keeps the table readable
// when someone is poking around in Supabase studio. Pinned (non-
// pending) stops keep their existing sort_order; we slot pending
// stops around them in the visual order requested.
//
// Returns the new (id -> sort_order) map covering only pending stops.
// ---------------------------------------------------------------------
export function computeReorderedSortOrders(
  /** Stops in their new visual order (mix of pending + pinned). */
  newOrder: RouteStop[],
): Map<string, number> {
  const out = new Map<string, number>();
  let next = 10;
  for (const s of newOrder) {
    if (s.status === "pending") {
      out.set(s.id, next);
      next += 10;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// SortableList — wraps children in dnd-kit's DndContext +
// SortableContext IF the modules are loaded. Until then it just
// renders the children as-is so the page never blocks on the dep.
//
// onReorder receives the new visual order of stop IDs (pending only).
// ---------------------------------------------------------------------
export interface SortableListProps {
  /** Full stop list in current visual order. */
  stops: RouteStop[];
  /** Called with the new full stop list (pending stops moved). */
  onReorder: (next: RouteStop[]) => void;
  children: ReactNode;
}

export function SortableList({ stops, onReorder, children }: SortableListProps) {
  const mods = useDndKit();
  // Until dnd-kit has resolved we render a plain pass-through. Once it
  // loads we mount the inner component, which can safely call dnd-kit
  // hooks at the top level. Splitting the gate from the hook-calling
  // body keeps us compliant with React's rules of hooks (mods is
  // either null forever during this mount or populated forever — we
  // never toggle between two hook counts in the same component).
  if (!mods) return <>{children}</>;
  return (
    <SortableListInner mods={mods} stops={stops} onReorder={onReorder}>
      {children}
    </SortableListInner>
  );
}

function SortableListInner({
  mods,
  stops,
  onReorder,
  children,
}: SortableListProps & { mods: NonNullable<DndKitModules> }) {
  const { DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } = mods.core;
  const { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } = mods.sortable;

  // Pointer for desktop; Touch with a 250 ms delay so accidental drags
  // while scrolling in a moving truck don't fire. Keyboard sensor
  // covers a11y (arrows to move a focused handle).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = stops.map((s) => s.id);

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stops.findIndex((s) => s.id === active.id);
    const newIndex = stops.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    // Guard: only pending stops are reorderable. dnd-kit also gates
    // this via the disabled flag on pinned items, but we double-check
    // here in case a stale stop slipped in.
    const moving = stops[oldIndex];
    const target = stops[newIndex];
    if (moving.status !== "pending" || target.status !== "pending") return;
    const next = arrayMove(stops, oldIndex, newIndex);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// ---------------------------------------------------------------------
// SortableStop — wraps a single stop's row markup with dnd-kit's
// useSortable hook (or a static div fallback if the modules aren't
// loaded yet / the stop is pinned). The child render function receives
// the props that the visible grip handle needs to attach so dragging
// only triggers from the handle, not the whole card body.
// ---------------------------------------------------------------------
export interface SortableStopProps {
  stop: RouteStop;
  children: (handle: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
  }) => ReactNode;
}

export function SortableStop({ stop, children }: SortableStopProps) {
  const mods = useDndKit();
  if (!mods || stop.status !== "pending") {
    return (
      <>
        {children({
          attributes: {},
          listeners: {},
          setActivatorNodeRef: () => undefined,
          isDragging: false,
        })}
      </>
    );
  }
  return <SortableStopInner stop={stop} mods={mods} children={children} />;
}

function SortableStopInner({
  stop,
  mods,
  children,
}: {
  stop: RouteStop;
  mods: NonNullable<DndKitModules>;
  children: SortableStopProps["children"];
}) {
  const { useSortable } = mods.sortable;
  const { CSS } = mods.utilities;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        attributes: attributes ?? {},
        listeners: listeners ?? {},
        setActivatorNodeRef,
        isDragging,
      })}
    </div>
  );
}
