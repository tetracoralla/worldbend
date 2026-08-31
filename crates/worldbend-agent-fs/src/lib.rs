//! Descriptor-scoped workspace file authority shared by every Agent carrier.
//!
//! A granted root is opened once, every descendant directory is acquired
//! without following symlinks, and held source/output handles remain
//! authoritative if visible pathnames are replaced before use.

use cap_fs_ext::{FollowSymlinks, OpenOptions, OpenOptionsFollowExt, ambient_authority};
use cap_primitives::fs::{
    DirOptions, create_dir, hard_link, open, open_ambient_dir, open_dir_nofollow, remove_dir,
    remove_dir_all, remove_file, rename, stat,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use worldbend_core::{ErrorCode, MAX_CANVAS_VARIANTS, TransformError, TransformResult};

static NEXT_STAGING_FILE: AtomicU64 = AtomicU64::new(1);
static NEXT_STAGING_DIRECTORY: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub struct WorkspaceRoot {
    directory: File,
}

#[derive(Debug)]
pub struct OutputTarget {
    parent: File,
    name: OsString,
    overwrite: bool,
}

#[derive(Debug)]
pub struct DirectoryOutputTarget {
    parent: File,
    name: OsString,
}

#[derive(Debug)]
pub struct StagedDirectoryCommit {
    parent: File,
    staged_name: OsString,
    final_name: OsString,
    committed: bool,
}

impl WorkspaceRoot {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let canonical = fs::canonicalize(path)?;
        let directory = open_ambient_dir(&canonical, ambient_authority())?;
        if !directory.metadata()?.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                "workspace root must resolve to a directory",
            ));
        }
        Ok(Self { directory })
    }

    pub fn open_source(&self, relative: &str) -> TransformResult<File> {
        let components = validate_relative_path(relative)?;
        let (parent, name) = self.open_parent(&components)?;
        reject_symlink(&parent, &name, components.len() - 1)?;

        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = open(&parent, Path::new(&name), &options).map_err(|error| {
            classify_open_error(
                &parent,
                &name,
                components.len() - 1,
                "source file is not accessible",
                error,
            )
        })?;
        let metadata = file.metadata().map_err(|error| {
            TransformError::new(ErrorCode::PathOutsideRoot, "source file is not accessible")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
        if !metadata.is_file() {
            return Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "source must be a regular file inside the granted workspace",
            ));
        }
        Ok(file)
    }

    pub fn prepare_output(&self, relative: &str, overwrite: bool) -> TransformResult<OutputTarget> {
        let components = validate_relative_path(relative)?;
        let (parent, name) = self.open_parent(&components)?;
        if !Path::new(&name)
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "render output path must use a .png extension",
            ));
        }

        match stat(&parent, Path::new(&name), FollowSymlinks::No) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(path_symlink(components.len() - 1));
                }
                if !metadata.is_file() {
                    return Err(TransformError::new(
                        ErrorCode::Render,
                        "output destination must be a regular file",
                    ));
                }
                if !overwrite {
                    return Err(TransformError::new(
                        ErrorCode::DestinationExists,
                        "destination already exists; set overwrite to true to replace it or choose a new output path",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "failed to inspect output destination",
                )
                .with_details(json!({ "reason": error.to_string() })));
            }
        }

        let probe_name = create_staging_file(&parent)?.0;
        remove_file(&parent, Path::new(&probe_name)).map_err(|error| {
            TransformError::new(ErrorCode::Render, "failed to remove output preflight file")
                .with_details(json!({ "reason": error.to_string() }))
        })?;

        Ok(OutputTarget {
            parent,
            name,
            overwrite,
        })
    }

    /// Acquire one not-yet-existing output directory under the descriptor
    /// grant. The returned target can copy a controller-private directory into
    /// a same-parent hidden directory, then expose one synchronous no-replace
    /// commit after response and cancellation preflight.
    pub fn prepare_output_directory(
        &self,
        relative: &str,
    ) -> TransformResult<DirectoryOutputTarget> {
        let components = validate_relative_path(relative)?;
        let (parent, name) = self.open_parent(&components)?;
        match stat(&parent, Path::new(&name), FollowSymlinks::No) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(path_symlink(components.len() - 1));
            }
            Ok(_) => {
                return Err(TransformError::new(
                    ErrorCode::DestinationExists,
                    "Canvas output directory already exists; choose a new outputDirectory because Canvas Set publication does not overwrite or merge",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "failed to inspect Canvas output directory",
                )
                .with_details(json!({ "reason": error.to_string() })));
            }
        }

        let probe = create_staging_directory(&parent)?;
        remove_dir(&parent, Path::new(&probe)).map_err(render_io(
            "failed to remove Canvas output preflight directory",
        ))?;
        Ok(DirectoryOutputTarget { parent, name })
    }

    fn open_parent(&self, components: &[OsString]) -> TransformResult<(File, OsString)> {
        let Some((name, parents)) = components.split_last() else {
            return Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "path must name a file inside the granted workspace",
            ));
        };
        let mut current = self.directory.try_clone().map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                "workspace grant could not be duplicated",
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?;
        for (index, component) in parents.iter().enumerate() {
            reject_symlink(&current, component, index)?;
            current = open_dir_nofollow(&current, Path::new(component)).map_err(|error| {
                classify_open_error(
                    &current,
                    component,
                    index,
                    "path component is not an accessible workspace directory",
                    error,
                )
            })?;
        }
        Ok((current, name.clone()))
    }
}

impl OutputTarget {
    pub fn publish_from(&self, staged: &Path) -> TransformResult<()> {
        let mut source = File::open(staged).map_err(|error| {
            TransformError::new(ErrorCode::Render, "staged render is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
        if !source.metadata().is_ok_and(|metadata| metadata.is_file()) {
            return Err(TransformError::new(
                ErrorCode::Render,
                "staged render must be a regular file",
            ));
        }
        source
            .seek(SeekFrom::Start(0))
            .map_err(render_io("failed to rewind staged render"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            source
                .set_permissions(fs::Permissions::from_mode(0o644))
                .map_err(render_io("failed to set output permissions"))?;
        }

        // Private staging is controller-owned, so open its parent once and
        // publish the already-synced artifact directly when both directories
        // share a filesystem. This removes a full output-sized copy from the
        // ordinary Agent path while retaining descriptor authority at the
        // workspace destination.
        let staged_parent_path = staged.parent().unwrap_or_else(|| Path::new("."));
        let staged_name = staged.file_name().ok_or_else(|| {
            TransformError::new(ErrorCode::Render, "staged render path has no file name")
        })?;
        let staged_parent = open_ambient_dir(staged_parent_path, ambient_authority())
            .map_err(render_io("failed to open private render staging"))?;
        let direct_result = if self.overwrite {
            rename(
                &staged_parent,
                Path::new(staged_name),
                &self.parent,
                Path::new(&self.name),
            )
        } else {
            hard_link(
                &staged_parent,
                Path::new(staged_name),
                &self.parent,
                Path::new(&self.name),
            )
        };
        match direct_result {
            Ok(()) => {
                if !self.overwrite {
                    let _ = remove_file(&staged_parent, Path::new(staged_name));
                }
                let _ = self.parent.sync_all();
                return Ok(());
            }
            Err(error) if is_cross_device(&error) => {}
            Err(error) => {
                let code = if !self.overwrite && error.kind() == std::io::ErrorKind::AlreadyExists {
                    ErrorCode::DestinationExists
                } else {
                    ErrorCode::Render
                };
                return Err(
                    TransformError::new(code, "failed to publish rendered output")
                        .with_details(json!({ "reason": error.to_string() })),
                );
            }
        }

        let (temporary_name, mut temporary) = create_staging_file(&self.parent)?;
        let publish = (|| -> TransformResult<()> {
            std::io::copy(&mut source, &mut temporary)
                .map_err(render_io("failed to stage rendered output"))?;
            temporary
                .flush()
                .map_err(render_io("failed to flush staged output"))?;
            temporary
                .sync_all()
                .map_err(render_io("failed to sync staged output"))?;
            drop(temporary);

            if self.overwrite {
                rename(
                    &self.parent,
                    Path::new(&temporary_name),
                    &self.parent,
                    Path::new(&self.name),
                )
                .map_err(render_io("failed to atomically publish rendered output"))?;
            } else {
                hard_link(
                    &self.parent,
                    Path::new(&temporary_name),
                    &self.parent,
                    Path::new(&self.name),
                )
                .map_err(|error| {
                    let code = if error.kind() == std::io::ErrorKind::AlreadyExists {
                        ErrorCode::DestinationExists
                    } else {
                        ErrorCode::Render
                    };
                    TransformError::new(code, "failed to publish rendered output without overwrite")
                        .with_details(json!({ "reason": error.to_string() }))
                })?;
                // The output side effect is committed. Cleanup is best-effort so
                // it cannot turn success into an error that hides publication.
                let _ = remove_file(&self.parent, Path::new(&temporary_name));
            }
            let _ = self.parent.sync_all();
            Ok(())
        })();

        if publish.is_err() {
            let _ = remove_file(&self.parent, Path::new(&temporary_name));
        }
        publish
    }
}

impl DirectoryOutputTarget {
    /// Copy a complete controller-private, flat Canvas output set into a
    /// hidden directory beside the final destination. This may be performed in
    /// a blocking task. The returned handle owns cleanup until `commit`.
    pub fn stage_from(self, source_directory: &Path) -> TransformResult<StagedDirectoryCommit> {
        self.stage_from_with_cancel(source_directory, &|| false)
    }

    /// Cancellable form of [`Self::stage_from`]. The predicate is polled
    /// before each file, between bounded copy chunks, and before filesystem
    /// sync. Cancellation removes the same-parent hidden directory before the
    /// method returns; the final commit remains a separate synchronous step.
    pub fn stage_from_with_cancel(
        self,
        source_directory: &Path,
        is_cancelled: &(dyn Fn() -> bool + Sync),
    ) -> TransformResult<StagedDirectoryCommit> {
        let metadata = fs::symlink_metadata(source_directory).map_err(render_io(
            "Canvas private staging directory is not accessible",
        ))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(TransformError::new(
                ErrorCode::Render,
                "Canvas private staging must be a real directory",
            ));
        }
        let staged_name = create_staging_directory(&self.parent)?;
        let staged_directory = match open_dir_nofollow(&self.parent, Path::new(&staged_name)) {
            Ok(directory) => directory,
            Err(error) => {
                let _ = remove_dir_all(&self.parent, Path::new(&staged_name));
                return Err(render_io(
                    "failed to open same-parent Canvas staging directory",
                )(error));
            }
        };
        let staged = (|| -> TransformResult<()> {
            let mut file_count = 0_usize;
            for entry in fs::read_dir(source_directory)
                .map_err(render_io("failed to inspect Canvas private staging"))?
            {
                check_cancelled(is_cancelled)?;
                file_count += 1;
                if file_count > MAX_CANVAS_VARIANTS {
                    return Err(TransformError::new(
                        ErrorCode::Render,
                        "Canvas staged output contains too many files",
                    ));
                }
                let entry = entry.map_err(render_io("failed to inspect Canvas staged entry"))?;
                let file_type = entry
                    .file_type()
                    .map_err(render_io("failed to inspect Canvas staged entry type"))?;
                if file_type.is_symlink() || !file_type.is_file() {
                    return Err(TransformError::new(
                        ErrorCode::Render,
                        "Canvas staged output must contain only regular files",
                    ));
                }
                let name = entry.file_name();
                if !Path::new(&name)
                    .extension()
                    .and_then(OsStr::to_str)
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
                {
                    return Err(TransformError::new(
                        ErrorCode::Render,
                        "Canvas staged output files must use .png",
                    ));
                }
                let mut source = File::open(entry.path())
                    .map_err(render_io("failed to open Canvas staged output"))?;
                let mut options = OpenOptions::new();
                options
                    .write(true)
                    .create_new(true)
                    .follow(FollowSymlinks::No);
                let mut destination = open(&staged_directory, Path::new(&name), &options).map_err(
                    render_io("failed to create same-parent Canvas staged output"),
                )?;
                copy_with_cancel(&mut source, &mut destination, is_cancelled)?;
                check_cancelled(is_cancelled)?;
                destination
                    .flush()
                    .map_err(render_io("failed to flush Canvas staged output"))?;
                destination
                    .sync_all()
                    .map_err(render_io("failed to sync Canvas staged output"))?;
            }
            if file_count == 0 {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "Canvas staged output must contain at least one PNG",
                ));
            }
            check_cancelled(is_cancelled)?;
            staged_directory
                .sync_all()
                .map_err(render_io("failed to sync Canvas staging directory"))?;
            Ok(())
        })();
        if let Err(error) = staged {
            let _ = remove_dir_all(&self.parent, Path::new(&staged_name));
            return Err(error);
        }
        Ok(StagedDirectoryCommit {
            parent: self.parent,
            staged_name,
            final_name: self.name,
            committed: false,
        })
    }
}

fn copy_with_cancel(
    source: &mut File,
    destination: &mut File,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        check_cancelled(is_cancelled)?;
        let count = source
            .read(&mut buffer)
            .map_err(render_io("failed to read Canvas staged output"))?;
        if count == 0 {
            return Ok(());
        }
        destination
            .write_all(&buffer[..count])
            .map_err(render_io("failed to copy Canvas staged output"))?;
    }
}

fn check_cancelled(is_cancelled: &(dyn Fn() -> bool + Sync)) -> TransformResult<()> {
    if is_cancelled() {
        Err(TransformError::new(
            ErrorCode::Cancelled,
            "Canvas staging copy was cancelled",
        ))
    } else {
        Ok(())
    }
}

impl StagedDirectoryCommit {
    /// Commit the complete output set with one same-parent atomic no-replace
    /// directory rename. No asynchronous work occurs after this call begins.
    pub fn commit(mut self) -> TransformResult<()> {
        atomic_rename_directory_noreplace(&self.parent, &self.staged_name, &self.final_name)
            .map_err(|error| {
                let code = if matches!(
                    error.kind(),
                    std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::DirectoryNotEmpty
                ) {
                    ErrorCode::DestinationExists
                } else {
                    ErrorCode::Render
                };
                TransformError::new(code, "failed to atomically commit Canvas output directory")
                    .with_details(json!({ "reason": error.to_string() }))
            })?;
        self.committed = true;
        let _ = self.parent.sync_all();
        Ok(())
    }
}

impl Drop for StagedDirectoryCommit {
    fn drop(&mut self) {
        if !self.committed {
            let _ = remove_dir_all(&self.parent, Path::new(&self.staged_name));
            let _ = self.parent.sync_all();
        }
    }
}

fn is_cross_device(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::CrossesDevices
}

pub fn copy_source_to_private_staging(
    mut source: File,
    destination: &Path,
    max_bytes: u64,
) -> TransformResult<String> {
    let metadata = source.metadata().map_err(|error| {
        TransformError::new(ErrorCode::PathOutsideRoot, "source file is not accessible")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if metadata.len() > max_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded source exceeds configured byte limit",
        )
        .with_details(json!({ "sourceBytes": metadata.len(), "maximum": max_bytes })));
    }
    let mut target =
        File::create(destination).map_err(render_io("failed to create private source staging"))?;
    source
        .seek(SeekFrom::Start(0))
        .map_err(render_io("failed to rewind source image"))?;
    let mut copied = 0_u64;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let remaining = max_bytes.saturating_add(1).saturating_sub(copied);
        if remaining == 0 {
            break;
        }
        let read_len = buffer.len().min(remaining as usize);
        let count = source
            .read(&mut buffer[..read_len])
            .map_err(render_io("failed to read source into private staging"))?;
        if count == 0 {
            break;
        }
        target
            .write_all(&buffer[..count])
            .map_err(render_io("failed to copy source into private staging"))?;
        hasher.update(&buffer[..count]);
        copied = copied.saturating_add(count as u64);
    }
    if copied > max_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded source exceeds configured byte limit",
        ));
    }
    target
        .flush()
        .map_err(render_io("failed to flush private source staging"))?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_relative_path(value: &str) -> TransformResult<Vec<OsString>> {
    let windows_prefix = value.as_bytes().get(1) == Some(&b':')
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic);
    if value.is_empty()
        || value.contains('\0')
        || value.contains("://")
        || value.starts_with('\\')
        || windows_prefix
    {
        return Err(TransformError::new(
            ErrorCode::PathOutsideRoot,
            "path must be a non-empty relative filesystem path, not a URI or platform path",
        ));
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Err(TransformError::new(
            ErrorCode::PathOutsideRoot,
            "absolute Agent paths are not allowed",
        ));
    }
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => components.push(name.to_owned()),
            Component::CurDir => {}
            _ => {
                return Err(TransformError::new(
                    ErrorCode::PathOutsideRoot,
                    "parent, root, and platform-prefix path components are not allowed",
                ));
            }
        }
    }
    if components.is_empty() {
        return Err(TransformError::new(
            ErrorCode::PathOutsideRoot,
            "path must name a file inside the granted workspace",
        ));
    }
    Ok(components)
}

fn reject_symlink(parent: &File, name: &OsStr, index: usize) -> TransformResult<()> {
    match stat(parent, Path::new(name), FollowSymlinks::No) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(path_symlink(index)),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(TransformError::new(
            ErrorCode::PathOutsideRoot,
            "path component could not be inspected",
        )
        .with_details(json!({ "componentIndex": index, "reason": error.to_string() }))),
    }
}

fn classify_open_error(
    parent: &File,
    name: &OsStr,
    index: usize,
    message: &'static str,
    error: std::io::Error,
) -> TransformError {
    if stat(parent, Path::new(name), FollowSymlinks::No)
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return path_symlink(index);
    }
    let io_kind = if error.kind() == std::io::ErrorKind::NotFound {
        "notFound"
    } else {
        "other"
    };
    TransformError::new(ErrorCode::PathOutsideRoot, message).with_details(json!({
        "componentIndex": index,
        "ioKind": io_kind,
        "reason": error.to_string()
    }))
}

fn path_symlink(index: usize) -> TransformError {
    TransformError::new(
        ErrorCode::PathSymlink,
        "Agent path traversal may not cross a symbolic link",
    )
    .with_details(json!({ "componentIndex": index }))
}

fn create_staging_file(parent: &File) -> TransformResult<(OsString, File)> {
    for _ in 0..32 {
        let sequence = NEXT_STAGING_FILE.fetch_add(1, Ordering::Relaxed);
        let name = OsString::from(format!(
            ".worldbend-publish-{}-{sequence}.tmp",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        match open(parent, Path::new(&name), &options) {
            Ok(file) => return Ok((name, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "output directory is not writable",
                )
                .with_details(json!({ "reason": error.to_string() })));
            }
        }
    }
    Err(TransformError::new(
        ErrorCode::Render,
        "could not allocate a unique output staging file",
    ))
}

fn create_staging_directory(parent: &File) -> TransformResult<OsString> {
    for _ in 0..32 {
        let sequence = NEXT_STAGING_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let name = OsString::from(format!(
            ".worldbend-canvas-{}-{sequence}.tmp",
            std::process::id()
        ));
        match create_dir(parent, Path::new(&name), &DirOptions::new()) {
            Ok(()) => return Ok(name),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "output directory is not writable",
                )
                .with_details(json!({ "reason": error.to_string() })));
            }
        }
    }
    Err(TransformError::new(
        ErrorCode::Render,
        "could not allocate a unique Canvas staging directory",
    ))
}

#[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
fn atomic_rename_directory_noreplace(
    parent: &File,
    old_name: &OsStr,
    new_name: &OsStr,
) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::{fd::AsRawFd, unix::ffi::OsStrExt};

    let old_name = CString::new(old_name.as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid old name"))?;
    let new_name = CString::new(new_name.as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid new name"))?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let status = unsafe {
        libc::renameat2(
            parent.as_raw_fd(),
            old_name.as_ptr(),
            parent.as_raw_fd(),
            new_name.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_vendor = "apple")]
    let status = unsafe {
        libc::renameatx_np(
            parent.as_raw_fd(),
            old_name.as_ptr(),
            parent.as_raw_fd(),
            new_name.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn atomic_rename_directory_noreplace(
    parent: &File,
    old_name: &OsStr,
    new_name: &OsStr,
) -> std::io::Result<()> {
    // `std::fs::rename` on Windows fails when the destination directory
    // exists; cap-primitives resolves both names from the held parent handle.
    rename(parent, Path::new(old_name), parent, Path::new(new_name))
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_vendor = "apple",
    windows
)))]
fn atomic_rename_directory_noreplace(
    _parent: &File,
    _old_name: &OsStr,
    _new_name: &OsStr,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "atomic no-replace directory rename is unavailable on this platform",
    ))
}

fn render_io(message: &'static str) -> impl FnOnce(std::io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, message)
            .with_details(json!({ "reason": error.to_string() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn rejects_absolute_parent_uri_and_cross_platform_prefixes() {
        let root = tempfile::tempdir().unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        for value in [
            "/tmp/source.png",
            "../source.png",
            "https://example.com/a.png",
            r"C:\source.png",
            r"\\server\share\source.png",
        ] {
            assert_eq!(
                workspace.open_source(value).unwrap_err().code,
                ErrorCode::PathOutsideRoot
            );
        }
    }

    #[test]
    fn opens_regular_source_and_preflights_output() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        fs::write(root.path().join("assets/source.png"), b"png").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let mut source = workspace.open_source("assets/source.png").unwrap();
        let mut bytes = Vec::new();
        source.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"png");
        workspace
            .prepare_output("assets/output.png", false)
            .unwrap();
    }

    #[test]
    fn canvas_directory_commit_is_atomic_and_no_replace() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("outputs")).unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("story.png"), b"story").unwrap();
        fs::write(private.path().join("square.png"), b"square").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        workspace
            .prepare_output_directory("outputs/complete")
            .unwrap()
            .stage_from(private.path())
            .unwrap()
            .commit()
            .unwrap();
        assert_eq!(
            fs::read(root.path().join("outputs/complete/story.png")).unwrap(),
            b"story"
        );

        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("new.png"), b"new").unwrap();
        let target = workspace.prepare_output_directory("outputs/raced").unwrap();
        let commit = target.stage_from(private.path()).unwrap();
        fs::create_dir(root.path().join("outputs/raced")).unwrap();
        fs::write(root.path().join("outputs/raced/owner.txt"), b"owner").unwrap();
        assert_eq!(
            commit.commit().unwrap_err().code,
            ErrorCode::DestinationExists
        );
        assert_eq!(
            fs::read(root.path().join("outputs/raced/owner.txt")).unwrap(),
            b"owner"
        );
        assert!(!root.path().join("outputs/raced/new.png").exists());
    }

    #[test]
    fn dropping_canvas_commit_cleans_same_parent_staging() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("outputs")).unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("one.png"), b"one").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let commit = workspace
            .prepare_output_directory("outputs/final")
            .unwrap()
            .stage_from(private.path())
            .unwrap();
        assert!(
            fs::read_dir(root.path().join("outputs"))
                .unwrap()
                .flatten()
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".worldbend-"))
        );
        drop(commit);
        assert!(
            fs::read_dir(root.path().join("outputs"))
                .unwrap()
                .flatten()
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".worldbend-"))
        );
        assert!(!root.path().join("outputs/final").exists());
    }

    #[test]
    fn private_source_copy_hashes_while_streaming_without_a_second_read() {
        let root = tempfile::tempdir().unwrap();
        let source_path = root.path().join("source.bin");
        let staged_path = root.path().join("staged.bin");
        fs::write(&source_path, b"hello").unwrap();
        let digest =
            copy_source_to_private_staging(File::open(&source_path).unwrap(), &staged_path, 1024)
                .unwrap();
        assert_eq!(
            digest,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(fs::read(staged_path).unwrap(), b"hello");
    }

    #[cfg(unix)]
    #[test]
    fn held_source_and_output_parent_survive_path_replacement_without_escape() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        fs::write(root.path().join("assets/source.png"), b"inside").unwrap();
        fs::write(outside.path().join("source.png"), b"outside").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let mut source = workspace.open_source("assets/source.png").unwrap();
        let output = workspace
            .prepare_output("assets/output.png", false)
            .unwrap();

        fs::rename(root.path().join("assets"), root.path().join("held-assets")).unwrap();
        symlink(outside.path(), root.path().join("assets")).unwrap();

        let mut bytes = Vec::new();
        source.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"inside");
        let staged = tempfile::NamedTempFile::new().unwrap();
        fs::write(staged.path(), b"rendered").unwrap();
        output.publish_from(staged.path()).unwrap();
        assert_eq!(
            fs::read(root.path().join("held-assets/output.png")).unwrap(),
            b"rendered"
        );
        assert!(!outside.path().join("output.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn held_canvas_output_parent_survives_path_replacement_without_escape() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("outputs")).unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let target = workspace.prepare_output_directory("outputs/final").unwrap();
        fs::rename(
            root.path().join("outputs"),
            root.path().join("held-outputs"),
        )
        .unwrap();
        symlink(outside.path(), root.path().join("outputs")).unwrap();

        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("one.png"), b"one").unwrap();
        target.stage_from(private.path()).unwrap().commit().unwrap();
        assert_eq!(
            fs::read(root.path().join("held-outputs/final/one.png")).unwrap(),
            b"one"
        );
        assert!(!outside.path().join("final").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_ancestors_and_final_entries() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("source.png"), b"outside").unwrap();
        symlink(outside.path(), root.path().join("linked")).unwrap();
        symlink(
            outside.path().join("source.png"),
            root.path().join("output.png"),
        )
        .unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        assert_eq!(
            workspace.open_source("linked/source.png").unwrap_err().code,
            ErrorCode::PathSymlink
        );
        assert_eq!(
            workspace
                .prepare_output("output.png", true)
                .unwrap_err()
                .code,
            ErrorCode::PathSymlink
        );
    }

    #[test]
    fn cancellation_during_canvas_copy_removes_same_parent_staging() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("outputs")).unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("large.png"), vec![7_u8; 512 * 1024]).unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let calls = AtomicUsize::new(0);
        let error = workspace
            .prepare_output_directory("outputs/final")
            .unwrap()
            .stage_from_with_cancel(private.path(), &|| {
                calls.fetch_add(1, Ordering::SeqCst) >= 3
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!root.path().join("outputs/final").exists());
        assert!(
            fs::read_dir(root.path().join("outputs"))
                .unwrap()
                .flatten()
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".worldbend-"))
        );
    }
}
