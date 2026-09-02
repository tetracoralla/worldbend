// Error-to-message mapping for the Figma UI: stable Worldbend core error
// codes, typed transform-frame reasons, and the editor/renderer failure
// strings thrown by @worldbend/web.

import { TransformError } from "@worldbend/web";
import {
  isUserMessage,
  userMessage,
  type MessageKey,
  type UserMessage,
} from "./i18n";
import { MAX_FIGMA_IMAGE_AXIS } from "./stored-plane";
import { TransformFrameError } from "./transform-frame";

const transformErrorMessages: Readonly<Record<string, MessageKey>> = {
  E_SCHEMA: "invalidSchema",
  E_NON_FINITE_COORDINATE: "nonFiniteCoordinate",
  E_QUAD_SELF_INTERSECT: "quadSelfIntersect",
  E_QUAD_CONCAVE: "quadConcave",
  E_QUAD_ORIENTATION: "quadOrientation",
  E_QUAD_DEGENERATE: "quadDegenerate",
  E_EDGE_TOO_SHORT: "edgeTooShort",
  E_HOMOGRAPHY_SINGULAR: "homographySingular",
  E_HOMOGRAPHY_HORIZON_CROSSING: "horizonCrossing",
  E_REPROJECTION: "reprojectionFailed",
  E_INTERNAL: "unexpectedError",
};

const editorErrorMessages: Readonly<Record<string, MessageKey>> = {
  "The selected layer could not be previewed": "previewFailed",
  "The repeated transform could not be previewed": "previewFailed",
  "The Warp preset could not be previewed": "previewFailed",
  "The transform preview timed out while composing geometry": "transformPreviewTimedOut",
  "The transform preview timed out while rendering": "transformPreviewTimedOut",
  "The Warp preview timed out while rendering": "transformPreviewTimedOut",
  "The selected layer did not produce a readable image": "unreadableImage",
  "The perspective preview lost its graphics context. Try again.": "graphicsContextLost",
  "The interactive editor requires a normalized perspective spec": "normalizedSpecRequired",
  "The source image could not be decoded": "sourceDecodeFailed",
  "The source image has no readable pixels": "sourceNoPixels",
  "No source is loaded": "noSourceLoaded",
  "The output image has invalid dimensions": "outputInvalidDimensions",
  "Unable to encode the perspective result": "encodeFailed",
  "The perspective editor has been disposed": "editorUnavailable",
  "The perspective renderer has been disposed": "editorUnavailable",
  "Unable to prepare the perspective preview": "previewUnavailable",
  "WebGL2 is required for interactive projective preview": "webglRequired",
  "The image could not be decoded": "sourceDecodeFailed",
};

export function messageFromError(error: unknown, fallback: MessageKey): UserMessage {
  if (isUserMessage(error)) return error;
  if (error instanceof TransformError) {
    if (error.code === "E_OUTPUT_LIMIT") {
      return userMessage("transformOutputLimit", { limit: MAX_FIGMA_IMAGE_AXIS });
    }
    const key = transformErrorMessages[error.code];
    return userMessage(key ?? fallback);
  }
  if (error instanceof TransformFrameError) {
    return userMessage(
      error.code === "renderDimensionsInvalid"
        ? "outputInvalidDimensions"
        : "transformPlacementInvalid",
    );
  }
  const text = error instanceof Error ? error.message : String(error);
  const exact = editorErrorMessages[text];
  if (exact) return userMessage(exact);
  const editorLimit = /^The output exceeds this editor's ([\d,]+) pixel limit$/.exec(text);
  if (editorLimit?.[1]) return userMessage("editorPixelLimit", { limit: editorLimit[1] });
  const textureLimit = /^The (?:source|output) image exceeds this device's (\d+) px WebGL limit$/.exec(
    text,
  );
  if (textureLimit?.[1]) return userMessage("imageTextureLimit", { limit: textureLimit[1] });
  if (/^The (?:source|output) image has invalid dimensions$/.test(text)) {
    return userMessage("imageInvalidDimensions");
  }
  return userMessage(fallback);
}
