//! Scoped video-command cancellation. The handler only flips a lock-free atomic;
//! ordinary rendering performs cleanup and returns the typed cancellation error.
use std::sync::atomic::{AtomicBool, Ordering};
use worldbend_core::{ErrorCode, TransformError, TransformResult};
static CANCELLED: AtomicBool = AtomicBool::new(false);
pub fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::Relaxed)
}

#[cfg(unix)]
extern "C" fn interrupt(_: libc::c_int) {
    CANCELLED.store(true, Ordering::Relaxed);
}
#[cfg(unix)]
pub struct CancellationSignals {
    previous: Vec<(libc::c_int, libc::sigaction)>,
}
#[cfg(unix)]
impl CancellationSignals {
    pub fn install() -> TransformResult<Self> {
        CANCELLED.store(false, Ordering::Relaxed);
        let mut guard = Self {
            previous: Vec::new(),
        };
        for signal in [libc::SIGINT, libc::SIGTERM] {
            // SAFETY: mask/flags/handler are initialized. The handler performs
            // no allocation, locks, IO or non-signal-safe operation.
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            let mut previous: libc::sigaction = unsafe { std::mem::zeroed() };
            action.sa_sigaction = interrupt as *const () as usize;
            unsafe {
                libc::sigemptyset(&mut action.sa_mask);
            }
            if unsafe { libc::sigaction(signal, &action, &mut previous) } != 0 {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "failed to register video cancellation",
                ));
            }
            guard.previous.push((signal, previous));
        }
        Ok(guard)
    }
}
#[cfg(unix)]
impl Drop for CancellationSignals {
    fn drop(&mut self) {
        for (signal, action) in &self.previous {
            unsafe {
                libc::sigaction(*signal, action, std::ptr::null_mut());
            }
        }
    }
}

#[cfg(windows)]
type Handler = unsafe extern "system" fn(u32) -> i32;
#[cfg(windows)]
#[link(name = "Kernel32")]
unsafe extern "system" {
    fn SetConsoleCtrlHandler(handler: Option<Handler>, add: i32) -> i32;
}
#[cfg(windows)]
unsafe extern "system" fn interrupt(event: u32) -> i32 {
    if event <= 1 {
        CANCELLED.store(true, Ordering::Relaxed);
        1
    } else {
        0
    }
}
#[cfg(windows)]
pub struct CancellationSignals;
#[cfg(windows)]
impl CancellationSignals {
    pub fn install() -> TransformResult<Self> {
        CANCELLED.store(false, Ordering::Relaxed);
        if unsafe { SetConsoleCtrlHandler(Some(interrupt), 1) } == 0 {
            return Err(TransformError::new(
                ErrorCode::Render,
                "failed to register video cancellation",
            ));
        }
        Ok(Self)
    }
}
#[cfg(windows)]
impl Drop for CancellationSignals {
    fn drop(&mut self) {
        unsafe {
            SetConsoleCtrlHandler(Some(interrupt), 0);
        }
    }
}

#[cfg(not(any(unix, windows)))]
pub struct CancellationSignals;
#[cfg(not(any(unix, windows)))]
impl CancellationSignals {
    pub fn install() -> TransformResult<Self> {
        Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "this host has no supported video cancellation mechanism",
        ))
    }
}
