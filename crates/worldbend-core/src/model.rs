use crate::{ErrorCode, TransformError, TransformResult, WarpSpec};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

pub const SPEC_SCHEMA: &str = "worldbend.transform";
pub const SPEC_VERSION: &str = "0.1";

/// Header values are Agent-authored and can be arbitrarily long; echoed input
/// inside error messages stays bounded so no carrier needs a byte backstop.
const MAX_HEADER_ECHO_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Size {
    #[schemars(schema_with = "positive_dimension_schema")]
    pub width: f64,
    #[schemars(schema_with = "positive_dimension_schema")]
    pub height: f64,
}

fn positive_dimension_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "exclusiveMinimum": 0
    })
}

impl Size {
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }

    pub fn validate(self, field: &str) -> TransformResult<Self> {
        if !self.width.is_finite() || !self.height.is_finite() {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                format!("{field} dimensions must be finite"),
            ));
        }
        if self.width <= 0.0 || self.height <= 0.0 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!("{field} dimensions must be greater than zero"),
            ));
        }
        Ok(self)
    }

    pub fn diagonal(self) -> f64 {
        self.width.hypot(self.height)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Quad {
    pub tl: Point,
    pub tr: Point,
    pub br: Point,
    pub bl: Point,
}

impl Quad {
    pub const fn new(tl: Point, tr: Point, br: Point, bl: Point) -> Self {
        Self { tl, tr, br, bl }
    }

    pub const fn unit() -> Self {
        Self::new(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
        )
    }

    pub const fn points(self) -> [Point; 4] {
        [self.tl, self.tr, self.br, self.bl]
    }

    pub fn map(self, mut f: impl FnMut(Point) -> Point) -> Self {
        Self::new(f(self.tl), f(self.tr), f(self.br), f(self.bl))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CoordinateSpace {
    Pixel,
    Normalized,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(schema_with = "destination_schema")]
pub struct Destination {
    pub space: CoordinateSpace,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<Size>,
    pub quad: Quad,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DestinationWire {
    space: CoordinateSpace,
    #[serde(default, deserialize_with = "deserialize_reference_presence")]
    reference: ReferencePresence,
    quad: Quad,
}

#[derive(Default)]
enum ReferencePresence {
    #[default]
    Missing,
    Present(Option<Size>),
}

fn deserialize_reference_presence<'de, D>(deserializer: D) -> Result<ReferencePresence, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Size>::deserialize(deserializer).map(ReferencePresence::Present)
}

impl<'de> Deserialize<'de> for Destination {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = DestinationWire::deserialize(deserializer)?;
        let reference = match (wire.space, wire.reference) {
            (CoordinateSpace::Pixel, ReferencePresence::Present(Some(reference))) => {
                Some(reference)
            }
            (CoordinateSpace::Pixel, _) => {
                return Err(serde::de::Error::custom(
                    "pixel destination requires a non-null reference",
                ));
            }
            (CoordinateSpace::Normalized, ReferencePresence::Missing) => None,
            (CoordinateSpace::Normalized, ReferencePresence::Present(_)) => {
                return Err(serde::de::Error::custom(
                    "normalized destination must not include reference, including null",
                ));
            }
        };
        Ok(Self {
            space: wire.space,
            reference,
            quad: wire.quad,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum FitMode {
    Stretch,
}

/// Explicit source orientation recorded in the spec. A flip mirrors the
/// source plane inside the destination quad; it is never expressed by
/// reordering destination corners, which would reverse the quad's winding
/// and silently change corner identity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SourceOrientation {
    #[default]
    Native,
    FlipHorizontal,
    FlipVertical,
    FlipBoth,
}

impl SourceOrientation {
    pub const fn flips(self) -> (bool, bool) {
        match self {
            Self::Native => (false, false),
            Self::FlipHorizontal => (true, false),
            Self::FlipVertical => (false, true),
            Self::FlipBoth => (true, true),
        }
    }

    pub const fn from_flips(x: bool, y: bool) -> Self {
        match (x, y) {
            (false, false) => Self::Native,
            (true, false) => Self::FlipHorizontal,
            (false, true) => Self::FlipVertical,
            (true, true) => Self::FlipBoth,
        }
    }

    /// The source-plane corner that lands at each destination label
    /// (TL, TR, BR, BL). Flipping mirrors the unit square's u and/or v.
    pub const fn source_corners(self) -> [Point; 4] {
        match self {
            Self::Native => [
                Point::new(0.0, 0.0),
                Point::new(1.0, 0.0),
                Point::new(1.0, 1.0),
                Point::new(0.0, 1.0),
            ],
            Self::FlipHorizontal => [
                Point::new(1.0, 0.0),
                Point::new(0.0, 0.0),
                Point::new(0.0, 1.0),
                Point::new(1.0, 1.0),
            ],
            Self::FlipVertical => [
                Point::new(0.0, 1.0),
                Point::new(1.0, 1.0),
                Point::new(1.0, 0.0),
                Point::new(0.0, 0.0),
            ],
            Self::FlipBoth => [
                Point::new(1.0, 1.0),
                Point::new(0.0, 1.0),
                Point::new(0.0, 0.0),
                Point::new(1.0, 0.0),
            ],
        }
    }
}

fn orientation_is_native(orientation: &SourceOrientation) -> bool {
    matches!(orientation, SourceOrientation::Native)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Content {
    pub fit: FitMode,
    #[serde(default, skip_serializing_if = "orientation_is_native")]
    pub orientation: SourceOrientation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warp: Option<WarpSpec>,
}

impl Default for Content {
    fn default() -> Self {
        Self {
            fit: FitMode::Stretch,
            orientation: SourceOrientation::Native,
            warp: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TransformSpec {
    #[schemars(schema_with = "spec_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spec_version_schema")]
    pub version: String,
    pub destination: Destination,
    #[serde(default)]
    pub content: Content,
}

fn spec_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": SPEC_SCHEMA
    })
}

fn spec_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": SPEC_VERSION
    })
}

fn destination_schema(generator: &mut SchemaGenerator) -> Schema {
    let pixel_reference = generator.subschema_for::<Size>();
    let pixel_quad = generator.subschema_for::<Quad>();
    let normalized_quad = generator.subschema_for::<Quad>();
    json_schema!({
        "oneOf": [
            {
                "type": "object",
                "properties": {
                    "space": { "const": "pixel" },
                    "reference": pixel_reference,
                    "quad": pixel_quad
                },
                "required": ["space", "reference", "quad"],
                "additionalProperties": false
            },
            {
                "type": "object",
                "properties": {
                    "space": { "const": "normalized" },
                    "quad": normalized_quad
                },
                "required": ["space", "quad"],
                "additionalProperties": false
            }
        ]
    })
}

impl TransformSpec {
    pub fn pixel(reference: Size, quad: Quad) -> Self {
        Self {
            schema: SPEC_SCHEMA.to_owned(),
            version: SPEC_VERSION.to_owned(),
            destination: Destination {
                space: CoordinateSpace::Pixel,
                reference: Some(reference),
                quad,
            },
            content: Content::default(),
        }
    }

    pub fn normalized(quad: Quad) -> Self {
        Self {
            schema: SPEC_SCHEMA.to_owned(),
            version: SPEC_VERSION.to_owned(),
            destination: Destination {
                space: CoordinateSpace::Normalized,
                reference: None,
                quad,
            },
            content: Content::default(),
        }
    }

    pub fn validate_header(&self) -> TransformResult<()> {
        if self.schema != SPEC_SCHEMA {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported schema {:?}; expected {SPEC_SCHEMA:?}",
                    crate::bounded_text(&self.schema, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        if self.version != SPEC_VERSION {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported version {:?}; expected {SPEC_VERSION:?}",
                    crate::bounded_text(&self.version, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        match self.destination.space {
            CoordinateSpace::Pixel => {
                self.destination
                    .reference
                    .ok_or_else(|| {
                        TransformError::new(
                            ErrorCode::Schema,
                            "pixel destination requires reference dimensions",
                        )
                    })?
                    .validate("destination.reference")?;
            }
            CoordinateSpace::Normalized => {
                if self.destination.reference.is_some() {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "normalized destination must not include reference dimensions",
                    ));
                }
            }
        }
        if let Some(warp) = self.content.warp {
            warp.validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::schema_for;
    use serde_json::{Value, json};

    #[test]
    fn canonical_schema_uses_literal_header_values_and_destination_variants() {
        let schema = serde_json::to_value(schema_for!(TransformSpec)).unwrap();
        assert_eq!(schema["properties"]["schema"]["const"], SPEC_SCHEMA);
        assert_eq!(schema["properties"]["version"]["const"], SPEC_VERSION);

        let destination_ref = schema["properties"]["destination"]["$ref"]
            .as_str()
            .unwrap();
        let definition = destination_ref.strip_prefix("#/$defs/").unwrap();
        let variants = schema["$defs"][definition]["oneOf"].as_array().unwrap();
        assert_eq!(variants.len(), 2);
        assert_eq!(variants[0]["properties"]["space"]["const"], "pixel");
        assert!(
            variants[0]["required"]
                .as_array()
                .unwrap()
                .contains(&json!("reference"))
        );
        assert_eq!(variants[1]["properties"]["space"]["const"], "normalized");
        assert!(variants[1]["properties"].get("reference").is_none());

        let size = &schema["$defs"]["Size"];
        assert_eq!(size["properties"]["width"]["exclusiveMinimum"], 0);
        assert_eq!(size["properties"]["height"]["exclusiveMinimum"], 0);

        let warp = &schema["$defs"]["WarpSpec"];
        assert_eq!(warp["required"], json!(["preset", "amount"]));
        assert_eq!(warp["properties"]["amount"]["minimum"], -1.0);
        assert_eq!(warp["properties"]["amount"]["maximum"], 1.0);
        assert_eq!(
            schema["$defs"]["WarpPreset"]["enum"],
            json!([
                "arc", "arch", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze",
                "twist"
            ])
        );
    }

    #[test]
    fn orientation_defaults_to_native_and_round_trips() {
        let plain = serde_json::from_value::<Content>(json!({ "fit": "stretch" })).unwrap();
        assert_eq!(plain.orientation, SourceOrientation::Native);

        let flipped = serde_json::from_value::<Content>(json!({
            "fit": "stretch", "orientation": "flipHorizontal"
        }))
        .unwrap();
        assert_eq!(flipped.orientation, SourceOrientation::FlipHorizontal);

        let encoded = serde_json::to_value(TransformSpec::normalized(Quad::unit())).unwrap();
        assert!(encoded["content"].get("orientation").is_none());

        let mut spec = TransformSpec::normalized(Quad::unit());
        spec.content.orientation = SourceOrientation::FlipVertical;
        let encoded = serde_json::to_value(&spec).unwrap();
        assert_eq!(encoded["content"]["orientation"], "flipVertical");
        let decoded: TransformSpec = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded.content.orientation, SourceOrientation::FlipVertical);

        assert!(
            serde_json::from_value::<Content>(json!({
                "fit": "stretch", "orientation": "mirror"
            }))
            .is_err()
        );
    }

    #[test]
    fn source_corners_mirror_u_and_v_per_orientation() {
        assert_eq!(
            SourceOrientation::Native.source_corners(),
            Quad::unit().points()
        );
        // flipHorizontal: source TR lands at destination TL, and so on.
        assert_eq!(
            SourceOrientation::FlipHorizontal.source_corners(),
            [
                Point::new(1.0, 0.0),
                Point::new(0.0, 0.0),
                Point::new(0.0, 1.0),
                Point::new(1.0, 1.0),
            ]
        );
        for orientation in [
            SourceOrientation::Native,
            SourceOrientation::FlipHorizontal,
            SourceOrientation::FlipVertical,
            SourceOrientation::FlipBoth,
        ] {
            assert_eq!(
                orientation,
                SourceOrientation::from_flips(orientation.flips().0, orientation.flips().1)
            );
            let corners = orientation.source_corners();
            for corner in corners {
                assert!(corner.x == 0.0 || corner.x == 1.0);
                assert!(corner.y == 0.0 || corner.y == 1.0);
            }
        }
    }

    #[test]
    fn header_validation_echoes_only_a_bounded_prefix_of_input() {
        let mut spec = TransformSpec::pixel(Size::new(10.0, 10.0), Quad::unit());
        spec.schema = "s".repeat(100_000);
        let error = spec.validate_header().unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(error.message.chars().count() < 512);
        assert!(!error.message.contains(&"s".repeat(256)));
    }

    #[test]
    fn runtime_header_validation_matches_destination_schema_variants() {
        let missing_pixel_reference = serde_json::from_value::<TransformSpec>(json!({
            "schema": SPEC_SCHEMA,
            "version": SPEC_VERSION,
            "destination": { "space": "pixel", "quad": Quad::unit() },
            "content": { "fit": "stretch" }
        }));
        assert!(missing_pixel_reference.is_err());

        let normalized_reference = serde_json::from_value::<TransformSpec>(json!({
            "schema": SPEC_SCHEMA,
            "version": SPEC_VERSION,
            "destination": {
                "space": "normalized",
                "reference": { "width": 100, "height": 100 },
                "quad": Quad::unit()
            },
            "content": { "fit": "stretch" }
        }));
        assert!(normalized_reference.is_err());

        let normalized_null_reference = serde_json::from_value::<TransformSpec>(json!({
            "schema": SPEC_SCHEMA,
            "version": SPEC_VERSION,
            "destination": {
                "space": "normalized",
                "reference": null,
                "quad": Quad::unit()
            },
            "content": { "fit": "stretch" }
        }));
        assert!(normalized_null_reference.is_err());

        let canonical = serde_json::to_value(TransformSpec::normalized(Quad::unit())).unwrap();
        assert_eq!(canonical["schema"], Value::String(SPEC_SCHEMA.to_owned()));
        assert!(canonical["destination"].get("reference").is_none());
    }
}
