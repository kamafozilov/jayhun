//! Read-only, bounded recovery from native Codex rollout metadata.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs::{self, Metadata, OpenOptions},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryInput {
    provider_session_id: String,
    turns: Vec<LegacyTurn>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyTurn {
    block_id: String,
    started_at: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Status {
    Complete,
    NotFound,
    Ambiguous,
    Limit,
    Incomplete,
    Unavailable,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryResult {
    status: Status,
    matches: Vec<RecoveredTurn>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveredTurn {
    block_id: String,
    provider_session_id: String,
    provider_turn_id: String,
    model: String,
    provider_started_at: f64,
    source: &'static str,
}
impl RecoveryResult {
    fn empty(status: Status) -> Self {
        Self {
            status,
            matches: vec![],
        }
    }
}
#[derive(Clone, Debug)]
struct ProviderTurn {
    id: String,
    started_at: f64,
    model: String,
}
#[derive(Clone, Copy)]
struct Limits {
    entries: usize,
    candidates: usize,
    bytes: u64,
    line: usize,
    elapsed: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            entries: 20_000,
            candidates: 16,
            bytes: 32 * 1024 * 1024,
            line: 4 * 1024 * 1024,
            elapsed: Duration::from_secs(2),
        }
    }
}
struct Budget {
    limits: Limits,
    start: Instant,
    entries: usize,
}
impl Budget {
    fn new(limits: Limits) -> Self {
        Self {
            limits,
            start: Instant::now(),
            entries: 0,
        }
    }
    fn check(&self) -> Result<(), Status> {
        if self.start.elapsed() >= self.limits.elapsed {
            Err(Status::Limit)
        } else {
            Ok(())
        }
    }
    fn entry(&mut self) -> Result<(), Status> {
        self.check()?;
        self.entries += 1;
        if self.entries > self.limits.entries {
            Err(Status::Limit)
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
pub(crate) async fn recover_codex_turn_identities(input: RecoveryInput) -> RecoveryResult {
    tauri::async_runtime::spawn_blocking(move || recover(input))
        .await
        .unwrap_or_else(|_| RecoveryResult::empty(Status::Incomplete))
}

fn recover(input: RecoveryInput) -> RecoveryResult {
    if !uuid(&input.provider_session_id) {
        return RecoveryResult::empty(Status::Unavailable);
    }
    // Bound both parsing and the correlation matrix independently of log size.
    if input.turns.len() > 4096 || input.turns.iter().any(|t| t.block_id.len() > 1024) {
        return RecoveryResult::empty(Status::Limit);
    }
    if !valid_turns(&input.turns) {
        return RecoveryResult::empty(Status::Ambiguous);
    }
    let root = match effective_root() {
        Ok(root) => root,
        Err(status) => return RecoveryResult::empty(status),
    };
    match coalesced_scan(root, input.provider_session_id.to_ascii_lowercase()) {
        Ok(turns) => correlate(&input, &turns),
        Err(status) => RecoveryResult::empty(status),
    }
}

// Inspect exactly the environment overrides used by the child, without spawning it.
fn effective_root() -> Result<PathBuf, Status> {
    let mut child = std::process::Command::new("codex");
    crate::harness::apply_gui_env(&mut child);
    let effective = |key: &str| -> Option<OsString> {
        child
            .get_envs()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.map(OsString::from))
            .unwrap_or_else(|| std::env::var_os(key))
    };
    #[cfg(windows)]
    let home = effective("USERPROFILE");
    #[cfg(not(windows))]
    let home = effective("HOME");
    resolve_root(effective("CODEX_HOME"), home)
}
fn resolve_root(
    override_home: Option<OsString>,
    home: Option<OsString>,
) -> Result<PathBuf, Status> {
    let path = match override_home {
        Some(path) => PathBuf::from(path),
        None => {
            let home = PathBuf::from(home.ok_or(Status::Unavailable)?);
            if !home.is_absolute() {
                return Err(Status::Unavailable);
            }
            home.join(".codex")
        }
    };
    if !path.is_absolute() || !path.is_dir() {
        return Err(Status::Unavailable);
    }
    fs::canonicalize(path).map_err(|_| Status::Unavailable)
}

// Share only overlapping scans. Failed or missing lookups are never cached.
type ScanResult = Result<Vec<ProviderTurn>, Status>;
#[derive(Default)]
struct Flight {
    result: Mutex<Option<ScanResult>>,
    ready: Condvar,
}
type FlightMap = HashMap<(PathBuf, String), Weak<Flight>>;
fn coalesced_scan(root: PathBuf, id: String) -> ScanResult {
    static FLIGHTS: OnceLock<Mutex<FlightMap>> = OnceLock::new();
    let (flight, owner) = {
        let mut flights = FLIGHTS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| Status::Incomplete)?;
        flights.retain(|_, value| value.strong_count() > 0);
        let key = (root.clone(), id.clone());
        match flights.get(&key).and_then(Weak::upgrade) {
            Some(flight) => (flight, false),
            None => {
                let flight = Arc::new(Flight::default());
                flights.insert(key, Arc::downgrade(&flight));
                (flight, true)
            }
        }
    };
    if owner {
        let result = scan(&root, &id, Limits::default());
        *flight.result.lock().map_err(|_| Status::Incomplete)? = Some(result.clone());
        flight.ready.notify_all();
        result
    } else {
        let result = flight.result.lock().map_err(|_| Status::Incomplete)?;
        let (result, _) = flight
            .ready
            .wait_timeout_while(result, Duration::from_secs(2), |r| r.is_none())
            .map_err(|_| Status::Incomplete)?;
        result.clone().unwrap_or(Err(Status::Limit))
    }
}

fn is_link(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn safe_meta(root: &Path, path: &Path) -> Result<Metadata, Status> {
    let relative = path.strip_prefix(root).map_err(|_| Status::Incomplete)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        if is_link(&fs::symlink_metadata(&current).map_err(|_| Status::Incomplete)?) {
            return Err(Status::Incomplete);
        }
    }
    if !fs::canonicalize(path)
        .map_err(|_| Status::Incomplete)?
        .starts_with(root)
    {
        return Err(Status::Incomplete);
    }
    fs::symlink_metadata(path).map_err(|_| Status::Incomplete)
}
fn date_component(name: &str, level: usize) -> bool {
    let width = if level == 0 { 4 } else { 2 };
    name.len() == width
        && name.bytes().all(|b| b.is_ascii_digit())
        && match name.parse::<u32>() {
            Ok(n) => match level {
                0 => n > 0,
                1 => (1..=12).contains(&n),
                _ => (1..=31).contains(&n),
            },
            Err(_) => false,
        }
}
fn candidate(name: &str, id: &str) -> bool {
    name.starts_with("rollout-") && name.ends_with(&format!("-{id}.jsonl"))
}
fn visit(
    root: &Path,
    dir: &Path,
    level: usize,
    archived: bool,
    id: &str,
    budget: &mut Budget,
    files: &mut Vec<PathBuf>,
) -> Result<(), Status> {
    budget.check()?;
    let meta = match fs::symlink_metadata(dir) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(Status::Incomplete),
    };
    if is_link(&meta) {
        return Err(Status::Incomplete);
    }
    if !meta.is_dir() {
        return Err(Status::Incomplete);
    }
    safe_meta(root, dir)?;
    for entry in fs::read_dir(dir).map_err(|_| Status::Incomplete)? {
        budget.entry()?;
        let entry = entry.map_err(|_| Status::Incomplete)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !archived && level < 3 {
            if date_component(name, level) {
                visit(root, &entry.path(), level + 1, false, id, budget, files)?;
            }
        } else if candidate(name, id) {
            let meta = safe_meta(root, &entry.path())?;
            if !meta.is_file() {
                return Err(Status::Incomplete);
            }
            files.push(entry.path());
            if files.len() > budget.limits.candidates {
                return Err(Status::Limit);
            }
        }
    }
    safe_meta(root, dir)?;
    Ok(())
}
fn scan(root: &Path, id: &str, limits: Limits) -> ScanResult {
    let mut budget = Budget::new(limits);
    let mut files = vec![];
    visit(
        root,
        &root.join("sessions"),
        0,
        false,
        id,
        &mut budget,
        &mut files,
    )?;
    visit(
        root,
        &root.join("archived_sessions"),
        0,
        true,
        id,
        &mut budget,
        &mut files,
    )?;
    budget.check()?;
    if files.is_empty() {
        return Err(Status::NotFound);
    }
    if files.len() != 1 {
        return Err(Status::Ambiguous);
    }
    read_rollout(root, &files[0], id, &budget)
}
fn unchanged(a: &Metadata, b: &Metadata) -> bool {
    let same = a.len() == b.len()
        && a.modified()
            .ok()
            .zip(b.modified().ok())
            .is_some_and(|(a, b)| a == b);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        same && a.dev() == b.dev()
            && a.ino() == b.ino()
            && a.ctime() == b.ctime()
            && a.ctime_nsec() == b.ctime_nsec()
    }
    #[cfg(not(unix))]
    {
        same && a.created().ok() == b.created().ok()
    }
}
fn read_rollout(root: &Path, path: &Path, id: &str, budget: &Budget) -> ScanResult {
    let before = safe_meta(root, path)?;
    if before.len() > budget.limits.bytes {
        return Err(Status::Limit);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|_| Status::Incomplete)?;
    if !unchanged(&before, &file.metadata().map_err(|_| Status::Incomplete)?) {
        return Err(Status::Incomplete);
    }
    let result = parse_rollout(&file, id, budget)?;
    budget.check()?;
    if !unchanged(&before, &file.metadata().map_err(|_| Status::Incomplete)?)
        || !unchanged(&before, &safe_meta(root, path)?)
    {
        return Err(Status::Incomplete);
    }
    Ok(result)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Status> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or(Status::Incomplete)
}
fn parse_rollout(reader: impl Read, id: &str, budget: &Budget) -> ScanResult {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    let mut total = 0u64;
    let mut metadata = false;
    let mut starts = HashMap::new();
    let mut contexts = HashMap::new();
    loop {
        budget.check()?;
        line.clear();
        let count = reader
            .by_ref()
            .take(budget.limits.line as u64 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| Status::Incomplete)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if count > budget.limits.line || total > budget.limits.bytes {
            return Err(Status::Limit);
        }
        if line.last() != Some(&b'\n') {
            return Err(Status::Incomplete);
        }
        let record: Value = serde_json::from_slice(&line).map_err(|_| Status::Incomplete)?;
        let kind = text(&record, "type")?;
        let payload = record
            .get("payload")
            .filter(|p| p.is_object())
            .ok_or(Status::Incomplete)?;
        if !metadata && kind != "session_meta" {
            return Err(Status::Incomplete);
        }
        match kind {
            "session_meta" => {
                if metadata {
                    return Err(Status::Ambiguous);
                }
                let actual = text(payload, "id")?;
                if !uuid(actual) || !actual.eq_ignore_ascii_case(id) {
                    return Err(Status::Incomplete);
                }
                metadata = true;
            }
            "event_msg" => {
                if text(payload, "type")? == "task_started" {
                    let turn = text(payload, "turn_id")?.to_owned();
                    let timestamp =
                        timestamp_ms(text(&record, "timestamp")?).ok_or(Status::Incomplete)?;
                    if starts.insert(turn, timestamp).is_some() {
                        return Err(Status::Ambiguous);
                    }
                }
            }
            "turn_context" => {
                let turn = text(payload, "turn_id")?.to_owned();
                let model = text(payload, "model")?.to_owned();
                timestamp_ms(text(&record, "timestamp")?).ok_or(Status::Incomplete)?;
                if let Some(previous) = contexts.insert(turn, model.clone()) {
                    if previous != model {
                        return Err(Status::Ambiguous);
                    }
                }
            }
            _ => {}
        }
    }
    if !metadata {
        return Err(Status::Incomplete);
    }
    let mut turns = Vec::with_capacity(starts.len());
    for (id, started_at) in starts {
        let model = contexts.remove(&id).ok_or(Status::Incomplete)?;
        turns.push(ProviderTurn {
            id,
            started_at,
            model,
        });
    }
    // Orphan contexts cannot establish a turn start but do not bind another turn.
    turns.sort_by(|a, b| a.started_at.total_cmp(&b.started_at));
    budget.check()?;
    Ok(turns)
}
fn uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn valid_turns(turns: &[LegacyTurn]) -> bool {
    let mut ids = HashSet::new();
    turns
        .iter()
        .all(|t| !t.block_id.is_empty() && t.started_at.is_finite() && ids.insert(&t.block_id))
        && turns
            .windows(2)
            .all(|pair| pair[0].started_at < pair[1].started_at)
}
fn correlate(input: &RecoveryInput, provider: &[ProviderTurn]) -> RecoveryResult {
    if !valid_turns(&input.turns) {
        return RecoveryResult::empty(Status::Ambiguous);
    }
    let mut candidates = vec![(0usize, 0usize); input.turns.len()];
    let budget = Budget::new(Limits::default());
    let mut comparisons = 0usize;
    let mut claims = vec![0usize; provider.len()];
    // Sorted timestamps make the work proportional to candidates, not the full matrix.
    for (i, turn) in input.turns.iter().enumerate() {
        let begin = provider.partition_point(|p| p.started_at < turn.started_at);
        for (j, p) in provider.iter().enumerate().skip(begin) {
            if p.started_at - turn.started_at > 2000.0 {
                break;
            }
            comparisons += 1;
            if comparisons > 1_000_000 || budget.check().is_err() {
                return RecoveryResult::empty(Status::Limit);
            }
            candidates[i].0 = candidates[i].0.saturating_add(1);
            candidates[i].1 = j;
            claims[j] += 1;
        }
    }
    let mut matches = vec![];
    let mut previous = None;
    for (turn, candidates) in input.turns.iter().zip(candidates) {
        if candidates.0 != 1 || claims[candidates.1] != 1 {
            continue;
        }
        let p = &provider[candidates.1];
        if previous.is_some_and(|time| time >= p.started_at) {
            return RecoveryResult::empty(Status::Ambiguous);
        }
        previous = Some(p.started_at);
        matches.push(RecoveredTurn {
            block_id: turn.block_id.clone(),
            provider_session_id: input.provider_session_id.clone(),
            provider_turn_id: p.id.clone(),
            model: p.model.clone(),
            provider_started_at: p.started_at,
            source: "codex-rollout-time-match",
        });
    }
    RecoveryResult {
        status: Status::Complete,
        matches,
    }
}

// RFC 3339 instants, including offsets and fractional seconds. No filename clocks.
fn timestamp_ms(value: &str) -> Option<f64> {
    let b = value.as_bytes();
    if b.len() < 20
        || !value.is_ascii()
        || b[4] != b'-'
        || b[7] != b'-'
        || !matches!(b[10], b'T' | b't')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let number = |start: usize, end: usize| -> Option<i64> {
        let s = value.get(start..end)?;
        if !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    let year = number(0, 4)?;
    let month = number(5, 7)?;
    let day = number(8, 10)?;
    let hour = number(11, 13)?;
    let minute = number(14, 16)?;
    let second = number(17, 19)?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || day > days[(month - 1) as usize]
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let mut end = 19;
    let mut fraction = 0.0;
    if b.get(end) == Some(&b'.') {
        end += 1;
        let start = end;
        while b.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        if start == end {
            return None;
        }
        fraction = value.get(start - 1..end)?.parse::<f64>().ok()?;
    }
    let offset = match b.get(end)? {
        b'Z' | b'z' if end + 1 == b.len() => 0,
        sign @ (b'+' | b'-') if end + 6 == b.len() && b[end + 3] == b':' => {
            let h = number(end + 1, end + 3)?;
            let m = number(end + 4, end + 6)?;
            if h > 23 || m > 59 {
                return None;
            }
            // -00:00 means the local offset is unknown, so cannot prove an instant.
            if *sign == b'-' && h == 0 && m == 0 {
                return None;
            }
            (h * 3600 + m * 60) * if *sign == b'-' { -1 } else { 1 }
        }
        _ => return None,
    };
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5 + day - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some(
        (days * 86400 + hour * 3600 + minute * 60 + second - offset) as f64 * 1000.0
            + fraction * 1000.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    const ID: &str = "12345678-abcd-7123-8123-123456789abc";
    const OTHER: &str = "87654321-abcd-7123-8123-123456789abc";
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            static SERIAL: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "jayhun-codex-history-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
        fn log(&self, directory: &str, contents: &str) -> PathBuf {
            let directory = self.0.join(directory);
            fs::create_dir_all(&directory).unwrap();
            let path = directory.join(format!("rollout-2026-09-09T11-38-11-{ID}.jsonl"));
            fs::write(&path, contents).unwrap();
            path
        }
        fn scan(&self) -> ScanResult {
            scan(&self.0, ID, Limits::default())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn meta(id: &str) -> String {
        format!("{}\n", json!({"type":"session_meta","payload":{"id":id}}))
    }
    fn start(id: &str, time: &str) -> String {
        format!(
            "{}\n",
            json!({"type":"event_msg","timestamp":time,"payload":{"type":"task_started","turn_id":id}})
        )
    }
    fn context(id: &str, model: &str) -> String {
        format!(
            "{}\n",
            json!({"type":"turn_context","timestamp":"2026-09-09T11:00:13.893Z","payload":{"turn_id":id,"model":model}})
        )
    }
    fn log() -> String {
        meta(ID) + &start("turn-1", "2026-09-09T11:00:00.560Z") + &context("turn-1", "gpt-5.6-sol")
    }
    fn parse(contents: &str) -> ScanResult {
        parse_rollout(contents.as_bytes(), ID, &Budget::new(Limits::default()))
    }
    fn input(times: &[f64]) -> RecoveryInput {
        RecoveryInput {
            provider_session_id: ID.into(),
            turns: times
                .iter()
                .enumerate()
                .map(|(i, time)| LegacyTurn {
                    block_id: format!("block-{i}"),
                    started_at: *time,
                })
                .collect(),
        }
    }
    fn provider(times: &[f64]) -> Vec<ProviderTurn> {
        times
            .iter()
            .enumerate()
            .map(|(i, time)| ProviderTurn {
                id: format!("turn-{i}"),
                started_at: *time,
                model: "raw-model-id".into(),
            })
            .collect()
    }
    fn status(result: ScanResult, expected: Status) {
        assert_eq!(result.unwrap_err(), expected);
    }

    #[test]
    fn metadata_identity_is_required_before_any_turn() {
        assert_eq!(parse(&log()).unwrap().len(), 1);
        status(parse(&log().replace(ID, OTHER)), Status::Incomplete);
        status(
            parse(&log().replace(ID, "../../secrets")),
            Status::Incomplete,
        );
        status(
            parse(&start("turn", "2026-09-09T11:00:00Z")),
            Status::Incomplete,
        );
        status(parse(&(meta(ID) + &meta(ID))), Status::Ambiguous);
        status(parse(""), Status::Incomplete);
    }
    #[test]
    fn uuid_validation_excludes_paths_and_noncanonical_shape() {
        assert!(uuid(ID));
        assert!(uuid(&ID.to_ascii_uppercase()));
        for bad in [
            "",
            "../sessions",
            "12345678abcd71238123123456789abc",
            "12345678-abcd-7123-8123-123456789abz",
        ] {
            assert!(!uuid(bad));
        }
    }
    #[test]
    fn delayed_context_and_missing_completion_preserve_raw_model() {
        let contents = meta(ID)
            + &start("one", "2026-09-09T11:00:00.560Z")
            + &start("two", "2026-09-09T11:01:00.066Z")
            + &context("two", " gpt-6-astra ")
            + &context("one", "gpt-5.6-sol")
            + &context("one", "gpt-5.6-sol");
        let turns = parse(&contents).unwrap();
        let result = correlate(
            &input(&[
                timestamp_ms("2026-09-09T11:00:00Z").unwrap(),
                timestamp_ms("2026-09-09T11:01:00Z").unwrap(),
            ]),
            &turns,
        );
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[1].model, " gpt-6-astra ");
        assert_eq!(result.matches[0].provider_turn_id, "one");
        assert_eq!(result.matches[0].source, "codex-rollout-time-match");
    }
    #[test]
    fn duplicate_starts_and_conflicting_contexts_reject_entire_log() {
        status(
            parse(&(log() + &start("turn-1", "2026-09-09T11:00:00.560Z"))),
            Status::Ambiguous,
        );
        status(
            parse(&(log() + &context("turn-1", "another-model"))),
            Status::Ambiguous,
        );
        status(
            parse(&(meta(ID) + &start("one", "2026-09-09T11:00:00Z"))),
            Status::Incomplete,
        );
        status(
            parse(&log().replace("gpt-5.6-sol", "  ")),
            Status::Incomplete,
        );
    }
    #[test]
    fn malformed_and_torn_records_never_return_prefix_matches() {
        for suffix in [
            "{\n",
            "null\n",
            "{}\n",
            "\n",
            "{\"type\":\"response_item\",\"payload\":null}\n",
            "{\"type\":\"event_msg\",\"payload\":{}}\n",
            "{}",
        ] {
            status(parse(&(log() + suffix)), Status::Incomplete);
        }
        status(parse(log().trim_end()), Status::Incomplete);
        status(
            parse(&log().replace("11:00:00.560Z", "99:00:00Z")),
            Status::Incomplete,
        );
        status(
            parse(&log().replace("11:00:13.893Z", "invalid")),
            Status::Incomplete,
        );
    }
    #[test]
    fn timings_match_all_nine_audited_delays() {
        let delays = [560., 66., 343., 207., 57., 407., 405., 45., 62.];
        let starts: Vec<f64> = (0..9).map(|i| i as f64 * 10_000.).collect();
        let native: Vec<f64> = starts.iter().zip(delays).map(|(s, d)| s + d).collect();
        assert_eq!(
            correlate(&input(&starts), &provider(&native)).matches.len(),
            9
        );
    }
    #[test]
    fn inclusive_window_and_failed_sends() {
        assert_eq!(
            correlate(
                &input(&[0., 10_000., 20_000., 30_000.]),
                &provider(&[0., 12_000., 22_000.001, 29_999.])
            )
            .matches
            .len(),
            2
        );
        let result = correlate(&input(&[100.]), &[]);
        assert_eq!(result.status, Status::Complete);
        assert!(result.matches.is_empty());
    }
    #[test]
    fn collisions_include_identified_blocks_without_nearest_neighbor() {
        assert!(correlate(&input(&[0., 1.]), &provider(&[100.]))
            .matches
            .is_empty());
        assert!(correlate(&input(&[0.]), &provider(&[100., 101.]))
            .matches
            .is_empty());
        // A provider with two claimants stays blocked even if one claimant also has another candidate.
        assert!(correlate(&input(&[0., 1000.]), &provider(&[500., 1500.]))
            .matches
            .is_empty());
        assert!(correlate(&input(&[0.]), &provider(&[100., 100.]))
            .matches
            .is_empty());
        assert_eq!(
            correlate(&input(&[0., 100., 10_000.]), &provider(&[500., 10_050.]))
                .matches
                .len(),
            1
        );
    }
    #[test]
    fn invalid_stored_order_and_duplicate_blocks_reject() {
        for times in [&[1., 1.][..], &[2., 1.], &[f64::NAN], &[f64::INFINITY]] {
            assert_eq!(
                correlate(&input(times), &provider(&[100.])).status,
                Status::Ambiguous
            );
        }
        let mut i = input(&[0., 10000.]);
        i.turns[1].block_id = i.turns[0].block_id.clone();
        assert!(!valid_turns(&i.turns));
        let steering = json!({"providerSessionId":ID,"turns":[{"blockId":"steer"}]});
        assert!(serde_json::from_value::<RecoveryInput>(steering).is_err());
    }
    #[test]
    fn timestamp_instants_validate_calendar_offsets_and_precision() {
        assert_eq!(timestamp_ms("1970-01-01T00:00:00Z"), Some(0.));
        assert_eq!(timestamp_ms("1970-01-01T05:00:00+05:00"), Some(0.));
        assert_eq!(timestamp_ms("1969-12-31T19:00:00-05:00"), Some(0.));
        assert_eq!(
            timestamp_ms("2000-02-29T00:00:00.123456Z"),
            Some(951782400123.456)
        );
        for bad in [
            "1900-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-01-00T00:00:00Z",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:00:60Z",
            "2026-01-01T00:00:00-00:00",
            "2026-01-01T00:00:00+24:00",
            "2026-01-01T00:00:00.Z",
            "2026-01-01T00:00:00",
        ] {
            assert_eq!(timestamp_ms(bad), None, "{bad}");
        }
    }
    #[test]
    fn native_home_and_override_rules_do_not_guess() {
        let temp = Temp::new();
        let default = temp.0.join(".codex");
        fs::create_dir(&default).unwrap();
        assert_eq!(
            resolve_root(None, Some(temp.0.clone().into_os_string())).unwrap(),
            default
        );
        assert_eq!(
            resolve_root(Some(temp.0.clone().into_os_string()), None).unwrap(),
            temp.0
        );
        for bad in [
            OsString::new(),
            OsString::from("relative"),
            temp.0.join("missing").into_os_string(),
        ] {
            assert_eq!(
                resolve_root(Some(bad), Some(temp.0.clone().into_os_string())),
                Err(Status::Unavailable)
            );
        }
        let file = temp.0.join("file");
        fs::write(&file, "x").unwrap();
        assert_eq!(
            resolve_root(Some(file.into_os_string()), None),
            Err(Status::Unavailable)
        );
        assert_eq!(
            resolve_root(None, Some(OsString::from("relative"))),
            Err(Status::Unavailable)
        );
        #[cfg(unix)]
        assert_eq!(
            resolve_root(Some(OsString::from("C:\\Users\\user\\.codex")), None),
            Err(Status::Unavailable)
        );
        #[cfg(windows)]
        {
            assert!(!Path::new("/Users/user/.codex").is_absolute());
            assert!(Path::new(r"C:\Users\user\.codex").is_absolute());
        }
    }
    #[test]
    fn only_known_layouts_and_exact_session_suffix_are_scanned() {
        let temp = Temp::new();
        temp.log("sessions/2020/01/01", &log());
        assert_eq!(temp.scan().unwrap().len(), 1);
        let other = Temp::new();
        other.log("sessions/2026/09/09/deeper", &log());
        other.log("sessions/2026/99/99", &log());
        other.log("unrelated/2026/09/09", &log());
        status(other.scan(), Status::NotFound);
        other.log("archived_sessions", &log());
        assert_eq!(other.scan().unwrap().len(), 1);
        assert!(!candidate(&format!("rollout-{ID}-extra.jsonl"), ID));
        assert!(!candidate(&format!("other-{ID}.jsonl"), ID));
    }
    #[test]
    fn duplicate_copies_are_ambiguous_even_with_same_content() {
        let temp = Temp::new();
        temp.log("sessions/2026/09/09", &log());
        temp.log("archived_sessions", &log());
        status(temp.scan(), Status::Ambiguous);
    }
    #[test]
    fn every_scan_budget_returns_limit_without_partial_matches() {
        let temp = Temp::new();
        temp.log("sessions/2026/09/09", &log());
        for limits in [
            Limits {
                entries: 0,
                ..Limits::default()
            },
            Limits {
                candidates: 0,
                ..Limits::default()
            },
            Limits {
                bytes: 1,
                ..Limits::default()
            },
            Limits {
                line: 10,
                ..Limits::default()
            },
            Limits {
                elapsed: Duration::ZERO,
                ..Limits::default()
            },
        ] {
            status(scan(&temp.0, ID, limits), Status::Limit);
        }
        // Streaming byte cap also applies when metadata did not supply a file size.
        status(
            parse_rollout(
                log().as_bytes(),
                ID,
                &Budget::new(Limits {
                    bytes: 1,
                    ..Limits::default()
                }),
            ),
            Status::Limit,
        );
    }
    #[test]
    fn changed_or_replaced_files_fail_metadata_verification() {
        let temp = Temp::new();
        let path = temp.log("archived_sessions", &log());
        let before = fs::metadata(&path).unwrap();
        fs::write(&path, "different length").unwrap();
        assert!(!unchanged(&before, &fs::metadata(&path).unwrap()));
        status(temp.scan(), Status::Incomplete);
    }
    #[cfg(unix)]
    #[test]
    fn symlink_directories_and_candidate_files_cannot_escape() {
        use std::os::unix::fs::symlink;
        let outside = Temp::new();
        let file = outside.log("archived_sessions", &log());
        let temp = Temp::new();
        symlink(
            outside.0.join("archived_sessions"),
            temp.0.join("archived_sessions"),
        )
        .unwrap();
        status(temp.scan(), Status::Incomplete);
        fs::remove_file(temp.0.join("archived_sessions")).unwrap();
        fs::create_dir(temp.0.join("archived_sessions")).unwrap();
        symlink(
            file,
            temp.0
                .join("archived_sessions")
                .join(format!("rollout-{ID}.jsonl")),
        )
        .unwrap();
        status(temp.scan(), Status::Incomplete);
    }
    #[test]
    fn missing_lookups_are_not_cached() {
        let temp = Temp::new();
        status(coalesced_scan(temp.0.clone(), ID.into()), Status::NotFound);
        temp.log("archived_sessions", &log());
        assert_eq!(coalesced_scan(temp.0.clone(), ID.into()).unwrap().len(), 1);
    }
    #[test]
    fn api_uses_camel_case_and_has_no_requested_model() {
        let input: RecoveryInput = serde_json::from_value(
            json!({"providerSessionId":ID,"turns":[{"blockId":"b","startedAt":0}]}),
        )
        .unwrap();
        let output = serde_json::to_value(correlate(&input, &provider(&[0.]))).unwrap();
        assert_eq!(output["status"], "complete");
        assert_eq!(output["matches"][0]["providerTurnId"], "turn-0");
        assert_eq!(output["matches"][0]["providerSessionId"], ID);
        assert!(output["matches"][0].get("requestedModel").is_none());
    }
}
