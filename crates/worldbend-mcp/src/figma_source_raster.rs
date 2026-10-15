//! Exact Figma-exported PNGs may arrive inline or as workspace files. File
//! authority is resolved once before the existing fingerprint/renderer path.
use base64::Engine as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::Read;
use worldbend_agent_fs::WorkspaceRoot;
use worldbend_core::{ErrorCode, TransformError, TransformResult};

const MAX_PNG_BYTES: usize = 1_200_000;

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum FigmaMockupSourceRaster {
    Inline(InlinePng),
    File(WorkspacePng),
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InlinePng {
    #[schemars(length(min = 8, max = 16), regex(pattern = r"^source-[1-8]$"))]
    pub(crate) slot_id: String,
    #[schemars(length(min = 1, max = 1_600_000))]
    pub(crate) base64: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspacePng {
    #[schemars(length(min = 8, max = 16), regex(pattern = r"^source-[1-8]$"))]
    slot_id: String,
    /// Relative PNG path under the MCP's explicitly granted workspace.
    #[schemars(length(min = 1, max = 4096))]
    path: String,
}

impl FigmaMockupSourceRaster {
    pub(crate) fn slot_id(&self) -> &str {
        match self {
            Self::Inline(v) => &v.slot_id,
            Self::File(v) => &v.slot_id,
        }
    }
    pub(crate) fn base64(&self) -> TransformResult<&str> {
        match self {
            Self::Inline(v) if !v.base64.is_empty() && v.base64.len() <= 1_600_000 => Ok(&v.base64),
            _ => Err(TransformError::new(
                ErrorCode::Schema,
                "Resolve an exact bounded PNG through its granted workspace before rendering",
            )),
        }
    }
    pub(crate) fn hydrate(&mut self, root: Option<&WorkspaceRoot>) -> TransformResult<()> {
        let Self::File(v) = self else {
            return self.base64().map(|_| ());
        };
        if v.path.is_empty() || v.path.len() > 4096 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Use a bounded relative workspace PNG path",
            ));
        }
        let root = root.ok_or_else(|| {
            TransformError::new(
                ErrorCode::Render,
                "File-backed Figma source requires an explicitly granted workspace root",
            )
        })?;
        let file = root.open_source(&v.path)?;
        let mut bytes = Vec::new();
        file.take((MAX_PNG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| {
                TransformError::new(
                    ErrorCode::Render,
                    "Unable to read the granted Figma PNG source",
                )
            })?;
        if bytes.is_empty() || bytes.len() > MAX_PNG_BYTES {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Figma source PNG exceeds the existing 1200000-byte decoded source ceiling",
            ));
        }
        *self = Self::Inline(InlinePng {
            slot_id: v.slot_id.clone(),
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
        Ok(())
    }
}

pub(crate) fn hydrate_sources(
    sources: &mut [FigmaMockupSourceRaster],
    root: Option<&WorkspaceRoot>,
) -> TransformResult<()> {
    if sources.is_empty() || sources.len() > 8 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Use 1..8 exact bound Figma PNG sources",
        ));
    }
    for source in sources {
        source.hydrate(root)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn file(path: &str) -> FigmaMockupSourceRaster {
        serde_json::from_value(json!({"slotId":"source-1","path":path})).unwrap()
    }
    #[test]
    fn file_source_retains_exact_bytes_after_the_visible_path_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("source.png"), b"exact-exported-bytes").unwrap();
        let root = WorkspaceRoot::open(dir.path()).unwrap();
        let mut source = file("source.png");
        source.hydrate(Some(&root)).unwrap();
        fs::rename(dir.path().join("source.png"), dir.path().join("old.png")).unwrap();
        fs::write(dir.path().join("source.png"), b"changed").unwrap();
        assert_eq!(source.slot_id(), "source-1");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(source.base64().unwrap())
                .unwrap(),
            b"exact-exported-bytes"
        );
    }
    #[test]
    fn source_authority_and_existing_byte_ceiling_are_not_widened() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = WorkspaceRoot::open(dir.path()).unwrap();
        assert!(file("source.png").hydrate(None).is_err());
        for path in [
            "../source.png",
            outside.path().join("source.png").to_str().unwrap(),
            "missing.png",
        ] {
            assert!(file(path).hydrate(Some(&root)).is_err());
        }
        fs::write(dir.path().join("large.png"), vec![0; MAX_PNG_BYTES + 1]).unwrap();
        assert_eq!(
            file("large.png").hydrate(Some(&root)).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        #[cfg(unix)]
        {
            fs::write(outside.path().join("source.png"), b"outside").unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("source.png"),
                dir.path().join("linked.png"),
            )
            .unwrap();
            assert_eq!(
                file("linked.png").hydrate(Some(&root)).unwrap_err().code,
                ErrorCode::PathSymlink
            );
        }
    }
    #[test]
    fn transport_variants_are_closed_and_unresolved_files_cannot_enter_a_renderer() {
        for value in [
            json!({"slotId":"source-1"}),
            json!({"slotId":"source-1","path":"s.png","base64":"aA=="}),
            json!({"slotId":"source-1","path":"s.png","url":"https://example.com"}),
        ] {
            assert!(serde_json::from_value::<FigmaMockupSourceRaster>(value).is_err());
        }
        assert!(file("source.png").base64().is_err());
        let mut inline: FigmaMockupSourceRaster =
            serde_json::from_value(json!({"slotId":"source-1","base64":"aA=="})).unwrap();
        inline.hydrate(None).unwrap();
        assert_eq!(inline.base64().unwrap(), "aA==");
    }
}
