use serde_json::{Value, json};
use std::path::PathBuf;
use worldbend_core::{
    MaterialPreferenceInput, native_material_preference_rules, plan_foil_delivery,
    plan_mesh_gradient_delivery, resolve_material_preference,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let directory =
        root.join("packages/swiftui/Tests/WorldbendAppearanceTests/Fixtures/material-preferences");
    let inputs: Value = serde_json::from_slice(&std::fs::read(
        root.join("packages/web/examples/material-preferences/inputs.json"),
    )?)?;
    let check = std::env::args().any(|value| value == "--check");
    let rules = native_material_preference_rules()?;
    if !check {
        std::fs::create_dir_all(&directory)?;
    }
    for (family, field, key, color_field) in [
        ("foil", "roughness", "roughness", "base-color"),
        ("mesh-gradient", "softness", "softness", "color-tl"),
    ] {
        let mut base = inputs[family].clone();
        base["source"]["target"] = json!("swiftui");
        let mut cases = vec![("empty", base.clone())];
        let mut all_fields = base.clone();
        let mut exposed = vec![];
        all_fields["preference"]["revision"] = json!(1);
        for rule in rules[family].as_array().ok_or("missing native rules")? {
            let id = rule["field"].as_str().ok_or("missing field")?;
            let value = match rule["kind"].as_str() {
                Some("toggle") => json!(false),
                Some("rgba") => json!({"r":0.12,"g":0.34,"b":0.56,"a":0.78}),
                Some("number") => {
                    let range = rule["range"].as_array().ok_or("missing range")?;
                    let lower = range[0].as_f64().ok_or("missing lower bound")?;
                    let upper = range[1].as_f64().ok_or("missing upper bound")?;
                    json!(lower + (upper - lower) * 0.37)
                }
                _ => return Err("unsupported native value kind".into()),
            };
            all_fields["preference"]["fields"][id] =
                json!({"actor":"agent","value":{"kind":rule["kind"],"value":value}});
            exposed.push(json!({"field":id}));
        }
        all_fields["policy"]["exposed"] = json!(exposed);
        cases.push(("all-fields", all_fields.clone()));
        all_fields["runtime"]["rendererAvailable"] = json!(false);
        cases.push(("unavailable", all_fields));
        let mut explicit = base.clone();
        explicit["preference"]["revision"] = json!(1);
        explicit["preference"]["fields"][field] = json!({"value":{"kind":"number","value":base["source"]["material"][key]},"actor":"user"});
        cases.push(("explicit-default", explicit.clone()));
        explicit["source"]["material"][key] = json!(0.85);
        explicit["source"]["recipe"]["recipeVersion"] = json!(2);
        cases.push(("later-design", explicit.clone()));
        explicit["preference"]["fields"][color_field] = json!({"value":{"kind":"rgba","value":{"r":0.1,"g":0.3,"b":0.6,"a":0.7}},"actor":"agent"});
        cases.push(("color", explicit.clone()));
        let mut hidden = explicit.clone();
        hidden["policy"]["revision"] = json!(2);
        hidden["policy"]["exposed"] = json!([]);
        cases.push(("hidden", hidden));
        let mut narrowed = explicit.clone();
        narrowed["policy"]["revision"] = json!(3);
        narrowed["policy"]["exposed"] = json!([{"field":field,"min":0,"max":0.2}]);
        cases.push(("narrowed", narrowed));
        let mut reduced = explicit.clone();
        reduced["runtime"]["motionAllowed"] = json!(false);
        cases.push(("reduced", reduced));
        if family == "mesh-gradient" {
            let mut legacy = explicit.clone();
            legacy["source"]["kernelProfile"] = json!("worldbend.mesh-gradient.rgba@0.1");
            cases.push(("legacy", legacy));
        }
        let mut results = vec![];
        for (name, wire) in cases {
            let input: MaterialPreferenceInput = serde_json::from_value(wire.clone())?;
            let source = match &input {
                MaterialPreferenceInput::Foil { source, .. } => {
                    serde_json::to_value(plan_foil_delivery(source)?)?
                }
                MaterialPreferenceInput::MeshGradient { source, .. } => {
                    serde_json::to_value(plan_mesh_gradient_delivery(source)?)?
                }
                _ => unreachable!(),
            };
            let output = serde_json::to_value(resolve_material_preference(&input)?)?;
            results.push(json!({"name":name,"source":source,"policy":wire["policy"],"preference":wire["preference"],"runtime":wire["runtime"],
                "expectedMaterial":output["plan"]["delivery"]["material"],"receipts":output["plan"]["receipts"],"controls":output["plan"]["controls"]}));
        }
        let path = directory.join(format!("{family}.json"));
        let text = serde_json::to_string_pretty(&json!({"family":family,"cases":results}))? + "\n";
        if check {
            if std::fs::read_to_string(&path)? != text {
                return Err(format!("{family} native preference parity is stale").into());
            }
        } else {
            std::fs::write(path, text)?;
        }
    }
    Ok(())
}
