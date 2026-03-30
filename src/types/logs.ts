// ── Core event types mirroring Rust structs ─────────────────────────────

export type EventType =
  | "damageDealt"
  | "damageTaken"
  | "healingDone"
  | "healingTaken"
  | "buffApplied"
  | "buffRemoved"
  | "debuffApplied"
  | "debuffRemoved"
  | "combatStart"
  | "combatEnd"
  | "unitDeath"
  | "unitResurrected"
  | "resourceChange"
  | "unknown";

export interface UnitInfo {
  unitId: number;
  name: string;
  isPlayer: boolean;
}

export interface AbilityInfo {
  abilityId: number;
  name: string;
}

export interface CombatEvent {
  timestamp: number;
  eventType: EventType;
  source: UnitInfo;
  target: UnitInfo;
  ability: AbilityInfo;
  value: number;
  overflow: number;
  isCrit: boolean;
  rawCode: number;
}

// ── Encounter & summary types ───────────────────────────────────────────

export type PlayerRole = "tank" | "healer" | "damageDealer" | "unknown";

export interface PlayerSummary {
  name: string;
  role: PlayerRole;
  damageDealt: number;
  dps: number;
  healingDone: number;
  hps: number;
  deaths: number;
}

export interface Encounter {
  index: number;
  bossName: string;
  isKill: boolean;
  startTime: number;
  endTime: number;
  durationSecs: number;
  players: PlayerSummary[];
  groupDps: number;
  groupHps: number;
  totalDeaths: number;
  byteStart: number;
  byteEnd: number;
}

// ── Log file metadata ───────────────────────────────────────────────────

export interface LogFileInfo {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  encounterCount: number | null;
  tags: string[];
}

export interface LogAnalysis {
  file: LogFileInfo;
  encounters: Encounter[];
  totalEvents: number;
  isComplete: boolean;
}

// ── Live logging types ──────────────────────────────────────────────────

export interface LiveEncounterSnapshot {
  bossName: string;
  durationSecs: number;
  groupDps: number;
  groupHps: number;
  deaths: number;
}

export interface LiveSessionStatus {
  active: boolean;
  filePath: string | null;
  fileSize: number;
  secsSinceLastEvent: number;
  currentEncounter: LiveEncounterSnapshot | null;
  encountersCompleted: number;
}

// ── Log path detection ──────────────────────────────────────────────────

export interface LogPathDetection {
  path: string | null;
  fromAddonPath: boolean;
  message: string;
}

// ── Convenience aliases mirroring Rust structs ─────────────────────────

export type LogFile = LogFileInfo;

export type EncounterOutcome = "kill" | "wipe";

export type ParsedLog = LogAnalysis;

// ── Logs workspace view state ───────────────────────────────────────────

export type LogsView = "home" | "log-detail" | "encounter-detail";
