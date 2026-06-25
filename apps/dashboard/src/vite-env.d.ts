/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the ClearLine API; defaults to local `wrangler dev`. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
