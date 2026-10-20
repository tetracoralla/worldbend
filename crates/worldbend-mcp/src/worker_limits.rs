use serde_json::json;
use std::time::Duration;
use worldbend_core::{ErrorCode, TransformError, TransformResult};

pub fn apply_worker_self_limits(
    memory_bytes: u64,
    timeout: Duration,
    render_threads: usize,
) -> TransformResult<()> {
    let cpu_budget = scaled_cpu_budget(timeout, render_threads);
    #[cfg(all(unix, not(target_os = "macos")))]
    apply_unix_memory_limit(memory_bytes)?;
    #[cfg(unix)]
    apply_unix_cpu_limit(cpu_budget)?;
    #[cfg(windows)]
    apply_windows_job_limits(memory_bytes, cpu_budget)?;
    #[cfg(target_os = "macos")]
    let _ = memory_bytes;
    #[cfg(not(any(unix, windows)))]
    let _ = (memory_bytes, timeout);
    Ok(())
}

fn scaled_cpu_budget(timeout: Duration, render_threads: usize) -> Duration {
    timeout
        .checked_mul(u32::try_from(render_threads.max(1)).unwrap_or(u32::MAX))
        .unwrap_or(Duration::MAX)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn apply_unix_memory_limit(memory_bytes: u64) -> TransformResult<()> {
    let address_space = libc::rlimit {
        rlim_cur: memory_bytes as libc::rlim_t,
        rlim_max: memory_bytes as libc::rlim_t,
    };
    // SAFETY: setrlimit reads the initialized structure for the current process.
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &address_space) } != 0 {
        return Err(limit_error(
            ErrorCode::Memory,
            "render worker could not apply its memory limit",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn apply_unix_cpu_limit(timeout: Duration) -> TransformResult<()> {
    let cpu = libc::rlimit {
        rlim_cur: timeout.as_secs() as libc::rlim_t,
        rlim_max: timeout.as_secs().saturating_add(1) as libc::rlim_t,
    };
    // SAFETY: setrlimit reads the initialized structure for the current process.
    if unsafe { libc::setrlimit(libc::RLIMIT_CPU, &cpu) } != 0 {
        return Err(limit_error(
            ErrorCode::Timeout,
            "render worker could not apply its CPU limit",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn apply_windows_job_limits(memory_bytes: u64, timeout: Duration) -> TransformResult<()> {
    use std::{ffi::c_void, mem::size_of, ptr};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOB_OBJECT_LIMIT_PROCESS_TIME,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
            Threading::GetCurrentProcess,
        },
    };

    // SAFETY: null security/name pointers request an unnamed job with default
    // security. The returned handle is checked before use.
    let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if job.is_null() {
        return Err(limit_error(
            ErrorCode::Memory,
            "render worker could not create its Windows resource job",
        ));
    }

    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_PROCESS_TIME
        | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    limits.BasicLimitInformation.PerProcessUserTimeLimit = duration_to_windows_ticks(timeout);
    limits.ProcessMemoryLimit = usize::try_from(memory_bytes).unwrap_or(usize::MAX);

    // SAFETY: SetInformationJobObject reads exactly the initialized limits
    // structure; the job handle is live and owned by this worker.
    let configured = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast::<c_void>(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        // SAFETY: job is a live handle created above and is not used afterward.
        unsafe { CloseHandle(job) };
        return Err(limit_error(
            ErrorCode::Memory,
            "render worker could not configure its Windows resource limits",
        ));
    }

    // SAFETY: GetCurrentProcess returns the current pseudo-handle; both handles
    // satisfy AssignProcessToJobObject's requirements for the current process.
    if unsafe { AssignProcessToJobObject(job, GetCurrentProcess()) } == 0 {
        // SAFETY: assignment failed, so closing the otherwise live job cannot
        // trigger its kill-on-close policy for this process.
        unsafe { CloseHandle(job) };
        return Err(limit_error(
            ErrorCode::Memory,
            "render worker could not enter its Windows resource job",
        ));
    }

    // Intentionally retain the raw job handle until process exit. Closing the
    // final handle would activate JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and kill
    // this worker before it can return its structured envelope.
    Ok(())
}

#[cfg(any(windows, test))]
fn duration_to_windows_ticks(duration: Duration) -> i64 {
    let ticks = duration.as_nanos() / 100;
    i64::try_from(ticks).unwrap_or(i64::MAX)
}

fn limit_error(code: ErrorCode, message: &'static str) -> TransformError {
    TransformError::new(code, message).with_details(json!({
        "reason": std::io::Error::last_os_error().to_string()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_cpu_time_uses_one_hundred_nanosecond_ticks() {
        assert_eq!(
            duration_to_windows_ticks(Duration::from_secs(20)),
            200_000_000
        );
    }

    #[test]
    fn cpu_limit_counts_parallel_worker_time_without_shortening_wall_timeout() {
        assert_eq!(
            scaled_cpu_budget(Duration::from_secs(20), 4),
            Duration::from_secs(80)
        );
        assert_eq!(
            scaled_cpu_budget(Duration::from_secs(20), 0),
            Duration::from_secs(20)
        );
    }
}
