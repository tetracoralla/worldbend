import { defineProperties } from "figma:shaders"

export default function Effect() {}

// Soft fluid mesh-gradient kernel projected from worldbend-core's
// mesh_gradient.wgsl. Four corner colors blend through an editable loop with
// soft domain warp. The surface is generated: no input texture is sampled.
// Shader fill output is straight RGBA.
export function setup(device, frame) {
  var wgsl = `
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
`
  frame.state.module = device.createShaderModule({ code: wgsl })
  frame.state.pipeline = null
  frame.state.pipelineFormat = null

  frame.state.quad = device.createBuffer({ size: 96, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true })
  new Float32Array(frame.state.quad.getMappedRange()).set([
    -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
    -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
  ])
  frame.state.quad.unmap()

  frame.state.uniformBuf = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
}

export function render(device, frame) {
  var params = frame.params || {}
  function finiteNumber(value, fallback) {
    var num = Number(value)
    return Number.isFinite(num) ? num : fallback
  }
  function numberParam(name, fallback) {
    return finiteNumber(params[name], fallback)
  }
  function colorParam(name, fallback) {
    var value = params[name] || {}
    return [
      finiteNumber(value.r, fallback[0]),
      finiteNumber(value.g, fallback[1]),
      finiteNumber(value.b, fallback[2]),
      finiteNumber(value.a, fallback[3]),
    ]
  }

  var output = frame.output || {}
  var width = Math.max(1, finiteNumber(output.width, finiteNumber(frame.width, 1)))
  var height = Math.max(1, finiteNumber(output.height, finiteNumber(frame.height, 1)))
  var timeSec = Math.max(0, finiteNumber(frame.time, 0)) * 0.001
  var durationSec = Math.max(numberParam("durationMs", 8000), 100) * 0.001
  var phaseSec = Math.max(numberParam("phaseMs", 0), 0) * 0.001
  var tl = colorParam("colorTl", [0.18, 0.42, 0.92, 1])
  var tr = colorParam("colorTr", [0.55, 0.22, 0.86, 1])
  var bl = colorParam("colorBl", [0.12, 0.72, 0.68, 1])
  var br = colorParam("colorBr", [0.95, 0.55, 0.22, 1])
  var visible = params.visible
  var visibleFlag = visible === false || visible === 0 ? 0 : 1

  device.queue.writeBuffer(frame.state.uniformBuf, 0, new Float32Array([
    timeSec, durationSec, phaseSec, numberParam("flowSpeed", 0.45),
    width, height, 0, 0,
    tl[0], tl[1], tl[2], tl[3],
    tr[0], tr[1], tr[2], tr[3],
    bl[0], bl[1], bl[2], bl[3],
    br[0], br[1], br[2], br[3],
    numberParam("warp", 0.35), numberParam("softness", 0.55), 0, 0,
    // flags.x = visible; flags.y = 0 → straight RGBA for native Shader fills
    visibleFlag, 0, 0, 0,
  ]))

  var outputFormat = frame.output.format
  if (frame.state.pipeline == null || frame.state.pipelineFormat !== outputFormat) {
    frame.state.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: frame.state.module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, format: "float32x2", offset: 0 },
            { shaderLocation: 1, format: "float32x2", offset: 8 },
          ],
        }],
      },
      fragment: {
        module: frame.state.module,
        entryPoint: "fs_main",
        targets: [{ format: outputFormat }],
      },
      primitive: { topology: "triangle-list" },
    })
    frame.state.pipelineFormat = outputFormat
  }

  var bindGroup = device.createBindGroup({
    layout: frame.state.pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frame.state.uniformBuf } }],
  })
  var encoder = device.createCommandEncoder()
  var pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: frame.output.createView(),
      loadOp: "clear",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      storeOp: "store",
    }],
  })
  pass.setPipeline(frame.state.pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.setVertexBuffer(0, frame.state.quad)
  pass.draw(6)
  pass.end()
  device.queue.submit([encoder.finish()])
}

defineProperties(Effect, {
  "visible": { type: "boolean", label: "Visible", defaultValue: true },
  "colorTl": { type: "color", label: "Top left", defaultValue: { r: 0.18, g: 0.42, b: 0.92, a: 1 } },
  "colorTr": { type: "color", label: "Top right", defaultValue: { r: 0.55, g: 0.22, b: 0.86, a: 1 } },
  "colorBl": { type: "color", label: "Bottom left", defaultValue: { r: 0.12, g: 0.72, b: 0.68, a: 1 } },
  "colorBr": { type: "color", label: "Bottom right", defaultValue: { r: 0.95, g: 0.55, b: 0.22, a: 1 } },
  "warp": { type: "number", label: "Fluid warp", defaultValue: 0.35, control: "slider", min: 0, max: 1, step: 0.01 },
  "softness": { type: "number", label: "Softness", defaultValue: 0.55, control: "slider", min: 0, max: 1, step: 0.01 },
  "durationMs": { type: "number", label: "Duration ms", defaultValue: 8000, control: "slider", min: 100, max: 60000, step: 50 },
  "phaseMs": { type: "number", label: "Phase ms", defaultValue: 0, control: "slider", min: 0, max: 60000, step: 50 },
  "flowSpeed": { type: "number", label: "Flow speed", defaultValue: 0.45, control: "slider", min: 0, max: 2, step: 0.01 },
})
