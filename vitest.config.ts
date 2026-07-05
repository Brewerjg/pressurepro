import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Scope vitest to our unit tests. The `@` alias mirrors vite.config so tests
// can import application modules by `@/…` (the same specifier the app uses).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: [
      "src/**/*.{test,spec}.ts",
      "supabase/functions/_shared/quickbooks-map.test.ts",
    ],
    environment: "node",
  },
});
