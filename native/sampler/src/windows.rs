use crate::{elapsed_ms, Process};
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::time::{SystemTime, UNIX_EPOCH};
type Handle = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct FileTime {
    low: u32,
    high: u32,
}
fn ticks(t: FileTime) -> u64 {
    (t.high as u64) << 32 | t.low as u64
}
#[repr(C)]
struct Entry {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    ppid: u32,
    priority: i32,
    flags: u32,
    name: [u16; 260],
}
#[repr(C)]
struct Memory {
    size: u32,
    faults: u32,
    peak_ws: usize,
    ws: usize,
    quota_peak_paged: usize,
    quota_paged: usize,
    quota_peak_nonpaged: usize,
    quota_nonpaged: usize,
    pagefile: usize,
    peak_pagefile: usize,
}
#[repr(C)]
struct BootInfo {
    identifier: [u8; 16],
    firmware: u32,
    padding: u32,
    flags: u64,
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
    fn Process32FirstW(h: Handle, entry: *mut Entry) -> i32;
    fn Process32NextW(h: Handle, entry: *mut Entry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn CloseHandle(h: Handle) -> i32;
    fn GetProcessTimes(
        h: Handle,
        creation: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
    fn K32GetProcessMemoryInfo(h: Handle, memory: *mut Memory, size: u32) -> i32;
    fn GetSystemTimeAsFileTime(time: *mut FileTime);
}
// Query the OS boot GUID: failing this query leaves the batch unavailable, never an uptime-derived guess.
#[link(name = "ntdll")]
extern "system" {
    fn NtQuerySystemInformation(
        class: u32,
        info: *mut c_void,
        size: u32,
        returned: *mut u32,
    ) -> i32;
}
struct OwnedHandle(Handle);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn times(h: Handle) -> Option<(u64, u128)> {
    unsafe {
        let (mut c, mut e, mut k, mut u) = (
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        );
        if GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) == 0 {
            return None;
        }
        Some((ticks(c), (ticks(k) as u128 + ticks(u) as u128) * 100))
    }
}
fn boot() -> Result<String, String> {
    unsafe {
        let mut info: BootInfo = zeroed();
        let mut returned = 0;
        let result = NtQuerySystemInformation(
            90,
            &mut info as *mut _ as *mut c_void,
            size_of::<BootInfo>() as u32,
            &mut returned,
        );
        if result < 0 || returned < size_of::<BootInfo>() as u32 {
            return Err("boot identity unavailable".into());
        }
        Ok(info
            .identifier
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect())
    }
}
pub(super) fn sample() -> Result<(String, Vec<Process>, Vec<String>), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "clock unavailable")?
        .as_nanos()
        / 100
        + 116_444_736_000_000_000u128;
    let boot = boot()?;
    let mut processes = Vec::new();
    let mut errors = Vec::new();
    let mut handles = Vec::new();
    unsafe {
        let mut snapshot_at = FileTime::default();
        GetSystemTimeAsFileTime(&mut snapshot_at);
        let snap = CreateToolhelp32Snapshot(2, 0);
        if snap as isize == -1 {
            return Err("process enumeration failed".into());
        }
        let snapshot = OwnedHandle(snap);
        let mut entry: Entry = zeroed();
        entry.size = size_of::<Entry>() as u32;
        let mut ok = Process32FirstW(snapshot.0, &mut entry);
        while ok != 0 {
            let pid = entry.pid;
            if pid > 0 {
                let h = OpenProcess(0x1000, 0, pid);
                if h.is_null() {
                    errors.push(format!("pid {} access denied", pid));
                } else {
                    let handle = OwnedHandle(h);
                    if let Some((creation, _)) = times(h) {
                        if creation > ticks(snapshot_at) {
                            errors.push(format!("pid {} changed since snapshot", pid));
                        } else {
                            let end = entry.name.iter().position(|&c| c == 0).unwrap_or(260);
                            handles.push((
                                handle,
                                pid,
                                entry.ppid,
                                creation,
                                entry.threads,
                                String::from_utf16_lossy(&entry.name[..end]),
                            ));
                        }
                    } else {
                        errors.push(format!("pid {} creation unavailable", pid));
                    }
                }
            }
            ok = Process32NextW(snapshot.0, &mut entry);
        }
        let starts: HashMap<u32, u64> = handles
            .iter()
            .map(|(_, pid, _, start, _, _)| (*pid, *start))
            .collect();
        for (handle, pid, parent, creation, threads, name) in handles {
            let mut mem: Memory = zeroed();
            mem.size = size_of::<Memory>() as u32;
            let readable = K32GetProcessMemoryInfo(handle.0, &mut mem, mem.size) != 0;
            let (current, cpu) = match times(handle.0) {
                Some(x) => x,
                None => {
                    errors.push(format!("pid {} times unavailable", pid));
                    continue;
                }
            };
            if current != creation {
                errors.push(format!("pid {} creation changed", pid));
                continue;
            }
            if !readable {
                errors.push(format!("pid {} working set denied", pid));
            }
            let ppid = starts
                .get(&parent)
                .filter(|&&s| s <= creation)
                .map(|_| parent);
            processes.push(Process {
                pid,
                ppid,
                start: creation as u128,
                uptime_ms: elapsed_ms(now, creation as u128, 10000),
                cpu,
                rss: if readable { mem.ws as u64 } else { 0 },
                name,
                threads,
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
    fn wide_filetime() {
        assert_eq!(
            ticks(FileTime {
                low: 1,
                high: 0x200000
            }),
            9007199254740993
        );
    }
    #[test]
    fn abi() {
        assert_eq!(size_of::<Entry>(), 568);
        assert_eq!(size_of::<Memory>(), 72);
        assert_eq!(size_of::<BootInfo>(), 32);
    }
    #[test]
    fn self_live() {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let (_, p, _) = sample().unwrap();
        let me = p.iter().find(|p| p.pid == std::process::id()).unwrap();
        assert!(me.readable);
        assert!(me.rss > 0);
        assert!(me.uptime_ms.unwrap() > 0);
    }
}
