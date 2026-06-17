/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_TOKEN?: string;
  readonly VITE_GITHUB_REPO?: string; // "owner/repo"
  readonly VITE_GITHUB_EPIC_ISSUE?: string; // número da issue do Epic
  readonly VITE_GITHUB_TEAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
