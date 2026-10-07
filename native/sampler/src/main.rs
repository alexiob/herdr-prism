use std::io::{self, BufRead, Read, Write};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[derive(Debug)]
struct Process {
    pid: u32,
    ppid: Option<u32>,
    start: u128,
    cpu: u128,
    rss: u64,
    name: String,
    threads: u32,
    readable: bool,
    uptime_ms: Option<u64>,
}
fn elapsed_ms(now: u128, start: u128, units_per_ms: u128) -> Option<u64> {
    now.checked_sub(start)
        .and_then(|elapsed| u64::try_from(elapsed / units_per_ms).ok())
}
fn quoted(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
fn process_json(p: &Process) -> String {
    let uptime = p
        .uptime_ms
        .map(|ms| format!(",\"uptimeMs\":{}", ms))
        .unwrap_or_default();
    format!("{{\"pid\":{},{}\"startTime\":\"{}\",\"cpuNs\":\"{}\",\"rssBytes\":\"{}\",\"name\":{},\"threads\":{},\"availability\":{}{}}}",p.pid,p.ppid.map(|id|format!("\"ppid\":{},",id)).unwrap_or_default(),p.start,p.cpu,p.rss,quoted(&p.name),p.threads,quoted(if p.readable{"known"}else{"unavailable"}),uptime)
}
fn batch_json(boot: &str, processes: &[Process], errors: &[String], stamp: u128, monotonic_ns: u128, collection_ns: u128) -> String {
    // Measure payload encoding separately from the host OS collection. This
    // excludes the stdout write and the small outer-envelope formatting.
    let encoding = Instant::now();
    let process_payload = processes.iter().map(process_json).collect::<Vec<_>>().join(",");
    let error_payload = errors.iter().map(|e| quoted(e)).collect::<Vec<_>>().join(",");
    let serialization_ns = encoding.elapsed().as_nanos();
    format!("{{\"version\":1,\"platform\":{},\"bootId\":{},\"sampledAt\":{},\"monotonicNs\":\"{}\",\"timings\":{{\"collectionNs\":\"{}\",\"serializationNs\":\"{}\"}},\"processes\":[{}],\"errors\":[{}]}}", quoted(std::env::consts::OS), quoted(boot), stamp, monotonic_ns, collection_ns, serialization_ns, process_payload, error_payload)
}
fn main() {
    let start = Instant::now();
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    loop {
        let mut line = Vec::new();
        match (&mut input).take(4097).read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) if line.len() > 4096 => break,
            Err(_) => break,
            _ => {}
        }
        if line != b"sample\n" && line != b"sample\r\n" {
            let _ = writeln!(out, "{{\"error\":\"unsupported command\",\"version\":1}}");
            let _ = out.flush();
            continue;
        }
        let collection = Instant::now();
        #[cfg(target_os = "macos")]
        let result = macos::sample();
        #[cfg(target_os = "windows")]
        let result = windows::sample();
        #[cfg(target_os = "linux")]
        let result = linux::sample();
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let result: Result<(String, Vec<Process>, Vec<String>), String> =
            Err("unsupported platform".into());
        let collection_ns = collection.elapsed().as_nanos();
        match result {
            Ok((boot, processes, errors)) => {
                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let json = batch_json(&boot, &processes, &errors, stamp, start.elapsed().as_nanos(), collection_ns);
                if writeln!(out, "{}", json).is_err() {
                    break;
                }
            }
            Err(e) => {
                if writeln!(out, "{{\"error\":{},\"version\":1}}", quoted(&e)).is_err() {
                    break;
                }
            }
        }
        if out.flush().is_err() {
            break;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_escapes_controls() {
        assert_eq!(quoted("a\"\\\n\0é"), "\"a\\\"\\\\\\n\\u0000é\"");
    }
    #[test]
    fn elapsed_wide_identity() {
        assert_eq!(
            elapsed_ms(9007199254741993123, 9007199254740993123, 1000),
            Some(1000)
        );
        assert_eq!(elapsed_ms(1, 2, 1000), None);
    }
    #[test]
    fn identity_never_rounds() {
        let p = Process {
            pid: 1,
            ppid: None,
            start: 9007199254740993001,
            cpu: 9007199254740993002,
            rss: 1,
            name: "x".into(),
            threads: 1,
            readable: true,
            uptime_ms: None,
        };
        assert!(process_json(&p).contains("\"startTime\":\"9007199254740993001\""));
    }
    #[test]
    fn batch_timing_is_optional_metadata_beside_unchanged_identity_fields() {
        let json = batch_json("fixture", &[], &["denied".into()], 123, 9007199254740993001, 9007199254740993002);
        assert!(json.contains("\"version\":1"));
        assert!(json.contains("\"processes\":[]"));
        assert!(json.contains("\"monotonicNs\":\"9007199254740993001\""));
        assert!(json.contains("\"collectionNs\":\"9007199254740993002\""));
        assert!(json.contains("\"serializationNs\":\""));
    }
    #[test]
    #[ignore = "manual synthetic encoding benchmark"]
    fn payload_encoding_benchmark() {
        let processes: Vec<_> = (1..=6144).map(|pid| Process {pid, ppid: Some(pid - 1), start: 9007199254740993001, cpu: 9007199254740993002, rss: 1048576, name: "synthetic-compiler".into(), threads: 1, readable: true, uptime_ms: Some(123)}).collect();
        let mut elapsed = Vec::new();
        let mut bytes = 0;
        for _ in 0..30 {
            let start = Instant::now();
            let json = batch_json("synthetic", &processes, &[], 123, 123, 123);
            bytes = json.len();
            elapsed.push(start.elapsed().as_nanos());
            std::hint::black_box(json);
        }
        elapsed.sort_unstable();
        println!("synthetic_processes=6144 iterations=30 median_encoding_ns={} p95_encoding_ns={} response_bytes={}", elapsed[15], elapsed[28], bytes);
    }
}
