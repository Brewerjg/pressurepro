import { NavLink } from "react-router-dom";
import { Home, Users, Route, ClipboardList, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Tab order per TURFPRO_SPEC.md: Home · Customers · Routes · Plans · Settings.
// Recurring is the default for lawn care, so Plans/Routes are promoted to
// primary slots and Quotes drops out of the bottom nav.
const tabs = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/routes", label: "Routes", icon: Route },
  { to: "/plans", label: "Plans", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export const TabBar = () => {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200/80 bg-card/96 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5 max-w-md mx-auto px-2 py-2">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 py-1.5 text-[10px] font-semibold tracking-wide transition-colors",
                  isActive ? "text-brand-800" : "text-neutral-500 hover:text-neutral-700"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2 : 1.7} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};
