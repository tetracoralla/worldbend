// @generated from Rust core JSON Schema. Do not edit by hand.

export type FitMode = "stretch";
/**
 * Explicit source orientation recorded in the spec. A flip mirrors the
 * source plane inside the destination quad; it is never expressed by
 * reordering destination corners, which would reverse the quad's winding
 * and silently change corner identity.
 */
export type SourceOrientation = "native" | "flipHorizontal" | "flipVertical" | "flipBoth";
export type WarpPreset =
  "arc" | "arch" | "flag" | "wave" | "fish" | "rise" | "fisheye" | "inflate" | "squeeze" | "twist";
export type Destination =
  | {
      quad: Quad1;
      reference: Size;
      space: "pixel";
    }
  | {
      quad: Quad1;
      space: "normalized";
    };
/**
 * The supported delivery targets. Each owns one typed implementation route;
 * neither is a pixel-identity claim.
 */
export type AppearanceDeliveryTarget = ("web" | "swiftui") | "web-color-preserving" | "swiftui-optical";
/**
 * The glass fields, in the stable wire order used by customized-field lists
 * and target mapping tables.
 */
export type GlassField =
  "visible" | "light-intensity" | "light-angle" | "refraction" | "depth" | "dispersion" | "radius";
/**
 * How one glass field maps onto a target. `native` fields have a real setter
 * (or inherent system behavior); `approximated` fields influence derived
 * values; `unavailable` fields have no honest representation on the target.
 */
export type AppearanceFieldMapping = "native" | "approximated" | "unavailable";
/**
 * Runtime capability of the receiving target. This is observable state, not
 * policy: a browser either supports SVG backdrop filters or it does not.
 */
export type AppearanceOpticsMode = "svg-optics" | "frost-only" | "system-glass" | "explicit-optical";
/**
 * What changing one exposed control costs the receiving surface.
 */
export type AppearanceChangeCost = "live" | "rebake" | "asset";
/**
 * Default value of a control: the family default, not a product decision.
 */
export type AppearanceControlDefault =
  | {
      toggle: boolean;
    }
  | {
      number: number;
    };
/**
 * The shape of one control surface.
 */
export type AppearanceControlKind = "toggle" | "scalar" | "composite";
/**
 * How a control currently exists for the receiver.
 */
export type AppearanceControlState = "exposed" | "not-exposed" | "unsupported" | "adapted";
/**
 * How the appearance currently exists on the surface.
 */
export type AppearanceInstanceState = "absent" | "tagged" | "customized" | "untagged-native" | "removed";
/**
 * Who authored one override. Both actors go through the same product action
 * and revision checks; neither can bypass the other's edits.
 */
export type AppearanceOverrideActor = "user" | "agent";
/**
 * Typed override value: booleans only for `visible`, finite numbers for the
 * optical fields. Untyped bags cannot express field meaning safely.
 */
export type AppearanceOverrideValue = boolean | number;
/**
 * Which overrides actually drive the effective material under a policy.
 */
export type AppearancePreferenceFieldState = "applied" | "not-exposed";
export type CanvasBackground =
  | {
      kind: "transparent";
    }
  | {
      kind: "color";
      /**
       * @minItems 4
       * @maxItems 4
       */
      rgba: [number, number, number, number];
      space: Srgb8Space;
    };
export type Srgb8Space = "srgb8";
export type CanvasOperationKind = "crop" | "trim" | "pad" | "contain" | "cover" | "stretch";
export type CanvasOperation =
  | {
      kind: "crop";
      rect: PixelRect;
    }
  | {
      alphaThreshold: number;
      kind: "trim";
    }
  | {
      background: CanvasBackground;
      insets: CanvasInsets;
      kind: "pad";
    }
  | {
      anchor: NormalizedAnchor;
      background: CanvasBackground;
      kind: "contain";
      output: {
        height: number;
        width: number;
      };
    }
  | {
      anchor: NormalizedAnchor;
      background: CanvasBackground;
      kind: "cover";
      output: {
        height: number;
        width: number;
      };
    }
  | {
      kind: "stretch";
      output: {
        height: number;
        width: number;
      };
    };
export type CardFace = "front" | "back" | "edge";
export type WarpMesh = GridWarpMesh | TriangleWarpMesh;
export type CoordinateSpace = "pixel" | "normalized";
export type MockupClipSegment =
  | {
      kind: "line";
      to: Point;
    }
  | {
      c1: Point;
      c2: Point;
      kind: "cubic";
      to: Point;
    };
export type MockupClipFillRule = "nonZero" | "evenOdd";
export type LiquifyMode = "push" | "bloat" | "pucker" | "twirl";
export type EffectCarrier = "web" | "swiftui" | "figma";
export type EffectContent = "dom" | "texture";
export type EffectId =
  "layered-depth" | "multiplane-camera" | "rigid-tilt" | "shared-plane" | "hinged-reveal" | "frosted-lens";
export type EffectAxis = "progress" | "pointer-x" | "pointer-y";
export type EffectIntent = "depth" | "inspect" | "reveal";
export type EffectFrameSurface =
  | {
      kind: "plane";
      plan: PlanePoseOutput;
    }
  | {
      kind: "window";
      plan: SurfaceWindowPlan;
    }
  | {
      kind: "strip";
      plan: PlaneStripOutput;
    };
export type SurfaceVisibility = "visible" | "edge-on" | "back-facing";
export type EffectSurface =
  | {
      kind: "plane";
      pose: PlanePose;
      size: Size;
    }
  | {
      depthMap?: EffectDepthMap | null;
      distance: number;
      kind: "camera-plane";
      size: Size;
    }
  | {
      kind: "window";
      spec: SurfaceWindowSpec;
    }
  | {
      kind: "strip";
      panels: PlaneStripPanel[];
      pose: PlanePose;
      size: Size;
    };
export type EffectCurve = "linear" | "smoothstep";
export type EffectProperty =
  "rotate-x" | "rotate-y" | "rotate-z" | "translate-x" | "translate-y" | "depth" | "frost-base" | "frost-spread";
export type FoilDeliveryTarget = "web" | "swiftui";
export type FoilField =
  "visible" | "base-color" | "highlight-color" | "light-angle" | "intensity" | "roughness" | "flow-speed";
export type MaterialPreferenceInput =
  | {
      family: "texture";
      policy: MaterialExposurePolicy;
      preference: MaterialPreferenceRecord;
      runtime: MaterialPreferenceRuntime;
      source: TextureDeliveryInput;
    }
  | {
      family: "foil";
      policy: MaterialExposurePolicy2;
      preference: MaterialPreferenceRecord2;
      runtime: MaterialPreferenceRuntime;
      source: FoilDeliveryInput;
    }
  | {
      family: "mesh-gradient";
      policy: MaterialExposurePolicy3;
      preference: MaterialPreferenceRecord3;
      runtime: MaterialPreferenceRuntime;
      source: MeshGradientDeliveryInput;
    };
/**
 * The texture fields, in the stable wire order used by customized-field lists
 * and target mapping tables.
 */
export type TextureField = "visible" | "grain" | "grain-size" | "grain-color" | "etch" | "etch-size" | "clip-to-shape";
export type MaterialPreferenceValue =
  | {
      kind: "toggle";
      value: boolean;
    }
  | {
      kind: "number";
      value: number;
    }
  | {
      kind: "rgba";
      value: MaterialRgba;
    }
  | {
      kind: "hex-color";
      value: string;
    };
/**
 * The supported delivery targets. The texture family's first verified target
 * is the self-contained Web route; a SwiftUI profile stays unadvertised until
 * a real adapter exists.
 */
export type TextureDeliveryTarget = "web";
export type MeshGradientField =
  | "visible"
  | "color-tl"
  | "color-tr"
  | "color-bl"
  | "color-br"
  | "warp"
  | "softness"
  | "duration-ms"
  | "phase-ms"
  | "flow-speed";
export type MeshGradientDeliveryTarget = "web" | "swiftui";
export type MaterialPreferenceOutput =
  | {
      family: "texture";
      plan: MaterialPreferencePlan;
    }
  | {
      family: "foil";
      plan: MaterialPreferencePlan2;
    }
  | {
      family: "mesh-gradient";
      plan: MaterialPreferencePlan3;
    };
export type MaterialPreferenceFieldState = "applied" | "not-exposed" | "out-of-range";
export type MockupMotionAuthoringInput =
  | {
      action: "create";
      frameCount: number;
      scene: MockupSpec;
      timebase: FrameRate;
    }
  | {
      action: "inspect";
      spec: MockupMotionSpec;
    }
  | {
      action: "revise";
      edit: MockupMotionEdit;
      expectedFingerprint: string;
      spec: MockupMotionSpec;
    };
/**
 * An authored surface inside one plane's placement bounds. These are compact
 * scene controls, not a reconstruction of a photographed object.
 */
export type MockupSurface =
  | {
      curvature: number;
      kind: "cylinder";
      light?: MockupSurfaceLight;
      tilt?: number;
    }
  | {
      depth: number;
      folds: number;
      kind: "fabric";
      light?: MockupSurfaceLight1;
      phase?: number;
    };
export type MockupEdge = "top" | "right" | "bottom" | "left";
/**
 * Shared named easing curves. Motion timelines and interactive-card turns
 * sample the same math so carriers cannot diverge on timing meaning.
 */
export type MotionEasing =
  | {
      kind: "linear";
    }
  | {
      kind: "hold";
    }
  | {
      kind: "cubicBezier";
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    };
export type SpatialTemplateOutput =
  | {
      id: string;
      kind: "single";
    }
  | {
      kind: "canvasSet";
      spec: CanvasSetSpec;
    };
export type MockupMotionEdit =
  | {
      kind: "setPresentation";
      presentation?: MockupMotionPresentation | null;
    }
  | {
      frame: number;
      kind: "setPresentationAtFrame";
      presentation: MockupMotionPresentation;
    }
  | {
      keyframe: MotionKeyframe;
      kind: "setPresentationKeyframe";
    }
  | {
      frame: number;
      kind: "removePresentationKeyframe";
    }
  | {
      frame: number;
      kind: "setScenePose";
      scene: MockupSpec;
    }
  | {
      frame: number;
      kind: "setPose";
      planes: MockupMotionPosePlane[];
    }
  | {
      keyframe: MotionKeyframe;
      kind: "setKeyframe";
      planeId: string;
    }
  | {
      frame: number;
      kind: "removeKeyframe";
      planeId: string;
    }
  | {
      frame: number;
      kind: "moveKeyframe";
      planeId: string;
      toFrame: number;
    }
  | {
      easingToNext?: MotionEasing | null;
      frame: number;
      kind: "capturePose";
      planeIds?: string[] | null;
    }
  | {
      frameCount: number;
      kind: "retime";
      timebase: FrameRate;
    }
  | {
      kind: "replacePlane";
      plane: MockupMotionPlane;
    }
  | {
      ids: string[];
      kind: "reorderPlanes";
    };
export type NativeFramePlan =
  | {
      /**
       * Uniform native content scaling required between the two bases.
       */
      contentScale: number;
      /**
       * Rotation-only inner transform; translation is always zero.
       *
       * @minItems 2
       * @maxItems 2
       */
      innerBasis: [[number, number, number], [number, number, number]];
      kind: "affine";
      /**
       * Maps current physical content units to result units.
       *
       * @minItems 2
       * @maxItems 2
       */
      logicalToOutput: [[number, number, number], [number, number, number]];
      /**
       * Geometric error from dropping only numerical projective residue.
       */
      numericalResidual: number;
      /**
       * Legal unit-column outer transform, including result translation.
       *
       * @minItems 2
       * @maxItems 2
       */
      outerBasis: [[number, number, number], [number, number, number]];
      outputSize: Size;
      sourceSize: Size;
    }
  | {
      /**
       * @minItems 9
       * @maxItems 9
       */
      inverse: [number, number, number, number, number, number, number, number, number];
      kind: "projective";
      outputSize: Size;
      sourceSize: Size;
    };
/**
 * Coordinate system for the explicitly selected plane in the source image.
 * Pixel coordinates require the reference image size that authored them;
 * normalized coordinates are reusable across source resolutions.
 */
export type SourcePlane =
  | {
      quad: Quad1;
      reference: Size;
      space: "pixel";
    }
  | {
      quad: Quad1;
      space: "normalized";
    };
export type RemapOperation =
  | {
      center?: Point6;
      coefficients: LensCoefficients;
      kind: "lens";
      scale?: LensScale;
    }
  | {
      boundary?: "transparent" | "clamp" | "wrap";
      kind: "displacement";
      neutral?: number;
      scaleXPixels: number;
      scaleYPixels: number;
      xChannel: RemapChannel;
      yChannel: RemapChannel;
    }
  | {
      boundary?: "transparent" | "clamp" | "wrap";
      kind: "displacementUnit";
      neutral?: number;
      scaleXPixels: number;
      scaleYPixels: number;
      xChannel: RemapChannel;
      yChannel: RemapChannel;
    };
export type RemapChannel = "red" | "green" | "blue" | "alpha" | "luminance";
export type SceneArtworkFit = "stretch" | "contain" | "cover";
/**
 * Candidate connected domains preserve the original compound clip. A native
 * contour is offered only when it contains every contour; the enclosing
 * control hull contains the complete authored Bezier curves, not just samples.
 */
export type ShapeFitDomainKind = "nativeContour" | "convexEnvelope" | "bounds";
export type SourceCaptureConvention = "fixedDensityFromOrigin";
export type SourceSamplingSchema = "worldbend.source-sampling";
export type SourceSamplingVersion = "0.1";
/**
 * Static, interactive and temporal expressions retain their own execution
 * contracts. The document owns their shared asset identity and repeat-use
 * relationship.
 */
export type SpatialDocumentExpression =
  | {
      /**
       * @minItems 1
       * @maxItems 17
       */
      bindings:
        | [SpatialDocumentBinding]
        | [SpatialDocumentBinding, SpatialDocumentBinding]
        | [SpatialDocumentBinding, SpatialDocumentBinding, SpatialDocumentBinding]
        | [SpatialDocumentBinding, SpatialDocumentBinding, SpatialDocumentBinding, SpatialDocumentBinding]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ]
        | [
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding,
            SpatialDocumentBinding
          ];
      id: string;
      kind: "scene3d";
      scene: Scene3DSpec;
    }
  | {
      /**
       * @minItems 1
       * @maxItems 64
       */
      bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
      id: string;
      kind: "material";
      material: SpatialMaterialInput;
    }
  | {
      /**
       * @minItems 1
       * @maxItems 64
       */
      bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
      id: string;
      kind: "static";
      template: SpatialTemplateSpec;
    }
  | {
      /**
       * @minItems 1
       * @maxItems 64
       */
      bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
      id: string;
      kind: "interactive";
      recipe: EffectRecipe;
    }
  | {
      /**
       * @minItems 1
       * @maxItems 64
       */
      bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
      id: string;
      kind: "temporal";
      video: MockupVideoSpec;
    };
export type SpatialDocumentBindingRole = ("content" | "depthMap") | "fittingGuide";
/**
 * Authored seed, actual material and intended target remain family-specific.
 */
export type SpatialMaterialInput =
  | {
      family: "glass";
      input: AppearanceDeliveryInput;
    }
  | {
      family: "texture";
      input: TextureDeliveryInput;
    }
  | {
      family: "foil";
      input: FoilDeliveryInput;
    }
  | {
      family: "mesh-gradient";
      input: MeshGradientDeliveryInput;
    };
export type SpatialTemplateOperation =
  | {
      kind: "rasterProgram";
      program: RasterProgramSpec;
      sourceSlot: string;
    }
  | {
      kind: "mockup";
      spec: MockupSpec;
    }
  | {
      composition: MockupSpec;
      kind: "compositionProgram";
      postprocess: RasterProgramSpec;
    };
export type RasterProgramStage =
  | {
      canvas?: "tight" | "reference";
      id: string;
      kind: "transform";
      spec: TransformSpec1;
      target_size?: Size | null;
    }
  | {
      id: string;
      kind: "rectify";
      spec: RectifySpec;
    }
  | {
      id: string;
      kind: "canvas";
      spec: CanvasSpec;
    }
  | {
      id: string;
      kind: "meshWarp";
      spec: MeshWarpSpec;
    }
  | {
      id: string;
      kind: "surfaceDeformation";
      spec: SurfaceDeformationSpec;
    }
  | {
      id: string;
      kind: "deformationWork";
      spec: DeformationWorkSpec;
    }
  | {
      id: string;
      kind: "remap";
      /**
       * Immutable, externally bound control raster. A displacement stage
       * requires it; a lens stage forbids it. It is never an intermediate.
       */
      mapSlot?: string | null;
      spec: RemapSpec;
    };
/**
 * Encoding policy is separate from canonical geometry and presentation time.
 * This profile is opaque, lossy, sRGB-derived 8-bit H.264 in an MP4 container.
 */
export type VideoEncoding = {
  crf: number;
  format: "mp4H264";
};
export type SpatialDocumentDelivery =
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "scene3d";
      scene: Scene3DPlan;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "material";
      material: SpatialMaterialDelivery;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      job: VariationJobSpec;
      kind: "static";
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "interactive";
      recipe: EffectRecipe;
      recipeFingerprint: string;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "temporal";
      video: MockupVideoSpec;
      videoFingerprint: string;
    };
export type SpatialMaterialDelivery =
  | {
      delivery: AppearanceDeliveryPlan;
      family: "glass";
    }
  | {
      delivery: TextureDeliveryPlan;
      family: "texture";
    }
  | {
      delivery: FoilDeliveryPlan;
      family: "foil";
    }
  | {
      delivery: MeshGradientDeliveryPlan;
      family: "mesh-gradient";
    };
export type SpatialDocumentExpressionInspection =
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "scene3d";
      scene: Scene3DPlan;
    }
  | {
      bindings: SpatialDocumentBinding[];
      family: SpatialMaterialFamily;
      id: string;
      kind: "material";
      materialFingerprint: string;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "static";
      template: SpatialTemplateInspection;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "interactive";
      recipe: EffectRecipeInspection;
    }
  | {
      bindings: SpatialDocumentBinding[];
      id: string;
      kind: "temporal";
      /**
       * @minItems 1
       * @maxItems 16
       */
      sourceIds:
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ];
      videoFingerprint: string;
    };
export type SpatialMaterialFamily = "glass" | "texture" | "foil" | "mesh-gradient";
export type SpatialTemplateOperationKind = "rasterProgram" | "mockup" | "compositionProgram";
export type SpatialTemplateOutputKind = "single" | "canvasSet";
export type RasterProgramStageKind =
  "transform" | "rectify" | "canvas" | "meshWarp" | "surfaceDeformation" | "deformationWork" | "remap";
export type SpatialDocumentExpressionKind = "scene3d" | "material" | "static" | "interactive" | "temporal";
/**
 * Encoded raster facts established by an upstream media/Figma provider.
 * Worldbend validates their bounded relationship to the spatial delivery; it
 * does not claim to have fetched or decoded the bytes.
 */
export type SpatialInteractiveMediaFormat = "png" | "jpeg" | "webp";
export type ErrorCode =
  | "E_SCHEMA"
  | "E_NON_FINITE_COORDINATE"
  | "E_QUAD_SELF_INTERSECT"
  | "E_QUAD_CONCAVE"
  | "E_QUAD_ORIENTATION"
  | "E_QUAD_DEGENERATE"
  | "E_CLIP_DEGENERATE"
  | "E_EDGE_TOO_SHORT"
  | "E_HOMOGRAPHY_SINGULAR"
  | "E_HOMOGRAPHY_HORIZON_CROSSING"
  | "E_REPROJECTION"
  | "E_CROP_BOUNDS"
  | "E_TRIM_EMPTY"
  | "E_RASTER_SHAPE_MISMATCH"
  | "E_OUTPUT_COLLISION"
  | "E_SHARED_EDGE_MISMATCH"
  | "E_UNSUPPORTED_MEDIA"
  | "E_OUTPUT_LIMIT"
  | "E_PATH_OUTSIDE_ROOT"
  | "E_PATH_SYMLINK"
  | "E_DESTINATION_EXISTS"
  | "E_RENDER"
  | "E_CAPACITY"
  | "E_CANCELLED"
  | "E_TIMEOUT"
  | "E_MEMORY"
  | "E_INTERNAL";
export type VariationFailurePolicy = "allOrNone" | "continue";
export type VectorOperation =
  | {
      kind: "transform";
      spec: TransformSpec1;
    }
  | {
      kind: "deformationWork";
      spec: DeformationWorkSpec;
    };
export type VectorWindingRule = "NONZERO" | "EVENODD";
export type VectorStrokeCap = "NONE" | "ROUND" | "SQUARE";
export type VectorStrokeJoin = "MITER" | "BEVEL" | "ROUND";
export type VectorArtworkSourceBoundsPolicy = "expandToGeometry";
export type VectorProjectionFidelity = "exact" | "approximated" | "outlined";
export type VectorProjectionLossReason = "curveSubdivision" | "strokeOutlined" | "strokeApproximated";

/**
 * One mechanically generated schema surface for the Web/WASM carrier. The
 * wrapper is never serialized at runtime; it makes the Rust-owned input,
 * normalized output, mesh, CSS, and structured-error contracts available to
 * the TypeScript generator without a second handwritten semantic model.
 */
export interface WebContract {
  affineCompositionOutput: AffineComposition;
  appearanceDeliveryInput: AppearanceDeliveryInput;
  appearanceDeliveryPlan: AppearanceDeliveryPlan;
  appearanceExposureInput: AppearanceExposureInput;
  appearanceExposurePolicy: AppearanceExposurePolicy;
  appearanceExposureReport: AppearanceExposureReport;
  appearanceGlassMaterial: GlassMaterial1;
  appearanceInspection: AppearanceInspection;
  appearanceInspectionInput: AppearanceInspectionInput;
  appearancePreferenceInput: AppearancePreferenceInput;
  appearancePreferencePlan: AppearancePreferencePlan;
  appearancePreferenceRecord: AppearancePreferenceRecord;
  appearanceRecipeSpec: AppearanceRecipeSpec;
  appearanceRevisionInput: AppearanceRevisionInput;
  appearanceRevisionPlan: AppearanceRevisionPlan;
  appearanceUpdateInput: AppearanceUpdateInput;
  appearanceUpdatePlan: AppearanceUpdatePlan;
  canvasPlanOutput: CanvasPlan;
  canvasSetPlanOutput: CanvasSetPlan;
  canvasSetSpecInput: CanvasSetSpec;
  canvasSpecInput: CanvasSpec;
  cardIdleInput: CardIdleInput;
  cardPointerInput: CardPointerInput;
  cardPointerOutput: CardPointerOutput;
  cardPoseInput: CardPoseInput;
  cardPoseOutput: CardPoseOutput;
  cardRig: CardRig;
  cardTurnInput: CardTurnInput;
  cardTurnOutput: CardTurnOutput;
  cssTransformOutput: CssTransform;
  deformationWorkMigrationOutput: DeformationWorkMigration;
  deformationWorkPlanOutput: DeformationWorkPlan;
  deformationWorkSpecInput: DeformationWorkSpec;
  effectCatalog: EffectCatalog;
  effectCatalogInput: EffectCatalogInput;
  effectPlan: EffectPlan;
  effectPlanInput: EffectPlanInput;
  effectRecipe: EffectRecipe;
  effectRecipeInput: EffectRecipeInput;
  foilDeliveryInput: FoilDeliveryInput;
  foilDeliveryPlan: FoilDeliveryPlan;
  foilInspection: FoilInspection;
  foilInspectionInput: FoilInspectionInput;
  foilMaterial: FoilMaterial;
  foilRecipeSpec: FoilRecipeSpec;
  foilRevisionInput: FoilRevisionInput;
  foilRevisionPlan: FoilRevisionPlan;
  foilUpdateInput: FoilUpdateInput;
  foilUpdatePlan: FoilUpdatePlan;
  materialPreferenceInput: MaterialPreferenceInput;
  materialPreferenceOutput: MaterialPreferenceOutput;
  meshGradientDeliveryInput: MeshGradientDeliveryInput;
  meshGradientDeliveryPlan: MeshGradientDeliveryPlan;
  meshGradientInspection: MeshGradientInspection;
  meshGradientInspectionInput: MeshGradientInspectionInput;
  meshGradientMaterial: MeshGradientMaterial;
  meshGradientRecipeSpec: MeshGradientRecipeSpec;
  meshGradientRevisionInput: MeshGradientRevisionInput;
  meshGradientRevisionPlan: MeshGradientRevisionPlan;
  meshGradientUpdateInput: MeshGradientUpdateInput;
  meshGradientUpdatePlan: MeshGradientUpdatePlan;
  meshWarpPlanOutput: MeshWarpPlan;
  meshWarpSpecInput: MeshWarpSpec;
  mockupMotionAuthoringInput: MockupMotionAuthoringInput;
  mockupMotionAuthoringOutput: MockupMotionAuthoringOutput;
  mockupMotionPlanOutput: MockupMotionPlan;
  mockupMotionSpecInput: MockupMotionSpec;
  mockupPlanOutput: MockupPlan;
  mockupSpecInput: MockupSpec;
  nativeAffineFrameState: NativeAffineFrameState;
  nativeFramePlan: NativeFramePlan;
  nativeFramePlanInput: NativeFramePlanInput;
  planePoseInput: PlanePoseInput;
  planePoseOutput: PlanePoseOutput;
  planeStripInput: PlaneStripInput;
  planeStripOutput: PlaneStripOutput;
  rectifyPlanOutput: RectifyPlan;
  rectifySpecInput: RectifySpec;
  remapPlanOutput: RemapPlan;
  remapSpecInput: RemapSpec;
  scene3dPlan: Scene3DPlan;
  scene3dSpec: Scene3DSpec;
  shapeFitDomain: ShapeFitDomain;
  shapeFitRefreshInput: ShapeFitRefreshInput;
  shapeFitRefreshOutput: ShapeFitRefreshOutput;
  solveOutput: SolveOutput1;
  sourceCaptureFacts: SourceCaptureFacts;
  sourceSamplingFrame: SourceSamplingFrame;
  spatialDocumentAssemblyInput: SpatialDocumentAssemblyInput;
  spatialDocumentAssemblyPlanOutput: SpatialDocumentAssemblyPlan;
  spatialDocumentDeliveryInput: SpatialDocumentDeliveryInput;
  spatialDocumentDeliveryPlanOutput: SpatialDocumentDeliveryPlan;
  spatialDocumentInspection: SpatialDocumentInspection;
  spatialDocumentSpecInput: SpatialDocumentSpec;
  spatialDocumentUpdateInput: SpatialDocumentUpdateInput;
  spatialDocumentUpdatePlanOutput: SpatialDocumentUpdatePlan;
  spatialInteractiveMediaBundleInput: SpatialInteractiveMediaBundleInput;
  spatialInteractiveMediaBundleOutput: SpatialInteractiveMediaBundle;
  spatialTemplateInspectionOutput: SpatialTemplateInspection;
  spatialTemplateSpecInput: SpatialTemplateSpec;
  surfaceDeformationPlanOutput: SurfaceDeformationPlan;
  surfaceDeformationSpecInput: SurfaceDeformationSpec;
  surfaceWindowPlan: SurfaceWindowPlan;
  surfaceWindowSpec: SurfaceWindowSpec;
  textureDeliveryInput: TextureDeliveryInput;
  textureDeliveryPlan: TextureDeliveryPlan;
  textureInspection: TextureInspection;
  textureInspectionInput: TextureInspectionInput;
  textureMaterial: TextureMaterial1;
  textureRecipeSpec: TextureRecipeSpec;
  textureRevisionInput: TextureRevisionInput;
  textureRevisionPlan: TextureRevisionPlan;
  transformError: TransformError;
  transformRecipeInput: TransformRecipe;
  transformSpecInput: TransformSpec1;
  variationJobPlanOutput: VariationJobPlan;
  variationJobSpecInput: VariationJobSpec;
  vectorArtworkInput: VectorArtworkProjectionInput;
  vectorArtworkOutput: VectorArtworkProjectionOutput;
  vectorOperationInput: VectorOperationInput;
  vectorOperationOutput: VectorOperationPlan;
  vectorProjectionInput: VectorProjectionInput;
  vectorProjectionOutput: VectorProjectionOutput;
  warpMeshOutput: WarpMesh;
}
export interface AffineComposition {
  canvas: TransformCanvas;
  diagnostics: SolveDiagnostics;
  /**
   * Affine matrix in the RAW resolved-destination frame: it maps base
   * destination pixels to raw output pixels, while `spec`/`canvas` are
   * canvas-relative. Chaining this composition as the next base re-pays
   * the integer floor/ceil canvas quantization (up to one pixel per
   * cycle); consumers who require drift-free iteration must retain the
   * original base and the accumulated recipe instead.
   *
   * @minItems 9
   * @maxItems 9
   */
  matrix: [number, number, number, number, number, number, number, number, number];
  rawBounds: Bounds;
  rawQuad: Quad;
  spec: TransformSpec;
}
export interface TransformCanvas {
  origin: Point;
  size: Size;
}
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  height: number;
  width: number;
}
export interface SolveDiagnostics {
  bounds: Bounds;
  geometry: GeometryDiagnostics;
  matrix: MatrixDiagnostics;
  reprojection: ReprojectionDiagnostics;
}
export interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface GeometryDiagnostics {
  convex: boolean;
  /**
   * @minItems 4
   * @maxItems 4
   */
  edgeLengths: [number, number, number, number];
  orientation: "clockwise-screen";
  selfIntersecting: boolean;
  signedArea: number;
}
export interface MatrixDiagnostics {
  determinant: number;
  invertible: boolean;
  minAbsW: number;
}
export interface ReprojectionDiagnostics {
  limit: number;
  max: number;
  mean: number;
  /**
   * @minItems 4
   * @maxItems 4
   */
  points: [ReprojectionPoint, ReprojectionPoint, ReprojectionPoint, ReprojectionPoint];
}
export interface ReprojectionPoint {
  actual: Point;
  corner: "tl" | "tr" | "br" | "bl";
  error: number;
  expected: Point;
}
/**
 * Transformed destination quad in the BASE destination pixel frame.
 */
export interface Quad {
  bl: Point;
  br: Point;
  tl: Point;
  tr: Point;
}
/**
 * Normalized spec for the tight canvas; its quad is canvas-relative.
 */
export interface TransformSpec {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface Content {
  fit: FitMode;
  orientation?: SourceOrientation;
  warp?: WarpSpec | null;
}
export interface WarpSpec {
  /**
   * Signed preset strength. Zero is identity; the closed supported domain
   * is [-1, 1]. Negative values reverse the preset's direction.
   */
  amount: number;
  preset: WarpPreset;
}
export interface Quad1 {
  bl: Point;
  br: Point;
  tl: Point;
  tr: Point;
}
export interface AppearanceDeliveryInput {
  material: GlassMaterial;
  /**
   * Native-only extras inspected beside the seven portable fields (for example
   * Figma Splay). They never widen GlassMaterial; delivery reports them as losses.
   */
  nativeExtras?: {
    [k: string]: unknown;
  };
  recipe: AppearanceRecipeSpec;
  target: AppearanceDeliveryTarget;
}
/**
 * The resolved material to deliver (typically from `inspect_appearance`).
 */
export interface GlassMaterial {
  /**
   * Depth of the refraction effect, `>= 1`.
   */
  depth: number;
  /**
   * Chromatic aberration amount, in `[0,1]`.
   */
  dispersion: number;
  /**
   * Angle of the specular light in degrees, in `[0,360)`.
   */
  lightAngle: number;
  /**
   * Intensity of specular highlights, in `[0,1]`.
   */
  lightIntensity: number;
  /**
   * Frost radius in logical pixels, `>= 0`.
   */
  radius: number;
  /**
   * Intensity of the refraction distortion, in `[0,1]`.
   */
  refraction: number;
  visible?: boolean;
}
/**
 * An editable appearance starting state: named, versioned, self-describing.
 * The material is the seed; live native values stay the authority.
 */
export interface AppearanceRecipeSpec {
  material: GlassMaterial1;
  /**
   * Stable recipe identity carried by every applied instance.
   */
  recipeId: string;
  /**
   * Seed version; `>= 1`. A newer seed keeps compatible instance overrides.
   */
  recipeVersion: number;
  schema: "worldbend.appearance@0.1";
  version: "0.1";
}
/**
 * One native Figma GLASS effect's optical controls. Field names follow the
 * Figma Effect API; `radius` is frost. Figma's beta Glass API does not expose
 * every UI setting (Splay is absent) and glass effects cannot bind variables.
 */
export interface GlassMaterial1 {
  /**
   * Depth of the refraction effect, `>= 1`.
   */
  depth: number;
  /**
   * Chromatic aberration amount, in `[0,1]`.
   */
  dispersion: number;
  /**
   * Angle of the specular light in degrees, in `[0,360)`.
   */
  lightAngle: number;
  /**
   * Intensity of specular highlights, in `[0,1]`.
   */
  lightIntensity: number;
  /**
   * Frost radius in logical pixels, `>= 0`.
   */
  radius: number;
  /**
   * Intensity of the refraction distortion, in `[0,1]`.
   */
  refraction: number;
  visible?: boolean;
}
export interface AppearanceDeliveryPlan {
  /**
   * Identity of the delivered state: seed identity plus resolved values.
   * Two deliveries with the same fingerprint show the same parameters.
   */
  fingerprint: string;
  /**
   * Native extras / mechanisms that did not enter the portable seven fields.
   */
  losses?: AppearanceLossReceipt[];
  material: GlassMaterial1;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.appearance-delivery@0.1";
  swiftui?: SwiftUIGlassDelivery | null;
  target: AppearanceDeliveryTarget;
  version: "0.1";
  web?: WebGlassDelivery | null;
}
/**
 * Native-only or otherwise unmapped authored state that did not enter the portable fields.
 */
export interface AppearanceLossReceipt {
  key: string;
  kind: string;
  note: string;
}
export interface SwiftUIGlassDelivery {
  fidelity: AppearanceFieldDelivery[];
  optical?: OpticalGlassDelivery | null;
  /**
   * Runnable view extension. Optical numbers are not setters; the snippet
   * maps visibility, shape and interaction and documents the rest.
   */
  snippet: string;
  /**
   * SwiftUI's Liquid Glass is the intended native material on iOS 26+.
   */
  usesNativeLiquidGlass: boolean;
}
export interface AppearanceFieldDelivery {
  field: GlassField;
  mapping: AppearanceFieldMapping;
  /**
   * One-line explanation of the setter, derivation or loss.
   */
  note: string;
}
/**
 * Rounded-glass kernel inputs in logical points. The core owns the mapping;
 * the receiving renderer supplies the actual backdrop and surface geometry.
 */
export interface OpticalGlassDelivery {
  backdrop: string;
  chromaticOffset: number;
  edgeWidth: number;
  frostRadius: number;
  highlightStrength: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  lightDirection: [number, number];
  profile: string;
  refractionScale: number;
}
export interface WebGlassDelivery {
  /**
   * The `backdrop-filter` value on its own, for hosts that compose it.
   */
  backdropFilter: string;
  /**
   * The inset edge response derived from light intensity and angle.
   */
  boxShadow: string;
  /**
   * Intentional couplings (for example refraction→saturation).
   */
  couplings: ParameterCoupling[];
  /**
   * Complete declaration list for the glass surface. Apply to the
   * element that must show the backdrop through the material.
   */
  css: string;
  /**
   * Edge-refraction and dispersion route. `None` when `refraction` and
   * `dispersion` are both zero: plain frost needs no displacement.
   */
  displacement?: GlassDisplacementFilter | null;
  fidelity: AppearanceFieldDelivery[];
  lightAxis: LightAxisReceipt;
  /**
   * Authored versus optically effective ranges for the Web compile path.
   */
  parameterRanges: ParameterRangeReceipt[];
  /**
   * Rim depth the Web receiver should use (`attachAppearance` reads this).
   */
  rimDepth: number;
}
/**
 * An intentional cross-parameter influence that Agents must not treat as independent.
 */
export interface ParameterCoupling {
  formula: string;
  fromField: string;
  intentional: boolean;
  note: string;
  toChannel: string;
}
/**
 * Deterministic numbers for the SVG displacement route. Edge-only refraction:
 * a flat backdrop has no thickness field to lens, so the displacement is
 * concentrated at the surface edge like a thick glass rim.
 */
export interface GlassDisplacementFilter {
  /**
   * Second-pass channel offset in pixels for chromatic aberration:
   * `24 * dispersion`.
   */
  chromaticOffset: number;
  /**
   * Ready-to-inline `<filter>` markup. The map image is an inline SVG
   * gradient edge ramp sized by the receiving element.
   */
  markup: string;
  /**
   * Displacement scale in logical pixels, derived from refraction and
   * depth: `64 * refraction * depthFactor`. `depthFactor` is linear on
   * authored `[1,10]`, then a soft tail through [`WEB_DEPTH_EFFECTIVE_MAX`].
   */
  scale: number;
}
/**
 * Calibrated cardinal light-axis mapping used for the inset highlight.
 */
export interface LightAxisReceipt {
  angleDegrees: number;
  cardinal: string;
  convention: string;
  /**
   * Unit vector in the host's 2D plane: +x right, +y down (CSS/Figma screen space).
   *
   * @minItems 2
   * @maxItems 2
   */
  direction: [number, number];
  note: string;
}
/**
 * Authored acceptance versus the optically live compiled range for one control.
 */
export interface ParameterRangeReceipt {
  authored: number;
  authoredMax: number;
  authoredMin: number;
  clamped: boolean;
  /**
   * Clamped authored input used by the compiler for this field — never the
   * mapped output channel (for example `depth.rim` reports clamped depth here;
   * `WebGlassDelivery.rim_depth` carries the rim contribution).
   */
  effective: number;
  effectiveMax: number;
  effectiveMin: number;
  field: string;
  note: string;
  unit: string;
}
export interface AppearanceExposureInput {
  policy: AppearanceExposurePolicy;
  runtime: AppearanceRuntimeState;
}
/**
 * Product exposure policy: what this product lets users and their Agents
 * adjust. Owned by the receiver, versioned independently of the design
 * recipe and of any user preference.
 */
export interface AppearanceExposurePolicy {
  /**
   * May be empty: a product can expose nothing and stay design-locked.
   */
  exposed: AppearanceExposedControl[];
  /**
   * Currently `glass`; typed controls exist only for the glass family.
   */
  family: string;
  /**
   * Monotonic ordering token for policy changes; not a content hash.
   */
  policyRevision: number;
  schema: "worldbend.appearance-exposure-policy@0.1";
  /**
   * Product scope ids this policy covers (for example surface roles).
   */
  scopes: string[];
  target: AppearanceDeliveryTarget;
  version: "0.1";
}
/**
 * One control the product chooses to expose, optionally narrowed.
 */
export interface AppearanceExposedControl {
  /**
   * A glass field id or the composite `clarity`.
   */
  field: string;
  /**
   * Optional product-facing label; meaning stays owned by the field id.
   */
  label?: string | null;
  max?: number | null;
  /**
   * Narrow the authored range for this product. Must stay inside it.
   */
  min?: number | null;
  step?: number | null;
}
export interface AppearanceRuntimeState {
  optics: AppearanceOpticsMode;
}
export interface AppearanceExposureReport {
  clarity?: ClarityMappingReceipt | null;
  /**
   * Every family control plus anything the policy named: supported,
   * hidden, unsupported and adapted states are all explicit here.
   */
  controls: AppearanceExposureRow[];
  family: string;
  /**
   * Content identity of this report; pin it like a delivery receipt.
   */
  fingerprint: string;
  policyRevision: number;
  schema: "worldbend.appearance-exposure@0.1";
  scopes: string[];
  target: AppearanceDeliveryTarget;
  version: "0.1";
}
/**
 * The versioned composite mapping behind a `clarity` control.
 */
export interface ClarityMappingReceipt {
  /**
   * `radius = min + (max - min) * (1 - clarity)`, clamped to the range.
   */
  formula: string;
  mapsTo: string;
  note: string;
  rangeMax: number;
  /**
   * Effective frost range the composite drives, in logical px.
   */
  rangeMin: number;
  version: string;
}
/**
 * One resolved control row: meaning plus current availability.
 */
export interface AppearanceExposureRow {
  authoredMax: number;
  /**
   * Authored acceptance range of the family field.
   */
  authoredMin: number;
  cost: AppearanceChangeCost;
  default: AppearanceControlDefault;
  /**
   * Other channels this control intentionally influences.
   */
  dependsOn: string[];
  /**
   * Which way the value moves the material.
   */
  direction: string;
  effectiveMax: number;
  /**
   * Range after policy narrowing; equals authored when not narrowed.
   */
  effectiveMin: number;
  field: string;
  kind: AppearanceControlKind;
  note: string;
  /**
   * Why the row has this state, in receiver-reportable words.
   */
  reason: string;
  state: AppearanceControlState;
  step?: number | null;
  unit: string;
}
export interface AppearanceInspection {
  /**
   * Fields where live values differ from the seed. Empty unless the state
   * is `customized`.
   */
  customized: GlassField[];
  material: GlassMaterial2;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.appearance-inspection@0.1";
  state: AppearanceInstanceState;
  version: "0.1";
}
/**
 * One native Figma GLASS effect's optical controls. Field names follow the
 * Figma Effect API; `radius` is frost. Figma's beta Glass API does not expose
 * every UI setting (Splay is absent) and glass effects cannot bind variables.
 */
export interface GlassMaterial2 {
  /**
   * Depth of the refraction effect, `>= 1`.
   */
  depth: number;
  /**
   * Chromatic aberration amount, in `[0,1]`.
   */
  dispersion: number;
  /**
   * Angle of the specular light in degrees, in `[0,360)`.
   */
  lightAngle: number;
  /**
   * Intensity of specular highlights, in `[0,1]`.
   */
  lightIntensity: number;
  /**
   * Frost radius in logical pixels, `>= 0`.
   */
  radius: number;
  /**
   * Intensity of the refraction distortion, in `[0,1]`.
   */
  refraction: number;
  visible?: boolean;
}
/**
 * One surface's reconciliation input: the stored seed plus the live native
 * state read from the host.
 */
export interface AppearanceInspectionInput {
  /**
   * Current native GLASS values. `None` when the surface has no GLASS
   * effect at all (including a Worldbend-tagged one removed natively).
   */
  live?: GlassMaterial1 | null;
  recipe: AppearanceRecipeSpec;
  /**
   * Whether the surface carries Worldbend appearance provenance.
   */
  tagged?: boolean;
}
/**
 * Resolve a preference against one base delivery: the canonical evaluated
 * result receivers display, plus per-field receipts for hidden overrides.
 */
export interface AppearancePreferenceInput {
  base: AppearanceDeliveryInput;
  /**
   * Optional exposure policy; hidden fields keep their override saved but
   * do not drive the effective material.
   */
  policy?: AppearanceExposurePolicy | null;
  preference: AppearancePreferenceRecord;
}
/**
 * Explicit personal overrides over one appearance source. `fields` keeps the
 * stable glass wire order, so two equal records serialize identically.
 */
export interface AppearancePreferenceRecord {
  fields?: {
    depth?: AppearanceFieldOverride;
    dispersion?: AppearanceFieldOverride;
    "light-angle"?: AppearanceFieldOverride;
    "light-intensity"?: AppearanceFieldOverride;
    radius?: AppearanceFieldOverride;
    refraction?: AppearanceFieldOverride;
    visible?: AppearanceFieldOverride;
  };
  /**
   * Ordering token owned by the receiver; monotonic across commits.
   */
  revision: number;
  schema: "worldbend.appearance-preference@0.1";
  version: "0.1";
}
export interface AppearanceFieldOverride {
  actor: AppearanceOverrideActor;
  value: AppearanceOverrideValue;
}
export interface AppearancePreferencePlan {
  delivery: AppearanceDeliveryPlan;
  material: GlassMaterial3;
  preferenceFingerprint: string;
  preferenceRevision: number;
  receipts: AppearancePreferenceFieldReceipt[];
  schema: "worldbend.appearance-preference-plan@0.1";
  version: "0.1";
}
/**
 * One native Figma GLASS effect's optical controls. Field names follow the
 * Figma Effect API; `radius` is frost. Figma's beta Glass API does not expose
 * every UI setting (Splay is absent) and glass effects cannot bind variables.
 */
export interface GlassMaterial3 {
  /**
   * Depth of the refraction effect, `>= 1`.
   */
  depth: number;
  /**
   * Chromatic aberration amount, in `[0,1]`.
   */
  dispersion: number;
  /**
   * Angle of the specular light in degrees, in `[0,360)`.
   */
  lightAngle: number;
  /**
   * Intensity of specular highlights, in `[0,1]`.
   */
  lightIntensity: number;
  /**
   * Frost radius in logical pixels, `>= 0`.
   */
  radius: number;
  /**
   * Intensity of the refraction distortion, in `[0,1]`.
   */
  refraction: number;
  visible?: boolean;
}
export interface AppearancePreferenceFieldReceipt {
  field: GlassField;
  reason: string;
  state: AppearancePreferenceFieldState;
}
/**
 * Upgrade a seed while retaining changes made in the native editor.
 */
export interface AppearanceRevisionInput {
  live?: GlassMaterial1 | null;
  next: AppearanceRecipeSpec;
  previous: AppearanceRecipeSpec;
}
export interface AppearanceRevisionPlan {
  /**
   * None keeps a natively removed effect removed; application must be explicit.
   */
  material?: GlassMaterial1 | null;
  preserved: GlassField[];
  recipe: AppearanceRecipeSpec;
}
/**
 * Redeliver a current native material, independently of a preset upgrade.
 * `previous` is the receiver's accepted source, not its locally edited state.
 */
export interface AppearanceUpdateInput {
  expectedFingerprint: string;
  live: GlassMaterial1 | null;
  next: AppearanceDeliveryInput;
  /**
   * Exposure policy that filters which overrides drive the merged
   * material. Hidden overrides stay in the record with recoverable intent.
   */
  policy?: AppearanceExposurePolicy | null;
  /**
   * Consumer path: merge by explicit override intent instead of value
   * difference. Pass `live: null` alongside; a record keeps overrides
   * even when they equal the new source defaults.
   */
  preference?: AppearancePreferenceRecord | null;
  previous: AppearanceDeliveryInput;
}
export interface AppearanceUpdatePlan {
  delivery: AppearanceDeliveryPlan | null;
  preferenceFingerprint?: string | null;
  /**
   * Per-override receipts when the consumer path was used.
   */
  preferenceReceipts?: AppearancePreferenceFieldReceipt[];
  /**
   * Preference revision this plan was prepared against. Receivers reject
   * the plan when their committed revision differs.
   */
  preferenceRevision?: number | null;
  preserved: GlassField[];
  /**
   * Reject a plan that was prepared before a newer destination edit/removal.
   */
  previousDeliveryFingerprint: string | null;
  previousFingerprint: string;
  schema: "worldbend.appearance-update@0.1";
  /**
   * The new source identity stays distinct from the locally merged delivery.
   */
  sourceFingerprint: string;
  version: "0.1";
}
export interface CanvasPlan {
  background?: CanvasBackground | null;
  operation: CanvasOperationKind;
  outputSize: {
    height: number;
    width: number;
  };
  placement: CanvasPlacement;
  scale: CanvasScale;
  schema: "worldbend.canvas-plan";
  sourceRect: PixelRect;
  sourceSize: PixelSize;
  version: "0.1";
}
export interface CanvasPlacement {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface CanvasScale {
  x: number;
  y: number;
}
export interface PixelRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface PixelSize {
  height: number;
  width: number;
}
export interface CanvasSetPlan {
  schema: "worldbend.canvas-set-plan";
  sourceSize: PixelSize;
  /**
   * @minItems 1
   * @maxItems 16
   */
  variants:
    | [CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ];
  version: "0.1";
}
export interface CanvasVariantPlan {
  id: string;
  plan: CanvasPlan;
}
export interface CanvasSetSpec {
  schema: "worldbend.canvas-set";
  /**
   * @minItems 1
   * @maxItems 16
   */
  variants:
    | [CanvasVariant]
    | [CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ];
  version: "0.1";
}
export interface CanvasVariant {
  id: string;
  operation: CanvasOperation;
}
export interface CanvasInsets {
  bottom: number;
  left: number;
  right: number;
  top: number;
}
export interface NormalizedAnchor {
  x: number;
  y: number;
}
export interface CanvasSpec {
  operation: CanvasOperation;
  schema: "worldbend.canvas";
  version: "0.1";
}
export interface CardIdleInput {
  rig: CardRig;
  timeMs: number;
}
/**
 * Accepted interactive-card state; see docs/CARD_CONTRACT.md. The rigid
 * geometry is shared with the pose operation; unlike pose, back-facing and
 * edge-on views are reportable states instead of errors.
 */
export interface CardRig {
  action: CardAction;
  /**
   * Explicit treatment of the unconfigured back face. The mirrored default
   * keeps a two-sided turn legible without requiring separate back artwork.
   */
  back?: {
    treatment: "mirror";
  };
  elementSize: Size;
  geometry: CardGeometry;
  rest?: CardView;
  schema: "worldbend.card";
  tilt: CardTilt;
  version: "0.1";
}
export interface CardAction {
  axis?: "x" | "y";
  /**
   * +1 or -1; selects which way the deliberate turn runs.
   */
  direction?: number;
  durationMs?: number;
  /**
   * Shared named easing curves. Motion timelines and interactive-card turns
   * sample the same math so carriers cannot diverge on timing meaning.
   */
  easing?:
    | {
        kind: "linear";
      }
    | {
        kind: "hold";
      }
    | {
        kind: "cubicBezier";
        x1: number;
        x2: number;
        y1: number;
        y2: number;
      };
  interruption?: "ignore-while-active";
  /**
   * Complete revolutions of one triggered action; distinguishable in state.
   */
  turns?: number;
}
export interface CardGeometry {
  /**
   * Perspective distance in CSS pixels, shared by every view of the card.
   */
  perspective: number;
  perspectiveOrigin?: NormalizedAnchor1;
  pivot?: NormalizedAnchor2;
}
/**
 * Projection origin as a fraction of the element border box.
 */
export interface NormalizedAnchor1 {
  x: number;
  y: number;
}
/**
 * Rotation origin as a fraction of the element border box; center by default.
 */
export interface NormalizedAnchor2 {
  x: number;
  y: number;
}
/**
 * Authored resting pose; live tilt and deliberate turns add to this view.
 */
export interface CardView {
  depth?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translate?: Point1;
}
export interface Point1 {
  x: number;
  y: number;
}
export interface CardTilt {
  idle?: CardIdle | null;
  maxRotateX: number;
  maxRotateY: number;
  pointerRegion?: CardRegion;
  /**
   * Return-to-rest timing after the pointer leaves the surface.
   */
  settleMs?: number;
  /**
   * Exponential pointer-follow time constant; 0 tracks instantly.
   */
  smoothingMs?: number;
}
export interface CardIdle {
  amplitudeX: number;
  amplitudeY: number;
  periodMs: number;
}
/**
 * Unit-box subregion that maps pointer position onto the tilt envelope.
 */
export interface CardRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface CardPointerInput {
  rig: CardRig;
  /**
   * Pointer position in the surface's unit box; values outside the rig's
   * pointer region clamp to its edge.
   */
  x: number;
  y: number;
}
export interface CardPointerOutput {
  clampX: number;
  clampY: number;
  /**
   * Envelope tilt in degrees; rotateX follows -y, rotateY follows +x.
   */
  tiltX: number;
  tiltY: number;
}
export interface CardPoseInput {
  rig: CardRig;
  view?: CardView1 | null;
}
/**
 * One explicit static view. Angles are cumulative so a two-revolution turn
 * differs from one revolution even when the projected stills match.
 */
export interface CardView1 {
  depth?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translate?: Point1;
}
export interface CardPoseOutput {
  /**
   * Same plane with readable authored back content, rotated about its center.
   */
  backCss: string;
  css?: CssTransform | null;
  /**
   * @minItems 4
   * @maxItems 4
   */
  depths: [number, number, number, number];
  face: CardFace;
  quad: Quad1;
  /**
   * Cumulative revolutions around the rig's action axis, signed; 2.0 after
   * a two-revolution turn and 1.0 after one even though both stills match.
   */
  revolutions: number;
  /**
   * Native rigid transform, including independent pivot and camera origins.
   * Apply with transform-origin: 0 0; valid for front, edge and back.
   */
  rigidCss: string;
  /**
   * Present only when the view passes the ordinary front-facing solver
   * validation; edge and back views carry the raw rigid quad instead.
   */
  spec?: TransformSpec1 | null;
}
export interface CssTransform {
  height: string;
  /**
   * @minItems 16
   * @maxItems 16
   */
  matrix3d: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];
  transform: string;
  transformOrigin: "0 0";
  width: string;
}
export interface TransformSpec1 {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface CardTurnInput {
  progress: number;
  rig: CardRig;
}
export interface CardTurnOutput {
  /**
   * Cumulative eased angle in degrees, signed by direction.
   */
  angle: number;
  easedProgress: number;
  face: CardFace;
  revolutions: number;
}
export interface DeformationWorkMigration {
  plan: DeformationWorkPlan;
  schema: "worldbend.deformation-work-migration";
  sourceSchema: string;
  sourceVersion: string;
  version: "0.1";
  work: DeformationWorkSpec;
}
export interface DeformationWorkPlan {
  authoredView?: AuthoredMeshView | null;
  /**
   * Compound mask projected by the core into normalized reference-canvas
   * coordinates. The original curves stay in spec.shapeFit.clip.
   */
  clip?: MockupClipPlan | null;
  liquifySampleCount: number;
  /**
   * The mesh the replay reached after the Pin phases and Liquify, before
   * any explicit mesh edit. Mesh-view editors measure new vertex
   * placements against this baseline so Liquify displacement is never
   * baked into edits, and adapters never re-derive that geometry.
   */
  meshEditBaseline: GridWarpMesh | TriangleWarpMesh;
  meshEditCount: number;
  meshWarp: MeshWarpPlan;
  pinView?: DeformationWorkPinView | null;
  schema: "worldbend.deformation-work-plan";
  shapeFitView?: DeformationWorkShapeFitView | null;
  spec: DeformationWorkSpec;
  version: "0.1";
}
export interface AuthoredMeshView {
  canvasOrigin: Point2;
  mesh: WarpMesh;
  solve: SolveOutput;
}
/**
 * Output canvas origin in the original reference pixels.
 */
export interface Point2 {
  x: number;
  y: number;
}
export interface GridWarpMesh {
  boundary?: "fixed" | "free";
  shading?: number[] | null;
  subdivisions: number;
  vertices: WarpVertex[];
}
export interface WarpVertex {
  source: Point;
  warped: Point;
}
export interface TriangleWarpMesh {
  boundary?: "fixed" | "free";
  shading?: number[] | null;
  /**
   * @minItems 2
   * @maxItems 4096
   */
  triangles: [[number, number, number], [number, number, number], ...[number, number, number][]];
  /**
   * @minItems 4
   * @maxItems 2048
   */
  vertices: [WarpVertex, WarpVertex, WarpVertex, WarpVertex, ...WarpVertex[]];
}
/**
 * Original authoring plane, translated into the complete output canvas.
 */
export interface SolveOutput {
  diagnostics: SolveDiagnostics;
  homography: Homography;
  resolvedDestination: ResolvedDestination;
  spec: TransformSpec1;
}
export interface Homography {
  /**
   * @minItems 9
   * @maxItems 9
   */
  inverse: [number, number, number, number, number, number, number, number, number];
  /**
   * @minItems 9
   * @maxItems 9
   */
  matrix: [number, number, number, number, number, number, number, number, number];
}
export interface ResolvedDestination {
  quad: Quad1;
  reference: Size;
  sourceSpace: CoordinateSpace;
}
export interface MockupClipPlan {
  bounds: Bounds1;
  /**
   * Sum of the per-contour flattened areas in canvas pixels. For compound
   * or overlapping contours this is not the exact covered region; the fill
   * rule still governs rendering.
   */
  contourAreaPixels: number;
  contours: MockupClipContour[];
  fillRule: MockupClipFillRule;
  regions?: MockupClipRegion[];
}
/**
 * Canvas-pixel bounds of the flattened contours. Contours may legitimately
 * extend past the canvas; these bounds are not clamped to it.
 */
export interface Bounds1 {
  height: number;
  width: number;
  x: number;
  y: number;
}
/**
 * A closed clip contour in normalized canvas coordinates. Each contour closes
 * implicitly from its final segment endpoint back to `start`.
 */
export interface MockupClipContour {
  segments: MockupClipSegment[];
  start: Point;
}
export interface MockupClipRegion {
  contourIndices: number[];
  fillRule?: "nonZero" | "evenOdd";
}
export interface MeshWarpPlan {
  schema: string;
  solve: SolveOutput1;
  spec: MeshWarpSpec;
  version: string;
}
export interface SolveOutput1 {
  diagnostics: SolveDiagnostics;
  homography: Homography;
  resolvedDestination: ResolvedDestination;
  spec: TransformSpec1;
}
export interface MeshWarpSpec {
  mesh: WarpMesh;
  schema: string;
  targetSize?: Size | null;
  transform: TransformSpec1;
  version: string;
}
/**
 * The Pin-view projection of a planned work: resolved anchors, the replayed
 * stroke-sample count, and the mesh the pin phases resolved to before any
 * mesh edits were applied. Editors read pin positions from this mesh so
 * adapters never re-derive deformation geometry.
 */
export interface DeformationWorkPinView {
  /**
   * @maxItems 64
   */
  anchors: ResolvedDeformationAnchor[];
  resolvedMesh: WarpMesh;
  strokeSampleCount: number;
}
export interface ResolvedDeformationAnchor {
  column: number;
  id: string;
  row: number;
  vertexIndex: number;
}
/**
 * Editors keep their regular interior control grid; the fitted mesh is a
 * separate projection over that state, never a replacement for its recipe.
 */
export interface DeformationWorkShapeFitView {
  fit: ShapeFitResolution;
  interiorMesh: WarpMesh;
}
export interface ShapeFitResolution {
  /**
   * @minItems 4
   * @maxItems 4
   */
  cornerPositions: [number, number, number, number];
  iterations: number;
  mesh: WarpMesh;
  refinement: number;
}
/**
 * One replayable deformation work. The `transform` owns the outer plane, the
 * optional `surface` controls are the Pin view, and `mesh_edits` are explicit
 * Mesh-view vertex placements. Resolution replays the pin phases first, then
 * applies mesh edits, so an explicit later edit wins over an anchored or
 * brushed position at the same vertex.
 */
export interface DeformationWorkSpec {
  /**
   * Fixed keeps the original rectangular boundary; free retains authored outline controls.
   */
  boundary?: "fixed" | "free";
  /**
   * Typed brush-only Liquify controls (`worldbend.liquify@0.1`), replayed
   * after the surface phases and before explicit mesh edits.
   */
  liquify?: LiquifyControls | null;
  /**
   * @maxItems 289
   */
  meshEdits?: MeshVertexEdit[];
  meshSubdivisions?: number;
  schema: "worldbend.deformation-work";
  /**
   * Replayable boundary fitting is applied after the authored interior.
   */
  shapeFit?: ShapeFitControls | null;
  surface?: SurfaceDeformationControls | null;
  targetSize?: Size | null;
  transform: TransformSpec1;
  version: "0.1";
}
export interface LiquifyControls {
  /**
   * @maxItems 64
   */
  strokes?: LiquifyStroke[];
}
export interface LiquifyStroke {
  id: string;
  mode: LiquifyMode;
  /**
   * @minItems 1
   * @maxItems 256
   */
  samples: [LiquifySample, ...LiquifySample[]];
}
export interface LiquifySample {
  delta?: Point | null;
  position: Point;
  radius: number;
  strength: number;
}
/**
 * One explicit Mesh-view placement. Fixed work accepts interior vertices;
 * free work also retains authored corners and edge vertices.
 */
export interface MeshVertexEdit {
  column: number;
  row: number;
  warped: Point;
}
/**
 * An authored closed contour in normalized destination-plane coordinates.
 * Corner positions are perimeter fractions in positive winding order, starting
 * at the authored contour's start, and correspond to TL, TR, BR, BL. The four
 * fractions may wrap once. Omission selects four ordered bounding-box landmarks.
 */
export interface ShapeFitControls {
  /**
   * Original compound fill in destination-plane coordinates. Fitting owns
   * the connected domain; this mask retains holes and independent regions.
   */
  clip?: MockupClip | null;
  contour: MockupClipContour;
  /**
   * @minItems 4
   * @maxItems 4
   */
  cornerPositions?: [number, number, number, number] | null;
  /**
   * One or two conforming refinement passes. Omission chooses two for a
   * compact outline, reserving room for exact composition with later edits.
   */
  refinement?: number | null;
}
export interface MockupClip {
  contours: MockupClipContour[];
  fillRule?: "nonZero" | "evenOdd";
  /**
   * Independent filled regions are combined by geometric union. Omitted
   * regions retain the single compound path governed by `fill_rule`.
   */
  regions?: MockupClipRegion[];
}
/**
 * The surface-deformation interior controls without their owning transform,
 * target size, mesh density, and header. The deformation-work contract nests
 * this exact structure as its Pin view; every rule and phase of
 * `worldbend.surface-deformation@0.1` applies unchanged.
 */
export interface SurfaceDeformationControls {
  /**
   * @maxItems 64
   */
  anchors?: DeformationAnchor[];
  envelope: BezierEnvelope;
  /**
   * @maxItems 64
   */
  strokes?: DeformationStroke[];
}
export interface DeformationAnchor {
  column: number;
  id: string;
  row: number;
}
export interface BezierEnvelope {
  columns: number;
  /**
   * @minItems 16
   * @maxItems 169
   */
  points: [
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    ...Point[]
  ];
  rows: number;
}
export interface DeformationStroke {
  id: string;
  /**
   * @minItems 1
   * @maxItems 256
   */
  samples: [StrokeSample, ...StrokeSample[]];
}
export interface StrokeSample {
  delta: Point;
  position: Point;
  radius: number;
  strength: number;
}
export interface EffectCatalog {
  effects: EffectDescriptor[];
  ordering: string;
  version: "1" | "2" | "3";
}
export interface EffectDescriptor {
  carriers: EffectCarrier[];
  compare: string;
  content: EffectContent;
  expresses: string;
  id: EffectId;
  inputAxes: EffectAxis[];
  intent: EffectIntent;
  keywords: string;
  limits: string;
  slots: string[];
  title: string;
  version: "1" | "2" | "3";
}
export interface EffectCatalogInput {
  carrier?: EffectCarrier | null;
  content?: EffectContent | null;
  intent?: EffectIntent | null;
  /**
   * Case-insensitive literal terms, all must match. No semantic inference.
   */
  query?: string;
  version: "1" | "2" | "3";
}
export interface EffectPlan {
  fingerprint: string;
  frames: EffectFrame[];
  schema: "worldbend.effect-plan";
  state: EffectState;
  version: "1" | "2" | "3";
  viewport: Size;
}
export interface EffectFrame {
  appearance?: EffectFrameAppearance | null;
  coverage?: EffectCoverage | null;
  id: string;
  offset: Point;
  size: Size;
  surface: EffectFrameSurface;
}
export interface EffectFrameAppearance {
  depthOfField?: EffectDepthOfFieldPlan | null;
  motionBlur?: EffectMotionBlurPlan | null;
}
export interface EffectDepthOfFieldPlan {
  blurRadius: number;
  depthMap?: EffectDepthMap | null;
  focusDistance: number;
  focusRange: number;
  maxBlurRadius: number;
  planeDistance: number;
}
/**
 * Optional caller-bound grayscale depth map for one camera plane. Red=0 maps
 * to `nearDistance`; red=1 maps to `farDistance`. The media bytes remain an
 * adapter binding and are not part of recipe identity.
 */
export interface EffectDepthMap {
  farDistance: number;
  nearDistance: number;
}
export interface EffectMotionBlurPlan {
  elapsedSeconds: number;
  exposureFraction: number;
  maxBlurRadius: number;
  screenBlurVector: Point;
  screenVelocity: Point;
  sourceBlurVector: Point3;
}
/**
 * Vector from the current sample toward its trail in logical source pixels.
 */
export interface Point3 {
  x: number;
  y: number;
}
/**
 * Geometric source coverage only. Transparent pixels inside the source remain
 * caller-owned content and are not claimed to cover the viewport.
 */
export interface EffectCoverage {
  requiredSourcePadding: EffectSourcePadding;
  sampledSourceBounds: Bounds;
  viewportCovered: boolean;
}
export interface EffectSourcePadding {
  bottom: number;
  left: number;
  right: number;
  top: number;
}
export interface PlanePoseOutput {
  css: CssTransform;
  spec: TransformSpec1;
}
export interface SurfaceWindowPlan {
  /**
   * Hidden faces have no drawable mapping; they never reuse a previous face.
   */
  mapping?: SurfaceWindowMapping | null;
  schema: "worldbend.surface-window-plan";
  spec: SurfaceWindowSpec;
  version: "0.1";
  visibility: SurfaceVisibility;
}
export interface SurfaceWindowMapping {
  css: CssTransform;
  /**
   * z(x,y) = coefficients[0]*x + coefficients[1]*y + coefficients[2].
   *
   * @minItems 3
   * @maxItems 3
   */
  depthPlane: [number, number, number];
  /**
   * Row-major. Maps local window (x,y,1) to homogeneous content UV.
   *
   * @minItems 9
   * @maxItems 9
   */
  sampleHomography: [number, number, number, number, number, number, number, number, number];
}
/**
 * A fixed content plane at z=0, viewed through one explicitly posed window.
 * All coordinates are logical CSS pixels, not source texture pixel counts.
 */
export interface SurfaceWindowSpec {
  contentOrigin: Point4;
  contentSize: {
    height: number;
    width: number;
  };
  frost: WindowFrost;
  pose: PlanePose;
  schema: "worldbend.surface-window";
  version: "0.1";
  windowSize: {
    height: number;
    width: number;
  };
}
/**
 * Top-left of the stationary content, relative to the unposed window.
 */
export interface Point4 {
  x: number;
  y: number;
}
export interface WindowFrost {
  /**
   * Blur sampling radius on the content plane at zero separation.
   */
  baseRadius: number;
  maxRadius: number;
  /**
   * Additional radius per logical pixel of absolute separation from z=0.
   */
  spread: number;
}
/**
 * Explicit local single-plane pose; see PLANE_POSE_CONTRACT.md for order and units.
 */
export interface PlanePose {
  /**
   * Translation toward the viewer, in CSS pixels.
   */
  depth?: number;
  /**
   * Perspective distance in CSS pixels. No camera estimation.
   */
  perspective: number;
  perspectiveOrigin?: NormalizedAnchor3;
  pivot?: NormalizedAnchor4;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translate?: Point5;
}
/**
 * Projection origin as a fraction of the element border box.
 */
export interface NormalizedAnchor3 {
  x: number;
  y: number;
}
/**
 * Rotation origin as a fraction of the element border box; center by default.
 */
export interface NormalizedAnchor4 {
  x: number;
  y: number;
}
export interface Point5 {
  x: number;
  y: number;
}
export interface PlaneStripOutput {
  items: PlaneStripItem[];
}
export interface PlaneStripItem {
  css: CssTransform;
  id: string;
  spec: TransformSpec1;
}
export interface EffectState {
  pointerX: number;
  pointerY: number;
  progress: number;
  reducedMotion: boolean;
}
export interface EffectPlanInput {
  /**
   * If supplied, reject a changed recipe before evaluating any layer.
   */
  expectedFingerprint?: string | null;
  /**
   * Explicit temporal sample for motion blur. The core retains no prior state.
   */
  motion?: EffectMotionSample | null;
  recipe: EffectRecipe;
  state: EffectState;
}
export interface EffectMotionSample {
  /**
   * Time between previous and current state in seconds.
   */
  elapsedSeconds: number;
  previousState: EffectState;
}
export interface EffectRecipe {
  /**
   * Version-3 optical/temporal rendering derived from the explicit camera.
   */
  appearance?: EffectSpatialAppearance | null;
  /**
   * Present only for version-2+ recipes composed entirely of camera planes.
   */
  camera?: EffectCameraRig | null;
  /**
   * @minItems 1
   * @maxItems 8
   */
  layers:
    | [EffectLayer]
    | [EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer]
    | [EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer, EffectLayer];
  /**
   * Provenance of a built-in expansion. Explicit layers remain authoritative.
   */
  origin?: EffectRecipeInput | null;
  schema: "worldbend.effect-recipe";
  version: "1" | "2" | "3";
  viewport: Size;
}
export interface EffectSpatialAppearance {
  depthOfField?: EffectDepthOfField | null;
  motionBlur?: EffectMotionBlur | null;
}
export interface EffectDepthOfField {
  /**
   * Optical focus is independent from the camera's convergence plane.
   */
  focusDistance: number;
  /**
   * Full sharp interval around optical focus. Blur reaches its maximum one
   * further focus-range beyond either edge of that interval.
   */
  focusRange: number;
  /**
   * Maximum blur radius in logical source pixels.
   */
  maxBlurRadius: number;
}
export interface EffectMotionBlur {
  /**
   * Fraction of the explicit frame interval during which the shutter is open.
   */
  exposureFraction: number;
  /**
   * Clamp for the screen-space trail in logical pixels.
   */
  maxBlurRadius: number;
}
/**
 * One explicit pinhole camera shared by every camera plane. `focusDistance`
 * is the version-2 name of the look-at/convergence plane. Version 3 keeps it
 * frozen for compatibility and gives optical focus its own appearance field.
 */
export interface EffectCameraRig {
  focalLength: number;
  focusDistance: number;
  travel: EffectCameraTravel;
}
/**
 * Maximum screen-space travel at the focus plane.
 */
export interface EffectCameraTravel {
  x: number;
  y: number;
}
export interface EffectLayer {
  id: string;
  offset: Point;
  surface: EffectSurface;
  /**
   * @maxItems 8
   */
  tracks:
    | []
    | [EffectTrack]
    | [EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack]
    | [EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack, EffectTrack];
}
export interface PlaneStripPanel {
  elementSize: Size;
  end: number;
  id: string;
  /**
   * Left and right source-space fractions of one shared strip, including caller-chosen gaps.
   */
  start: number;
}
export interface EffectTrack {
  axis: EffectAxis;
  curve: EffectCurve;
  from: number;
  property: EffectProperty;
  to: number;
}
export interface EffectRecipeInput {
  effect: EffectId;
  intensity: number;
  version: "1" | "2" | "3";
  viewport: {
    height: number;
    width: number;
  };
}
export interface FoilDeliveryInput {
  material: FoilMaterial;
  recipe: FoilRecipeSpec;
  target: FoilDeliveryTarget;
}
export interface FoilMaterial {
  baseColor: FoilColor;
  /**
   * Flow multiplier; frame time is milliseconds in every host.
   */
  flowSpeed: number;
  highlightColor: FoilColor;
  intensity: number;
  lightAngle: number;
  roughness: number;
  visible: boolean;
}
/**
 * Encoded sRGB tint and opacity. Interpolation uses premultiplied tint so a
 * fully transparent color does not introduce a colored fringe.
 */
export interface FoilColor {
  a: number;
  b: number;
  g: number;
  r: number;
}
export interface FoilRecipeSpec {
  material: FoilMaterial;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.foil@0.1";
  version: "0.1";
}
export interface FoilDeliveryPlan {
  fingerprint: string;
  kernel: FoilKernelResource;
  material: FoilMaterial;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.foil-delivery@0.1";
  target: FoilDeliveryTarget;
  version: "0.1";
}
/**
 * Obtainable, immutable implementation; no account-owned asset is needed by
 * a receiver. Source is bundled into the delivery and checked by the binding.
 */
export interface FoilKernelResource {
  id: string;
  sha256: string;
  source: string;
  uniformBytes: number;
}
export interface FoilInspection {
  customized: FoilField[];
  material: FoilMaterial;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.foil-inspection@0.1";
  state: AppearanceInstanceState;
  version: "0.1";
}
export interface FoilInspectionInput {
  live: FoilMaterial | null;
  recipe: FoilRecipeSpec;
  tagged?: boolean;
}
export interface FoilRevisionInput {
  live: FoilMaterial | null;
  next: FoilRecipeSpec;
  previous: FoilRecipeSpec;
}
export interface FoilRevisionPlan {
  material?: FoilMaterial | null;
  preserved: FoilField[];
  recipe: FoilRecipeSpec;
}
export interface FoilUpdateInput {
  expectedFingerprint: string;
  live: FoilMaterial | null;
  next: FoilDeliveryInput;
  previous: FoilDeliveryInput;
}
export interface FoilUpdatePlan {
  delivery: FoilDeliveryPlan | null;
  preserved: FoilField[];
  previousDeliveryFingerprint: string | null;
  previousFingerprint: string;
  schema: "worldbend.foil-update@0.1";
  sourceFingerprint: string;
  version: "0.1";
}
export interface MaterialExposurePolicy {
  exposed: MaterialExposedControl[];
  policyId: string;
  revision: number;
  schema: "worldbend.material-policy@0.1";
  /**
   * @minItems 1
   * @maxItems 32
   */
  scopes: [string, ...string[]];
}
export interface MaterialExposedControl {
  field: TextureField;
  max?: number | null;
  min?: number | null;
}
export interface MaterialPreferenceRecord {
  fields: {
    "clip-to-shape"?: MaterialFieldPreference;
    etch?: MaterialFieldPreference;
    "etch-size"?: MaterialFieldPreference;
    grain?: MaterialFieldPreference;
    "grain-color"?: MaterialFieldPreference;
    "grain-size"?: MaterialFieldPreference;
    visible?: MaterialFieldPreference;
  };
  recipeId: string;
  revision: number;
  schema: "worldbend.material-preference@0.1";
  /**
   * Receiver-owned role/instance scope, never inferred from a design label.
   */
  scope: string;
}
export interface MaterialFieldPreference {
  actor: AppearanceOverrideActor;
  value: MaterialPreferenceValue;
}
export interface MaterialRgba {
  a: number;
  b: number;
  g: number;
  r: number;
}
export interface MaterialPreferenceRuntime {
  /**
   * Pause/reduced-motion adaptation; does not rewrite saved authored timing.
   */
  motionAllowed: boolean;
  /**
   * Actual mechanism availability, reported by the receiving target.
   */
  rendererAvailable: boolean;
}
export interface TextureDeliveryInput {
  material: TextureMaterial;
  nativeExtras?: {
    [k: string]: unknown;
  };
  recipe: TextureRecipeSpec;
  target: TextureDeliveryTarget;
}
/**
 * The resolved material to deliver (typically from `inspect_texture`).
 */
export interface TextureMaterial {
  /**
   * Whether the etch follows the layer outline instead of its bounds.
   */
  clipToShape?: boolean;
  /**
   * Etch bump radius in `[0,1000]` logical pixels — the TEXTURE effect.
   */
  etch: number;
  /**
   * Etch cell size in `[0.5,1000]` logical pixels.
   */
  etchSize: number;
  /**
   * Grain density in `[0,1]` — the NOISE effect's density.
   */
  grain: number;
  /**
   * Grain tint, `#rrggbb`; the NOISE effect's primary color.
   */
  grainColor: string;
  /**
   * Grain cell size in `[0.5,1000]` logical pixels.
   */
  grainSize: number;
  visible?: boolean;
}
/**
 * An editable texture starting state: named, versioned, self-describing.
 * The material is the seed; live native values stay the authority.
 */
export interface TextureRecipeSpec {
  material: TextureMaterial1;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.texture@0.1";
  version: "0.1";
}
/**
 * The seven portable texture controls. Field names follow the native effects:
 * grain maps the NOISE effect (density, size, color) and etch maps the
 * TEXTURE effect (radius, size, clip).
 */
export interface TextureMaterial1 {
  /**
   * Whether the etch follows the layer outline instead of its bounds.
   */
  clipToShape?: boolean;
  /**
   * Etch bump radius in `[0,1000]` logical pixels — the TEXTURE effect.
   */
  etch: number;
  /**
   * Etch cell size in `[0.5,1000]` logical pixels.
   */
  etchSize: number;
  /**
   * Grain density in `[0,1]` — the NOISE effect's density.
   */
  grain: number;
  /**
   * Grain tint, `#rrggbb`; the NOISE effect's primary color.
   */
  grainColor: string;
  /**
   * Grain cell size in `[0.5,1000]` logical pixels.
   */
  grainSize: number;
  visible?: boolean;
}
export interface MaterialExposurePolicy2 {
  exposed: MaterialExposedControl2[];
  policyId: string;
  revision: number;
  schema: "worldbend.material-policy@0.1";
  /**
   * @minItems 1
   * @maxItems 32
   */
  scopes: [string, ...string[]];
}
export interface MaterialExposedControl2 {
  field: FoilField;
  max?: number | null;
  min?: number | null;
}
export interface MaterialPreferenceRecord2 {
  fields: {
    "base-color"?: MaterialFieldPreference;
    "flow-speed"?: MaterialFieldPreference;
    "highlight-color"?: MaterialFieldPreference;
    intensity?: MaterialFieldPreference;
    "light-angle"?: MaterialFieldPreference;
    roughness?: MaterialFieldPreference;
    visible?: MaterialFieldPreference;
  };
  recipeId: string;
  revision: number;
  schema: "worldbend.material-preference@0.1";
  /**
   * Receiver-owned role/instance scope, never inferred from a design label.
   */
  scope: string;
}
export interface MaterialExposurePolicy3 {
  exposed: MaterialExposedControl3[];
  policyId: string;
  revision: number;
  schema: "worldbend.material-policy@0.1";
  /**
   * @minItems 1
   * @maxItems 32
   */
  scopes: [string, ...string[]];
}
export interface MaterialExposedControl3 {
  field: MeshGradientField;
  max?: number | null;
  min?: number | null;
}
export interface MaterialPreferenceRecord3 {
  fields: {
    "color-bl"?: MaterialFieldPreference;
    "color-br"?: MaterialFieldPreference;
    "color-tl"?: MaterialFieldPreference;
    "color-tr"?: MaterialFieldPreference;
    "duration-ms"?: MaterialFieldPreference;
    "flow-speed"?: MaterialFieldPreference;
    "phase-ms"?: MaterialFieldPreference;
    softness?: MaterialFieldPreference;
    visible?: MaterialFieldPreference;
    warp?: MaterialFieldPreference;
  };
  recipeId: string;
  revision: number;
  schema: "worldbend.material-preference@0.1";
  /**
   * Receiver-owned role/instance scope, never inferred from a design label.
   */
  scope: string;
}
export interface MeshGradientDeliveryInput {
  kernelProfile?: "worldbend.mesh-gradient.rgba@0.1" | "worldbend.mesh-gradient.rgba@0.2";
  material: MeshGradientMaterial;
  recipe: MeshGradientRecipeSpec;
  target: MeshGradientDeliveryTarget;
}
/**
 * Soft four-corner mesh with editable loop timing and soft fluid warp.
 */
export interface MeshGradientMaterial {
  colorBl: MeshGradientColor;
  colorBr: MeshGradientColor;
  colorTl: MeshGradientColor;
  colorTr: MeshGradientColor;
  /**
   * Editable loop duration in milliseconds.
   */
  durationMs: number;
  /**
   * Motion energy inside the loop; zero freezes the fluid field.
   */
  flowSpeed: number;
  /**
   * Instance phase offset in milliseconds; independent surfaces may differ.
   */
  phaseMs: number;
  /**
   * Corner falloff softness; higher values blend regions like fluid light.
   */
  softness: number;
  visible: boolean;
  /**
   * Soft fluid domain warp; zero keeps a static bilinear mesh.
   */
  warp: number;
}
/**
 * Encoded sRGB tint and opacity. Interpolation uses premultiplied tint so a
 * fully transparent color does not introduce a colored fringe.
 */
export interface MeshGradientColor {
  a: number;
  b: number;
  g: number;
  r: number;
}
export interface MeshGradientRecipeSpec {
  material: MeshGradientMaterial;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.mesh-gradient@0.1";
  version: "0.1";
}
export interface MaterialPreferencePlan {
  controls: MaterialPreferenceControl[];
  delivery: TextureDeliveryPlan;
  policyFingerprint: string;
  policyRevision: number;
  preferenceFingerprint: string;
  preferenceRevision: number;
  receipts: MaterialPreferenceReceipt[];
  schema: "worldbend.material-preference-plan@0.1";
  scope: string;
  sourceFingerprint: string;
}
export interface MaterialPreferenceControl {
  /**
   * @minItems 2
   * @maxItems 2
   */
  authoredRange?: [number, number] | null;
  /**
   * What changing one exposed control costs the receiving surface.
   */
  cost: "live" | "rebake" | "asset";
  current: MaterialPreferenceValue;
  default: MaterialPreferenceValue;
  direction: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  effectiveRange?: [number, number] | null;
  field: TextureField;
  state: AppearanceControlState;
  /**
   * Target-effective logical range, separate from product permission.
   *
   * @minItems 2
   * @maxItems 2
   */
  targetRange?: [number, number] | null;
  targetValue: MaterialPreferenceValue;
  unit: string;
}
export interface TextureDeliveryPlan {
  /**
   * Identity of the delivered state: seed identity plus resolved values.
   */
  fingerprint: string;
  losses?: AppearanceLossReceipt[];
  material: TextureMaterial1;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.texture-delivery@0.1";
  target: TextureDeliveryTarget;
  version: "0.1";
  web?: WebTextureDelivery | null;
}
export interface WebTextureDelivery {
  /**
   * Complete declaration list for one grain overlay layer. Apply to an
   * absolutely-positioned child that covers the textured surface.
   */
  css: string;
  /**
   * Etch route through SVG bump lighting. `None` when `etch` is zero: a
   * flat grain sheet needs no displacement.
   */
  etch?: TextureEtchFilter | null;
  fidelity: TextureFieldDelivery[];
  /**
   * The grain layer's mix-blend-mode.
   */
  grainBlend: "normal" | "multiply" | "overlay";
  /**
   * The overlay's `background-image` data-URI tile on its own, for hosts
   * that compose it themselves.
   */
  grainTile: string;
  /**
   * CSS size of the 64 px tile, calibrated to the noise frequency so
   * grainSize scales cells rather than squeezing the entire tile to it.
   */
  grainTileSize: number;
  parameterRanges: ParameterRangeReceipt[];
}
/**
 * Deterministic numbers for the Web SVG etch route.
 */
export interface TextureEtchFilter {
  /**
   * `feTurbulence` base frequency: `1 / etchSize` in cycles per pixel.
   */
  baseFrequency: number;
  /**
   * Ready-to-inline `<filter>` markup with a fixed overhead key light.
   */
  markup: string;
  /**
   * Bump height for `feDiffuseLighting`. Linear on authored `[0,12]`, then
   * a soft tail through [`WEB_ETCH_EFFECTIVE_MAX`].
   */
  surfaceScale: number;
}
export interface TextureFieldDelivery {
  field: TextureField;
  mapping: AppearanceFieldMapping;
  note: string;
}
export interface MaterialPreferenceReceipt {
  field: TextureField;
  state: MaterialPreferenceFieldState;
}
export interface MaterialPreferencePlan2 {
  controls: MaterialPreferenceControl2[];
  delivery: FoilDeliveryPlan;
  policyFingerprint: string;
  policyRevision: number;
  preferenceFingerprint: string;
  preferenceRevision: number;
  receipts: MaterialPreferenceReceipt2[];
  schema: "worldbend.material-preference-plan@0.1";
  scope: string;
  sourceFingerprint: string;
}
export interface MaterialPreferenceControl2 {
  /**
   * @minItems 2
   * @maxItems 2
   */
  authoredRange?: [number, number] | null;
  /**
   * What changing one exposed control costs the receiving surface.
   */
  cost: "live" | "rebake" | "asset";
  current: MaterialPreferenceValue;
  default: MaterialPreferenceValue;
  direction: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  effectiveRange?: [number, number] | null;
  field: FoilField;
  state: AppearanceControlState;
  /**
   * Target-effective logical range, separate from product permission.
   *
   * @minItems 2
   * @maxItems 2
   */
  targetRange?: [number, number] | null;
  targetValue: MaterialPreferenceValue;
  unit: string;
}
export interface MaterialPreferenceReceipt2 {
  field: FoilField;
  state: MaterialPreferenceFieldState;
}
export interface MaterialPreferencePlan3 {
  controls: MaterialPreferenceControl3[];
  delivery: MeshGradientDeliveryPlan;
  policyFingerprint: string;
  policyRevision: number;
  preferenceFingerprint: string;
  preferenceRevision: number;
  receipts: MaterialPreferenceReceipt3[];
  schema: "worldbend.material-preference-plan@0.1";
  scope: string;
  sourceFingerprint: string;
}
export interface MaterialPreferenceControl3 {
  /**
   * @minItems 2
   * @maxItems 2
   */
  authoredRange?: [number, number] | null;
  /**
   * What changing one exposed control costs the receiving surface.
   */
  cost: "live" | "rebake" | "asset";
  current: MaterialPreferenceValue;
  default: MaterialPreferenceValue;
  direction: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  effectiveRange?: [number, number] | null;
  field: MeshGradientField;
  state: AppearanceControlState;
  /**
   * Target-effective logical range, separate from product permission.
   *
   * @minItems 2
   * @maxItems 2
   */
  targetRange?: [number, number] | null;
  targetValue: MaterialPreferenceValue;
  unit: string;
}
export interface MeshGradientDeliveryPlan {
  fingerprint: string;
  kernel: MeshGradientKernelResource;
  material: MeshGradientMaterial;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.mesh-gradient-delivery@0.1";
  target: MeshGradientDeliveryTarget;
  version: "0.1";
}
export interface MeshGradientKernelResource {
  id: string;
  sha256: string;
  source: string;
  uniformBytes: number;
}
export interface MaterialPreferenceReceipt3 {
  field: MeshGradientField;
  state: MaterialPreferenceFieldState;
}
export interface MeshGradientInspection {
  customized: MeshGradientField[];
  material: MeshGradientMaterial;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.mesh-gradient-inspection@0.1";
  state: AppearanceInstanceState;
  version: "0.1";
}
export interface MeshGradientInspectionInput {
  live: MeshGradientMaterial | null;
  recipe: MeshGradientRecipeSpec;
  tagged?: boolean;
}
export interface MeshGradientRevisionInput {
  live: MeshGradientMaterial | null;
  next: MeshGradientRecipeSpec;
  previous: MeshGradientRecipeSpec;
}
export interface MeshGradientRevisionPlan {
  material?: MeshGradientMaterial | null;
  preserved: MeshGradientField[];
  recipe: MeshGradientRecipeSpec;
}
export interface MeshGradientUpdateInput {
  expectedFingerprint: string;
  live: MeshGradientMaterial | null;
  next: MeshGradientDeliveryInput;
  previous: MeshGradientDeliveryInput;
}
export interface MeshGradientUpdatePlan {
  delivery: MeshGradientDeliveryPlan | null;
  preserved: MeshGradientField[];
  previousDeliveryFingerprint: string | null;
  previousFingerprint: string;
  schema: "worldbend.mesh-gradient-update@0.1";
  sourceFingerprint: string;
  version: "0.1";
}
export interface MockupSpec {
  background?:
    | {
        kind: "transparent";
      }
    | {
        kind: "color";
        /**
         * @minItems 4
         * @maxItems 4
         */
        rgba: [number, number, number, number];
        space: Srgb8Space;
      };
  canvas: PixelSize;
  /**
   * Explicit output clip in normalized canvas coordinates. The composite is
   * masked to the covered region; clipping is the only meaning — the planes
   * are never reshaped to the contour.
   */
  clip?: MockupClip | null;
  planes: MockupPlane[];
  schema: string;
  seams?: MockupSeam[];
  version: string;
}
export interface MockupPlane {
  grid?: MockupGrid | null;
  id: string;
  measurement?: MockupPhysicalSize | null;
  opacity?: number;
  shadow?: MockupShadow | null;
  sourceId: string;
  surface?: MockupSurface | null;
  transform: TransformSpec1;
}
export interface MockupGrid {
  columns: number;
  rows: number;
}
export interface MockupPhysicalSize {
  height: number;
  unit: string;
  width: number;
}
export interface MockupShadow {
  blurSigmaPx: number;
  /**
   * @minItems 3
   * @maxItems 3
   */
  color: [number, number, number];
  /**
   * Offset in the authored scene canvas's pixels.
   */
  offset: {
    x: number;
    y: number;
  };
  opacity: number;
}
export interface MockupSurfaceLight {
  /**
   * -1 illuminates from the left, +1 from the right, 0 from the front.
   */
  direction: number;
  strength: number;
}
export interface MockupSurfaceLight1 {
  /**
   * -1 illuminates from the left, +1 from the right, 0 from the front.
   */
  direction: number;
  strength: number;
}
export interface MockupSeam {
  first: MockupEdgeRef;
  second: MockupEdgeRef;
  tolerancePixels?: number;
}
export interface MockupEdgeRef {
  edge: MockupEdge;
  planeId: string;
}
export interface FrameRate {
  denominator: number;
  numerator: number;
}
export interface MockupMotionSpec {
  background?:
    | {
        kind: "transparent";
      }
    | {
        kind: "color";
        /**
         * @minItems 4
         * @maxItems 4
         */
        rgba: [number, number, number, number];
        space: Srgb8Space;
      };
  canvas: PixelSize;
  clip?: MockupClip | null;
  frameCount: number;
  planes: MockupMotionPlane[];
  presentation?: MockupMotionPresentation | null;
  schema: "worldbend.mockup-motion";
  seams?: MockupSeam[];
  timebase: FrameRate;
  version: "0.1";
}
export interface MockupMotionPlane {
  base: TransformSpec1;
  grid?: MockupGrid | null;
  id: string;
  keyframes: MotionKeyframe[];
  measurement?: MockupPhysicalSize | null;
  opacity?: number;
  shadow?: MockupShadow | null;
  sourceId: string;
  surface?: MockupSurface | null;
}
export interface MotionKeyframe {
  easingToNext?: MotionEasing | null;
  frame: number;
  quad: Quad1;
}
export interface MockupMotionPresentation {
  /**
   * Optional whole-view motion in the transform destination coordinate space.
   */
  keyframes?: MotionKeyframe[];
  output: SpatialTemplateOutput;
  outputId: string;
  size: PixelSize1;
  transform: TransformSpec1;
}
/**
 * The explicit whole-scene raster viewport, before named output framing.
 */
export interface PixelSize1 {
  height: number;
  width: number;
}
export interface MockupMotionPosePlane {
  easingToNext?: MotionEasing | null;
  planeId: string;
  quad: Quad1;
}
export interface MockupMotionAuthoringOutput {
  changed: boolean;
  displayDuration: RationalTime;
  fingerprint: string;
  keyframeFrames: number[];
  previousFingerprint?: string | null;
  schema: "worldbend.mockup-motion-authoring";
  sourceIds: string[];
  spec: MockupMotionSpec;
  version: "0.1";
}
export interface RationalTime {
  denominator: number;
  numerator: number;
}
export interface MockupMotionPlan {
  canvas: PixelSize;
  cumulativeOutputPixels: number;
  cumulativeProcessingPixels?: number | null;
  duration: RationalTime1;
  /**
   * One ordinary mockup document per frame with interpolated plane quads.
   */
  frameSpecs: MockupSpec[];
  /**
   * @minItems 1
   * @maxItems 240
   */
  frames: [MotionFrameTiming, ...MotionFrameTiming[]];
  presentation?: MockupMotionPresentationPlan | null;
  presentationFrames?: MockupMotionPresentationPlan[];
  schema: "worldbend.mockup-motion-plan";
  sourceIds: string[];
  timebase: FrameRate;
  version: "0.1";
}
/**
 * Last presentation time (Motion semantics). Video display duration adds
 * the final frame interval separately.
 */
export interface RationalTime1 {
  denominator: number;
  numerator: number;
}
export interface MotionFrameTiming {
  easedProgress: number;
  id: string;
  index: number;
  linearProgress: number;
  presentationTime: RationalTime;
  segmentEndFrame: number;
  segmentStartFrame: number;
}
export interface MockupMotionPresentationPlan {
  canvas?: CanvasPlan | null;
  output: PixelSize;
  solve: SolveOutput1;
  spec: MockupMotionPresentation;
}
export interface MockupPlan {
  background: CanvasBackground;
  canvas: PixelSize;
  clip?: MockupClipPlan | null;
  planes: MockupPlanePlan[];
  schema: string;
  seams: MockupSeamPlan[];
  version: string;
}
export interface MockupPlanePlan {
  grid?: MockupGridPlan | null;
  id: string;
  measurement?: MockupMeasurement | null;
  opacity: number;
  shadow?: MockupShadowPlan | null;
  solve: SolveOutput1;
  sourceId: string;
  surface?: MockupSurface | null;
  transform: TransformSpec1;
}
export interface MockupGridPlan {
  columns: number;
  horizontal: MockupGridLine[];
  rows: number;
  vertical: MockupGridLine[];
}
export interface MockupGridLine {
  end: Point;
  points?: Point[] | null;
  start: Point;
}
export interface MockupMeasurement {
  bottomPixels: number;
  bottomPixelsPerUnit: number;
  height: number;
  leftPixels: number;
  leftPixelsPerUnit: number;
  rightPixels: number;
  rightPixelsPerUnit: number;
  topPixels: number;
  topPixelsPerUnit: number;
  unit: string;
  width: number;
}
export interface MockupShadowPlan {
  /**
   * Crop the blurred expanded alpha by this inset on both axes.
   */
  inset: number;
  profile: "worldbend.projected-alpha-shadow@0.1";
  sampleCanvas: PixelSize;
  shadow: MockupShadow;
  solve: SolveOutput1;
  transform: TransformSpec1;
}
export interface MockupSeamPlan {
  first: MockupEdgeRef;
  maximumErrorPixels: number;
  reversed: boolean;
  second: MockupEdgeRef;
  tolerancePixels: number;
}
/**
 * Actual protected carrier bases plus the current editable content extent.
 * A native Resize changes output clipping; a Scale changes content extent.
 */
export interface NativeAffineFrameState {
  /**
   * @minItems 2
   * @maxItems 2
   */
  innerBasis: [[number, number, number], [number, number, number]];
  orientation: SourceOrientation;
  /**
   * @minItems 2
   * @maxItems 2
   */
  outerBasis: [[number, number, number], [number, number, number]];
  outputSize: Size;
  sourceSize: Size;
}
export interface NativeFramePlanInput {
  outputSize: Size;
  sourceSize: Size1;
  spec: TransformSpec1;
}
/**
 * Actual current content units, including any prior native scaling.
 */
export interface Size1 {
  height: number;
  width: number;
}
export interface PlanePoseInput {
  elementSize: Size;
  pose: PlanePose;
}
export interface PlaneStripInput {
  destinationSize?: Size | null;
  /**
   * @minItems 1
   * @maxItems 32
   */
  panels: [PlaneStripPanel, ...PlaneStripPanel[]];
  spec: TransformSpec2;
}
/**
 * One front-facing unwarped shared plane. Each panel keeps its own source content.
 */
export interface TransformSpec2 {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface RectifyPlan {
  diagnostics: RectifyDiagnostics;
  homography: Homography;
  outputQuad: Quad1;
  outputSpec: TransformSpec1;
  resolvedSourceQuad: Quad1;
  spec: RectifySpec;
}
export interface RectifyDiagnostics {
  matrix: MatrixDiagnostics;
  outputBounds: Bounds;
  reprojection: ReprojectionDiagnostics;
  sourceGeometry: GeometryDiagnostics;
}
export interface RectifySpec {
  output: PixelSize;
  schema: "worldbend.rectify";
  source: SourcePlane;
  version: "0.1";
}
export interface RemapPlan {
  outputPixels: number;
  requiresMap: boolean;
  schema: string;
  spec: RemapSpec;
  version: string;
}
export interface RemapSpec {
  operation: RemapOperation;
  output: PixelSize;
  schema: string;
  version: string;
}
export interface Point6 {
  x: number;
  y: number;
}
export interface LensCoefficients {
  k1?: number;
  k2?: number;
  k3?: number;
  p1?: number;
  p2?: number;
}
export interface LensScale {
  x: number;
  y: number;
}
export interface Scene3DPlan {
  durationMs: number;
  fingerprint: string;
  samples: Scene3DSample[];
  schema: "worldbend.scene3d-plan";
  spec: Scene3DSpec;
  version: "0.1";
}
export interface Scene3DSample {
  frame: number;
  milliseconds: number;
  /**
   * Normalized imported clip progress. The last authored pose remains
   * displayed until the complete encoded duration; no implicit loop.
   */
  progress: number;
}
export interface Scene3DSpec {
  ambientIntensity: number;
  animation?: string | null;
  /**
   * @maxItems 16
   */
  artworks?:
    | []
    | [Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork, Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork]
    | [Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork, Scene3DArtwork]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ]
    | [
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork,
        Scene3DArtwork
      ];
  /**
   * @minItems 3
   * @maxItems 3
   */
  backgroundRgb: [number, number, number];
  /**
   * Exact exported camera object name; ambiguity is a receiving error.
   */
  camera: string;
  canvas: PixelSize;
  exposure: number;
  frameCount: number;
  sceneSlot: string;
  schema: "worldbend.scene3d";
  timebase: FrameRate;
  version: "0.1";
}
export interface Scene3DArtwork {
  fit: SceneArtworkFit;
  material: string;
  slotId: string;
  surfaceSize: PixelSize;
}
export interface ShapeFitDomain {
  contour: MockupClipContour;
  contourIndex?: number | null;
  kind: ShapeFitDomainKind;
}
export interface ShapeFitRefreshInput {
  clip: MockupClip;
  domain?: ShapeFitDomainChoice | null;
  shapeFit: ShapeFitControls;
}
/**
 * Authored domain choice, independent of the guide's current coordinates.
 */
export interface ShapeFitDomainChoice {
  contourIndex?: number | null;
  kind: ShapeFitDomainKind;
}
export interface ShapeFitRefreshOutput {
  domain: ShapeFitDomainChoice;
  shapeFit: ShapeFitControls;
}
export interface SourceCaptureFacts {
  captureOrigin: Point;
  captureScale: number;
  convention: SourceCaptureConvention;
  logicalSize: Size;
  /**
   * Logical source units -> the provider's capture coordinate space.
   *
   * @minItems 2
   * @maxItems 2
   */
  logicalToCaptureSpace: [[number, number, number], [number, number, number]];
  pixelSize: PixelSize2;
}
/**
 * Actual decoded header dimensions, not dimensions inferred from bounds.
 */
export interface PixelSize2 {
  height: number;
  width: number;
}
export interface SourceSamplingFrame {
  logicalSize: Size;
  /**
   * Logical normalized UV -> encoded texture normalized UV (pixel edges).
   *
   * @minItems 2
   * @maxItems 2
   */
  logicalUvToTextureUv: [[number, number, number], [number, number, number]];
  pixelSize: PixelSize;
  schema: SourceSamplingSchema;
  version: SourceSamplingVersion;
}
export interface SpatialDocumentAssemblyInput {
  /**
   * @minItems 1
   * @maxItems 64
   */
  assets: [SpatialDocumentAssemblyAsset, ...SpatialDocumentAssemblyAsset[]];
  /**
   * @minItems 2
   * @maxItems 32
   */
  documents: [SpatialDocumentAssemblyDocument, SpatialDocumentAssemblyDocument, ...SpatialDocumentAssemblyDocument[]];
  /**
   * @minItems 1
   * @maxItems 32
   */
  expressions: [SpatialDocumentAssemblyExpression, ...SpatialDocumentAssemblyExpression[]];
}
/**
 * Explicit caller assertion that source assets represent one durable asset.
 * Worldbend validates the assertion but never infers equivalence from names,
 * bytes, node IDs or geometry.
 */
export interface SpatialDocumentAssemblyAsset {
  contentVersion?: string | null;
  id: string;
  /**
   * @minItems 1
   * @maxItems 2048
   */
  members: [SpatialDocumentAssemblyAssetMember, ...SpatialDocumentAssemblyAssetMember[]];
}
export interface SpatialDocumentAssemblyAssetMember {
  assetId: string;
  documentId: string;
}
/**
 * One accepted source document. Assembly always guards the exact inspected
 * fingerprint so an Agent cannot accidentally combine stale projected work.
 */
export interface SpatialDocumentAssemblyDocument {
  document: SpatialDocumentSpec;
  expectedFingerprint: string;
  id: string;
}
export interface SpatialDocumentSpec {
  /**
   * @minItems 1
   * @maxItems 64
   */
  assets: [SpatialDocumentAsset, ...SpatialDocumentAsset[]];
  /**
   * @minItems 1
   * @maxItems 32
   */
  expressions: [SpatialDocumentExpression, ...SpatialDocumentExpression[]];
  schema: "worldbend.spatial-document";
  version: "0.1";
}
/**
 * A stable content identity. Carriers resolve bytes, URLs, DOM nodes or local
 * paths separately; those transport details do not enter document meaning.
 */
export interface SpatialDocumentAsset {
  /**
   * Optional caller-owned revision, digest or content version. It is
   * descriptive provenance, not a path and not verified by the core.
   */
  contentVersion?: string | null;
  id: string;
}
export interface SpatialDocumentBinding {
  assetId: string;
  role: SpatialDocumentBindingRole;
  slotId: string;
}
export interface SpatialTemplateSpec {
  operation: SpatialTemplateOperation;
  output: SpatialTemplateOutput;
  schema: "worldbend.spatial-template";
  version: "0.1";
}
export interface RasterProgramSpec {
  schema: "worldbend.raster-program";
  /**
   * @minItems 1
   * @maxItems 8
   */
  stages:
    | [RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ];
  version: "0.1";
}
export interface SurfaceDeformationSpec {
  /**
   * @maxItems 64
   */
  anchors?: DeformationAnchor[];
  /**
   * Fixed keeps the original rectangular boundary; free retains authored outline controls.
   */
  boundary?: "fixed" | "free";
  envelope: BezierEnvelope;
  meshSubdivisions?: number;
  schema: "worldbend.surface-deformation";
  /**
   * @maxItems 64
   */
  strokes?: DeformationStroke[];
  targetSize?: Size | null;
  transform: TransformSpec1;
  version: "0.1";
}
/**
 * Multi-plane device/scene Motion encoded with the same opaque MP4 profile as
 * single-source Video. Geometry comes from `MockupMotionSpec`; timing uses the
 * Video display-duration rule (includes the final frame interval).
 */
export interface MockupVideoSpec {
  /**
   * @minItems 3
   * @maxItems 3
   */
  backgroundRgb: [number, number, number];
  encoding: VideoEncoding;
  mockupMotion: MockupMotionSpec;
  schema: "worldbend.mockup-video";
  version: "0.1";
}
export interface SpatialDocumentAssemblyExpression {
  documentId: string;
  expressionId: string;
  id: string;
}
export interface SpatialDocumentAssemblyPlan {
  /**
   * @minItems 1
   * @maxItems 64
   */
  assets: [SpatialDocumentAssemblyAsset, ...SpatialDocumentAssemblyAsset[]];
  deliveryPlan: SpatialDocumentDeliveryPlan;
  document: SpatialDocumentSpec;
  /**
   * @minItems 2
   * @maxItems 32
   */
  documents: [
    SpatialDocumentAssemblyDocumentResult,
    SpatialDocumentAssemblyDocumentResult,
    ...SpatialDocumentAssemblyDocumentResult[]
  ];
  /**
   * @minItems 1
   * @maxItems 32
   */
  expressions: [SpatialDocumentAssemblyExpression, ...SpatialDocumentAssemblyExpression[]];
  schema: "worldbend.spatial-document-assembly-plan";
  version: "0.1";
}
export interface SpatialDocumentDeliveryPlan {
  /**
   * @minItems 1
   * @maxItems 32
   */
  deliveries: [SpatialDocumentDelivery, ...SpatialDocumentDelivery[]];
  documentFingerprint: string;
  schema: "worldbend.spatial-document-delivery-plan";
  version: "0.1";
}
export interface VariationJobSpec {
  failurePolicy?: "allOrNone" | "continue";
  /**
   * @minItems 1
   * @maxItems 64
   */
  items: [VariationJobItem, ...VariationJobItem[]];
  schema: "worldbend.variation-job";
  template: SpatialTemplateSpec;
  version: "0.1";
}
export interface VariationJobItem {
  /**
   * @minItems 1
   * @maxItems 16
   */
  bindings:
    | [VariationBinding]
    | [VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ];
  id: string;
}
export interface VariationBinding {
  assetId: string;
  slotId: string;
}
export interface SpatialDocumentAssemblyDocumentResult {
  fingerprint: string;
  id: string;
}
/**
 * Compile selected expressions into their existing execution contracts. An
 * omitted selection means every expression; a supplied selection remains in
 * canonical document order rather than caller presentation order.
 */
export interface SpatialDocumentDeliveryInput {
  document: SpatialDocumentSpec;
  expectedFingerprint?: string | null;
  /**
   * @minItems 1
   * @maxItems 32
   */
  expressionIds?: [string, ...string[]] | null;
}
export interface SpatialDocumentInspection {
  /**
   * @minItems 1
   * @maxItems 64
   */
  assets: [SpatialDocumentAsset, ...SpatialDocumentAsset[]];
  /**
   * @minItems 1
   * @maxItems 32
   */
  expressions: [SpatialDocumentExpressionInspection, ...SpatialDocumentExpressionInspection[]];
  fingerprint: string;
  schema: "worldbend.spatial-document-inspection";
  /**
   * @maxItems 64
   */
  unusedAssetIds: string[];
  version: "0.1";
}
export interface SpatialTemplateInspection {
  operation: SpatialTemplateOperationKind;
  output: SpatialTemplateOutputKind;
  /**
   * @minItems 1
   * @maxItems 16
   */
  outputs:
    | [SpatialTemplateOutputSummary]
    | [SpatialTemplateOutputSummary, SpatialTemplateOutputSummary]
    | [SpatialTemplateOutputSummary, SpatialTemplateOutputSummary, SpatialTemplateOutputSummary]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ];
  rasterProgram?: RasterProgramInspection | null;
  schema: "worldbend.spatial-template-inspection";
  /**
   * @minItems 1
   * @maxItems 16
   */
  sourceSlots:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  version: "0.1";
}
export interface SpatialTemplateOutputSummary {
  filename: string;
  id: string;
}
export interface RasterProgramInspection {
  /**
   * Required control rasters, deduplicated in stage first-use order.
   *
   * @maxItems 8
   */
  mapSlots?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  schema: "worldbend.raster-program-inspection";
  stageCount: number;
  /**
   * @minItems 1
   * @maxItems 8
   */
  stages:
    | [RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ];
  version: "0.1";
}
export interface RasterProgramStageSummary {
  id: string;
  kind: RasterProgramStageKind;
}
/**
 * The reusable media roles required to deliver one validated recipe. Media
 * bytes and paths stay in the carrier; this inspection makes their stable
 * identities available to a higher-level Spatial Document.
 */
export interface EffectRecipeInspection {
  /**
   * @maxItems 8
   */
  depthMapSlots:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  fingerprint: string;
  layerCount: number;
  schema: "worldbend.effect-recipe-inspection";
  /**
   * @minItems 1
   * @maxItems 16
   */
  sourceSlots:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  version: "1" | "2" | "3";
}
export interface SpatialDocumentUpdateInput {
  document: SpatialDocumentSpec;
  /**
   * Reject an update planned against a different accepted document.
   */
  expectedFingerprint?: string | null;
  /**
   * Replace complete expressions under their existing identity. Omitted
   * expressions and historical assets remain part of the same work.
   *
   * @maxItems 32
   */
  expressions?: SpatialDocumentExpression[];
  /**
   * Add distinct durable assets for explicit expression-local bindings.
   * Existing asset versions change only through `revisions`.
   *
   * @maxItems 64
   */
  newAssets?: SpatialDocumentAsset[];
  /**
   * @maxItems 64
   */
  revisions?: SpatialDocumentAssetRevision[];
}
/**
 * One explicit new content identity. `null` or an omitted `contentVersion`
 * clears the caller-owned revision without removing the durable asset.
 */
export interface SpatialDocumentAssetRevision {
  assetId: string;
  contentVersion?: string | null;
}
export interface SpatialDocumentUpdatePlan {
  /**
   * @maxItems 64
   */
  addedAssets: SpatialDocumentAsset[];
  /**
   * @maxItems 32
   */
  affectedExpressions: SpatialDocumentAffectedExpression[];
  changed: boolean;
  document: SpatialDocumentSpec;
  /**
   * @maxItems 32
   */
  expressionRevisions: SpatialDocumentExpressionRevisionResult[];
  fingerprint: string;
  previousFingerprint: string;
  /**
   * @maxItems 64
   */
  revisions: SpatialDocumentAssetRevisionResult[];
  schema: "worldbend.spatial-document-update-plan";
  version: "0.1";
}
export interface SpatialDocumentAffectedExpression {
  /**
   * @minItems 1
   * @maxItems 64
   */
  bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
  id: string;
  kind: SpatialDocumentExpressionKind;
}
export interface SpatialDocumentExpressionRevisionResult {
  changed: boolean;
  fingerprint: string;
  id: string;
  previousFingerprint: string;
}
export interface SpatialDocumentAssetRevisionResult {
  assetId: string;
  changed: boolean;
  contentVersion?: string | null;
  previousContentVersion?: string | null;
}
export interface SpatialInteractiveMediaBundleInput {
  /**
   * @minItems 1
   * @maxItems 64
   */
  bindings: [SpatialDocumentBinding, ...SpatialDocumentBinding[]];
  expressionId: string;
  initialState: EffectState;
  /**
   * @minItems 1
   * @maxItems 64
   */
  media: [SpatialInteractiveMedia, ...SpatialInteractiveMedia[]];
  recipe: EffectRecipe;
}
export interface SpatialInteractiveMedia {
  assetId: string;
  encodedBytes: number;
  format: SpatialInteractiveMediaFormat;
  height: number;
  sha256: string;
  width: number;
}
export interface SpatialInteractiveMediaBundle {
  deliveryPlan: SpatialDocumentDeliveryPlan;
  document: SpatialDocumentSpec;
  expressionId: string;
  fingerprint: string;
  initialState: EffectState;
  /**
   * @minItems 1
   * @maxItems 64
   */
  media: [SpatialInteractiveMedia, ...SpatialInteractiveMedia[]];
  schema: "worldbend.spatial-interactive-media-bundle";
  version: "0.1";
}
export interface SurfaceDeformationPlan {
  /**
   * @maxItems 64
   */
  anchors: ResolvedDeformationAnchor[];
  authoredView?: AuthoredMeshView | null;
  meshWarp: MeshWarpPlan;
  schema: "worldbend.surface-deformation-plan";
  spec: SurfaceDeformationSpec;
  strokeSampleCount: number;
  version: "0.1";
}
export interface TextureInspection {
  /**
   * Fields where live values differ from the seed. Empty unless the state
   * is `customized`.
   */
  customized: TextureField[];
  material: TextureMaterial2;
  recipeFingerprint: string;
  recipeId: string;
  recipeVersion: number;
  schema: "worldbend.texture-inspection@0.1";
  state: AppearanceInstanceState;
  version: "0.1";
}
/**
 * The seven portable texture controls. Field names follow the native effects:
 * grain maps the NOISE effect (density, size, color) and etch maps the
 * TEXTURE effect (radius, size, clip).
 */
export interface TextureMaterial2 {
  /**
   * Whether the etch follows the layer outline instead of its bounds.
   */
  clipToShape?: boolean;
  /**
   * Etch bump radius in `[0,1000]` logical pixels — the TEXTURE effect.
   */
  etch: number;
  /**
   * Etch cell size in `[0.5,1000]` logical pixels.
   */
  etchSize: number;
  /**
   * Grain density in `[0,1]` — the NOISE effect's density.
   */
  grain: number;
  /**
   * Grain tint, `#rrggbb`; the NOISE effect's primary color.
   */
  grainColor: string;
  /**
   * Grain cell size in `[0.5,1000]` logical pixels.
   */
  grainSize: number;
  visible?: boolean;
}
/**
 * One surface's reconciliation input: the stored seed plus the resolved live
 * material read from the host. `None` means neither native effect remains.
 */
export interface TextureInspectionInput {
  live?: TextureMaterial1 | null;
  recipe: TextureRecipeSpec;
  tagged?: boolean;
}
/**
 * Upgrade a seed while retaining changes made in the native editor.
 */
export interface TextureRevisionInput {
  live?: TextureMaterial1 | null;
  next: TextureRecipeSpec;
  previous: TextureRecipeSpec;
}
export interface TextureRevisionPlan {
  /**
   * None keeps a natively removed effect removed; application must be explicit.
   */
  material?: TextureMaterial1 | null;
  preserved: TextureField[];
  recipe: TextureRecipeSpec;
}
export interface TransformError {
  code: ErrorCode;
  details?: unknown;
  message: string;
}
export interface TransformRecipe {
  /**
   * Remove the base spec's warp. Mutually exclusive with `warp`.
   */
  clearWarp?: boolean;
  flip?: Flip2D;
  pivot?: Point7;
  /**
   * Clockwise screen-space rotation in degrees. Omit to keep zero rotation.
   */
  rotationDegrees?: number;
  scale?: Scale2D;
  skew?: Skew2D;
  translation?: Point8;
  /**
   * Optional bounded preset warp. Omit to preserve the base spec's warp.
   */
  warp?: WarpSpec | null;
}
/**
 * Explicit source-orientation flips. Omit to preserve orientation.
 */
export interface Flip2D {
  x?: boolean;
  y?: boolean;
}
/**
 * Pivot relative to the current destination bounds: (0,0) is top-left,
 * (0.5,0.5) is the default center, and (1,1) is bottom-right. These are
 * relative values, never destination pixel coordinates. Omit unless the
 * caller explicitly changes the pivot.
 */
export interface Point7 {
  x: number;
  y: number;
}
/**
 * Multipliers on the destination width and height. Omit to keep 1x scale.
 */
export interface Scale2D {
  x: number;
  y: number;
}
/**
 * Horizontal and vertical skew angles in degrees. Omit to keep zero skew.
 */
export interface Skew2D {
  xDegrees: number;
  yDegrees: number;
}
/**
 * Translation in resolved destination units. Omit to keep zero translation.
 */
export interface Point8 {
  x: number;
  y: number;
}
export interface VariationJobPlan {
  /**
   * @minItems 1
   * @maxItems 1024
   */
  assetIds: [string, ...string[]];
  failurePolicy: VariationFailurePolicy;
  /**
   * @minItems 1
   * @maxItems 64
   */
  items: [VariationJobItemPlan, ...VariationJobItemPlan[]];
  outputCount: number;
  schema: "worldbend.variation-job-plan";
  template: SpatialTemplateInspection;
  version: "0.1";
}
export interface VariationJobItemPlan {
  bindings: VariationBinding[];
  id: string;
}
export interface VectorArtworkProjectionInput {
  operation: VectorOperation;
  parts: VectorArtworkPart[];
  placement: Size;
  reference: Size;
  schema: "worldbend.vector-artwork";
  sourceBounds: Bounds;
  /**
   * Opt-in full geometry enclosure for a carrier's rounded appearance
   * rectangle. Logical/cropped windows must leave this absent.
   */
  sourceBoundsPolicy?: VectorArtworkSourceBoundsPolicy | null;
  tolerancePx?: number;
  version: "0.1";
}
export interface VectorArtworkPart {
  path: VectorPathSpec;
  /**
   * @minItems 6
   * @maxItems 6
   */
  sourceTransform: [number, number, number, number, number, number];
  stroke?: VectorStrokeSpec | null;
}
/**
 * Array bounds live in the code validation rather than the JSON Schema: a
 * tuple-shaped generated type would stop carriers from building inputs from
 * ordinary mapped arrays.
 */
export interface VectorPathSpec {
  regions: VectorPathRegion[];
  segments: VectorPathSegment[];
  vertices: VectorPathVertex[];
}
export interface VectorPathRegion {
  /**
   * Each loop lists segment indices forming one closed boundary; holes are
   * additional loops of the same region.
   */
  loops: number[][];
  windingRule: VectorWindingRule;
}
export interface VectorPathSegment {
  end: number;
  start: number;
  /**
   * Cubic handle relative to the end vertex.
   */
  tangentEnd?: Point | null;
  /**
   * Cubic handle relative to the start vertex; absent or zero means the
   * boundary is straight out of this vertex.
   */
  tangentStart?: Point | null;
}
export interface VectorPathVertex {
  x: number;
  y: number;
}
/**
 * Center-aligned stroke expanded into a fill outline before projection. The
 * weight is the full stroke width in path-space units; the carrier must
 * supply a path space that is isometric to the space in which the source
 * stroke renders with uniform width. Inside/outside alignment and dash
 * patterns are not representable in this shared model and stay on carrier
 * fallbacks.
 */
export interface VectorStrokeSpec {
  cap: VectorStrokeCap;
  join: VectorStrokeJoin;
  miterLimit: number;
  weight: number;
}
export interface VectorArtworkProjectionOutput {
  /**
   * The original target-domain mask projected at this job's placement and
   * tolerance. It follows H, not interior M, and shares the whole job meter.
   */
  clip?: VectorProjectionOutput | null;
  outputs: VectorProjectionOutput[];
  plan: VectorOperationPlan;
  sourceBounds?: Bounds | null;
  usage: VectorArtworkUsage;
}
export interface VectorProjectionOutput {
  bounds: Bounds2;
  network: VectorProjectionNetwork;
  report: VectorProjectionReport;
}
/**
 * Bounds of the emitted geometry in placement-relative result pixels.
 */
export interface Bounds2 {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface VectorProjectionNetwork {
  regions: VectorPathRegion[];
  segments: VectorPathSegment[];
  vertices: VectorPathVertex[];
}
export interface VectorProjectionReport {
  fidelity: VectorProjectionFidelity;
  inputRegions: number;
  inputSegments: number;
  inputVertices: number;
  /**
   * Proven upper bound on target-space deviation, in placement pixels.
   * `None` means every emitted boundary is mathematically exact.
   */
  maxError?: number | null;
  maxSubdivisionDepth: number;
  outputRegions: number;
  outputSegments: number;
  outputVertices: number;
  reasons: VectorProjectionLossReason[];
  strokeChains?: number | null;
  strokeOutlined: boolean;
  tolerancePx: number;
}
export interface VectorOperationPlan {
  clip?: MockupClipPlan | null;
  /**
   * Expanded executable plane, distinct from the complete authored operation.
   */
  executionFrame?: VectorExecutionFrame | null;
  /**
   * @minItems 9
   * @maxItems 9
   */
  homography: [number, number, number, number, number, number, number, number, number];
  mesh?: WarpMesh | null;
  reference: Size;
}
export interface VectorExecutionFrame {
  reference: Size;
  transform: TransformSpec1;
}
export interface VectorArtworkUsage {
  curvePieces: number;
  faceVisits: number;
  inputBytes: number;
  inputLoopReferences: number;
  inputRegions: number;
  inputSegments: number;
  inputVertices: number;
  outputBytes: number;
  outputLoopReferences: number;
  outputRegions: number;
  outputSegments: number;
  outputVertices: number;
  parts: number;
  sourceExtentNodes?: number;
  strokePairs: number;
  workUnits: number;
}
export interface VectorOperationInput {
  operation: VectorOperation;
  reference: Size2;
  schema: "worldbend.vector-operation";
  version: "0.1";
}
/**
 * Explicit homography reference canvas, independent of logical placement.
 */
export interface Size2 {
  height: number;
  width: number;
}
export interface VectorProjectionInput {
  /**
   * Core-solved forward homography from the normalized source plane to
   * reference pixels. No second solver is involved anywhere in this module.
   *
   * @minItems 9
   * @maxItems 9
   */
  homography: [number, number, number, number, number, number, number, number, number];
  /**
   * Version 0.2 only: the validated canonical source-to-warped mesh,
   * applied before the homography. Omission retains the 0.1 operation.
   */
  mesh?: GridWarpMesh | TriangleWarpMesh;
  path: VectorPathSpec;
  placement: Size;
  reference: Size;
  schema: "worldbend.vector-projection";
  sourceBounds: Bounds3;
  /**
   * Affine map from path space to document space, row-major
   * `[a b c d e f]` for rows `[a b c; d e f]`.
   *
   * @minItems 6
   * @maxItems 6
   */
  sourceTransform: [number, number, number, number, number, number];
  stroke?: VectorStrokeSpec | null;
  /**
   * Target-space pixel budget for every approximation this module emits.
   */
  tolerancePx?: number;
  version: "0.1" | "0.2";
}
/**
 * Document-space axis-aligned bounds of the path; the path is normalized
 * onto the core source plane through these bounds before the homography.
 */
export interface Bounds3 {
  height: number;
  width: number;
  x: number;
  y: number;
}
