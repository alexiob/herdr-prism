use crate::{elapsed_ms, Process};
use std::ffi::{c_char, c_int, c_void};
use std::mem::{size_of, zeroed};
use std::time::{SystemTime, UNIX_EPOCH};
#[repr(C)]
struct BsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [u8; 16],
    name: [u8; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    tdev: u32,
    tpgid: u32,
    nice: i32,
    start_sec: u64,
    start_usec: u64,
}
#[repr(C)]
struct TaskInfo {
    virtual_size: u64,
    resident_size: u64,
    total_user: u64,
    total_system: u64,
    threads_user: u64,
    threads_system: u64,
    policy: i32,
    faults: i32,
    pageins: i32,
    cow_faults: i32,
    messages_sent: i32,
    messages_received: i32,
    syscalls_mach: i32,
    syscalls_unix: i32,
    csw: i32,
    threadnum: i32,
    numrunning: i32,
    priority: i32,
}
#[link(name = "proc")]
extern "C" {
    fn proc_listpids(kind: u32, filter: u32, buffer: *mut c_void, size: c_int) -> c_int;
    fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, size: c_int)
        -> c_int;
}
extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        old: *mut c_void,
        len: *mut usize,
        new: *mut c_void,
        newlen: usize,
    ) -> c_int;
}
fn bsd(pid: u32) -> Option<BsdInfo> {
    unsafe {
        let mut b: BsdInfo = zeroed();
        let n = proc_pidinfo(
            pid as i32,
            3,
            0,
            &mut b as *mut _ as *mut c_void,
            size_of::<BsdInfo>() as i32,
        );
        (n == size_of::<BsdInfo>() as i32 && b.pid == pid).then_some(b)
    }
}
fn birth(b: &BsdInfo) -> u128 {
    b.start_sec as u128 * 1000000 + b.start_usec as u128
}
fn cpu_to_ns(ticks: u128, frequency: u64) -> u128 {
    ticks * 1_000_000_000 / frequency as u128
}
fn cpu_frequency() -> Result<u64, String> {
    unsafe {
        let mut frequency = 0u64;
        let mut len = size_of::<u64>();
        if sysctlbyname(
            b"hw.tbfrequency\0".as_ptr() as *const c_char,
            &mut frequency as *mut _ as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
            || len != size_of::<u64>()
            || frequency == 0
        {
            return Err("CPU clock frequency unavailable".into());
        }
        Ok(frequency)
    }
}
fn boot() -> Result<String, String> {
    unsafe {
        let mut bytes = [0u8; 128];
        let mut len = bytes.len();
        if sysctlbyname(
            b"kern.bootsessionuuid\0".as_ptr() as *const c_char,
            bytes.as_mut_ptr() as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
            || len > bytes.len()
        {
            return Err("boot identity unavailable".into());
        }
        Ok(String::from_utf8_lossy(&bytes[..len])
            .trim_end_matches('\0')
            .to_string())
    }
}
pub(super) fn sample() -> Result<(String, Vec<Process>, Vec<String>), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "clock unavailable")?
        .as_micros();
    let boot = boot()?;
    let frequency = cpu_frequency()?;
    let mut processes = Vec::new();
    let mut errors = Vec::new();
    unsafe {
        let needed = proc_listpids(1, 0, std::ptr::null_mut(), 0);
        if needed <= 0 {
            return Err("process enumeration denied".into());
        }
        let mut pids = vec![0u32; needed as usize / 4 + 4096];
        let bytes = proc_listpids(
            1,
            0,
            pids.as_mut_ptr() as *mut c_void,
            (pids.len() * 4) as i32,
        );
        if bytes < 0 {
            return Err("process enumeration failed".into());
        }
        if bytes as usize >= pids.len() * 4 {
            errors.push("process enumeration truncated".into());
        }
        for &pid in pids.iter().take(bytes as usize / 4).filter(|&&p| p > 0) {
            let before = match bsd(pid) {
                Some(b) => b,
                None => {
                    errors.push(format!("pid {} identity unavailable", pid));
                    continue;
                }
            };
            let mut task: TaskInfo = zeroed();
            let n = proc_pidinfo(
                pid as i32,
                4,
                0,
                &mut task as *mut _ as *mut c_void,
                size_of::<TaskInfo>() as i32,
            );
            let after = match bsd(pid) {
                Some(b) => b,
                None => {
                    errors.push(format!("pid {} vanished", pid));
                    continue;
                }
            };
            if birth(&before) != birth(&after) {
                errors.push(format!("pid {} identity changed during sample", pid));
                continue;
            }
            let readable = n == size_of::<TaskInfo>() as i32;
            if !readable {
                errors.push(format!("pid {} resource read denied", pid));
            }
            let name = if before.name[0] != 0 {
                &before.name[..]
            } else {
                &before.comm[..]
            };
            let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            processes.push(Process {
                pid,
                ppid: Some(after.ppid),
                start: birth(&before),
                uptime_ms: elapsed_ms(now, birth(&before), 1000),
                cpu: if readable {
                    cpu_to_ns(
                        task.total_user as u128 + task.total_system as u128,
                        frequency,
                    )
                } else {
                    0
                },
                rss: if readable { task.resident_size } else { 0 },
                name: String::from_utf8_lossy(&name[..end]).into_owned(),
                threads: task.threadnum.max(0) as u32,
                readable,
            });
        }
    }
    Ok((boot, processes, errors))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_clock_uses_host_frequency() {
        assert_eq!(cpu_to_ns(24_000_000, 24_000_000), 1_000_000_000);
    }
    #[test]
    fn native_abi_lengths() {
        assert_eq!(size_of::<BsdInfo>(), 136);
        assert_eq!(size_of::<TaskInfo>(), 96);
    }
    #[test]
    fn sampler_reads_own_identity_resources() {
        unsafe {
            let pid = std::process::id();
            let before = bsd(pid).expect("own BSD identity readable");
            let mut task: TaskInfo = zeroed();
            assert_eq!(
                proc_pidinfo(
                    pid as i32,
                    4,
                    0,
                    &mut task as *mut _ as *mut c_void,
                    size_of::<TaskInfo>() as i32
                ),
                size_of::<TaskInfo>() as i32
            );
            assert!(task.resident_size > 0);
            assert!(birth(&before) > 0);
            std::thread::sleep(std::time::Duration::from_millis(20));
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros();
            let age = elapsed_ms(now, birth(&before), 1000).unwrap();
            assert!(age > 0);
            std::thread::sleep(std::time::Duration::from_millis(20));
            let after = bsd(pid).unwrap();
            assert_eq!(birth(&before), birth(&after));
            let later = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros();
            assert!(elapsed_ms(later, birth(&after), 1000).unwrap() >= age);
        }
    }
}
