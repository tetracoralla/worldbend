use std::path::PathBuf;
use worldbend_core::native_material_preference_rules;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let path = root.join(
        "packages/swiftui/Sources/WorldbendAppearance/MaterialPreferenceRules.generated.swift",
    );
    let rules = native_material_preference_rules()?;
    let mut text = String::from(
        "// @generated from worldbend-core material preference fields; do not edit.\nimport Foundation\n\nenum WorldbendMaterialPreferenceRules {\n    static let families: [String: [String: WorldbendMaterialFieldRule]] = [\n",
    );
    for (family, fields) in rules.as_object().unwrap() {
        text += &format!("        \"{family}\": [\n");
        for row in fields.as_array().unwrap() {
            let range = if let Some(values) = row["range"].as_array() {
                format!("[{}, {}]", values[0], values[1])
            } else {
                "nil".into()
            };
            text += &format!(
                "            {}: .init(property: {}, kind: {}, range: {range}, unit: {}, direction: {}, moving: {}),\n",
                row["field"],
                row["property"],
                row["kind"],
                row["unit"],
                row["direction"],
                row["moving"]
            );
        }
        text += "        ],\n";
    }
    text += "    ]\n}\n";
    if std::env::args().any(|value| value == "--check") {
        if std::fs::read_to_string(&path)? != text {
            return Err("native material preference rules are stale".into());
        }
    } else {
        std::fs::write(&path, text)?;
    }
    Ok(())
}
