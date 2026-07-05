/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERTICAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "@active-theme";
