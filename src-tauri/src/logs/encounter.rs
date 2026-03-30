use super::types::{CombatEvent, Encounter, EventType, PlayerRole, PlayerSummary};
use std::collections::HashMap;

/// Gap in milliseconds between events that signals the end of an encounter
/// when no explicit combat-end event is received.
const ENCOUNTER_GAP_MS: u64 = 15_000;

/// Detect encounters from a stream of combat events with byte offsets.
///
/// Encounter boundaries are determined by:
/// 1. Explicit `CombatStart` / `CombatEnd` event pairs.
/// 2. Time gaps exceeding `ENCOUNTER_GAP_MS` between consecutive events.
///
/// Within each encounter we aggregate per-player stats and attempt to
/// identify the boss (highest-HP non-player target).
pub fn detect_encounters(events_with_offsets: &[(CombatEvent, u64, u64)]) -> Vec<Encounter> {
    if events_with_offsets.is_empty() {
        return Vec::new();
    }

    let mut encounters: Vec<Encounter> = Vec::new();
    let mut current_events: Vec<&(CombatEvent, u64, u64)> = Vec::new();
    let mut in_combat = false;

    for entry in events_with_offsets {
        let event = &entry.0;

        match event.event_type {
            EventType::CombatStart => {
                // Finalize any in-progress encounter before starting a new one
                if !current_events.is_empty() {
                    encounters.push(build_encounter(encounters.len(), &current_events));
                    current_events.clear();
                }
                in_combat = true;
                current_events.push(entry);
            }
            EventType::CombatEnd => {
                current_events.push(entry);
                if in_combat {
                    encounters.push(build_encounter(encounters.len(), &current_events));
                    current_events.clear();
                    in_combat = false;
                }
            }
            _ => {
                // Check for time gap indicating encounter boundary
                if let Some(last) = current_events.last() {
                    if event.timestamp.saturating_sub(last.0.timestamp) > ENCOUNTER_GAP_MS {
                        // Gap detected — finalize current encounter
                        if !current_events.is_empty() {
                            encounters.push(build_encounter(encounters.len(), &current_events));
                            current_events.clear();
                        }
                    }
                }
                current_events.push(entry);
            }
        }
    }

    // Finalize any remaining events
    if !current_events.is_empty() {
        encounters.push(build_encounter(encounters.len(), &current_events));
    }

    encounters
}

/// Build an `Encounter` from a slice of events belonging to a single fight.
fn build_encounter(index: usize, events: &[&(CombatEvent, u64, u64)]) -> Encounter {
    let start_time = events.first().map(|e| e.0.timestamp).unwrap_or(0);
    let end_time = events.last().map(|e| e.0.timestamp).unwrap_or(0);
    let duration_ms = end_time.saturating_sub(start_time);
    let duration_secs = duration_ms as f64 / 1000.0;

    let byte_start = events.first().map(|e| e.1).unwrap_or(0);
    let byte_end = events.last().map(|e| e.2).unwrap_or(0);

    let boss_name = infer_boss_name(events);
    let is_kill = check_boss_killed(events, &boss_name);
    let players = aggregate_players(events, duration_secs);

    let group_dps: f64 = players.iter().map(|p| p.dps).sum();
    let group_hps: f64 = players.iter().map(|p| p.hps).sum();
    let total_deaths: u32 = players.iter().map(|p| p.deaths).sum();

    Encounter {
        index,
        boss_name,
        is_kill,
        start_time,
        end_time,
        duration_secs,
        players,
        group_dps,
        group_hps,
        total_deaths,
        byte_start,
        byte_end,
    }
}

/// Infer the boss name from the events. We pick the most-damaged non-player
/// target as a heuristic for the "boss".
fn infer_boss_name(events: &[&(CombatEvent, u64, u64)]) -> String {
    let mut target_damage: HashMap<String, i64> = HashMap::new();

    for entry in events {
        let event = &entry.0;
        if event.event_type == EventType::DamageDealt && !event.target.is_player {
            *target_damage
                .entry(event.target.name.clone())
                .or_insert(0) += event.value;
        }
    }

    target_damage
        .into_iter()
        .max_by_key(|(_, dmg)| *dmg)
        .map(|(name, _)| name)
        .unwrap_or_else(|| "Unknown".to_string())
}

/// Check whether the inferred boss died during this encounter.
fn check_boss_killed(events: &[&(CombatEvent, u64, u64)], boss_name: &str) -> bool {
    events.iter().any(|entry| {
        let event = &entry.0;
        event.event_type == EventType::UnitDeath && event.target.name == boss_name
    })
}

/// Aggregate per-player statistics for the encounter.
fn aggregate_players(events: &[&(CombatEvent, u64, u64)], duration_secs: f64) -> Vec<PlayerSummary> {
    struct Accumulator {
        damage_dealt: i64,
        healing_done: i64,
        deaths: u32,
    }

    let mut players: HashMap<String, Accumulator> = HashMap::new();

    for entry in events {
        let event = &entry.0;

        // Track source player stats
        if event.source.is_player && !event.source.name.is_empty() {
            let acc = players.entry(event.source.name.clone()).or_insert(Accumulator {
                damage_dealt: 0,
                healing_done: 0,
                deaths: 0,
            });

            match event.event_type {
                EventType::DamageDealt => acc.damage_dealt += event.value,
                EventType::HealingDone => acc.healing_done += event.value,
                _ => {}
            }
        }

        // Track deaths
        if event.event_type == EventType::UnitDeath && event.target.is_player {
            players
                .entry(event.target.name.clone())
                .or_insert(Accumulator {
                    damage_dealt: 0,
                    healing_done: 0,
                    deaths: 0,
                })
                .deaths += 1;
        }
    }

    let safe_duration = if duration_secs > 0.0 {
        duration_secs
    } else {
        1.0
    };

    let mut result: Vec<PlayerSummary> = players
        .into_iter()
        .map(|(name, acc)| {
            let dps = acc.damage_dealt as f64 / safe_duration;
            let hps = acc.healing_done as f64 / safe_duration;
            let role = infer_role(acc.damage_dealt, acc.healing_done);

            PlayerSummary {
                name,
                role,
                damage_dealt: acc.damage_dealt,
                dps,
                healing_done: acc.healing_done,
                hps,
                deaths: acc.deaths,
            }
        })
        .collect();

    // Sort by DPS descending
    result.sort_by(|a, b| b.dps.partial_cmp(&a.dps).unwrap_or(std::cmp::Ordering::Equal));

    result
}

/// Heuristic role inference based on damage vs healing ratios.
fn infer_role(damage: i64, healing: i64) -> PlayerRole {
    if damage == 0 && healing == 0 {
        return PlayerRole::Unknown;
    }

    let total = (damage + healing) as f64;
    if total == 0.0 {
        return PlayerRole::Unknown;
    }

    let heal_ratio = healing as f64 / total;

    if heal_ratio > 0.6 {
        PlayerRole::Healer
    } else if heal_ratio > 0.3 {
        // Mixed — could be a tank or off-healer. Default to tank if low damage.
        PlayerRole::Tank
    } else {
        PlayerRole::DamageDealer
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logs::types::{AbilityInfo, UnitInfo};

    fn make_event(ts: u64, event_type: EventType, source_name: &str, target_name: &str, value: i64, source_player: bool, target_player: bool) -> (CombatEvent, u64, u64) {
        (
            CombatEvent {
                timestamp: ts,
                event_type,
                source: UnitInfo {
                    unit_id: 1,
                    name: source_name.to_string(),
                    is_player: source_player,
                },
                target: UnitInfo {
                    unit_id: 2,
                    name: target_name.to_string(),
                    is_player: target_player,
                },
                ability: AbilityInfo {
                    ability_id: 100,
                    name: "Test Ability".to_string(),
                },
                value,
                overflow: 0,
                is_crit: false,
                raw_code: event_type as u32,
            },
            0,
            0,
        )
    }

    #[test]
    fn detect_single_encounter_by_gap() {
        let events = vec![
            make_event(1000, EventType::DamageDealt, "@Player", "Boss", 100, true, false),
            make_event(2000, EventType::DamageDealt, "@Player", "Boss", 200, true, false),
            make_event(3000, EventType::UnitDeath, "@Player", "Boss", 0, true, false),
        ];

        let encounters = detect_encounters(&events);
        assert_eq!(encounters.len(), 1);
        assert_eq!(encounters[0].boss_name, "Boss");
        assert!(encounters[0].is_kill);
    }

    #[test]
    fn detect_two_encounters_by_gap() {
        let events = vec![
            make_event(1000, EventType::DamageDealt, "@Player", "Boss1", 100, true, false),
            make_event(2000, EventType::DamageDealt, "@Player", "Boss1", 200, true, false),
            // 20s gap -> new encounter
            make_event(22000, EventType::DamageDealt, "@Player", "Boss2", 300, true, false),
            make_event(23000, EventType::DamageDealt, "@Player", "Boss2", 400, true, false),
        ];

        let encounters = detect_encounters(&events);
        assert_eq!(encounters.len(), 2);
        assert_eq!(encounters[0].boss_name, "Boss1");
        assert_eq!(encounters[1].boss_name, "Boss2");
    }

    #[test]
    fn detect_encounter_by_combat_events() {
        let events = vec![
            make_event(1000, EventType::CombatStart, "@Player", "", 0, true, false),
            make_event(2000, EventType::DamageDealt, "@Player", "Dragon", 500, true, false),
            make_event(3000, EventType::CombatEnd, "@Player", "", 0, true, false),
        ];

        let encounters = detect_encounters(&events);
        assert_eq!(encounters.len(), 1);
        assert_eq!(encounters[0].boss_name, "Dragon");
    }

    #[test]
    fn player_role_inference() {
        assert_eq!(infer_role(10000, 100), PlayerRole::DamageDealer);
        assert_eq!(infer_role(100, 10000), PlayerRole::Healer);
        assert_eq!(infer_role(5000, 5000), PlayerRole::Tank);
        assert_eq!(infer_role(0, 0), PlayerRole::Unknown);
    }
}
