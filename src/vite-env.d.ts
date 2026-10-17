/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_HOME_URL?: string;
  readonly VITE_LOGOUT_URL?: string;
  readonly VITE_ANNOTATION_AUTHOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
