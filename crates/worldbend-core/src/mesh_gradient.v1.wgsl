
diagnostic(off,derivative_uniformity);
struct Uniforms {
  frameData: vec4f,
  outputDimsData: vec4f,
  colorTl: vec4f,
  colorTr: vec4f,
  colorBl: vec4f,
  colorBr: vec4f,
  surface: vec4f,
  flags: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsIn {
  @location(0) pos: vec2f,
  @location(1) uv: vec2f,
};
struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(127.1, 311.7));
  q += dot(q, q + 74.13);
  return fract(q.x * q.y);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let t = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn fbm(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var point = p;
  for (var i = 0; i < 4; i++) {
    value += amplitude * valueNoise(point);
    point = point * 2.07 + vec2f(17.3, 13.1);
    amplitude *= 0.5;
  }
  return value;
}

@vertex fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.position = vec4f(in.pos, 0.0, 1.0);
  out.uv = in.uv;
  return out;
}

@fragment fn fs_main(@location(0) outputUv_in: vec2f) -> @location(0) vec4f {
  if (u.flags.x < 0.5) {
    return vec4f(0.0);
  }
  let dims = max(u.outputDimsData.xy, vec2f(1.0));
  let aspect = dims.x / max(dims.y, 1.0);
  // frameData: elapsed seconds, duration seconds, phase seconds, flowSpeed
  let duration = max(u.frameData.y, 0.001);
  let phase = u.frameData.z;
  let flowSpeed = max(u.frameData.w, 0.0);
  let loopT = fract((u.frameData.x + phase) / duration);
  let motion = loopT * 6.28318530718 * flowSpeed;

  let warp = clamp(u.surface.x, 0.0, 1.0);
  let softness = clamp(u.surface.y, 0.0, 1.0);

  var uv = vec2f(outputUv_in.x * aspect, outputUv_in.y);
  // Soft fluid drift of the mesh sampling domain; warp zero keeps a static mesh.
  let drift = vec2f(
    fbm(uv * 2.4 + vec2f(motion * 0.17, motion * 0.11)) - 0.5,
    fbm(uv * 2.4 + vec2f(19.0 + motion * 0.13, 7.0 - motion * 0.19)) - 0.5
  );
  uv = uv + drift * warp * 0.35;

  // Map back to unit square for corner bilinear mesh.
  var sx = clamp(uv.x / max(aspect, 0.0001), 0.0, 1.0);
  var sy = clamp(uv.y, 0.0, 1.0);
  // Softness widens the corner falloff so regions blend more like fluid light.
  let power = mix(1.35, 0.55, softness);
  sx = pow(sx, power);
  sy = pow(sy, power);

  // Mix premultiplied encoded-sRGB tints, then return the host's alpha
  // convention. Transparent corners change coverage without color bleed.
  let top = mix(
    vec4f(u.colorTl.rgb * u.colorTl.a, u.colorTl.a),
    vec4f(u.colorTr.rgb * u.colorTr.a, u.colorTr.a),
    sx,
  );
  let bottom = mix(
    vec4f(u.colorBl.rgb * u.colorBl.a, u.colorBl.a),
    vec4f(u.colorBr.rgb * u.colorBr.a, u.colorBr.a),
    sx,
  );
  let premultiplied = mix(top, bottom, sy);
  let alpha = premultiplied.a;
  if (u.flags.y > 0.5) { return premultiplied; }
  if (alpha <= 0.0) { return vec4f(0.0); }
  return vec4f(premultiplied.rgb / alpha, alpha);
}
