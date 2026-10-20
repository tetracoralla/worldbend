//! Prepare native Foil requests from explicit get_shader source evidence.
//! Source integrity is checked here; this module never contacts a Figma account.
use crate::figma_handoff::{FigmaRequest, bounded_request, identity};
use crate::figma_shader_source::{ShaderSource, source_hash};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use worldbend_core::{
    ErrorCode, FoilField, FoilMaterial, FoilRecipeSpec, TransformError, TransformResult,
};

const RUNTIME: &str = include_str!("figma-runtime-foil.js");
const CURRENT_SOURCE: &str = include_str!("../../../packages/figma/shaders/foil/main.ts");
const LEGACY_SOURCE_HASH: &str =
    "sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6";
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
#[schemars(extend("type"="object"))]
pub enum Change {
    Edit {
        material: FoilMaterial,
        #[schemars(length(min = 1, max = 7))]
        fields: Vec<FoilField>,
    },
    Choose {
        material: FoilMaterial,
        recipe: FoilRecipeSpec,
    },
    Adopt {
        material: FoilMaterial,
        recipe: FoilRecipeSpec,
        #[schemars(
            description = "Exact second get_shader result for the acquired current renderer"
        )]
        source: ShaderSource,
    },
    Remove {},
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FoilInput {
    file_key: String,
    page_id: String,
    node_id: String,
    source: ShaderSource,
    #[serde(default)]
    paint_index: Option<u32>,
    operation: Operation,
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
#[schemars(extend("type"="object"))]
// Parsed once per request; the edit variant carries the full guarded change inline.
#[allow(clippy::large_enum_variant)]
enum Operation {
    Resources {},
    Acquire {
        #[serde(rename = "expectedState")]
        #[schemars(length(min = 1, max = 128))]
        expected_state: String,
        #[serde(default, rename = "repairRecord")]
        repair_record: bool,
    },
    Read {
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: u16,
        #[serde(default)]
        token: Option<String>,
    },
    Edit {
        #[serde(rename = "expectedState")]
        #[schemars(length(min = 1, max = 128))]
        expected_state: String,
        change: Change,
    },
}
fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn resource(source: &ShaderSource, paint_required: bool) -> TransformResult<serde_json::Value> {
    crate::figma_shader_source::resource(
        source,
        paint_required,
        CURRENT_SOURCE,
        LEGACY_SOURCE_HASH,
        "Foil",
    )
}
pub fn prepare(input: FoilInput) -> TransformResult<FigmaRequest> {
    identity(&input.file_key)?;
    identity(&input.page_id)?;
    identity(&input.node_id)?;
    let paint_required = matches!(
        &input.operation,
        Operation::Read { .. } | Operation::Edit { .. }
    );
    let captured_resource = resource(&input.source, paint_required)?;
    let mut arguments = json!({"fileKey":input.file_key,"pageId":input.page_id,"nodeId":input.node_id,
        "resource":captured_resource});
    if let Some(index) = input.paint_index {
        arguments["paintIndex"] = json!(index);
    }
    let (method, description) = match input.operation {
        Operation::Resources {} => (
            "foilResources",
            "Read Foil resource availability, retained identity and acquisition guard without changing artwork",
        ),
        Operation::Acquire {
            expected_state,
            repair_record,
        } => {
            if expected_state.is_empty() || expected_state.len() > 128 {
                return Err(error("Use the current Foil resource-state expectedState"));
            }
            // The acquisition probe obtains the paint alias itself.
            arguments["resource"]
                .as_object_mut()
                .unwrap()
                .remove("paintId");
            arguments["expectedState"] = json!(expected_state);
            arguments["repairRecord"] = json!(repair_record);
            (
                "acquireFoil",
                "Acquire the exact Foil build, observe its native paint identity and retain availability without adopting it",
            )
        }
        Operation::Read { part, token } => {
            if part > 255
                || (part > 0 && token.is_none())
                || token
                    .as_ref()
                    .is_some_and(|value| value.is_empty() || value.len() > 128)
            {
                return Err(error(
                    "Continue Foil reads with a valid part and the previous token",
                ));
            }
            arguments["part"] = json!(part);
            if let Some(token) = token {
                arguments["token"] = json!(token);
            }
            (
                "readFoil",
                "Read actual native Foil assignments, variable values and renderer profile",
            )
        }
        Operation::Edit {
            expected_state,
            change,
        } => {
            if expected_state.is_empty() || expected_state.len() > 128 {
                return Err(error("Use the current native Foil expectedState"));
            }
            match &change {
                Change::Edit { material, fields } => {
                    material.validate()?;
                    if fields.is_empty()
                        || fields.len() > 7
                        || fields
                            .iter()
                            .enumerate()
                            .any(|(index, field)| fields[..index].contains(field))
                    {
                        return Err(error("Foil edits need 1..7 distinct owned fields"));
                    }
                }
                Change::Choose { material, recipe } => {
                    material.validate()?;
                    recipe.validate()?;
                }
                Change::Adopt {
                    material,
                    recipe,
                    source,
                } => {
                    material.validate()?;
                    recipe.validate()?;
                    if source_hash(&source.main_source) != source_hash(CURRENT_SOURCE) {
                        return Err(error(
                            "Explicit Foil adoption requires the current renderer profile",
                        ));
                    }
                }
                Change::Remove {} => {}
            }
            arguments["expectedState"] = json!(expected_state);
            arguments["change"] = match change {
                Change::Adopt {
                    material,
                    recipe,
                    source,
                } => {
                    json!({"action":"adopt","material":material,"recipe":recipe,"resource":resource(&source,true)?})
                }
                other => json!(other),
            };
            (
                "editFoil",
                "Edit native Foil with current-state guards and rollback; retain the existing renderer",
            )
        }
    };
    // Returned source evidence is compact; main.ts is integrity input and never
    // interpolated into the executable request. The actual file read happens
    // only when the caller runs the returned use_figma request.
    let code = format!(
        "if(figma.fileKey!=={})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{RUNTIME}\nreturn await WorldbendFigmaHandoff.{method}({arguments});",
        json!(input.file_key),
        json!(input.page_id)
    );
    bounded_request(FigmaRequest {
        file_key: input.file_key,
        skill_names: "figma-use",
        description,
        code,
        publication: None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn input(action: serde_json::Value) -> serde_json::Value {
        let mut value = json!({"fileKey":"file","pageId":"1:2","nodeId":"2:3","source":{
            "id":"shader-id","version":"0123456789abcdef0123456789abcdef01234567",
            "paintId":"observed-paint/build","mainSource":CURRENT_SOURCE}});
        value["operation"] = action;
        value
    }
    #[test]
    fn checks_actual_source_bytes_and_only_embeds_compact_evidence() {
        let value = input(json!({"action":"read"}));
        let packet = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(packet.code.contains("WorldbendFigmaHandoff.readFoil"));
        assert!(packet.code.contains(&source_hash(CURRENT_SOURCE)));
        assert!(!packet.code.contains("@fragment fn"));
        assert!(serde_json::to_vec(&packet).unwrap().len() < 48 * 1024);
        let mut corrupt = value.clone();
        corrupt["source"]["mainSource"] = json!(format!("{CURRENT_SOURCE}\n// changed"));
        assert!(prepare(serde_json::from_value(corrupt).unwrap()).is_err());
        let mut bad = value;
        bad["source"]["version"] = json!("latest");
        assert!(prepare(serde_json::from_value(bad).unwrap()).is_err());
    }
    #[test]
    fn requires_current_receipts_and_distinct_typed_edits() {
        let material = FoilMaterial::default();
        for fields in [json!([]), json!(["intensity", "intensity"])] {
            assert!(
                prepare(
                    serde_json::from_value(input(
                        json!({"action":"edit","expectedState":"guard","change":{
                "action":"edit","material":material,"fields":fields}})
                    ))
                    .unwrap()
                )
                .is_err()
            );
        }
        assert!(
            prepare(serde_json::from_value(input(json!({"action":"read","part":1}))).unwrap())
                .is_err()
        );
        assert!(
            serde_json::from_value::<FoilInput>(input(
                json!({"action":"edit","expectedState":"guard","change":{
            "action":"remove","material":material}})
            ))
            .is_err()
        );
    }
    #[test]
    fn acquires_observed_aliases_without_guesses_and_validates_both_adoption_sources() {
        let mut value = input(json!({"action":"acquire","expectedState":"hash32x2:guard"}));
        value["source"].as_object_mut().unwrap().remove("paintId");
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(request.code.contains("WorldbendFigmaHandoff.acquireFoil"));
        assert!(!request.code.contains("@fragment fn"));
        value["operation"] = json!({"action":"read"});
        assert!(prepare(serde_json::from_value(value).unwrap()).is_err());
        let mut next = input(json!({"action":"resources"}))["source"].clone();
        let recipe: FoilRecipeSpec =
            serde_json::from_value(json!({"schema":"worldbend.foil@0.1","version":"0.1",
            "recipeId":"warm-fold","recipeVersion":1,"material":FoilMaterial::default()}))
            .unwrap();
        let value = input(json!({"action":"edit","expectedState":"guard","change":{
            "action":"adopt","material":FoilMaterial::default(),"recipe":recipe,"source":next}}));
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(request.code.contains("\"action\":\"adopt\""));
        assert!(!request.code.contains("@fragment fn"));
        next["mainSource"] = json!(format!("{CURRENT_SOURCE}\n// unsupported"));
        let mut corrupt = value;
        corrupt["operation"]["change"]["source"] = next;
        assert!(prepare(serde_json::from_value(corrupt).unwrap()).is_err());
    }
}
