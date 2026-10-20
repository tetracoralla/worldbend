//! Host process lifetime mechanics, separate from canonical authored state.
//! Unix groups stay owned until they are retired, before the leader is reaped.
//! Callers must retain the corresponding direct child and reap it afterwards.

#![cfg(unix)]

use std::io;

/// Observe a direct child's exit while keeping its PID reserved. In particular,
/// an eventual group kill cannot target a different process which reused it.
pub fn child_exit_ready(pid: u32) -> io::Result<bool> {
    let pid = checked_pid(pid)?;
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let status = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if status == 0 {
            return Ok(unsafe { info.si_pid() } == pid);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

#[derive(Debug)]
pub struct OwnedProcessGroup {
    pid: libc::pid_t,
    retired: bool,
}

impl OwnedProcessGroup {
    /// Acquire only the isolated group of a retained direct child. The caller
    /// sets process_group(0) when spawning and must not reap before retirement.
    pub fn from_child(pid: u32) -> io::Result<Self> {
        let native_pid = checked_pid(pid)?;
        child_exit_ready(pid)?;
        if unsafe { libc::getpgid(native_pid) } != native_pid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "child is not the leader of its isolated process group",
            ));
        }
        Ok(Self {
            pid: native_pid,
            retired: false,
        })
    }

    pub fn id(&self) -> u32 {
        self.pid as u32
    }

    /// Retire all members while the leader PID still belongs to the child.
    /// ESRCH means the owned group already has no remaining members.
    pub fn retire(&mut self) -> io::Result<()> {
        if self.retired {
            return Ok(());
        }
        let status = unsafe { libc::kill(-self.pid, libc::SIGKILL) };
        if status != 0 {
            let error = io::Error::last_os_error();
            let absent = error.raw_os_error() == Some(libc::ESRCH);
            // Darwin reports EPERM when every member is an unreaped zombie:
            // XNU's group-signal iteration excludes zombies. Do not hide a
            // permission failure affecting any living member.
            #[cfg(target_os = "macos")]
            let absent = absent
                || (error.raw_os_error() == Some(libc::EPERM)
                    && mac_group_members(self.pid)?
                        .iter()
                        .all(|member| member.pbi_status == libc::SZOMB));
            if !absent {
                return Err(error);
            }
        }
        self.retired = true;
        Ok(())
    }
}

impl Drop for OwnedProcessGroup {
    fn drop(&mut self) {
        let _ = self.retire();
    }
}

fn checked_pid(pid: u32) -> io::Result<libc::pid_t> {
    i32::try_from(pid)
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid direct child PID"))
}

// Bound enumeration independently of the renderer's ordinary thread count.
// A full buffer is ambiguous, so refuse it rather than silently miss members.
#[cfg(target_os = "macos")]
fn mac_group_members(group: libc::pid_t) -> io::Result<Vec<libc::proc_bsdinfo>> {
    const PROC_PGRP_ONLY: u32 = 2; // libproc.h; not exported by libc.
    let mut pids = vec![0_i32; 4096];
    let capacity = std::mem::size_of_val(pids.as_slice());
    unsafe { *libc::__error() = 0 };
    let bytes = unsafe {
        libc::proc_listpids(
            PROC_PGRP_ONLY,
            group as u32,
            pids.as_mut_ptr().cast(),
            capacity as i32,
        )
    };
    if bytes == 0 && io::Error::last_os_error().raw_os_error() != Some(0) {
        return Err(io::Error::last_os_error());
    }
    if bytes < 0 || bytes as usize >= capacity || !(bytes as usize).is_multiple_of(4) {
        return Err(io::Error::other(
            "cannot enumerate the complete owned process group",
        ));
    }
    pids.truncate(bytes as usize / 4);
    pids.sort_unstable();
    pids.dedup();
    let mut members = Vec::with_capacity(pids.len());
    for pid in pids.into_iter().filter(|pid| *pid > 0) {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if read != size {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                continue;
            }
            return Err(error);
        }
        if info.pbi_pid == pid as u32 && info.pbi_pgid == group as u32 {
            members.push(info);
        }
    }
    Ok(members)
}

/// Aggregate the resident footprint of living members of a retained group.
/// Inaccessible members fail closed; this is not a best-effort measurement.
#[cfg(target_os = "macos")]
pub fn group_memory_bytes(group: u32) -> io::Result<u64> {
    let mut total = 0_u64;
    for member in mac_group_members(checked_pid(group)?)? {
        if member.pbi_status == libc::SZOMB {
            continue;
        }
        let mut usage: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
        let status = unsafe {
            libc::proc_pid_rusage(
                member.pbi_pid as i32,
                libc::RUSAGE_INFO_V2,
                (&mut usage as *mut libc::rusage_info_v2).cast(),
            )
        };
        if status != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                continue;
            }
            return Err(error);
        }
        total = total
            .checked_add(usage.ri_phys_footprint)
            .ok_or_else(|| io::Error::other("owned process group footprint overflow"))?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::unix::process::CommandExt,
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn completed_leader_stays_reserved_until_group_retirement_and_reaping() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exit 0"]).process_group(0);
        let mut child = command.spawn().unwrap();
        let mut group = OwnedProcessGroup::from_child(child.id()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !child_exit_ready(child.id()).unwrap() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        // The non-reaping observation remains repeatable and ownership remains
        // intact until the group is retired, before an ordinary wait.
        assert!(child_exit_ready(child.id()).unwrap());
        group.retire().unwrap();
        assert!(child.wait().unwrap().success());
        assert!(child_exit_ready(child.id()).is_err());
    }

    #[test]
    fn non_child_pid_cannot_acquire_group_authority() {
        assert!(OwnedProcessGroup::from_child(0).is_err());
        assert!(OwnedProcessGroup::from_child(std::process::id()).is_err());
    }

    #[test]
    fn completed_leader_does_not_leave_its_live_descendant() {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 >/dev/null 2>&1 & echo $!"])
            .stdout(std::process::Stdio::piped())
            .process_group(0);
        let mut child = command.spawn().unwrap();
        let mut group = OwnedProcessGroup::from_child(child.id()).unwrap();
        let mut output = String::new();
        use std::io::Read;
        child
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut output)
            .unwrap();
        let descendant: i32 = output.trim().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !child_exit_ready(child.id()).unwrap() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(unsafe { libc::getpgid(descendant) }, group.id() as i32);
        #[cfg(target_os = "macos")]
        assert!(group_memory_bytes(group.id()).unwrap() > 0);
        group.retire().unwrap();
        assert!(child.wait().unwrap().success());
        // Orphaned grandchildren may await init reaping briefly; a zombie is
        // already retired and cannot continue encoding or writing output.
        #[cfg(target_os = "macos")]
        {
            let deadline = Instant::now() + Duration::from_secs(5);
            while mac_group_members(group.id() as i32)
                .unwrap()
                .iter()
                .any(|member| member.pbi_status != libc::SZOMB)
            {
                assert!(Instant::now() < deadline);
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
}
