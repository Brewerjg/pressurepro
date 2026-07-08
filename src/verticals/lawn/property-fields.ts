import { Leaf, PawPrint, Droplets, Scissors } from "lucide-react";
import type { PropertyFieldsModule } from "@/verticals/property-fields";

export const lawnPropertyFields: PropertyFieldsModule = {
  sectionLabel: "Lawn details",
  sectionIcon: Leaf,
  emptyStateHint:
    "No lawn-care flags set. Edit to record grass type, mow height, irrigation, etc.",
  fields: [
    {
      key: "grass_type",
      label: "Grass type",
      type: "datalist",
      placeholder: "e.g. Bermuda, Fescue, Zoysia…",
      suggestions: [
        "Bermuda", "Fescue", "Zoysia", "Kentucky Bluegrass", "St. Augustine",
        "Centipede", "Ryegrass", "Buffalo", "mixed",
      ],
    },
    {
      key: "mow_height_in",
      label: "Mow height (in)",
      readLabel: "Mow height",
      type: "number",
      placeholder: "e.g. 3.5",
      step: "0.1",
      displaySuffix: '"',
    },
    { key: "pet_safe_only", label: "Pet-safe chems only", type: "toggle", icon: PawPrint, pillTone: "green" },
    { key: "irrigation_present", label: "Irrigation present", type: "toggle", icon: Droplets, pillTone: "rain" },
    { key: "bag_clippings", label: "Bag clippings", type: "toggle", icon: Scissors, pillTone: "bronze" },
  ],
};
