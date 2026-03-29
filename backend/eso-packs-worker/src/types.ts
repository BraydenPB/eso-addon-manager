// ── Pack addon entry ────────────────────────────────────────────────
export interface PackAddonEntry {
  esouiId: number;
  name: string;
  required: boolean;
  defaultEnabled: boolean;
  note?: string;
}

// ── Build / Roster references (links to ESO Toolkit webapp) ────────
export interface BuildReference {
  buildHubId: string;
  title: string;
  esoClass?: string;
  role?: string;
}

export interface RosterReference {
  rosterHubId: string;
  title: string;
  trialId?: string;
}

// ── Pack metadata ──────────────────────────────────────────────────
export interface PackMetadata {
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  originUrl?: string;
  version: number;
}

export type PackType = "addon-pack" | "build-pack" | "roster-pack";

// ── Full pack ──────────────────────────────────────────────────────
export interface Pack {
  id: string;
  name: string;
  description: string;
  type: PackType;
  tags: string[];
  metadata: PackMetadata;
  addons: PackAddonEntry[];
  builds?: BuildReference[];
  rosters?: RosterReference[];
}

// ── Index (lightweight listing) ────────────────────────────────────
export interface PackIndexItem {
  id: string;
  name: string;
  description: string;
  type: PackType;
  tags: string[];
  addonCount: number;
  buildCount: number;
  rosterCount: number;
  updatedAt: string;
}

export interface PackIndex {
  items: PackIndexItem[];
}

// ── Validation ─────────────────────────────────────────────────────
export interface ValidationError {
  field: string;
  message: string;
}

// ── Env bindings ───────────────────────────────────────────────────
export interface Env {
  ESO_PACKS: KVNamespace;
  ADMIN_API_KEY: string;
}
