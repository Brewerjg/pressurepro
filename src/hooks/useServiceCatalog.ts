import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import type { CatalogItem } from "@/verticals/quote-line";

/** Vertical-aware service catalog for the quote/plan line editor.
 *  Lawn → catalog_items; pressure → surface_pricing. */
export function useServiceCatalog() {
  const { user } = useAuth();
  return useQuery<CatalogItem[]>({
    queryKey: ["catalog", "service", user?.id],
    enabled: !!user?.id,
    queryFn: () => vertical.catalog.loadServiceCatalog(user!.id, APP_ID),
  });
}
