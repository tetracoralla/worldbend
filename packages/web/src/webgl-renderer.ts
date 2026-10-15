import type { MockupClipPlan, Point, PreviewSolveOutput, WarpMesh, WarpVertex } from "./types";
import { paintClipMask } from "./clip-canvas";
import { MAX_INDEXED_MESH_TRIANGLES, validateMeshTopology, type MeshTopology } from "./mesh-topology";
import type { SourceSamplingFrame } from "./generated/core-contract";

const vertexShaderSource = `#version 300 es
in vec2 warpedPosition;
in vec2 sourcePosition;
in float vertexShading;
uniform mat3 forwardH;
uniform vec2 canvasSize;
out vec2 sourceUv;
out float surfaceShading;
void main() {
  vec3 projected = forwardH * vec3(warpedPosition, 1.0);
  vec2 destination = projected.xy / projected.z;
  vec2 ndc = vec2(
    destination.x / canvasSize.x * 2.0 - 1.0,
    1.0 - destination.y / canvasSize.y * 2.0
  );
  gl_Position = vec4(ndc * projected.z, 0.0, projected.z);
  sourceUv = sourcePosition;
  surfaceShading = vertexShading;
}`;

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform sampler2D sourceTexture;
uniform bool highQuality;
uniform sampler2D clipTexture;
uniform bool hasClip;
uniform mat3 sourceMap;
uniform vec2 canvasSize;
in vec2 sourceUv;
in float surfaceShading;
out vec4 outputColor;

vec4 catmullRomWeights(float fraction) {
  float f2 = fraction * fraction;
  float f3 = f2 * fraction;
  return vec4(
    -0.5 * fraction + f2 - 0.5 * f3,
    1.0 - 2.5 * f2 + 1.5 * f3,
    0.5 * fraction + 2.0 * f2 - 1.5 * f3,
    -0.5 * f2 + 0.5 * f3
  );
}

vec4 catmullRomSample(vec2 uv) {
  vec2 size = vec2(textureSize(sourceTexture, 0));
  vec2 texel = uv * size - 0.5;
  vec2 base = floor(texel);
  vec2 fraction = texel - base;
  vec4 weightsX = catmullRomWeights(fraction.x);
  vec4 weightsY = catmullRomWeights(fraction.y);
  vec3 combinedX = vec3(weightsX.x, weightsX.y + weightsX.z, weightsX.w);
  vec3 combinedY = vec3(weightsY.x, weightsY.y + weightsY.z, weightsY.w);
  vec3 offsetX = vec3(-1.0, weightsX.z / combinedX.y, 2.0);
  vec3 offsetY = vec3(-1.0, weightsY.z / combinedY.y, 2.0);
  vec4 result = vec4(0.0);
  for (int y = 0; y < 3; y += 1) {
    for (int x = 0; x < 3; x += 1) {
      vec2 sampleUv = (base + vec2(offsetX[x], offsetY[y]) + 0.5) / size;
      result += textureLod(sourceTexture, sampleUv, 0.0) * combinedX[x] * combinedY[y];
    }
  }
  result = clamp(result, 0.0, 1.0);
  result.rgb = min(result.rgb, vec3(result.a));
  return result;
}

void main() {
  // Evaluate derivatives AND mip sampling before non-uniform UV/quality
  // branches. Sampling inside them can select coarse mip levels at the plane
  // boundary and bleed unrelated interior colors into an otherwise pale edge.
  vec2 textureUv = (sourceMap * vec3(sourceUv, 1.0)).xy;
  vec2 uvDx = dFdx(textureUv);
  vec2 uvDy = dFdy(textureUv);
  vec2 size = vec2(textureSize(sourceTexture, 0));
  float footprint = max(length(uvDx * size), length(uvDy * size));
  vec4 filtered = texture(sourceTexture, textureUv);
  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    outputColor = vec4(0.0);
  } else {
    outputColor = highQuality && footprint <= 1.0
      ? catmullRomSample(textureUv)
      : filtered;
    outputColor.rgb = min(outputColor.rgb * surfaceShading, vec3(outputColor.a));
    if (hasClip) {
      vec2 clipUv = vec2(gl_FragCoord.x, canvasSize.y - gl_FragCoord.y) / canvasSize;
      outputColor *= texture(clipTexture, clipUv).a;
    }
  }
}`;

export type WebGLSamplingQuality = "preview" | "high";

export interface TransformWebGLRendererOptions {
  preserveDrawingBuffer?: boolean;
  /**
   * Request multisampled geometry antialiasing. Slanted silhouettes show
   * stair steps without it; a driver that cannot provide it falls back to the
   * previous aliased raster instead of failing. Texture filtering is separate
   * and already covered by the high-quality sampling path.
   */
  antialias?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class TransformWebGLRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly maximumTextureSize: number;
  /** Whether the host actually granted the requested multisampled raster. */
  readonly antialiasActive: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly forwardMatrix = new Float32Array(9);
  private program: WebGLProgram | undefined;
  private texture: WebGLTexture | undefined;
  private clipTexture: WebGLTexture | undefined;
  private clipCanvas: HTMLCanvasElement | undefined;
  private clipKey: string | undefined;
  private buffer: WebGLBuffer | undefined;
  private uniforms:
    | {
        sourceTexture: WebGLUniformLocation;
        canvasSize: WebGLUniformLocation;
        forwardH: WebGLUniformLocation;
        highQuality: WebGLUniformLocation;
        clipTexture: WebGLUniformLocation;
        hasClip: WebGLUniformLocation;
        sourceMap: WebGLUniformLocation;
      }
    | undefined;
  private source: TexImageSource | undefined;
  private textureAnisotropy: { parameter: number; maximum: number } | undefined;
  private contextLost = false;
  private disposed = false;
  private uploadedWarpMesh: WarpMesh | undefined;
  private geometryInitialized = false;
  private geometryCapacityBytes = 0;
  private geometryVertexCount = 0;
  private geometryVertexData: Float32Array | undefined;

  constructor(
    canvas: HTMLCanvasElement = document.createElement("canvas"),
    private readonly options: TransformWebGLRendererOptions = {},
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: options.antialias ?? true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 is required for interactive projective preview");
    this.gl = gl;
    this.antialiasActive = Boolean(gl.getContextAttributes()?.antialias);
    this.maximumTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    this.initializeResources();
  }

  render(
    source: TexImageSource,
    solved: PreviewSolveOutput,
    warpMesh?: WarpMesh,
    quality: WebGLSamplingQuality = "preview",
    clip?: MockupClipPlan,
    sourceView?: SourceSamplingFrame,
  ): void {
    this.assertAvailable();
    // The frame is core-planned/validated by the receiver. The renderer owns
    // only decoded resource compatibility and finite GPU representation.
    const sourceMap = sourceSamplingUniform(source, sourceView);
    const { width, height } = solved.resolvedDestination.reference;
    const outputWidth = Math.max(1, Math.round(width));
    const outputHeight = Math.max(1, Math.round(height));
    this.assertTextureDimensions(outputWidth, outputHeight, "output");
    this.uploadSourceIfNeeded(source);

    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth;
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight;
    this.uploadClipIfNeeded(clip, outputWidth, outputHeight);
    const { gl } = this;
    const program = this.program ?? fail("Preview program is unavailable");
    const texture = this.texture ?? fail("Preview texture is unavailable");
    const uniforms = this.uniforms ?? fail("Preview uniforms are unavailable");
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms.sourceTexture, 0);
    gl.uniform1i(uniforms.clipTexture, 1);
    gl.uniform1i(uniforms.hasClip, clip ? 1 : 0);
    gl.uniform1i(uniforms.highQuality, quality === "high" ? 1 : 0);
    gl.uniformMatrix3fv(uniforms.sourceMap, false, sourceMap);
    gl.uniform2f(uniforms.canvasSize, outputWidth, outputHeight);
    gl.uniformMatrix3fv(
      uniforms.forwardH,
      false,
      rowMajorToColumnMajor(solved.homography.matrix, this.forwardMatrix),
    );
    const vertexCount = this.uploadGeometryIfNeeded(warpMesh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  invalidateSource(): void {
    this.source = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.deleteResources();
    this.source = undefined;
    this.releaseClipCanvas();
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) return;
    this.contextLost = true;
    this.source = undefined;
    // A restored context invalidates the old resource handles. Deleting them
    // during reinitialization would raise a GL error in the new context.
    this.program = undefined;
    this.texture = undefined;
    this.clipTexture = undefined;
    this.clipKey = undefined;
    this.buffer = undefined;
    this.uniforms = undefined;
    this.options.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    try {
      this.initializeResources();
    } catch {
      // Resource re-creation can fail inside the restore event; the next
      // render reports it through the missing-resource guards instead of
      // throwing uncaught from a DOM event listener.
      return;
    }
    this.options.onContextRestored?.();
  };

  private initializeResources(): void {
    this.deleteResources();
    const { gl } = this;
    this.program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    this.texture = gl.createTexture() ?? fail("Unable to create source texture");
    this.clipTexture = gl.createTexture() ?? fail("Unable to create clip texture");
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.clipTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
    gl.activeTexture(gl.TEXTURE0);
    this.buffer = gl.createBuffer() ?? fail("Unable to create preview geometry");
    this.uploadedWarpMesh = undefined;
    this.geometryInitialized = false;
    this.geometryCapacityBytes = 0;
    this.geometryVertexCount = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const warpedLocation = gl.getAttribLocation(this.program, "warpedPosition");
    const sourceLocation = gl.getAttribLocation(this.program, "sourcePosition");
    const shadingLocation = gl.getAttribLocation(this.program, "vertexShading");
    if (warpedLocation < 0 || sourceLocation < 0 || shadingLocation < 0) fail("Unable to locate preview geometry");
    gl.enableVertexAttribArray(warpedLocation);
    gl.vertexAttribPointer(warpedLocation, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(sourceLocation);
    gl.vertexAttribPointer(sourceLocation, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(shadingLocation);
    gl.vertexAttribPointer(shadingLocation, 1, gl.FLOAT, false, 20, 16);
    this.uniforms = {
      sourceTexture: requiredUniform(gl, this.program, "sourceTexture"),
      canvasSize: requiredUniform(gl, this.program, "canvasSize"),
      forwardH: requiredUniform(gl, this.program, "forwardH"),
      highQuality: requiredUniform(gl, this.program, "highQuality"),
      clipTexture: requiredUniform(gl, this.program, "clipTexture"),
      hasClip: requiredUniform(gl, this.program, "hasClip"),
      sourceMap: requiredUniform(gl, this.program, "sourceMap"),
    };
    // Query the anisotropy ceiling once per context lifetime instead of on
    // every upload; it is re-cached here on context restore.
    const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic") as
      | {
          TEXTURE_MAX_ANISOTROPY_EXT: number;
          MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
        }
      | null;
    this.textureAnisotropy = anisotropy
      ? {
          parameter: anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
          maximum: Number(gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
        }
      : undefined;
    assertNoWebGlError(gl, "Unable to initialize preview geometry");
  }

  private uploadSourceIfNeeded(source: TexImageSource): void {
    // Only immutable sources may reuse an uploaded texture: a canvas or video
    // keeps mutating in place, so identity comparison would freeze frame zero.
    if (source === this.source && isImmutableSource(source)) return;
    const dimensions = sourceDimensions(source);
    if (dimensions) {
      this.assertTextureDimensions(dimensions.width, dimensions.height, "source");
    }
    const { gl } = this;
    const texture = this.texture ?? fail("Preview texture is unavailable");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // TransformSpec uses a top-left origin. With HTML image sources, leaving
    // upload rows unflipped makes texture v=0 address the source's top row.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stageImageForUpload(source));
    gl.generateMipmap(gl.TEXTURE_2D);
    const anisotropy = this.textureAnisotropy;
    if (anisotropy) {
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.parameter, Math.min(4, anisotropy.maximum));
    }
    assertNoWebGlError(gl, "Unable to upload the source image");
    this.source = source;
  }

  private uploadClipIfNeeded(clip: MockupClipPlan | undefined, width: number, height: number): void {
    if (!clip) {
      if (this.clipCanvas) {
        this.releaseClipCanvas();
        this.clipKey = undefined;
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.clipTexture ?? fail("Clip texture is unavailable"));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
        assertNoWebGlError(gl, "Unable to release the projected shape mask");
      }
      return;
    }
    const key = JSON.stringify([width, height, clip.contours, clip.fillRule, clip.regions]);
    if (key === this.clipKey) return;
    const canvas = this.clipCanvas ??= document.createElement("canvas");
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) fail("Unable to create the projected shape mask");
    paintClipMask(context, clip, canvas);
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.clipTexture ?? fail("Clip texture is unavailable"));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    assertNoWebGlError(gl, "Unable to upload the projected shape mask");
    this.clipKey = key;
  }

  private releaseClipCanvas(): void {
    if (!this.clipCanvas) return;
    this.clipCanvas.width = 1;
    this.clipCanvas.height = 1;
    this.clipCanvas = undefined;
  }

  private uploadGeometryIfNeeded(warpMesh?: WarpMesh): number {
    if (this.geometryInitialized && warpMesh === this.uploadedWarpMesh) {
      return this.geometryVertexCount;
    }
    let vertices: Float32Array;
    let floatCount: number;
    if (warpMesh) {
      // One bounded CPU staging buffer survives continuous Warp/custom-Mesh
      // updates, including declared indexed faces and surface lighting.
      // The shared face ceiling bounds the buffer throughout its lifetime.
      this.geometryVertexData ??= new Float32Array(MAX_WARP_MESH_FLOATS);
      vertices = this.geometryVertexData;
      floatCount = writeWarpMeshVertexData(warpMesh, vertices, true);
    } else {
      vertices = unitMeshVertexData;
      floatCount = vertices.length;
    }
    const uploadBytes = floatCount * Float32Array.BYTES_PER_ELEMENT;
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer ?? fail("Preview geometry is unavailable"));
    if (uploadBytes <= this.geometryCapacityBytes) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, floatCount);
    } else {
      const capacityBytes = warpMesh ? vertices.byteLength : uploadBytes;
      gl.bufferData(gl.ARRAY_BUFFER, capacityBytes, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, floatCount);
      this.geometryCapacityBytes = capacityBytes;
    }
    this.uploadedWarpMesh = warpMesh;
    this.geometryInitialized = true;
    this.geometryVertexCount = floatCount / 5;
    assertNoWebGlError(gl, "Unable to upload preview geometry");
    return this.geometryVertexCount;
  }

  private assertTextureDimensions(width: number, height: number, label: string): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error(`The ${label} image has invalid dimensions`);
    }
    if (width > this.maximumTextureSize || height > this.maximumTextureSize) {
      throw new Error(
        `The ${label} image exceeds this device's ${this.maximumTextureSize} px WebGL limit`,
      );
    }
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("The perspective renderer has been disposed");
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error("The perspective preview lost its graphics context. Try again.");
    }
  }

  private deleteResources(): void {
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.clipTexture) this.gl.deleteTexture(this.clipTexture);
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.program = undefined;
    this.texture = undefined;
    this.clipTexture = undefined;
    this.clipKey = undefined;
    this.buffer = undefined;
    this.uniforms = undefined;
    this.uploadedWarpMesh = undefined;
    this.geometryInitialized = false;
    this.geometryCapacityBytes = 0;
    this.geometryVertexCount = 0;
    this.geometryVertexData = undefined;
  }
}

const unitMeshVertices: readonly WarpVertex[] = [
  { source: { x: 0, y: 0 }, warped: { x: 0, y: 0 } },
  { source: { x: 1, y: 0 }, warped: { x: 1, y: 0 } },
  { source: { x: 1, y: 1 }, warped: { x: 1, y: 1 } },
  { source: { x: 0, y: 1 }, warped: { x: 0, y: 1 } },
];

const MAX_WARP_MESH_FLOATS = MAX_INDEXED_MESH_TRIANGLES * 3 * 5;

export function warpMeshVertexData(mesh?: WarpMesh): Float32Array {
  const topology = mesh ? validateMeshTopology(mesh) : undefined;
  const output = new Float32Array((topology?.triangles.length ?? 2) * 3 * 4);
  writeMeshGeometry(mesh, topology, output, false);
  return output;
}

/** Fill caller-owned geometry storage and return the written float count. */
export function writeWarpMeshVertexData(mesh: WarpMesh | undefined, output: Float32Array, includeShading = false): number {
  return writeMeshGeometry(mesh, mesh ? validateMeshTopology(mesh) : undefined, output, includeShading);
}

function writeMeshGeometry(mesh: WarpMesh | undefined, topology: MeshTopology | undefined, output: Float32Array, includeShading: boolean): number {
  const indices = topology?.triangles ?? [[0,1,2],[0,2,3]];
  const vertices = mesh?.vertices ?? unitMeshVertices;
  const floatCount = indices.length * 3 * (includeShading ? 5 : 4);
  if (output.length < floatCount) throw new Error("The warp mesh geometry buffer is too small");
  let offset = 0;
  for (const triangle of indices) for (const index of triangle) {
    const vertex = vertices[index]!;
    output[offset++] = vertex.warped.x;
    output[offset++] = vertex.warped.y;
    output[offset++] = vertex.source.x;
    output[offset++] = vertex.source.y;
    if (includeShading) output[offset++] = mesh?.shading?.[index] ?? 1;
  }
  return floatCount;
}

const unitMeshVertexData = new Float32Array(2 * 3 * 5);
writeWarpMeshVertexData(undefined, unitMeshVertexData, true);

function assertFinitePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("The warp mesh contains a non-finite point");
  }
}

export function sourceDimensions(source: TexImageSource): { width: number; height: number } | undefined {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (
    source instanceof HTMLCanvasElement ||
    source instanceof ImageBitmap ||
    source instanceof ImageData ||
    (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas)
  ) {
    return { width: source.width, height: source.height };
  }
  return undefined;
}

function isImmutableSource(source: TexImageSource): boolean {
  return source instanceof HTMLImageElement || source instanceof ImageBitmap;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram() ?? fail("Unable to create WebGL program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unable to link WebGL program";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type) ?? fail("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unable to compile WebGL shader";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  return gl.getUniformLocation(program, name) ?? fail(`Unable to locate ${name}`);
}

function assertNoWebGlError(gl: WebGL2RenderingContext, message: string): void {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`${message} (WebGL ${error})`);
}

function rowMajorToColumnMajor(values: readonly number[], target: Float32Array): Float32Array {
  target[0] = values[0] ?? 0;
  target[1] = values[3] ?? 0;
  target[2] = values[6] ?? 0;
  target[3] = values[1] ?? 0;
  target[4] = values[4] ?? 0;
  target[5] = values[7] ?? 0;
  target[6] = values[2] ?? 0;
  target[7] = values[5] ?? 0;
  target[8] = values[8] ?? 1;
  return target;
}

function fail(message: string): never {
  throw new Error(message);
}

const identitySourceMap = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function sourceSamplingUniform(source: TexImageSource, view?: SourceSamplingFrame): Float32Array {
  if (!view) return identitySourceMap;
  const dimensions = sourceDimensions(source);
  const m = view.logicalUvToTextureUv;
  if (view.schema !== "worldbend.source-sampling" || view.version !== "0.1" ||
      !Array.isArray(m) || m.length !== 2 || m.some(row => !Array.isArray(row) || row.length !== 3) ||
      !m.flat().every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))) ||
      ![view.logicalSize.width, view.logicalSize.height].every(value => Number.isFinite(value) && value > 0) ||
      ![view.pixelSize.width, view.pixelSize.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Invalid source sampling frame");
  }
  if (!dimensions || dimensions.width !== view.pixelSize.width || dimensions.height !== view.pixelSize.height) {
    throw new Error("Source sampling frame does not match the decoded image");
  }
  return new Float32Array([m[0]![0]!, m[1]![0]!, 0, m[0]![1]!, m[1]![1]!, 0, m[0]![2]!, m[1]![2]!, 1]);
}

/**
 * Some embedded and headless host builds reject texImage2D from blob-backed
 * image elements with INVALID_VALUE (observed as WebGL 1281 across context
 * attributes, timings, and warmed contexts, while canvas and ImageBitmap
 * sources upload cleanly). Staging a decoded image element through a canvas
 * costs one draw per source and sidesteps the whole class; other source
 * kinds pass through untouched.
 */
function stageImageForUpload(source: TexImageSource): TexImageSource {
  if (typeof HTMLImageElement === "undefined" || !(source instanceof HTMLImageElement)) return source;
  // Staging draws the element's current pixels; an image that has not
  // finished loading would stage a blank texture, so hand it to the GL
  // upload path unchanged and let its own decode semantics apply.
  if (!source.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0) return source;
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return source;
  context.drawImage(source, 0, 0);
  return canvas;
}
