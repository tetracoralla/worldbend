//! Prepare one bounded Figma-tool request. This module never contacts Figma.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use worldbend_core::{
    CoordinateSpace, ErrorCode, Size, TransformError, TransformResult, TransformSpec, solve_spec,
};

const RUNTIME: &str = include_str!("figma-runtime.js");
const MAX_PACKET_BYTES: usize = 48 * 1024;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaInspectInput {
    #[schemars(
        length(min = 1, max = 256),
        description = "Explicitly granted Figma file key"
    )]
    file_key: String,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(
        length(min = 1, max = 256),
        description = "Selected Worldbend editable result or its duplicate"
    )]
    node_id: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaPlacement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaSource {
    node_id: String,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaSnapshot {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    /// Zero denotes a native duplicate which has not yet been independently updated.
    revision: u64,
    spec: TransformSpec,
    source: FigmaSource,
    placement: FigmaPlacement,
    #[schemars(
        length(min = 1, max = 8192),
        description = "Opaque expected-state fingerprint from the actual Figma inspect result"
    )]
    expected: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaApplyInput {
    snapshot: FigmaSnapshot,
    #[schemars(
        description = "Normalized affine/projective TransformSpec; native output excludes Warp"
    )]
    spec: TransformSpec,
    #[serde(default)]
    #[schemars(
        range(min = 1, max = 4096),
        description = "Requested logical frame width; omission preserves the current fractional width. Core solving uses the ceiling in pixels."
    )]
    width: Option<u32>,
    #[serde(default)]
    #[schemars(range(min = 1, max = 4096))]
    height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaRequest {
    file_key: String,
    skill_names: &'static str,
    description: &'static str,
    #[schemars(
        length(max = 49152),
        description = "Pass this complete request to the available Figma use_figma tool after loading its required skill. Preparing it performs no Figma read or write."
    )]
    code: String,
}

fn input_error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

fn identity(value: &str) -> TransformResult<()> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(input_error(
            "Figma identities must contain 1..256 bytes without control characters",
        ));
    }
    Ok(())
}

fn axis(value: f64) -> TransformResult<u32> {
    if !value.is_finite() || !(0.01..=4096.0).contains(&value) {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Editable Figma axes must be in 0.01..4096 logical units",
        ));
    }
    Ok(value.ceil() as u32)
}

fn native_spec(spec: &TransformSpec) -> TransformResult<()> {
    if spec.destination.space != CoordinateSpace::Normalized || spec.content.warp.is_some() {
        return Err(input_error(
            "Editable Figma output requires a normalized TransformSpec without Warp",
        ));
    }
    Ok(())
}

fn packet(
    file_key: String,
    page_id: &str,
    call: String,
    applying: bool,
) -> TransformResult<FigmaRequest> {
    identity(&file_key)?;
    identity(page_id)?;
    let page = json!(page_id);
    let file = json!(file_key);
    let code = format!(
        "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{RUNTIME}\nconst state=await WorldbendFigmaHandoff.{call};const result=await figma.getNodeByIdAsync(state.nodeId);await result.screenshot({{scale:Math.min(1,1024/Math.max(state.placement.width,state.placement.height))}});return state;"
    );
    let request = FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description: if applying {
            "Apply a core-validated transform to the same editable Figma result"
        } else {
            "Read a Worldbend editable result and its visual preview"
        },
        code,
    };
    let bytes = serde_json::to_vec(&request)
        .map_err(|_| input_error("Figma request serialization failed"))?;
    if bytes.len() > MAX_PACKET_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Figma request exceeds 48 KiB",
        ));
    }
    Ok(request)
}

pub fn inspect(input: FigmaInspectInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    let call = format!(
        "inspect({},{},{})",
        json!(input.node_id),
        json!(input.file_key),
        json!(input.page_id)
    );
    packet(input.file_key, &input.page_id, call, false)
}

pub fn apply(input: FigmaApplyInput) -> TransformResult<FigmaRequest> {
    let saved = input.snapshot;
    for value in [
        &saved.file_key,
        &saved.page_id,
        &saved.node_id,
        &saved.source.node_id,
    ] {
        identity(value)?;
    }
    if saved.schema != "worldbend.figma.handoff"
        || saved.version != "0.1"
        || saved.revision > 9_007_199_254_740_991
        || saved.expected.is_empty()
        || saved.expected.len() > 8192
        || !saved.placement.x.is_finite()
        || !saved.placement.y.is_finite()
    {
        return Err(input_error("Invalid bounded Figma handoff snapshot"));
    }
    axis(saved.source.width)?;
    axis(saved.source.height)?;
    axis(saved.placement.width)?;
    axis(saved.placement.height)?;
    native_spec(&saved.spec)?;
    native_spec(&input.spec)?;
    let width = input.width.map(f64::from).unwrap_or(saved.placement.width);
    let height = input
        .height
        .map(f64::from)
        .unwrap_or(saved.placement.height);
    let render_width = axis(width)?;
    let render_height = axis(height)?;
    let solved = solve_spec(
        &input.spec,
        Some(Size {
            width: f64::from(render_width),
            height: f64::from(render_height),
        }),
    )?;
    let call = format!(
        "apply({})",
        json!({
            "fileKey": saved.file_key, "pageId": saved.page_id, "nodeId": saved.node_id,
            "expected": saved.expected, "spec": input.spec,
            "inverse": solved.homography.inverse, "width": width, "height": height,
            "renderWidth": render_width, "renderHeight": render_height,
        })
    );
    packet(saved.file_key, &saved.page_id, call, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> serde_json::Value {
        let spec = json!({"schema":"worldbend.transform","version":"0.1","destination":{"space":"normalized","quad":{
            "tl":{"x":0.04,"y":0.03},"tr":{"x":0.93,"y":0.12},"br":{"x":0.98,"y":0.95},"bl":{"x":0.12,"y":0.99}
        }},"content":{"fit":"stretch"}});
        json!({"snapshot":{"schema":"worldbend.figma.handoff","version":"0.1","fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","revision":4,
            "source":{"nodeId":"48:5","width":520,"height":606},"placement":{"x":900,"y":3240,"width":560,"height":640},"spec":spec,"expected":"opaque"},"spec":spec})
    }

    #[test]
    fn builds_bounded_request_with_the_canonical_inverse() {
        let parsed: FigmaApplyInput = serde_json::from_value(input()).unwrap();
        let solved = solve_spec(
            &parsed.spec,
            Some(Size {
                width: 560.0,
                height: 640.0,
            }),
        )
        .unwrap();
        let request = apply(parsed).unwrap();
        assert!(
            request
                .code
                .contains(&format!("\"inverse\":{}", json!(solved.homography.inverse)))
        );
        assert!(request.code.contains("1024/Math.max"));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        assert_eq!(request.file_key, "granted-file");
    }

    #[test]
    fn rejects_invalid_geometry_limits_and_unknown_fields_before_producing_a_request() {
        let mut value = input();
        value["width"] = json!(4097);
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["spec"]["destination"]["quad"]["tr"] =
            value["spec"]["destination"]["quad"]["bl"].clone();
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["snapshot"]["expected"] = json!("x".repeat(8193));
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["silentOverwrite"] = json!(true);
        assert!(serde_json::from_value::<FigmaApplyInput>(value).is_err());
        let mut value = input();
        value["snapshot"]["placement"]["width"] = json!(0.001);
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn escapes_identities_as_data_and_accepts_a_fresh_duplicate() {
        let request = inspect(FigmaInspectInput {
            file_key: "granted-file".into(),
            page_id: "37:7".into(),
            node_id: "node');throw Error('injected".into(),
        })
        .unwrap();
        assert!(
            request
                .code
                .contains("inspect(\"node');throw Error('injected\"")
        );
        let mut value = input();
        value["snapshot"]["revision"] = json!(0);
        assert!(apply(serde_json::from_value(value).unwrap()).is_ok());
    }

    #[test]
    fn preserves_fractional_placement_when_dimensions_are_omitted() {
        let mut value = input();
        value["snapshot"]["placement"]["width"] = json!(560.25);
        value["snapshot"]["placement"]["height"] = json!(640.5);
        let request = apply(serde_json::from_value(value).unwrap()).unwrap();
        assert!(request.code.contains("\"width\":560.25"));
        assert!(request.code.contains("\"height\":640.5"));
        assert!(request.code.contains("\"renderWidth\":561"));
        assert!(request.code.contains("\"renderHeight\":641"));
    }
}
