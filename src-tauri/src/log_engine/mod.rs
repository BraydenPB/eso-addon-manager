mod tests;

use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;
use std::time::UNIX_EPOCH;

// ── Data types (Serializable, used by Tauri commands) ──────────────────

/// Metadata for a single ESO combat log file on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

/// The result of a boss encounter: kill, wipe, or indeterminate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncounterOutcome {
    Kill,
    Wipe,
    Unknown,
}

/// A single encounter (boss fight) detected within a log file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Encounter {
    pub id: String,
    pub log_file_id: String,
    pub name: String,
    pub start_line: usize,
    pub end_line: usize,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: u64,
    pub outcome: EncounterOutcome,
}

/// A player that participated in an encounter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub is_local: bool,
}

/// The full result of parsing a log file: the file metadata plus all
/// encounters that were detected inside it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLog {
    pub log_file: LogFile,
    pub encounters: Vec<Encounter>,
}

// ── Internal parsing types ─────────────────────────────────────────────

/// A detected encounter from the BufReader parser (internal).
#[derive(Debug, Clone)]
pub struct ParsedEncounter {
    pub name: String,
    pub outcome: EncounterOutcome,
    pub start_line: usize,
    pub end_line: usize,
    pub start_time: i64,
    pub end_time: i64,
}

/// Gap threshold (ms) after the last COMBAT_EVENT to consider a new encounter started.
const NEW_ENCOUNTER_GAP_MS: i64 = 5_000;

/// Gap threshold (ms) of no COMBAT_EVENT activity to end the current encounter.
const END_ENCOUNTER_GAP_MS: i64 = 10_000;

/// A parsed line from the combat log.
struct LogLine {
    line_number: usize,
    timestamp: i64,
    event_type: String,
    fields: Vec<String>,
}

/// Tracks a boss candidate detected during an encounter.
struct BossCandidate {
    name: String,
    died: bool,
}

// ── Public API ─────────────────────────────────────────────────────────

/// Walk `base_path` for `*.log` files and return a [`LogFile`] for each,
/// populated from filesystem metadata.
pub fn discover_logs(base_path: &str) -> Vec<LogFile> {
    let dir = Path::new(base_path);
    if !dir.is_dir() {
        return Vec::new();
    }

    let mut logs: Vec<LogFile> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext != "log" {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let full_path = path.to_string_lossy().into_owned();
        let id = stable_id(&full_path);

        logs.push(LogFile {
            id,
            path: full_path,
            file_name,
            size_bytes: metadata.len(),
            modified_at,
        });
    }

    // Newest first
    logs.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    logs
}

/// Parse a log file and return the full result with encounters.
pub fn parse_log(path: &str) -> Result<ParsedLog, String> {
    let file_path = Path::new(path);
    if !file_path.is_file() {
        return Err(format!("File does not exist: {}", path));
    }

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Cannot read file metadata: {}", e))?;

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let full_path = file_path.to_string_lossy().into_owned();
    let log_file_id = stable_id(&full_path);

    let log_file = LogFile {
        id: log_file_id.clone(),
        path: full_path.clone(),
        file_name,
        size_bytes: metadata.len(),
        modified_at,
    };

    // Use the real BufReader-based parser
    let raw_encounters = parse_log_file(&full_path)
        .map_err(|e| format!("Failed to parse log: {}", e))?;

    let encounters = raw_encounters
        .into_iter()
        .enumerate()
        .map(|(i, enc)| Encounter {
            id: format!("{}-enc-{}", log_file_id, i),
            log_file_id: log_file_id.clone(),
            name: enc.name,
            start_line: enc.start_line,
            end_line: enc.end_line,
            started_at: enc.start_time,
            ended_at: enc.end_time,
            duration_ms: (enc.end_time - enc.start_time).max(0) as u64,
            outcome: enc.outcome,
        })
        .collect();

    Ok(ParsedLog {
        log_file,
        encounters,
    })
}

/// Parse an ESO combat log file and detect encounters using BufReader.
///
/// Reads the file line by line. Malformed lines are silently skipped.
/// Returns `Err` only when the file cannot be opened.
pub fn parse_log_file<P: AsRef<Path>>(path: P) -> io::Result<Vec<ParsedEncounter>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    Ok(parse_log_from_reader(reader))
}

// ── Internal parsing implementation ────────────────────────────────────

/// Inner implementation that works on any `BufRead`, enabling tests with
/// `Cursor` without touching the filesystem.
fn parse_log_from_reader<R: Read>(reader: BufReader<R>) -> Vec<ParsedEncounter> {
    let lines = read_parsed_lines(reader);
    detect_encounters(&lines)
}

fn read_parsed_lines<R: Read>(reader: BufReader<R>) -> Vec<LogLine> {
    let mut parsed = Vec::new();
    for (line_number, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Some(parsed_line) = parse_line(line_number, &line) {
            parsed.push(parsed_line);
        }
    }
    parsed
}

fn parse_line(line_number: usize, line: &str) -> Option<LogLine> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let mut parts = line.splitn(3, ',');
    let timestamp_str = parts.next()?;
    let event_type = parts.next()?.trim().to_string();
    let rest = parts.next().unwrap_or("");

    let timestamp = timestamp_str.trim().parse::<i64>().ok()?;

    if event_type.is_empty() {
        return None;
    }

    let fields: Vec<String> = if rest.is_empty() {
        Vec::new()
    } else {
        rest.split(',').map(|f| f.trim().to_string()).collect()
    };

    Some(LogLine {
        line_number,
        timestamp,
        event_type,
        fields,
    })
}

fn detect_encounters(lines: &[LogLine]) -> Vec<ParsedEncounter> {
    let mut encounters = Vec::new();
    let mut last_combat_event_ts: Option<i64> = None;
    let mut current_encounter: Vec<usize> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if line.event_type == "COMBAT_EVENT" {
            if let Some(last_ts) = last_combat_event_ts {
                let gap = line.timestamp - last_ts;

                if current_encounter.is_empty() {
                    current_encounter.push(i);
                } else if gap > END_ENCOUNTER_GAP_MS {
                    encounters.push(build_encounter(lines, &current_encounter));
                    current_encounter.clear();
                    current_encounter.push(i);
                } else {
                    current_encounter.push(i);
                }
            } else {
                current_encounter.push(i);
            }

            last_combat_event_ts = Some(line.timestamp);
        } else if line.event_type == "END_COMBAT" || line.event_type == "END_LOG" {
            if !current_encounter.is_empty() {
                current_encounter.push(i);
                encounters.push(build_encounter(lines, &current_encounter));
                current_encounter.clear();
            }
        }
    }

    if !current_encounter.is_empty() {
        encounters.push(build_encounter(lines, &current_encounter));
    }

    encounters
}

fn build_encounter(all_lines: &[LogLine], indices: &[usize]) -> ParsedEncounter {
    let first = &all_lines[indices[0]];
    let last = &all_lines[*indices.last().unwrap()];

    let boss = detect_boss(all_lines, indices);
    let boss_name = boss
        .as_ref()
        .map(|b| b.name.clone())
        .unwrap_or_else(|| "Unknown Encounter".to_string());

    let outcome = if let Some(ref boss_info) = boss {
        if boss_info.died && is_boss_death_last(all_lines, indices, &boss_info.name) {
            EncounterOutcome::Kill
        } else {
            EncounterOutcome::Wipe
        }
    } else {
        EncounterOutcome::Wipe
    };

    ParsedEncounter {
        name: boss_name,
        outcome,
        start_line: first.line_number,
        end_line: last.line_number,
        start_time: first.timestamp,
        end_time: last.timestamp,
    }
}

fn is_boss_death_last(all_lines: &[LogLine], indices: &[usize], boss_name: &str) -> bool {
    for &idx in indices.iter().rev() {
        let line = &all_lines[idx];
        if line.event_type == "COMBAT_EVENT" {
            return is_unit_death_for(line, boss_name);
        }
    }
    false
}

fn detect_boss(all_lines: &[LogLine], indices: &[usize]) -> Option<BossCandidate> {
    let mut best: Option<BossCandidate> = None;
    let mut boss_died = false;

    for &idx in indices {
        let line = &all_lines[idx];
        if line.event_type != "COMBAT_EVENT" {
            continue;
        }

        let target_name = line.fields.get(3).map(|s| s.as_str()).unwrap_or("");
        let target_type = line.fields.get(4).map(|s| s.as_str()).unwrap_or("");
        let target_health: i64 = line
            .fields
            .get(5)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let is_boss = target_name.starts_with("BOSS_")
            || (target_type == "MONSTER" && target_health > 500_000);

        if is_boss && !target_name.is_empty() {
            let is_death = line
                .fields
                .first()
                .map(|s| s == "unit_death")
                .unwrap_or(false);
            if is_death {
                boss_died = true;
            }
            if best.is_none() || best.as_ref().is_some_and(|b| b.name == target_name) {
                best = Some(BossCandidate {
                    name: target_name.to_string(),
                    died: boss_died,
                });
            }
        }

        let source_name = line.fields.get(1).map(|s| s.as_str()).unwrap_or("");
        let source_type = line.fields.get(2).map(|s| s.as_str()).unwrap_or("");

        let source_is_boss = source_name.starts_with("BOSS_")
            || (source_type == "MONSTER" && target_health > 500_000);

        if source_is_boss && !source_name.is_empty() && best.is_none() {
            best = Some(BossCandidate {
                name: source_name.to_string(),
                died: false,
            });
        }
    }

    if let Some(ref mut b) = best {
        if boss_died {
            b.died = true;
        }
    }

    best
}

fn is_unit_death_for(line: &LogLine, unit_name: &str) -> bool {
    let subtype = line.fields.first().map(|s| s.as_str()).unwrap_or("");
    let target_name = line.fields.get(3).map(|s| s.as_str()).unwrap_or("");
    subtype == "unit_death" && target_name == unit_name
}

// ── Helpers ────────────────────────────────────────────────────────────

/// Produce a short, deterministic hex ID from a file path.
fn stable_id(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}
