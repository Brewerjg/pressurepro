import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// How a vertical composes into the shared app shell: the routes it injects, its
// bottom-tab entries, and its Home quick-action tiles.

// `element` is the page element (e.g. <ApplicationCalc/>); App.tsx wraps it in
// the named guard, which maps to the existing Protected/Paid/ProtectedFullBleed.
export type RouteGuard = "protected" | "paid" | "fullBleed";
export interface VerticalRoute {
  path: string;
  element: ReactNode;
  guard: RouteGuard;
}

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface HomeAction {
  icon: LucideIcon;
  label: string;
  sub: string;
  accent: string; // tailwind text-color class, e.g. "text-accent-600"
  to: string;
}
