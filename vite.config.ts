import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { HTML_META } from "./src/verticals/html-meta";

export default defineConfig(({ mode }) => {
  // Match src/vertical.ts: default "lawn". loadEnv reads the same VITE_VERTICAL
  // that import.meta.env exposes, so the theme CSS and the JS vertical agree.
  const vertical = loadEnv(mode, process.cwd(), "").VITE_VERTICAL || "lawn";
  // index.html is static — the JS/CSS vertical seams can't reach the <title>
  // or meta tags, so the pressure deploy shipped a "TurfPro" tab title until
  // this hook. Lawn's HTML_META values equal the literals index.html carries,
  // keeping the lawn build byte-identical.
  const htmlMeta = HTML_META[vertical] ?? HTML_META.lawn;
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
    },
    plugins: [
      react(),
      {
        name: "vertical-html-meta",
        transformIndexHtml(html: string) {
          return html
            .replace(/<title>[^<]*<\/title>/, `<title>${htmlMeta.title}</title>`)
            .replace(
              /(<meta name="theme-color" content=")[^"]*(")/,
              `$1${htmlMeta.themeColor}$2`,
            )
            .replace(
              /(<meta name="description" content=")[^"]*(")/,
              `$1${htmlMeta.description}$2`,
            );
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@active-theme": path.resolve(__dirname, `./src/verticals/${vertical}/theme.css`),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
