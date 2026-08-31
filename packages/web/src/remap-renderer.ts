import type { RemapSpecInput } from "./types";

const VERTEX = `#version 300 es
in vec2 position;
out vec2 outputUv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  outputUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D sourceTexture;
uniform sampler2D mapTexture;
uniform int operation;
uniform vec4 radial;
uniform vec3 tangential;
uniform vec4 displacement;
uniform int channels;
uniform int boundaryMode;
uniform bool highQuality;
in vec2 outputUv;
out vec4 outputColor;

float channelValue(vec4 value, int channel) {
  if (channel == 0) return value.r;
  if (channel == 1) return value.g;
  if (channel == 2) return value.b;
  if (channel == 3) return value.a;
  return dot(value.rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec2 boundUv(vec2 uv) {
  if (boundaryMode == 1) return clamp(uv, vec2(0.0), vec2(1.0));
  if (boundaryMode == 2) return fract(uv);
  return uv;
}

vec4 catmullRomWeights(float fraction) {
  float f2 = fraction * fraction;
  float f3 = f2 * fraction;
  return vec4(-0.5*fraction + f2 - 0.5*f3, 1.0 - 2.5*f2 + 1.5*f3,
    0.5*fraction + 2.0*f2 - 1.5*f3, -0.5*f2 + 0.5*f3);
}

vec4 cubicSample(vec2 uv) {
  vec2 size = vec2(textureSize(sourceTexture, 0));
  vec2 texel = uv * size - 0.5;
  vec2 base = floor(texel);
  vec2 fraction = texel - base;
  vec4 wx = catmullRomWeights(fraction.x);
  vec4 wy = catmullRomWeights(fraction.y);
  vec4 result = vec4(0.0);
  for (int y = 0; y < 4; y += 1) {
    for (int x = 0; x < 4; x += 1) {
      vec2 sampleUv = (base + vec2(float(x - 1), float(y - 1)) + 0.5) / size;
      if (boundaryMode == 0 && any(bvec4(lessThan(sampleUv, vec2(0.0)), greaterThan(sampleUv, vec2(1.0))))) continue;
      result += texture(sourceTexture, boundUv(sampleUv)) * wx[x] * wy[y];
    }
  }
  result = clamp(result, 0.0, 1.0);
  result.rgb = min(result.rgb, vec3(result.a));
  return result;
}

void main() {
  vec2 sourceUv;
  if (operation == 0) {
    vec2 p = (outputUv - tangential.yz) / radial.zw;
    float r2 = dot(p, p);
    float factor = 1.0 + radial.x*r2 + radial.y*r2*r2 + tangential.x*r2*r2*r2;
    sourceUv = tangential.yz + vec2(
      p.x*factor + 2.0*displacement.x*p.x*p.y + displacement.y*(r2 + 2.0*p.x*p.x),
      p.y*factor + displacement.x*(r2 + 2.0*p.y*p.y) + 2.0*displacement.y*p.x*p.y
    ) * radial.zw;
  } else {
    vec4 mapValue = texture(mapTexture, outputUv);
    float neutral = displacement.w / 255.0;
    vec2 offset = vec2(
      (channelValue(mapValue, channels / 8) - neutral) * displacement.x,
      (channelValue(mapValue, channels % 8) - neutral) * displacement.y
    );
    sourceUv = outputUv + offset / vec2(textureSize(sourceTexture, 0));
  }
  if (boundaryMode == 0 && any(bvec4(lessThan(sourceUv, vec2(0.0)), greaterThan(sourceUv, vec2(1.0))))) {
    outputColor = vec4(0.0);
    return;
  }
  sourceUv = boundUv(sourceUv);
  outputColor = highQuality ? cubicSample(sourceUv) : texture(sourceTexture, sourceUv);
}`;

export class RemapWebGLRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly sourceTexture: WebGLTexture;
  private readonly mapTexture: WebGLTexture;
  private source?: TexImageSource;
  private map?: TexImageSource;

  constructor(canvas: HTMLCanvasElement = document.createElement("canvas")) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is required for remap preview");
    this.gl = gl;
    this.program = program(gl, VERTEX, FRAGMENT);
    this.sourceTexture = texture(gl);
    this.mapTexture = texture(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to create remap geometry");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }

  render(source: TexImageSource, map: TexImageSource | undefined, spec: RemapSpecInput, highQuality = false): void {
    const { gl } = this;
    const { width, height } = spec.output;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    this.upload(0, this.sourceTexture, source, source !== this.source);
    this.source = source;
    this.upload(1, this.mapTexture, map ?? source, (map ?? source) !== this.map);
    this.map = map ?? source;
    gl.uniform1i(uniform(gl, this.program, "sourceTexture"), 0);
    gl.uniform1i(uniform(gl, this.program, "mapTexture"), 1);
    gl.uniform1i(uniform(gl, this.program, "highQuality"), highQuality ? 1 : 0);
    if (spec.operation.kind === "lens") {
      const c = spec.operation.coefficients;
      const center = spec.operation.center ?? { x: 0.5, y: 0.5 };
      const scale = spec.operation.scale ?? { x: 0.5, y: 0.5 };
      gl.uniform1i(uniform(gl, this.program, "operation"), 0);
      gl.uniform4f(uniform(gl, this.program, "radial"), c.k1 ?? 0, c.k2 ?? 0, scale.x, scale.y);
      gl.uniform3f(uniform(gl, this.program, "tangential"), c.k3 ?? 0, center.x, center.y);
      gl.uniform4f(uniform(gl, this.program, "displacement"), c.p1 ?? 0, c.p2 ?? 0, 0, 0);
      gl.uniform1i(uniform(gl, this.program, "boundaryMode"), 0);
    } else {
      gl.uniform1i(uniform(gl, this.program, "operation"), 1);
      gl.uniform4f(uniform(gl, this.program, "displacement"), spec.operation.scaleXPixels, spec.operation.scaleYPixels, 0, spec.operation.neutral ?? 128);
      gl.uniform1i(uniform(gl, this.program, "channels"), channel(spec.operation.xChannel) * 8 + channel(spec.operation.yChannel));
      gl.uniform1i(uniform(gl, this.program, "boundaryMode"), boundary(spec.operation.boundary ?? "transparent"));
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  async exportPng(): Promise<Uint8Array> {
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Unable to encode remap output")), "image/png"),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose(): void {
    this.gl.deleteTexture(this.sourceTexture);
    this.gl.deleteTexture(this.mapTexture);
    this.gl.deleteProgram(this.program);
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private upload(unit: number, target: WebGLTexture, source: TexImageSource, changed: boolean): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target);
    if (!changed && !(source instanceof HTMLCanvasElement) && !(source instanceof HTMLVideoElement)) return;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
}

function channel(value: string): number { return ["red", "green", "blue", "alpha", "luminance"].indexOf(value); }
function boundary(value: string): number { return value === "clamp" ? 1 : value === "wrap" ? 2 : 0; }
function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const value = gl.createTexture();
  if (!value) throw new Error("Unable to create remap texture");
  gl.bindTexture(gl.TEXTURE_2D, value);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return value;
}
function uniform(gl: WebGL2RenderingContext, value: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(value, name);
  if (!location) throw new Error(`Missing remap uniform ${name}`);
  return location;
}
function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const result = gl.createProgram();
  if (!result) throw new Error("Unable to create remap program");
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error("Unable to create remap shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Unable to compile remap shader");
    gl.attachShader(result, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "Unable to link remap program");
  return result;
}
