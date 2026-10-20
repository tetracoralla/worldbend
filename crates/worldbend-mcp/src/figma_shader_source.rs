//! Shared exact Shader source evidence for bounded native material requests.
//! Material parameters and action semantics remain owned by their typed family.
use crate::figma_handoff::identity;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use worldbend_core::{ErrorCode, TransformError, TransformResult};
fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShaderSource {
    #[schemars(description = "Exact Shader id returned by get_shader; not its name")]
    pub(crate) id: String,
    #[schemars(description = "Exact get_shader build/version commit SHA")]
    pub(crate) version: String,
    #[schemars(
        length(min = 1, max = 65536),
        description = "Exact main.ts source returned by get_shader for this id/version; inspected for integrity, never executed"
    )]
    pub(crate) main_source: String,
    #[schemars(
        description = "Exact paint resource identity from actual native evidence, required for reads/edits. Acquisition observes this alias with a temporary native probe; never infer it from a name or build suffix"
    )]
    #[serde(default)]
    pub(crate) paint_id: Option<String>,
}
pub(crate) fn source_hash(source: &str) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(source.as_bytes())))
}
pub(crate) fn resource(
    source: &ShaderSource,
    paint_required: bool,
    current_source: &str,
    legacy_hash: &str,
    family: &str,
) -> TransformResult<serde_json::Value> {
    identity(&source.id)?;
    if source.id.contains('/')
        || source.version.len() != 40
        || !source
            .version
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(error(
            "Use the exact Shader id and lowercase build commit SHA from get_shader",
        ));
    }
    if source.main_source.is_empty() || source.main_source.len() > 65536 {
        return Err(error("Shader main.ts evidence must be 1..65536 bytes"));
    }
    let hash = source_hash(&source.main_source);
    if hash != source_hash(current_source) && hash != legacy_hash {
        return Err(error(&format!(
            "Shader source is not the current or supported legacy {family} profile"
        )));
    }
    let id = format!("{}/{}", source.id, source.version);
    identity(&id)?;
    let mut value = json!({"importId":id,"sourceSha256":hash});
    if let Some(paint) = &source.paint_id {
        identity(paint)?;
        value["paintId"] = json!(paint);
    } else if paint_required {
        return Err(error(
            "Use the paint identity observed by native acquisition or capture",
        ));
    }
    Ok(value)
}
