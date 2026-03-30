#![cfg(test)]

use super::*;
use std::io::{BufReader, Cursor};

/// Helper: run parse_log_from_reader on a string.
fn parse_from_str(input: &str) -> Vec<ParsedEncounter> {
    let cursor = Cursor::new(input.as_bytes().to_vec());
    parse_log_from_reader(BufReader::new(cursor))
}

// ── Line parsing ──────────────────────────────────────────────────────────

#[test]
fn parse_line_valid_combat_event() {
    let line = "1234567890123,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Dragon,MONSTER,1000000,Fire,500";
    let parsed = parse_line(0, line).unwrap();
    assert_eq!(parsed.timestamp, 1234567890123);
    assert_eq!(parsed.event_type, "COMBAT_EVENT");
    assert_eq!(parsed.fields.len(), 8);
    assert_eq!(parsed.fields[3], "BOSS_Dragon");
}

#[test]
fn parse_line_skips_blank() {
    assert!(parse_line(0, "").is_none());
    assert!(parse_line(0, "   ").is_none());
}

#[test]
fn parse_line_skips_malformed() {
    // No comma at all.
    assert!(parse_line(0, "just_a_string").is_none());
    // Non-numeric timestamp.
    assert!(parse_line(0, "abc,COMBAT_EVENT,stuff").is_none());
    // Timestamp only, no event type.
    assert!(parse_line(0, "12345,").is_none());
}

#[test]
fn parse_line_no_extra_fields() {
    let line = "100,BEGIN_LOG";
    let parsed = parse_line(0, line).unwrap();
    assert_eq!(parsed.timestamp, 100);
    assert_eq!(parsed.event_type, "BEGIN_LOG");
    assert!(parsed.fields.is_empty());
}

// ── Encounter detection ───────────────────────────────────────────────────

#[test]
fn single_encounter_detected() {
    let log = "\
1000,BEGIN_LOG
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Lich,MONSTER,800000,Slash,100
2000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Lich,MONSTER,800000,Slash,200
3000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_Lich,MONSTER,800000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].name, "BOSS_Lich");
    assert_eq!(encounters[0].outcome, EncounterOutcome::Kill);
    assert_eq!(encounters[0].start_line, 1); // 0-indexed, skipping BEGIN_LOG
    assert_eq!(encounters[0].end_line, 3);
    assert_eq!(encounters[0].start_time, 1000);
    assert_eq!(encounters[0].end_time, 3000);
}

#[test]
fn encounter_wipe_when_boss_not_killed() {
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Dragon,MONSTER,900000,Fire,500
2000,COMBAT_EVENT,damage,BOSS_Dragon,MONSTER,@Player,PLAYER,0,Bite,300
3000,COMBAT_EVENT,unit_death,BOSS_Dragon,MONSTER,@Player,PLAYER,0,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].name, "BOSS_Dragon");
    // Last event is a unit_death for the *player*, not the boss → Wipe.
    assert_eq!(encounters[0].outcome, EncounterOutcome::Wipe);
}

#[test]
fn two_encounters_split_by_gap() {
    // 6 second gap between events at ts 2000 and 8000 → new encounter.
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_A,MONSTER,600000,Slash,100
2000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_A,MONSTER,600000,,0
8000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_B,MONSTER,700000,Fire,200
9000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_B,MONSTER,700000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 2);
    assert_eq!(encounters[0].name, "BOSS_A");
    assert_eq!(encounters[1].name, "BOSS_B");
}

#[test]
fn encounter_ends_on_end_combat_marker() {
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Troll,MONSTER,600000,Slash,100
2000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Troll,MONSTER,600000,Slash,200
2500,END_COMBAT
3000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Ogre,MONSTER,700000,Fire,300
4000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_Ogre,MONSTER,700000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 2);
    assert_eq!(encounters[0].name, "BOSS_Troll");
    // END_COMBAT is included in the encounter.
    assert_eq!(encounters[0].end_line, 2);
    assert_eq!(encounters[1].name, "BOSS_Ogre");
    assert_eq!(encounters[1].outcome, EncounterOutcome::Kill);
}

#[test]
fn monster_with_high_hp_detected_as_boss() {
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,Big Ogre,MONSTER,750000,Slash,100
2000,COMBAT_EVENT,unit_death,@Player,PLAYER,Big Ogre,MONSTER,750000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    // "Big Ogre" has type MONSTER and health > 500000, so it's the boss.
    assert_eq!(encounters[0].name, "Big Ogre");
    assert_eq!(encounters[0].outcome, EncounterOutcome::Kill);
}

#[test]
fn unknown_encounter_when_no_boss() {
    // Low-HP targets that don't match boss criteria.
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,Mud Crab,CRITTER,500,Slash,10
2000,COMBAT_EVENT,damage,@Player,PLAYER,Mud Crab,CRITTER,500,Slash,10
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].name, "Unknown Encounter");
    assert_eq!(encounters[0].outcome, EncounterOutcome::Wipe);
}

#[test]
fn malformed_lines_skipped_gracefully() {
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_X,MONSTER,600000,Slash,100
not_a_timestamp,BAD_LINE
,,,
2000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_X,MONSTER,600000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].name, "BOSS_X");
    assert_eq!(encounters[0].outcome, EncounterOutcome::Kill);
    // Line numbers should reflect the original file positions (0-indexed).
    assert_eq!(encounters[0].start_line, 0);
    assert_eq!(encounters[0].end_line, 3);
}

#[test]
fn empty_input_returns_no_encounters() {
    let encounters = parse_from_str("");
    assert!(encounters.is_empty());
}

#[test]
fn no_combat_events_returns_no_encounters() {
    let log = "\
1000,BEGIN_LOG
2000,END_LOG
";
    let encounters = parse_from_str(log);
    assert!(encounters.is_empty());
}

#[test]
fn encounter_gap_within_threshold_stays_together() {
    // Events 4 seconds apart — within 5s threshold, same encounter.
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_A,MONSTER,600000,Slash,100
5000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_A,MONSTER,600000,Slash,200
9000,COMBAT_EVENT,unit_death,@Player,PLAYER,BOSS_A,MONSTER,600000,,0
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].name, "BOSS_A");
    assert_eq!(encounters[0].outcome, EncounterOutcome::Kill);
}

#[test]
fn end_log_finalizes_encounter() {
    let log = "\
1000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Z,MONSTER,600000,Slash,100
2000,COMBAT_EVENT,damage,@Player,PLAYER,BOSS_Z,MONSTER,600000,Slash,200
3000,END_LOG
";
    let encounters = parse_from_str(log);
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].end_line, 2); // END_LOG line included
}
