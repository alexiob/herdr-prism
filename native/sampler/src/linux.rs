use crate::{elapsed_ms, Process};
use std::ffi::{c_int, c_long};
use std::fs;
extern "C" {
    fn sysconf(name: c_int) -> c_long;
}
fn parse(s: &str, hz: u128, page: u64) -> Option<Process> {
    let begin = s.find('(')?;
    let end = s.rfind(')')?;
    let fields: Vec<_> = s.get(end + 2..)?.split_whitespace().collect();
    Some(Process {
        pid: s[..begin].trim().parse().ok()?,
        ppid: Some(fields.get(1)?.parse().ok()?),
        start: fields.get(19)?.parse().ok()?,
        cpu: (fields.get(11)?.parse::<u128>().ok()? + fields.get(12)?.parse::<u128>().ok()?)
            * 1000000000
            / hz,
        rss: fields.get(21)?.parse::<i64>().ok()?.max(0) as u64 * page,
        name: s.get(begin + 1..end)?.into(),
        threads: fields.get(17)?.parse().ok()?,
        readable: true,
        uptime_ms: None,
    })
}
pub(super) fn sample() -> Result<(String, Vec<Process>, Vec<String>), String> {
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map_err(|_| "boot identity unavailable")?;
    let (hz, page) = unsafe { (sysconf(2), sysconf(30)) };
    if hz <= 0 || page <= 0 {
        return Err("clock/page units unavailable".into());
    }
    let uptime_ns = fs::read_to_string("/proc/uptime").ok().and_then(|text| {
        let value = text.split_whitespace().next()?;
        let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
        let fraction = format!("{:0<9}", &fraction[..fraction.len().min(9)]);
        Some(
            whole
                .parse::<u128>()
                .ok()?
                .checked_mul(1_000_000_000)?
                .checked_add(fraction.parse::<u128>().ok()?)?,
        )
    });
    let mut processes = Vec::new();
    let mut errors = Vec::new();
    for entry in fs::read_dir("/proc")
        .map_err(|_| "procfs unavailable")?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.parse::<u32>().is_err() {
            continue;
        }
        match fs::read_to_string(entry.path().join("stat")) {
            Ok(s) => {
                if let Some(mut p) = parse(&s, hz as u128, page as u64) {
                    p.uptime_ms = uptime_ns.and_then(|now| {
                        elapsed_ms(now, p.start * 1_000_000_000 / hz as u128, 1_000_000)
                    });
                    processes.push(p)
                } else {
                    errors.push(format!("pid {} malformed stat", name));
                }
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    errors.push(format!("pid {} read denied", name));
                }
            }
        }
    }
    Ok((boot.trim().into(), processes, errors))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn units_and_child_cpu_ignored() {
        let p = parse(
            "42 (name (a) b) S 1 0 0 0 0 0 0 0 0 0 12 8 999 999 0 0 4 0 9007199254740993 0 3",
            100,
            4096,
        )
        .unwrap();
        assert_eq!(p.cpu, 200000000);
        assert_eq!(p.rss, 12288);
        assert_eq!(p.start, 9007199254740993);
    }
}
