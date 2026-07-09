import { StickyNote } from "lucide-react";
import type { PropertyFieldsModule } from "@/verticals/property-fields";

export const pressurePropertyFields: PropertyFieldsModule = {
  sectionLabel: "Site details",
  sectionIcon: StickyNote,
  emptyStateHint:
    "No site notes yet. Edit to record surface materials, problem areas, or access notes.",
  fields: [
    {
      key: "surface_notes",
      label: "Surface notes",
      type: "textarea",
      placeholder: "Materials, problem areas, access…",
    },
  ],
};
