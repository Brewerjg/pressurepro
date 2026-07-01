import { defineConfig } from "vitest/config";

// Scope vitest to our unit tests only. The edge functions are Deno modules
// (remote esm.sh imports, Deno globals) that vitest must never try to load;
// our one test imports only the pure, dependency-free quickbooks-map module.
export default defineConfig({
  test: {
    include: [
      "src/**/*.{test,spec}.ts",
      "supabase/functions/_shared/quickbooks-map.test.ts",
    ],
    environment: "node",
  },
});
