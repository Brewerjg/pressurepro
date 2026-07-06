import { NavLink } from "react-router-dom";
import { vertical } from "@/vertical";
import { cn } from "@/lib/utils";

export const TabBar = () => {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-neutral-200/80 bg-card/96 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className="grid max-w-md mx-auto px-2 py-2"
        style={{ gridTemplateColumns: `repeat(${vertical.navEntries.length}, minmax(0, 1fr))` }}
      >
        {vertical.navEntries.map(({ to, label, icon: Icon, end }) => (
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
