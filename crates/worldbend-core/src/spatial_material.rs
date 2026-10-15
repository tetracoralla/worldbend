//! Durable appearance expressions reuse the typed family contracts. The
//! document binds existing content surfaces; it never owns a second renderer.
use crate::{
    AppearanceDeliveryInput, AppearanceDeliveryPlan, FoilDeliveryInput, FoilDeliveryPlan,
    MeshGradientDeliveryInput, MeshGradientDeliveryPlan, TextureDeliveryInput, TextureDeliveryPlan,
    TransformResult, plan_appearance_delivery, plan_foil_delivery, plan_mesh_gradient_delivery,
    plan_texture_delivery,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SpatialMaterialFamily {
    Glass,
    Texture,
    Foil,
    MeshGradient,
}

/// Authored seed, actual material and intended target remain family-specific.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SpatialMaterialInput {
    Glass {
        input: Box<AppearanceDeliveryInput>,
    },
    Texture {
        input: Box<TextureDeliveryInput>,
    },
    Foil {
        input: Box<FoilDeliveryInput>,
    },
    MeshGradient {
        input: Box<MeshGradientDeliveryInput>,
    },
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SpatialMaterialDelivery {
    Glass {
        delivery: Box<AppearanceDeliveryPlan>,
    },
    Texture {
        delivery: Box<TextureDeliveryPlan>,
    },
    Foil {
        delivery: Box<FoilDeliveryPlan>,
    },
    MeshGradient {
        delivery: Box<MeshGradientDeliveryPlan>,
    },
}

impl SpatialMaterialInput {
    pub(crate) fn plan(&self) -> TransformResult<SpatialMaterialDelivery> {
        Ok(match self {
            Self::Glass { input } => SpatialMaterialDelivery::Glass {
                delivery: Box::new(plan_appearance_delivery(input)?),
            },
            Self::Texture { input } => SpatialMaterialDelivery::Texture {
                delivery: Box::new(plan_texture_delivery(input)?),
            },
            Self::Foil { input } => SpatialMaterialDelivery::Foil {
                delivery: Box::new(plan_foil_delivery(input)?),
            },
            Self::MeshGradient { input } => SpatialMaterialDelivery::MeshGradient {
                delivery: Box::new(plan_mesh_gradient_delivery(input)?),
            },
        })
    }
}

impl SpatialMaterialDelivery {
    pub(crate) fn identity(&self) -> (SpatialMaterialFamily, &str) {
        match self {
            Self::Glass { delivery } => (SpatialMaterialFamily::Glass, &delivery.fingerprint),
            Self::Texture { delivery } => (SpatialMaterialFamily::Texture, &delivery.fingerprint),
            Self::Foil { delivery } => (SpatialMaterialFamily::Foil, &delivery.fingerprint),
            Self::MeshGradient { delivery } => {
                (SpatialMaterialFamily::MeshGradient, &delivery.fingerprint)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;
    use serde_json::json;

    fn inputs() -> Vec<SpatialMaterialInput> {
        [("glass", APPEARANCE_SCHEMA, json!(GlassMaterial::default())),
         ("texture", TEXTURE_SCHEMA, json!(TextureMaterial::default())),
         ("foil", FOIL_SCHEMA, json!(FoilMaterial::default())),
         ("mesh-gradient", MESH_GRADIENT_SCHEMA, json!(MeshGradientMaterial::default()))]
            .into_iter().map(|(family, schema, material)| serde_json::from_value(json!({
                "family": family, "input": {
                    "recipe": {"schema":schema,"version":"0.1","recipeId":"authored-work","recipeVersion":1,"material":material},
                    "material":material, "target":"web"
                }
            })).unwrap()).collect()
    }
    fn document(material: SpatialMaterialInput) -> SpatialDocumentSpec {
        SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.into(),
            version: SPATIAL_DOCUMENT_VERSION.into(),
            assets: vec![SpatialDocumentAsset {
                id: "poster".into(),
                content_version: Some("week-1".into()),
            }],
            expressions: vec![SpatialDocumentExpression::Material {
                id: "poster-finish".into(),
                material,
                bindings: vec!["small-card", "hero"]
                    .into_iter()
                    .map(|slot| SpatialDocumentBinding {
                        role: SpatialDocumentBindingRole::Content,
                        slot_id: slot.into(),
                        asset_id: "poster".into(),
                    })
                    .collect(),
            }],
        }
    }
    fn delivery(document: SpatialDocumentSpec) -> SpatialDocumentDeliveryPlan {
        plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document,
            expected_fingerprint: None,
            expression_ids: None,
        })
        .unwrap()
    }

    #[test]
    fn all_families_deliver_the_existing_target_contract_with_canonical_surface_bindings() {
        for input in inputs() {
            let expected = json!(input.plan().unwrap());
            let mut source = document(input);
            let first = inspect_spatial_document(&source).unwrap();
            assert!(first.unused_asset_ids.is_empty());
            let SpatialDocumentDelivery::Material {
                material, bindings, ..
            } = &delivery(source.clone()).deliveries[0]
            else {
                panic!()
            };
            assert_eq!(json!(material), expected);
            assert_eq!(
                bindings
                    .iter()
                    .map(|b| b.slot_id.as_str())
                    .collect::<Vec<_>>(),
                ["hero", "small-card"]
            );
            let SpatialDocumentExpression::Material { bindings, .. } = &mut source.expressions[0]
            else {
                panic!()
            };
            bindings.reverse();
            assert_eq!(
                first.fingerprint,
                inspect_spatial_document(&source).unwrap().fingerprint
            );
        }
    }

    #[test]
    fn content_and_material_revision_preserve_sibling_work_and_reject_stale_plans() {
        let mut source = document(inputs().pop().unwrap());
        let mut companion = source.expressions[0].clone();
        let SpatialDocumentExpression::Material { id, .. } = &mut companion else {
            panic!()
        };
        *id = "companion".into();
        source.expressions.push(companion.clone());
        let previous = inspect_spatial_document(&source).unwrap().fingerprint;
        let mut revised = source.expressions[0].clone();
        let SpatialDocumentExpression::Material {
            material: SpatialMaterialInput::MeshGradient { input },
            ..
        } = &mut revised
        else {
            panic!()
        };
        // Actual state can differ from the authored seed, including alpha and timing.
        input.material.color_tl.a = 0.4;
        input.material.phase_ms = 1600.0;
        let request = SpatialDocumentUpdateInput {
            document: source,
            expected_fingerprint: Some(previous.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "poster".into(),
                content_version: Some("week-2".into()),
            }],
            new_assets: vec![],
            expressions: vec![revised],
        };
        let plan = plan_spatial_document_update(&request).unwrap();
        assert_eq!(plan.affected_expressions.len(), 2);
        assert!(
            plan.affected_expressions
                .iter()
                .all(|e| e.kind == SpatialDocumentExpressionKind::Material)
        );
        assert_eq!(json!(plan.document.expressions[1]), json!(companion));
        let SpatialDocumentDelivery::Material {
            material: SpatialMaterialDelivery::MeshGradient { delivery },
            ..
        } = &delivery(plan.document.clone()).deliveries[0]
        else {
            panic!()
        };
        assert_eq!(delivery.material.color_tl.a, 0.4);
        assert_eq!(delivery.material.phase_ms, 1600.0);
        assert_eq!(delivery.recipe_version, 1);
        let stale = SpatialDocumentUpdateInput {
            document: plan.document.clone(),
            ..request
        };
        assert!(plan_spatial_document_update(&stale).is_err());
        assert!(
            plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
                document: plan.document,
                expected_fingerprint: Some(previous),
                expression_ids: None,
            })
            .is_err()
        );
    }

    #[test]
    fn assembly_remaps_content_identity_without_changing_material_or_surface_roles() {
        let mut materials = inputs();
        let first = document(materials.pop().unwrap());
        let second = document(materials.pop().unwrap());
        let assembled = plan_spatial_document_assembly(&SpatialDocumentAssemblyInput {
            documents: vec![first, second]
                .into_iter()
                .enumerate()
                .map(|(index, document)| SpatialDocumentAssemblyDocument {
                    id: format!("source-{index}"),
                    expected_fingerprint: inspect_spatial_document(&document).unwrap().fingerprint,
                    document,
                })
                .collect(),
            assets: vec![SpatialDocumentAssemblyAsset {
                id: "shared-poster".into(),
                content_version: Some("week-1".into()),
                members: (0..2)
                    .map(|index| SpatialDocumentAssemblyAssetMember {
                        document_id: format!("source-{index}"),
                        asset_id: "poster".into(),
                    })
                    .collect(),
            }],
            expressions: (0..2)
                .map(|index| SpatialDocumentAssemblyExpression {
                    id: format!("finish-{index}"),
                    document_id: format!("source-{index}"),
                    expression_id: "poster-finish".into(),
                })
                .collect(),
        })
        .unwrap();
        for expression in &assembled.document.expressions {
            let SpatialDocumentExpression::Material { bindings, .. } = expression else {
                panic!()
            };
            assert!(bindings.iter().all(|b| b.asset_id == "shared-poster"));
            assert_eq!(
                bindings
                    .iter()
                    .map(|b| b.slot_id.as_str())
                    .collect::<Vec<_>>(),
                ["small-card", "hero"]
            );
        }
        assert_eq!(delivery(assembled.document).deliveries.len(), 2);
    }

    #[test]
    fn invalid_material_and_surface_relationships_fail_before_delivery() {
        for mutation in 0..6 {
            let mut source = document(inputs().pop().unwrap());
            let SpatialDocumentExpression::Material {
                material: SpatialMaterialInput::MeshGradient { input },
                bindings,
                ..
            } = &mut source.expressions[0]
            else {
                panic!()
            };
            match mutation {
                0 => input.material.softness = 3.0,
                1 => input.recipe.recipe_version = 0,
                2 => bindings.clear(),
                3 => bindings[0].role = SpatialDocumentBindingRole::DepthMap,
                4 => bindings[0].asset_id = "missing".into(),
                _ => bindings[0].slot_id = bindings[1].slot_id.clone(),
            }
            assert!(
                inspect_spatial_document(&source).is_err(),
                "mutation {mutation}"
            );
        }
        let mut unknown = json!(inputs().pop().unwrap());
        unknown["input"]["renderer"] = json!("foreign");
        assert!(serde_json::from_value::<SpatialMaterialInput>(unknown).is_err());
    }
}
