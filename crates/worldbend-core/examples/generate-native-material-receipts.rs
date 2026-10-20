use std::{error::Error, fs, path::Path};
use worldbend_core::*;

fn save(
    root: &Path,
    name: &str,
    value: &impl serde::Serialize,
    check: bool,
) -> Result<(), Box<dyn Error>> {
    let text = serde_json::to_string_pretty(value)? + "\n";
    for folder in [
        "examples/ios-procedural-materials/Receipts",
        "packages/swiftui/Tests/WorldbendAppearanceTests/Receipts",
    ] {
        let directory = root.join(folder);
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("procedural-{name}.json"));
        if check {
            if fs::read_to_string(&path)? != text {
                return Err(format!("stale receipt {}", path.display()).into());
            }
        } else {
            fs::write(path, &text)?;
        }
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let check = std::env::args().any(|arg| arg == "--check");
    let foil = FoilMaterial {
        base_color: FoilColor {
            r: 0.08,
            g: 0.18,
            b: 0.22,
            a: 0.85,
        },
        highlight_color: FoilColor {
            r: 0.97,
            g: 0.83,
            b: 0.5,
            a: 0.65,
        },
        light_angle: 35.0,
        intensity: 0.85,
        roughness: 0.55,
        flow_speed: 0.35,
        visible: true,
    };
    let previous = FoilDeliveryInput {
        recipe: FoilRecipeSpec {
            schema: FOIL_SCHEMA.into(),
            version: "0.1".into(),
            recipe_id: "native-book-foil".into(),
            recipe_version: 1,
            material: foil,
        },
        material: foil,
        target: FoilDeliveryTarget::Swiftui,
    };
    let mut next = previous.clone();
    next.recipe.recipe_version = 2;
    next.material.intensity = 0.35;
    next.recipe.material = next.material;
    let mut live = foil;
    live.highlight_color = FoilColor {
        r: 0.45,
        g: 0.78,
        b: 0.98,
        a: 0.2,
    };
    let initial = plan_foil_delivery(&previous)?;
    save(&root, "foil-initial", &initial, check)?;
    save(&root, "foil-source", &plan_foil_delivery(&next)?, check)?;
    let mut personal = next.clone();
    personal.material.roughness = 0.85;
    personal.recipe.material = personal.material;
    save(
        &root,
        "personal-foil-source",
        &plan_foil_delivery(&personal)?,
        check,
    )?;
    save(
        &root,
        "foil-local",
        &plan_foil_delivery(&FoilDeliveryInput {
            material: live,
            ..previous.clone()
        })?,
        check,
    )?;
    save(
        &root,
        "foil-update",
        &plan_foil_update(&FoilUpdateInput {
            previous: previous.clone(),
            next: next.clone(),
            live: Some(live),
            expected_fingerprint: initial.fingerprint.clone(),
        })?,
        check,
    )?;
    save(
        &root,
        "foil-pristine-update",
        &plan_foil_update(&FoilUpdateInput {
            previous: previous.clone(),
            next: next.clone(),
            live: Some(foil),
            expected_fingerprint: initial.fingerprint.clone(),
        })?,
        check,
    )?;
    save(
        &root,
        "foil-removed-update",
        &plan_foil_update(&FoilUpdateInput {
            previous,
            next,
            live: None,
            expected_fingerprint: initial.fingerprint,
        })?,
        check,
    )?;

    let mesh = MeshGradientMaterial {
        color_tl: MeshGradientColor {
            r: 0.12,
            g: 0.28,
            b: 0.78,
            a: 0.8,
        },
        color_tr: MeshGradientColor {
            r: 0.6,
            g: 0.2,
            b: 0.65,
            a: 0.9,
        },
        color_bl: MeshGradientColor {
            r: 0.14,
            g: 0.62,
            b: 0.54,
            a: 1.0,
        },
        color_br: MeshGradientColor {
            r: 0.96,
            g: 0.44,
            b: 0.22,
            a: 0.65,
        },
        visible: true,
        warp: 0.65,
        softness: 0.75,
        duration_ms: 6000.0,
        phase_ms: 1300.0,
        flow_speed: 0.6,
    };
    let previous = MeshGradientDeliveryInput {
        recipe: MeshGradientRecipeSpec {
            schema: MESH_GRADIENT_SCHEMA.into(),
            version: "0.1".into(),
            recipe_id: "native-fluid-light".into(),
            recipe_version: 1,
            material: mesh,
        },
        material: mesh,
        target: MeshGradientDeliveryTarget::Swiftui,
        kernel_profile: MeshGradientKernelProfile::default(),
    };
    let mut next = previous.clone();
    next.recipe.recipe_version = 2;
    next.material.warp = 0.8;
    next.recipe.material = next.material;
    let mut live = mesh;
    live.phase_ms = 3400.0;
    live.color_tr = MeshGradientColor {
        r: 0.18,
        g: 0.52,
        b: 0.86,
        a: 0.4,
    };
    let initial = plan_mesh_gradient_delivery(&previous)?;
    save(&root, "mesh-initial", &initial, check)?;
    save(
        &root,
        "mesh-source",
        &plan_mesh_gradient_delivery(&next)?,
        check,
    )?;
    let mut personal = next.clone();
    personal.material.softness = 0.25;
    personal.recipe.material = personal.material;
    save(
        &root,
        "personal-mesh-source",
        &plan_mesh_gradient_delivery(&personal)?,
        check,
    )?;
    save(
        &root,
        "mesh-local",
        &plan_mesh_gradient_delivery(&MeshGradientDeliveryInput {
            material: live,
            ..previous.clone()
        })?,
        check,
    )?;
    save(
        &root,
        "mesh-update",
        &plan_mesh_gradient_update(&MeshGradientUpdateInput {
            previous: previous.clone(),
            next: next.clone(),
            live: Some(live),
            expected_fingerprint: initial.fingerprint.clone(),
        })?,
        check,
    )?;
    save(
        &root,
        "mesh-pristine-update",
        &plan_mesh_gradient_update(&MeshGradientUpdateInput {
            previous: previous.clone(),
            next: next.clone(),
            live: Some(mesh),
            expected_fingerprint: initial.fingerprint.clone(),
        })?,
        check,
    )?;
    save(
        &root,
        "mesh-removed-update",
        &plan_mesh_gradient_update(&MeshGradientUpdateInput {
            previous: previous.clone(),
            next: next.clone(),
            live: None,
            expected_fingerprint: initial.fingerprint,
        })?,
        check,
    )?;
    let mut old = previous.clone();
    old.kernel_profile = MeshGradientKernelProfile::LinearV1;
    let old_delivery = plan_mesh_gradient_delivery(&old)?;
    save(&root, "mesh-v1-initial", &old_delivery, check)?;
    save(
        &root,
        "mesh-v1-local",
        &plan_mesh_gradient_delivery(&MeshGradientDeliveryInput {
            material: live,
            ..old.clone()
        })?,
        check,
    )?;
    save(
        &root,
        "mesh-profile-upgrade",
        &plan_mesh_gradient_update(&MeshGradientUpdateInput {
            previous: old.clone(),
            next: next.clone(),
            live: Some(live),
            expected_fingerprint: old_delivery.fingerprint,
        })?,
        check,
    )?;
    for (name, live) in [
        ("mesh-profile-pristine-upgrade", Some(mesh)),
        ("mesh-profile-removed-upgrade", None),
    ] {
        save(
            &root,
            name,
            &plan_mesh_gradient_update(&MeshGradientUpdateInput {
                previous: old.clone(),
                next: next.clone(),
                live,
                expected_fingerprint: plan_mesh_gradient_delivery(&old)?.fingerprint,
            })?,
            check,
        )?;
    }
    Ok(())
}
