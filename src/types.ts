export interface Dependency {
  name: string;
  min_version: number | null;
}

export interface AddonManifest {
  folderName: string;
  title: string;
  author: string;
  version: string;
  addonVersion: number | null;
  apiVersion: number[];
  description: string;
  isLibrary: boolean;
  dependsOn: Dependency[];
  optionalDependsOn: Dependency[];
  missingDependencies: string[];
  esouiId: number | null;
  tags: string[];
  esouiLastUpdate: number;
}

export interface EsouiAddonInfo {
  id: number;
  title: string;
  version: string;
  downloadUrl: string;
  updated: string;
}

export interface InstallResult {
  installedFolders: string[];
  installedDeps: string[];
  failedDeps: string[];
  skippedDeps: string[];
}

export interface UpdateCheckResult {
  folderName: string;
  esouiId: number;
  currentVersion: string;
  remoteVersion: string;
  downloadUrl: string;
  hasUpdate: boolean;
}

export interface ImportResult {
  installed: string[];
  failed: string[];
  skipped: string[];
}

export interface EsouiSearchResult {
  id: number;
  title: string;
  author: string;
  category: string;
  downloads: string;
  updated: string;
}

export interface EsouiAddonDetail {
  id: number;
  title: string;
  version: string;
  author: string;
  description: string;
  compatibility: string;
  fileSize: string;
  totalDownloads: string;
  monthlyDownloads: string;
  favorites: string;
  updated: string;
  created: string;
  screenshots: string[];
  downloadUrl: string;
}

export interface EsouiCategory {
  id: number;
  name: string;
  depth: number;
}

export interface ApiCompatInfo {
  gameApiVersion: number;
  outdatedAddons: string[];
  upToDateAddons: string[];
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

export interface AddonProfile {
  name: string;
  enabledAddons: string[];
  createdAt: string;
}

export interface CharacterInfo {
  server: string;
  name: string;
}

export interface MinionMigrationResult {
  found: boolean;
  addonCount: number;
  imported: number;
  alreadyTracked: number;
}

// App-level UI state types
export type SortMode = "name" | "author";
export type FilterMode =
  | "all"
  | "addons"
  | "libraries"
  | "outdated"
  | "missing-deps"
  | "favorites"
  | "tagged"
  | "untracked";

// Predefined tags users can apply to addons
export const PRESET_TAGS = ["favorite", "testing", "broken", "essential", "cosmetic"] as const;
export type PresetTag = (typeof PRESET_TAGS)[number];
export type ViewMode = "installed" | "discover";
export type DiscoverTab = "search" | "categories" | "url";

// ── Pack types (from roster-hub-api Pack Hub) ─────────────────────────────
export interface PackAddonEntry {
  esouiId: number;
  name: string;
  required: boolean;
  note?: string;
}

export type PackType = "addon-pack" | "build-pack" | "roster-pack";

export interface Pack {
  id: string;
  authorId: string;
  title: string;
  description: string;
  packType: PackType;
  authorName: string;
  isAnonymous: boolean;
  voteCount: number;
  userVoted: boolean;
  tags: string[];
  addons: PackAddonEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PackPage {
  packs: Pack[];
  page: number;
}

// ── Auth types ────────────────────────────────────────────────────────────
export interface AuthUser {
  userId: string;
  userName: string;
}
