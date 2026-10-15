//! Bounded lossless data envelopes. No executable source is accepted here.
use base64::Engine as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use worldbend_core::{ErrorCode, TransformError, TransformResult};
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExactJsonEnvelope {
    pub encoding: String,
    #[schemars(range(min = 1, max = 16777216))]
    pub decoded_bytes: usize,
    #[schemars(length(min = 64, max = 64))]
    pub digest: String,
    #[schemars(length(min = 1, max = 2097152))]
    pub data: String,
}
fn issue(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
pub fn encode(value: &impl Serialize) -> TransformResult<ExactJsonEnvelope> {
    let raw = serde_json::to_vec(value).map_err(|_| issue("Exact JSON serialization failed"))?;
    if raw.is_empty() || raw.len() > 16 * 1024 * 1024 {
        return Err(issue("Exact JSON exceeds decoded capacity"));
    }
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&raw)
        .map_err(|_| issue("Exact JSON compression failed"))?;
    let data = base64::engine::general_purpose::STANDARD.encode(
        gzip.finish()
            .map_err(|_| issue("Exact JSON compression failed"))?,
    );
    if data.len() > 2 * 1024 * 1024 {
        return Err(issue("Exact JSON exceeds encoded capacity"));
    }
    Ok(ExactJsonEnvelope {
        encoding: "gzip-base64".into(),
        decoded_bytes: raw.len(),
        digest: hex::encode(Sha256::digest(data.as_bytes())),
        data,
    })
}
pub fn decode(envelope: ExactJsonEnvelope) -> TransformResult<serde_json::Value> {
    if envelope.decoded_bytes == 0
        || envelope.decoded_bytes > 16 * 1024 * 1024
        || envelope.data.is_empty()
        || envelope.data.len() > 2 * 1024 * 1024
        || hex::encode(Sha256::digest(envelope.data.as_bytes())) != envelope.digest
    {
        return Err(issue("Exact Vector envelope changed or exceeds capacity"));
    }
    let encoded = base64::engine::general_purpose::STANDARD
        .decode(&envelope.data)
        .map_err(|_| issue("Invalid exact base64"))?;
    if base64::engine::general_purpose::STANDARD.encode(&encoded) != envelope.data {
        return Err(issue("Noncanonical exact base64"));
    }
    let decoded = match envelope.encoding.as_str() {
        "utf8-base64" => encoded,
        "gzip-base64" => {
            let mut gzip =
                flate2::bufread::GzDecoder::new(std::io::Cursor::new(encoded.as_slice()));
            let mut decoded = Vec::new();
            gzip.by_ref()
                .take((envelope.decoded_bytes + 1) as u64)
                .read_to_end(&mut decoded)
                .map_err(|_| issue("Invalid exact gzip framing/CRC"))?;
            if decoded.len() != envelope.decoded_bytes
                || gzip.get_ref().position() != encoded.len() as u64
            {
                return Err(issue("Incomplete, excess or multiple exact gzip members"));
            }
            decoded
        }
        _ => return Err(issue("Unsupported exact data encoding")),
    };
    if decoded.len() != envelope.decoded_bytes {
        return Err(issue("Exact decoded length changed"));
    }
    let json = std::str::from_utf8(&decoded).map_err(|_| issue("Exact data is not UTF-8"))?;
    serde_json::from_str(json).map_err(|_| issue("Exact data is not complete bounded JSON"))
}
