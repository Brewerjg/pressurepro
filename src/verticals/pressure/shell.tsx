import { lazy } from "react";
import { Home, Users, FileText, Calendar, Settings as SettingsIcon, FlaskConical } from "lucide-react";
import type { VerticalRoute, NavEntry, HomeAction } from "@/verticals/shell";

// Lazy for the same reason as lawn/shell.tsx: eager-importing a page here
// would create a startup circular import through @/lib/app-context's
// top-level vertical.id read.
const MixCalculator = lazy(() => import("./MixCalculator"));

export const pressureRoutes: VerticalRoute[] = [
  { path: "/mix", element: <MixCalculator />, guard: "protected" },
];

export const pressureNavEntries: NavEntry[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/quotes", label: "Quotes", icon: FileText },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export const pressureHomeActions: HomeAction[] = [
  { icon: FlaskConical, label: "Mix Calc", sub: "Soft-wash SH recipe", accent: "text-accent-600", to: "/mix" },
];
