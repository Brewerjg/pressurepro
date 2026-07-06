import { lazy } from "react";
import {
  Home,
  Users,
  Route,
  ClipboardList,
  Settings as SettingsIcon,
  Calculator,
  StickyNote,
} from "lucide-react";
import type { VerticalRoute, NavEntry, HomeAction } from "@/verticals/shell";

// All lazy — see spec decision 4. Eager-importing RoutesPage here would create a
// startup circular import through @/lib/app-context's top-level vertical.id read.
const RoutesPage = lazy(() => import("@/pages/Routes"));
const RouteMode = lazy(() => import("@/pages/RouteMode"));
const ApplicationCalc = lazy(() => import("@/pages/ApplicationCalc"));
const ChemicalLog = lazy(() => import("@/pages/ChemicalLog"));

export const lawnRoutes: VerticalRoute[] = [
  { path: "/routes", element: <RoutesPage />, guard: "paid" },
  { path: "/routes/run/:routeId", element: <RouteMode />, guard: "fullBleed" },
  { path: "/calc", element: <ApplicationCalc />, guard: "protected" },
  { path: "/chem-log", element: <ChemicalLog />, guard: "protected" },
];

export const lawnNavEntries: NavEntry[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/routes", label: "Routes", icon: Route },
  { to: "/plans", label: "Plans", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export const lawnHomeActions: HomeAction[] = [
  { icon: Calculator, label: "Application", sub: "NPK · per 1000ft²", accent: "text-accent-600", to: "/calc" },
  { icon: StickyNote, label: "Chemical log", sub: "Compliance record", accent: "text-brand-700", to: "/chem-log" },
];
