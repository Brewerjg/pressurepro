import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";

// Seeds the active vertical's starter catalog. The trade-specific data access
// (table, RPC, idempotency) lives in vertical.catalog.seed.
export async function seedDefaultCatalog(userId: string): Promise<void> {
  await vertical.catalog.seed(userId, APP_ID);
}
