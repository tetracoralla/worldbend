use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Canonical JSON identity shared by durable Worldbend data. Object key order
/// and signed zero must not create carrier-specific fingerprints.
pub(crate) fn canonical_json_value<T: Serialize>(value: &T) -> serde_json::Result<Value> {
    fn normalize(value: &mut Value) {
        match value {
            Value::Number(number) if number.as_f64() == Some(0.0) => {
                *number = serde_json::Number::from_f64(0.0).expect("zero is finite");
            }
            Value::Array(values) => values.iter_mut().for_each(normalize),
            Value::Object(values) => values.values_mut().for_each(normalize),
            _ => {}
        }
    }

    let mut value = serde_json::to_value(value)?;
    normalize(&mut value);
    value.sort_all_objects();
    Ok(value)
}

pub(crate) fn fingerprint_json_value(value: &Value) -> serde_json::Result<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(format!(
        "sha256:{}",
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}
