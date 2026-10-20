
diagnostic(off,derivative_uniformity);
struct Uniforms {
  frameData: vec4f,
  outputDimsData: vec4f,
  baseColor: vec4f,
  highlightColor: vec4f,
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
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  // Quintic smoothstep keeps the field C2-continuous for calm gradients.
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
    point = point * 2.03 + vec2f(11.7, 9.2);
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
  let p = vec2f(outputUv_in.x * aspect, outputUv_in.y);

  let lightAngle = u.surface.x;
  let intensity = clamp(u.surface.y, 0.0, 1.0);
  let roughness = clamp(u.surface.z, 0.0, 1.0);
  let flowSpeed = max(u.surface.w, 0.0);

  let flow = u.frameData.x * flowSpeed;
  let dir = vec2f(cos(lightAngle), sin(lightAngle));
  let along = dot(p, dir);

  // Roughness bends the bands through a flowing noise field; at zero the
  // bands stay straight and deterministic.
  let warp = (fbm(p * 3.0 + vec2f(flow * 0.35, flow * 0.21)) - 0.5) * roughness;
  // Broad reflective faces meet narrow fold glints. The phase closes in a
  // dark region so the periodic boundary introduces no lit seam. Roughness
  // bends the folds and broadens their highlights, rather than blurring the
  // whole surface into a mottled gradient.
  let phase = fract((along + warp * 0.85) * 2.4 - flow * 0.28);
  let opening = smoothstep(0.08, 0.10, phase);
  let face = opening * (1.0 - smoothstep(0.16, 0.86, phase)) * 0.75;
  let glint = smoothstep(0.10, 0.14, phase) * (1.0 - smoothstep(0.14, 0.152 + roughness * 0.025, phase));
  let weight = intensity * clamp(face + glint * 0.7, 0.0, 1.0);

  // Mix premultiplied encoded-sRGB tints, then return the host's alpha
  // convention. Transparent highlights change coverage without color bleed.
  let alpha = mix(u.baseColor.a, u.highlightColor.a, weight);
  let premultiplied = mix(u.baseColor.rgb * u.baseColor.a,
    u.highlightColor.rgb * u.highlightColor.a, weight);
  if (u.flags.y > 0.5) { return vec4f(premultiplied, alpha); }
  if (alpha <= 0.0) { return vec4f(0.0); }
  return vec4f(premultiplied / alpha, alpha);
}
