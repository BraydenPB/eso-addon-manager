use super::types::{AbilityInfo, CombatEvent, EventType, UnitInfo};

/// Parse a single ESO combat log line into a `CombatEvent`.
///
/// ESO combat log lines follow this general format:
///   `timestamp,event_code,args...`
///
/// The exact field layout varies by event code. This parser handles the
/// most common event types and returns `None` for lines it cannot parse
/// (blank lines, comments, unknown formats).
pub fn parse_line(line: &str) -> Option<CombatEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let fields: Vec<&str> = line.split(',').collect();
    if fields.len() < 3 {
        return None;
    }

    let timestamp = parse_timestamp(fields[0])?;
    let raw_code = fields[1].trim().parse::<u32>().ok()?;
    let event_type = classify_event(raw_code);

    // Parse source/target/ability from positional fields.
    // The layout for damage/heal events is:
    //   timestamp, code, source_id, source_name, target_id, target_name,
    //   ability_id, ability_name, value, overflow, crit_flag, ...
    //
    // We gracefully handle shorter lines by defaulting missing fields.

    let source = parse_unit(&fields, 2, 3);
    let target = parse_unit(&fields, 4, 5);
    let ability = parse_ability(&fields, 6, 7);
    let value = field_i64(&fields, 8);
    let overflow = field_i64(&fields, 9);
    let is_crit = field_bool(&fields, 10);

    Some(CombatEvent {
        timestamp,
        event_type,
        source,
        target,
        ability,
        value,
        overflow,
        is_crit,
        raw_code,
    })
}

/// Parse a chunk of log text (multiple lines) into a vector of events.
/// Skips lines that cannot be parsed.
pub fn parse_chunk(text: &str) -> Vec<CombatEvent> {
    text.lines().filter_map(parse_line).collect()
}

/// Parse a full log file's contents into events, returning both the events
/// and the byte offsets of each line for encounter byte-range tracking.
pub fn parse_with_offsets(text: &str) -> Vec<(CombatEvent, u64, u64)> {
    let mut results = Vec::new();
    let mut byte_offset: u64 = 0;

    // Detect line ending style: CRLF (Windows) vs LF (Unix)
    let line_ending_len: u64 = if text.contains("\r\n") { 2 } else { 1 };

    for line in text.lines() {
        let line_bytes = line.len() as u64;
        if let Some(event) = parse_line(line) {
            results.push((event, byte_offset, byte_offset + line_bytes));
        }
        byte_offset += line_bytes + line_ending_len;
    }

    results
}

// ── Internal helpers ────────────────────────────────────────────────────

/// Parse the timestamp portion of a log line. ESO uses millisecond timestamps.
fn parse_timestamp(field: &str) -> Option<u64> {
    field.trim().parse::<u64>().ok()
}

/// Map a raw event code to our `EventType` enum.
/// These codes are derived from community documentation of the ESO log format.
fn classify_event(code: u32) -> EventType {
    match code {
        1 => EventType::DamageDealt,
        2 => EventType::DamageTaken,
        3 => EventType::HealingDone,
        4 => EventType::HealingTaken,
        5 => EventType::BuffApplied,
        6 => EventType::BuffRemoved,
        7 => EventType::DebuffApplied,
        8 => EventType::DebuffRemoved,
        9 => EventType::CombatStart,
        10 => EventType::CombatEnd,
        11 => EventType::UnitDeath,
        12 => EventType::UnitResurrected,
        13 => EventType::ResourceChange,
        _ => EventType::Unknown,
    }
}

/// Extract a unit (source or target) from positional fields.
fn parse_unit(fields: &[&str], id_idx: usize, name_idx: usize) -> UnitInfo {
    let unit_id = fields
        .get(id_idx)
        .and_then(|f| f.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let name = fields
        .get(name_idx)
        .map(|f| unquote(f.trim()))
        .unwrap_or_default();
    let is_player = name.starts_with('@') || (unit_id > 0 && unit_id < 100_000);

    UnitInfo {
        unit_id,
        name,
        is_player,
    }
}

/// Extract an ability from positional fields.
fn parse_ability(fields: &[&str], id_idx: usize, name_idx: usize) -> AbilityInfo {
    let ability_id = fields
        .get(id_idx)
        .and_then(|f| f.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let name = fields
        .get(name_idx)
        .map(|f| unquote(f.trim()))
        .unwrap_or_default();

    AbilityInfo { ability_id, name }
}

/// Safely read a field as i64, defaulting to 0.
fn field_i64(fields: &[&str], idx: usize) -> i64 {
    fields
        .get(idx)
        .and_then(|f| f.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

/// Safely read a field as bool (1/true = true, anything else = false).
fn field_bool(fields: &[&str], idx: usize) -> bool {
    fields
        .get(idx)
        .map(|f| {
            let trimmed = f.trim();
            trimmed == "1" || trimmed.eq_ignore_ascii_case("true")
        })
        .unwrap_or(false)
}

/// Remove surrounding quotes from a string field if present.
fn unquote(s: &str) -> String {
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_damage_line() {
        let line = "1000,1,42,\"@PlayerOne\",99,\"Mud Crab\",12345,\"Flame Reach\",500,0,0";
        let event = parse_line(line).expect("should parse damage line");
        assert_eq!(event.timestamp, 1000);
        assert_eq!(event.event_type, EventType::DamageDealt);
        assert_eq!(event.source.name, "@PlayerOne");
        assert!(event.source.is_player);
        assert_eq!(event.target.name, "Mud Crab");
        assert_eq!(event.ability.name, "Flame Reach");
        assert_eq!(event.value, 500);
        assert!(!event.is_crit);
    }

    #[test]
    fn parse_crit_heal_line() {
        let line = "2000,3,42,\"@Healer\",43,\"@Tank\",9999,\"Healing Springs\",1200,100,1";
        let event = parse_line(line).expect("should parse heal line");
        assert_eq!(event.event_type, EventType::HealingDone);
        assert!(event.is_crit);
        assert_eq!(event.value, 1200);
        assert_eq!(event.overflow, 100);
    }

    #[test]
    fn skip_blank_lines() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
    }

    #[test]
    fn skip_too_short() {
        assert!(parse_line("123,1").is_none());
    }

    #[test]
    fn parse_chunk_filters_invalid() {
        let text = "1000,1,1,\"A\",2,\"B\",10,\"Slash\",100,0,0\n\nbad\n2000,3,1,\"A\",2,\"B\",10,\"Heal\",50,0,0\n";
        let events = parse_chunk(text);
        assert_eq!(events.len(), 2);
    }
}
