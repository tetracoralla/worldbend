import type { Point, PreviewSolveOutput, WarpMesh, WarpVertex } from "./types";

const vertexShaderSource = `#version 300 es
in vec2 warpedPosition;
in vec2 sourcePosition;
uniform mat3 forwardH;
uniform vec2 canvasSize;
out vec2 sourceUv;
void main() {
  vec3 projected = forwardH * vec3(warpedPosition, 1.0);
  vec2 destination = projected.xy / projected.z;
  vec2 ndc = vec2(
    destination.x / canvasSize.x * 2.0 - 1.0,
    1.0 - destination.y / canvasSize.y * 2.0
  );
  gl_Position = vec4(ndc * projected.z, 0.0, projected.z);
  sourceUv = sourcePosition;
}`;

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform sampler2D sourceTexture;
uniform bool highQuality;
in vec2 sourceUv;
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
  vec2 uvDx = dFdx(sourceUv);
  vec2 uvDy = dFdy(sourceUv);
  vec2 size = vec2(textureSize(sourceTexture, 0));
  float footprint = max(length(uvDx * size), length(uvDy * size));
  vec4 filtered = texture(sourceTexture, sourceUv);
  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    outputColor = vec4(0.0);
  } else {
    outputColor = highQuality && footprint <= 1.0
      ? catmullRomSample(sourceUv)
      : filtered;
  }
}`;

export type WebGLSamplingQuality = "preview" | "high";

export interface TransformWebGLRendererOptions {
  preserveDrawingBuffer?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class TransformWebGLRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly maximumTextureSize: number;
  private readonly gl: WebGL2RenderingContext;
  private readonly forwardMatrix = new Float32Array(9);
  private program: WebGLProgram | undefined;
  private texture: WebGLTexture | undefined;
  private buffer: WebGLBuffer | undefined;
  private uniforms:
    | {
        sourceTexture: WebGLUniformLocation;
        canvasSize: WebGLUniformLocation;
        forwardH: WebGLUniformLocation;
        highQuality: WebGLUniformLocation;
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
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error("WebGL2 is required for interactive projective preview");
    this.gl = gl;
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
  ): void {
    this.assertAvailable();
    const { width, height } = solved.resolvedDestination.reference;
    const outputWidth = Math.max(1, Math.round(width));
    const outputHeight = Math.max(1, Math.round(height));
    this.assertTextureDimensions(outputWidth, outputHeight, "output");
    this.uploadSourceIfNeeded(source);

    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth;
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight;
    const { gl } = this;
    const program = this.program ?? fail("Preview program is unavailable");
    const texture = this.texture ?? fail("Preview texture is unavailable");
    const uniforms = this.uniforms ?? fail("Preview uniforms are unavailable");
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms.sourceTexture, 0);
    gl.uniform1i(uniforms.highQuality, quality === "high" ? 1 : 0);
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
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) return;
    this.contextLost = true;
    this.source = undefined;
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
    this.buffer = gl.createBuffer() ?? fail("Unable to create preview geometry");
    this.uploadedWarpMesh = undefined;
    this.geometryInitialized = false;
    this.geometryCapacityBytes = 0;
    this.geometryVertexCount = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const warpedLocation = gl.getAttribLocation(this.program, "warpedPosition");
    const sourceLocation = gl.getAttribLocation(this.program, "sourcePosition");
    if (warpedLocation < 0 || sourceLocation < 0) fail("Unable to locate preview geometry");
    gl.enableVertexAttribArray(warpedLocation);
    gl.vertexAttribPointer(warpedLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(sourceLocation);
    gl.vertexAttribPointer(sourceLocation, 2, gl.FLOAT, false, 16, 8);
    this.uniforms = {
      sourceTexture: requiredUniform(gl, this.program, "sourceTexture"),
      canvasSize: requiredUniform(gl, this.program, "canvasSize"),
      forwardH: requiredUniform(gl, this.program, "forwardH"),
      highQuality: requiredUniform(gl, this.program, "highQuality"),
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
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // TransformSpec uses a top-left origin. With HTML image sources, leaving
    // upload rows unflipped makes texture v=0 address the source's top row.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    const anisotropy = this.textureAnisotropy;
    if (anisotropy) {
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.parameter, Math.min(4, anisotropy.maximum));
    }
    assertNoWebGlError(gl, "Unable to upload the source image");
    this.source = source;
  }

  private uploadGeometryIfNeeded(warpMesh?: WarpMesh): number {
    if (this.geometryInitialized && warpMesh === this.uploadedWarpMesh) {
      return this.geometryVertexCount;
    }
    let vertices: Float32Array;
    let floatCount: number;
    if (warpMesh) {
      // One bounded CPU staging buffer survives continuous Warp/custom-Mesh
      // updates. The mesh resolution is capped at 16x16, so a changing mesh no
      // longer allocates a new ~24 KiB Float32Array on every rendered sample.
      this.geometryVertexData ??= new Float32Array(MAX_WARP_MESH_FLOATS);
      vertices = this.geometryVertexData;
      floatCount = writeWarpMeshVertexData(warpMesh, vertices);
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
    this.geometryVertexCount = floatCount / 4;
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
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.program = undefined;
    this.texture = undefined;
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

const MIN_MESH_SUBDIVISIONS = 2;
const MAX_MESH_SUBDIVISIONS = 16;
const MAX_WARP_MESH_FLOATS = MAX_MESH_SUBDIVISIONS ** 2 * 2 * 3 * 4;

export function warpMeshVertexData(mesh?: WarpMesh): Float32Array {
  const subdivisions = validatedMeshSubdivisions(mesh);
  const triangleCount = mesh ? subdivisions ** 2 * 2 : 2;
  const output = new Float32Array(triangleCount * 3 * 4);
  writeWarpMeshVertexData(mesh, output);
  return output;
}

/** Fill caller-owned geometry storage and return the written float count. */
export function writeWarpMeshVertexData(
  mesh: WarpMesh | undefined,
  output: Float32Array,
): number {
  // Validate the complete topology before using caller-reachable dimensions
  // in an allocation. Preset Warp supplies the canonical 16x16 mesh while the
  // custom Mesh contract supplies a core-validated 2..16 grid.
  const subdivisions = validatedMeshSubdivisions(mesh);
  const side = subdivisions + 1;
  const triangleCount = mesh ? subdivisions ** 2 * 2 : 2;
  const floatCount = triangleCount * 3 * 4;
  if (output.length < floatCount) {
    throw new Error("The warp mesh geometry buffer is too small");
  }
  let offset = 0;
  const append = (vertex: WarpVertex): void => {
    assertFinitePoint(vertex.warped);
    assertFinitePoint(vertex.source);
    output[offset++] = vertex.warped.x;
    output[offset++] = vertex.warped.y;
    output[offset++] = vertex.source.x;
    output[offset++] = vertex.source.y;
  };
  const appendTriangle = (a: WarpVertex, b: WarpVertex, c: WarpVertex): void => {
    append(a);
    append(b);
    append(c);
  };
  if (!mesh) {
    appendTriangle(unitMeshVertices[0]!, unitMeshVertices[1]!, unitMeshVertices[2]!);
    appendTriangle(unitMeshVertices[0]!, unitMeshVertices[2]!, unitMeshVertices[3]!);
    return floatCount;
  }
  const vertex = (x: number, y: number): WarpVertex =>
    mesh.vertices[y * side + x] ?? fail("The warp mesh is incomplete");
  for (let y = 0; y < mesh.subdivisions; y += 1) {
    for (let x = 0; x < mesh.subdivisions; x += 1) {
      const tl = vertex(x, y);
      const tr = vertex(x + 1, y);
      const br = vertex(x + 1, y + 1);
      const bl = vertex(x, y + 1);
      assertCoreSourceVertex(tl, x, y, mesh.subdivisions);
      assertCoreSourceVertex(tr, x + 1, y, mesh.subdivisions);
      assertCoreSourceVertex(br, x + 1, y + 1, mesh.subdivisions);
      assertCoreSourceVertex(bl, x, y + 1, mesh.subdivisions);
      assertFixedBoundary(tl, x, y, mesh.subdivisions);
      assertFixedBoundary(tr, x + 1, y, mesh.subdivisions);
      assertFixedBoundary(br, x + 1, y + 1, mesh.subdivisions);
      assertFixedBoundary(bl, x, y + 1, mesh.subdivisions);
      assertPositiveTriangle(tl.warped, tr.warped, br.warped);
      assertPositiveTriangle(tl.warped, br.warped, bl.warped);
      appendTriangle(tl, tr, br);
      appendTriangle(tl, br, bl);
    }
  }
  return floatCount;
}

const unitMeshVertexData = warpMeshVertexData();

function validatedMeshSubdivisions(mesh?: WarpMesh): number {
  const subdivisions = mesh?.subdivisions ?? 1;
  const side = subdivisions + 1;
  if (
    mesh &&
    (!Number.isSafeInteger(subdivisions) ||
      subdivisions < MIN_MESH_SUBDIVISIONS ||
      subdivisions > MAX_MESH_SUBDIVISIONS ||
      mesh.vertices.length !== side * side)
  ) {
    throw new Error("The warp mesh topology is invalid");
  }
  return subdivisions;
}

function assertFixedBoundary(
  vertex: WarpVertex,
  x: number,
  y: number,
  subdivisions: number,
): void {
  if (
    (x === 0 || x === subdivisions || y === 0 || y === subdivisions) &&
    (vertex.warped.x !== vertex.source.x || vertex.warped.y !== vertex.source.y)
  ) {
    throw new Error("The warp mesh boundary is invalid");
  }
}

function assertPositiveTriangle(a: Point, b: Point, c: Point): void {
  const twiceArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (!Number.isFinite(twiceArea) || twiceArea <= 2.0e-8) {
    throw new Error("The warp mesh contains a folded or collapsed triangle");
  }
}

function assertCoreSourceVertex(
  vertex: WarpVertex,
  x: number,
  y: number,
  subdivisions: number,
): void {
  const expectedX = x / subdivisions;
  const expectedY = y / subdivisions;
  if (vertex.source.x !== expectedX || vertex.source.y !== expectedY) {
    throw new Error("The warp mesh source grid is invalid");
  }
}

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
