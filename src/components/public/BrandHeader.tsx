import type { ReactNode } from "react";
import { Leaf } from "lucide-react";
import { vertical } from "@/vertical";

// Shared header for all customer-facing public pages (Accept, Review,
// Gallery, PlanPortal). TurfPro brand: green gradient hero, bronze accent
// wordmark, and a simple Leaf glyph. We deliberately drop PressurePro's
// hazard-stripe / water-overlay imagery — lawn-care doesn't share that
// safety-tape vocabulary; clean fairway green tells the right story.
export interface BrandHeaderProps {
  business: string;
  children?: ReactNode;
  className?: string;
}

export function BrandHeader({ business, children, className }: BrandHeaderProps) {
  return (
    <header
      className={
        "text-white px-5 pt-6 pb-8 rounded-b-[28px] relative overflow-hidden " +
        "bg-gradient-hero-deep shadow-card-lg " +
        (className ?? "")
      }
    >
      <div className="relative">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="h-9 w-9 rounded-[10px] bg-accent-500 text-brand-900 flex items-center justify-center">
            <Leaf className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <div className="flex flex-col">
            <span className="tp-display font-extrabold text-[11px] tracking-[0.18em] text-accent-400 uppercase">
              {vertical.brand.name}
            </span>
            <span className="font-extrabold text-sm leading-tight">
              {business || "Lawn Care"}
            </span>
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}

export default BrandHeader;
