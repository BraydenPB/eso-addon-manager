use serde::{Deserialize, Serialize};

// ── Core event types parsed from ESO combat log lines ───────────────────

/// A single combat log event parsed from one line of a log file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatEvent {
    /// Millisecond timestamp from the log line.
    pub timestamp: u64,
    /// The kind of event (damage dealt, healing, buff applied, etc.).
    pub event_type: EventType,
    /// Source unit (player, pet, NPC, etc.).
    pub source: UnitInfo,
    /// Target unit.
    pub target: UnitInfo,
    /// Ability that caused this event.
    pub ability: AbilityInfo,
    /// Numeric value (damage amount, heal amount, etc.). Zero if N/A.
    pub value: i64,
    /// Overflow value (overkill, overheal). Zero if N/A.
    pub overflow: i64,
    /// Whether this was a critical strike.
    pub is_crit: bool,
    /// The raw event code from the log for forward-compatibility.
    pub raw_code: u32,
}

/// Categorises the type of combat log event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventType {
    DamageDealt,
    DamageTaken,
    HealingDone,
    HealingTaken,
    BuffApplied,
    BuffRemoved,
    DebuffApplied,
    DebuffRemoved,
    CombatStart,
    CombatEnd,
    UnitDeath,
    UnitResurrected,
    ResourceChange,
    /// Catch-all for event codes we don't specifically handle yet.
    Unknown,
}

/// Identifies a unit (player, NPC, pet) in a combat event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitInfo {
    /// Internal game unit ID.
    pub unit_id: u64,
    /// Display name (character name or NPC name).
    pub name: String,
    /// Whether this unit is a player character.
    pub is_player: bool,
}

/// Identifies an ability/skill used in a combat event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityInfo {
    /// The game's ability ID.
    pub ability_id: u32,
    /// The display name of the ability.
    pub name: String,
}

// ── Encounter & summary types ───────────────────────────────────────────

/// Represents a single encounter (boss fight or trash pull) detected from
/// a sequence of combat events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Encounter {
    /// Unique index within the parent log file (0-based).
    pub index: usize,
    /// Inferred boss or encounter name. May be "Unknown" for trash pulls.
    pub boss_name: String,
    /// Whether the encounter ended in a kill (all boss units died).
    pub is_kill: bool,
    /// Encounter start timestamp (ms).
    pub start_time: u64,
    /// Encounter end timestamp (ms).
    pub end_time: u64,
    /// Duration in seconds.
    pub duration_secs: f64,
    /// Participants (players only).
    pub players: Vec<PlayerSummary>,
    /// Total group DPS across the encounter.
    pub group_dps: f64,
    /// Total group HPS across the encounter.
    pub group_hps: f64,
    /// Total deaths during the encounter.
    pub total_deaths: u32,
    /// Byte range in the source file for quick re-extraction.
    pub byte_start: u64,
    /// End byte offset.
    pub byte_end: u64,
}

/// Summary statistics for a single player within an encounter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSummary {
    /// Character display name.
    pub name: String,
    /// Inferred role (tank, healer, damage dealer).
    pub role: PlayerRole,
    /// Total damage dealt.
    pub damage_dealt: i64,
    /// Damage per second.
    pub dps: f64,
    /// Total healing done.
    pub healing_done: i64,
    /// Healing per second.
    pub hps: f64,
    /// Number of deaths.
    pub deaths: u32,
}

/// Inferred player role based on ability usage and stats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayerRole {
    Tank,
    Healer,
    DamageDealer,
    Unknown,
}

// ── Log file metadata ───────────────────────────────────────────────────

/// Metadata about a discovered log file on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    /// Full path to the log file.
    pub path: String,
    /// File name only.
    pub file_name: String,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Last modified timestamp (ISO 8601).
    pub modified_at: String,
    /// Number of encounters found (None if not yet indexed).
    pub encounter_count: Option<usize>,
    /// User-assigned tags (e.g. "vCR", "prog").
    pub tags: Vec<String>,
}

/// Result of analyzing a full log file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogAnalysis {
    /// The log file that was analyzed.
    pub file: LogFileInfo,
    /// All encounters detected in the log.
    pub encounters: Vec<Encounter>,
    /// Total number of events parsed.
    pub total_events: usize,
    /// Whether the file was fully parsed or only partially (e.g. truncated).
    pub is_complete: bool,
}

// ── Live logging types ──────────────────────────────────────────────────

/// Snapshot of the current live logging session state, sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionStatus {
    /// Whether a live session is currently active.
    pub active: bool,
    /// Path of the file being watched.
    pub file_path: Option<String>,
    /// Current file size in bytes.
    pub file_size: u64,
    /// Seconds since the last event was recorded.
    pub secs_since_last_event: f64,
    /// The current encounter (if in combat).
    pub current_encounter: Option<LiveEncounterSnapshot>,
    /// Total encounters completed in this session.
    pub encounters_completed: usize,
}

/// Real-time snapshot of an in-progress encounter during live logging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEncounterSnapshot {
    /// Inferred boss name.
    pub boss_name: String,
    /// Duration so far in seconds.
    pub duration_secs: f64,
    /// Current group DPS.
    pub group_dps: f64,
    /// Current group HPS.
    pub group_hps: f64,
    /// Deaths so far.
    pub deaths: u32,
}

// ── Log path configuration ──────────────────────────────────────────────

/// Result of attempting to discover the ESO log directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPathDetection {
    /// The detected log directory path, if found.
    pub path: Option<String>,
    /// Whether the path was derived from the addon manager's known ESO path.
    pub from_addon_path: bool,
    /// Human-readable status message.
    pub message: String,
}
