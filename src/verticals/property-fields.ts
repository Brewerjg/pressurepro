import type { LucideIcon } from "lucide-react";

// One editable custom field on the property record.
export type PropertyFieldDef =
  | { key: string; label: string; readLabel?: string; type: "datalist"; placeholder?: string; suggestions: string[] }
  | { key: string; label: string; readLabel?: string; type: "number"; placeholder?: string; step?: string; displaySuffix?: string }
  | { key: string; label: string; type: "toggle"; icon: LucideIcon; pillTone: "green" | "rain" | "bronze" };

export interface PropertyFieldsModule {
  /** Heading for the custom-fields card ("Lawn details"). */
  sectionLabel: string;
  /** Icon shown beside the read-view section label. */
  sectionIcon: LucideIcon;
  /** Shown when no toggle field is set. */
  emptyStateHint: string;
  /** The vertical's editable custom fields (empty = no card renders). */
  fields: PropertyFieldDef[];
}
