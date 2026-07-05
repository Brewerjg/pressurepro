import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  // Match src/vertical.ts: default "lawn". loadEnv reads the same VITE_VERTICAL
  // that import.meta.env exposes, so the theme CSS and the JS vertical agree.
  const vertical = loadEnv(mode, process.cwd(), "").VITE_VERTICAL || "lawn";
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@active-theme": path.resolve(__dirname, `./src/verticals/${vertical}/theme.css`),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
