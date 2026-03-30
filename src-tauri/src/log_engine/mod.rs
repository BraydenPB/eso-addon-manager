mod tests;

use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;

/// Outcome of a detected encounter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncounterOutcome {
    Kill,
    Wipe,
}

/// A detected encounter with its metadata.
#[derive(Debug, Clone)]
pub struct ParsedEncounter {
    /// Human-readable encounter name (boss name or "Unknown Encounter").
    pub name: String,
    /// Whether the encounter ended in a kill or a wipe.
    pub outcome: EncounterOutcome,
    /// 0-indexed line number where the encounter starts.
    pub start_line: usize,
    /// 0-indexed line number where the encounter ends (inclusive).
    pub end_line: usize,
    /// Millisecond timestamp of the first event.
    pub start_time: i64,
    /// Millisecond timestamp of the last event.
    pub end_time: i64,
}

/// Gap threshold (ms) after the last COMBAT_EVENT to consider a new encounter started.
const NEW_ENCOUNTER_GAP_MS: i64 = 5_000;

/// Gap threshold (ms) of no COMBAT_EVENT activity to end the current encounter.
const END_ENCOUNTER_GAP_MS: i64 = 10_000;

/// A parsed line from the combat log.
struct LogLine {
    /// 0-indexed line number.
    line_number: usize,
    /// Millisecond timestamp.
    timestamp: i64,
    /// The event type keyword (e.g. "COMBAT_EVENT", "BEGIN_LOG").
    event_type: String,
    /// Remaining comma-separated fields after timestamp and event type.
    fields: Vec<String>,
}

/// Tracks a boss candidate detected during an encounter.
struct BossCandidate {
    name: String,
    /// Whether the boss had a unit_death event in this encounter.
    died: bool,
}

/// Parse an ESO combat log file and detect encounters.
///
/// Reads the file line by line using `BufReader`. Malformed lines are
/// silently skipped. Returns `Err` only when the file cannot be opened.
pub fn parse_log<P: AsRef<Path>>(path: P) -> io::Result<Vec<ParsedEncounter>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    Ok(parse_log_from_reader(reader))
}

/// Inner implementation that works on any `BufRead`, enabling tests with
/// `Cursor` without touching the filesystem.
fn parse_log_from_reader<R: Read>(reader: BufReader<R>) -> Vec<ParsedEncounter> {
    let lines = read_parsed_lines(reader);
    detect_encounters(&lines)
}

/// Read and parse all valid lines from the reader.
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

/// Parse a single log line. Returns `None` for malformed lines.
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

/// Detect encounters from parsed log lines using the specified heuristics.
fn detect_encounters(lines: &[LogLine]) -> Vec<ParsedEncounter> {
    let mut encounters = Vec::new();

    // Track state for encounter detection.
    let mut last_combat_event_ts: Option<i64> = None;
    // Indices into `lines` for events belonging to the current encounter.
    let mut current_encounter: Vec<usize> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if line.event_type == "COMBAT_EVENT" {
            if let Some(last_ts) = last_combat_event_ts {
                let gap = line.timestamp - last_ts;

                if current_encounter.is_empty() {
                    // No active encounter; gap > 5s since last combat event
                    // means this starts a new encounter (which is always true
                    // when there's no active encounter and gap > 5s).
                    if gap > NEW_ENCOUNTER_GAP_MS {
                        current_encounter.push(i);
                    } else {
                        // Gap <= 5s but no active encounter — this shouldn't
                        // normally happen unless the prior encounter was just
                        // finalized. Start a new one anyway.
                        current_encounter.push(i);
                    }
                } else {
                    // Active encounter exists — check if this event belongs
                    // to it or signals a boundary.
                    if gap > END_ENCOUNTER_GAP_MS {
                        // End previous encounter due to inactivity.
                        encounters.push(build_encounter(lines, &current_encounter));
                        current_encounter.clear();
                        // This event starts a new encounter.
                        current_encounter.push(i);
                    } else {
                        // Continuation of the current encounter.
                        current_encounter.push(i);
                    }
                }
            } else {
                // Very first COMBAT_EVENT — starts the first encounter.
                current_encounter.push(i);
            }

            last_combat_event_ts = Some(line.timestamp);
        } else if line.event_type == "END_COMBAT" || line.event_type == "END_LOG" {
            // Explicit end marker — finalize current encounter if one is active.
            if !current_encounter.is_empty() {
                // Include this line in the encounter so end_line is correct.
                current_encounter.push(i);
                encounters.push(build_encounter(lines, &current_encounter));
                current_encounter.clear();
            }
        }
        // Non-COMBAT_EVENT, non-END_COMBAT lines (e.g. BEGIN_LOG) are
        // ignored for encounter detection.
    }

    // Finalize any remaining encounter.
    if !current_encounter.is_empty() {
        encounters.push(build_encounter(lines, &current_encounter));
    }

    encounters
}

/// Build a `ParsedEncounter` from the indices of lines that belong to it.
fn build_encounter(all_lines: &[LogLine], indices: &[usize]) -> ParsedEncounter {
    let first = &all_lines[indices[0]];
    let last = &all_lines[*indices.last().unwrap()];

    let boss = detect_boss(all_lines, indices);
    let boss_name = boss
        .as_ref()
        .map(|b| b.name.clone())
        .unwrap_or_else(|| "Unknown Encounter".to_string());

    // Kill if the last event in the encounter is a unit_death for the boss.
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

/// Check if the last COMBAT_EVENT in the encounter is a unit_death for the boss.
fn is_boss_death_last(all_lines: &[LogLine], indices: &[usize], boss_name: &str) -> bool {
    // Walk backwards to find the last COMBAT_EVENT.
    for &idx in indices.iter().rev() {
        let line = &all_lines[idx];
        if line.event_type == "COMBAT_EVENT" {
            return is_unit_death_for(line, boss_name);
        }
    }
    false
}

/// Detect the boss for an encounter.
///
/// A unit is considered a boss if:
///  - Its name starts with "BOSS_", OR
///  - It has unit type "MONSTER" and health > 500_000
///
/// Scans COMBAT_EVENT fields for these patterns. Field layout assumed:
///   `COMBAT_EVENT,event_subtype,source_name,source_type,target_name,target_type,target_health,...`
///
/// field indices (0-based within the fields after timestamp,COMBAT_EVENT):
///   0: event_subtype (e.g. "damage", "heal", "unit_death")
///   1: source_name
///   2: source_type (e.g. "PLAYER", "MONSTER")
///   3: target_name
///   4: target_type
///   5: target_health (max HP as integer)
fn detect_boss(all_lines: &[LogLine], indices: &[usize]) -> Option<BossCandidate> {
    let mut best: Option<BossCandidate> = None;
    let mut boss_died = false;

    for &idx in indices {
        let line = &all_lines[idx];
        if line.event_type != "COMBAT_EVENT" {
            continue;
        }

        // Check target for boss criteria.
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

        // Also check source for boss criteria.
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

    // Update died status.
    if let Some(ref mut b) = best {
        if boss_died {
            b.died = true;
        }
    }

    best
}

/// Check whether a COMBAT_EVENT line represents a unit_death for the given unit.
fn is_unit_death_for(line: &LogLine, unit_name: &str) -> bool {
    let subtype = line.fields.first().map(|s| s.as_str()).unwrap_or("");
    let target_name = line.fields.get(3).map(|s| s.as_str()).unwrap_or("");
    subtype == "unit_death" && target_name == unit_name
}
