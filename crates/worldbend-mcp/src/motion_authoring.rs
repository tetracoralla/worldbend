//! Progressive exact authoring results. Large programs are transported in
//! tokened UTF-8 parts rather than truncated or hidden by response limits.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worldbend_core::{
    ErrorCode, MockupMotionAuthoringInput, MockupMotionAuthoringOutput, TransformError,
    TransformResult, author_mockup_motion,
};
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub input: MockupMotionAuthoringInput,
    #[serde(default)]
    pub part: Option<u16>,
    #[serde(default)]
    pub token: Option<String>,
}
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    pub schema: String,
    pub version: String,
    pub token: String,
    pub part: u16,
    pub part_count: u16,
    pub bytes: usize,
    pub byte_start: usize,
    pub byte_end: usize,
    pub json: String,
}
#[derive(Debug, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum Output {
    Complete(Box<MockupMotionAuthoringOutput>),
    Page(Page),
}
pub fn run(input: Input) -> TransformResult<Output> {
    let state = author_mockup_motion(&input.input)?;
    let json = serde_json::to_string(&state).map_err(|_| {
        TransformError::new(ErrorCode::Internal, "Cannot serialize authored motion")
    })?;
    if json.len() > 4 * 1024 * 1024 {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Authored motion exceeds complete-read capacity",
        ));
    }
    let token = format!("sha256:{}", hex::encode(Sha256::digest(json.as_bytes())));
    if input
        .token
        .as_ref()
        .is_some_and(|expected| expected != &token)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Motion result changed between parts; restart its complete read",
        ));
    }
    if input.part.is_none() && input.token.is_none() && json.len() <= 16 * 1024 {
        return Ok(Output::Complete(Box::new(state)));
    }
    let mut ranges = vec![];
    let mut start = 0;
    while start < json.len() {
        let mut end = (start + 16 * 1024).min(json.len());
        while !json.is_char_boundary(end) {
            end -= 1;
        }
        ranges.push(start..end);
        start = end;
    }
    let part = input.part.unwrap_or(0);
    if part > 511 || (part > 0 && input.token.is_none()) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Use a current complete-read token for later motion parts",
        ));
    }
    let range = ranges.get(usize::from(part)).ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            "Motion result part is outside the complete value",
        )
    })?;
    Ok(Output::Page(Page {
        schema: "worldbend.mockup-motion-authoring-page".into(),
        version: "0.1".into(),
        token,
        part,
        part_count: ranges.len() as u16,
        bytes: json.len(),
        byte_start: range.start,
        byte_end: range.end,
        json: json[range.clone()].into(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{MockupMotionSpec, Quad, TransformSpec};
    fn input() -> MockupMotionAuthoringInput {
        let q = Quad::unit();
        let keys = (0..100)
            .map(|frame| serde_json::json!({"frame":frame,"quad":q}))
            .collect::<Vec<_>>();
        let planes=(0..3).map(|i|serde_json::json!({"id":format!("layer-{i}"),"sourceId":"art","base":TransformSpec::normalized(q),"keyframes":keys,"measurement":{"width":21,"height":28,"unit":"cm"}})).collect::<Vec<_>>();
        let spec:MockupMotionSpec=serde_json::from_value(serde_json::json!({"schema":"worldbend.mockup-motion","version":"0.1","canvas":{"width":16,"height":16},"frameCount":100,"timebase":{"numerator":25,"denominator":1},"planes":planes})).unwrap();
        MockupMotionAuthoringInput::Inspect { spec }
    }
    #[test]
    fn complete_program_is_tokened_and_reassembled_without_loss() {
        let input = input();
        let expected = serde_json::to_string(&author_mockup_motion(&input).unwrap()).unwrap();
        let Output::Page(first) = run(Input {
            input: input.clone(),
            part: None,
            token: None,
        })
        .unwrap() else {
            panic!("expected paged program")
        };
        assert!(first.part_count > 1);
        let mut json = String::new();
        for part in 0..first.part_count {
            let Output::Page(value) = run(Input {
                input: input.clone(),
                part: Some(part),
                token: Some(first.token.clone()),
            })
            .unwrap() else {
                panic!("expected page")
            };
            assert_eq!(json.len(), value.byte_start);
            assert!(serde_json::to_vec(&value).unwrap().len() < 128 * 1024);
            json.push_str(&value.json);
            assert_eq!(json.len(), value.byte_end);
        }
        assert_eq!(json, expected);
        assert!(
            run(Input {
                input: input.clone(),
                part: Some(1),
                token: None
            })
            .is_err()
        );
        assert!(
            run(Input {
                input,
                part: Some(1),
                token: Some("stale".into())
            })
            .is_err()
        );
    }
    #[test]
    fn input_and_edit_shapes_stay_closed() {
        let mut value = serde_json::json!({"input":input(),"extra":true});
        assert!(serde_json::from_value::<Input>(value.clone()).is_err());
        value.as_object_mut().unwrap().remove("extra");
        assert!(serde_json::from_value::<Input>(value).is_ok());
    }
}
