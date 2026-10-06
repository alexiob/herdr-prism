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
        #[cfg(target_os = "macos")]
        let result = macos::sample();
        #[cfg(target_os = "windows")]
        let result = windows::sample();
        #[cfg(target_os = "linux")]
        let result = linux::sample();
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let result: Result<(String, Vec<Process>, Vec<String>), String> =
            Err("unsupported platform".into());
        match result {
            Ok((boot, processes, errors)) => {
                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let json=format!("{{\"version\":1,\"platform\":{},\"bootId\":{},\"sampledAt\":{},\"monotonicNs\":\"{}\",\"processes\":[{}],\"errors\":[{}]}}",quoted(std::env::consts::OS),quoted(&boot),stamp,start.elapsed().as_nanos(),processes.iter().map(process_json).collect::<Vec<_>>().join(","),errors.iter().map(|e|quoted(e)).collect::<Vec<_>>().join(","));
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
}
