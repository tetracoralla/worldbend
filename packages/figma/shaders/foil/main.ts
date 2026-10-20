import { defineProperties } from "figma:shaders"

export default function Effect() {}

// Procedural foil kernel projected from worldbend-core's foil.wgsl. Reflective
// faces and narrow fold glints flow along the light direction through a
// roughness-distorted field; both tint opacities contribute to coverage. The surface is generated:
// no input texture is sampled. This is a Shader fill, whose output is
// straight RGBA (effect shaders have a different alpha contract).
export function setup(device, frame) {
  var wgsl = `
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
`
  frame.state.module = device.createShaderModule({ code: wgsl })
  frame.state.pipeline = null
  frame.state.pipelineFormat = null

  frame.state.quad = device.createBuffer({
    size: 6 * 4 * 4,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  })
  new Float32Array(frame.state.quad.getMappedRange()).set([
    -1, -1,   0, 1,
     1, -1,   1, 1,
    -1,  1,   0, 0,
    -1,  1,   0, 0,
     1, -1,   1, 1,
     1,  1,   1, 0,
  ])
  frame.state.quad.unmap()

  frame.state.uniformBuf = device.createBuffer({
    size: 96,
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
  var width = Math.max(1, finiteNumber(output.width, 1))
  var height = Math.max(1, finiteNumber(output.height, 1))
  // Figma drives animated shaders with the frame time; hosts without a clock
  // render the settled t=0 surface.
  var time = Math.max(0, finiteNumber(frame.time, 0)) * 0.001
  var lightAngle = numberParam("lightAngle", 120) * Math.PI / 180

  var base = colorParam("baseColor", [0.72, 0.71, 0.68, 1])
  var highlight = colorParam("highlightColor", [0.98, 0.92, 0.78, 1])
  device.queue.writeBuffer(frame.state.uniformBuf, 0, new Float32Array([
    time, width, height, 0,
    width, height, 0, 0,
    base[0], base[1], base[2], base[3],
    highlight[0], highlight[1], highlight[2], highlight[3],
    lightAngle,
    numberParam("intensity", 0.6),
    numberParam("roughness", 0.45),
    numberParam("flowSpeed", 0.25),
    numberParam("visible", 1), 0, 0, 0,
  ]))

  var outputFormat = frame.output.format
  if (frame.state.pipeline == null || frame.state.pipelineFormat !== outputFormat) {
    frame.state.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: frame.state.module,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, format: 'float32x2', offset: 0 },
            { shaderLocation: 1, format: 'float32x2', offset: 8 },
          ],
        }],
      },
      fragment: {
        module: frame.state.module,
        entryPoint: 'fs_main',
        targets: [{ format: outputFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })
    frame.state.pipelineFormat = outputFormat
  }

  var bindGroup = device.createBindGroup({
    layout: frame.state.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: frame.state.uniformBuf } },
    ],
  })

  var encoder = device.createCommandEncoder()
  var pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: frame.output.createView(),
      loadOp: 'clear',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      storeOp: 'store',
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
  "visible": {
    type: "boolean",
    label: "Visible",
    defaultValue: true,
  },
  "baseColor": {
    type: "color",
    label: "Base metal",
    defaultValue: { r: 0.72, g: 0.71, b: 0.68, a: 1 },
  },
  "highlightColor": {
    type: "color",
    label: "Highlight",
    defaultValue: { r: 0.98, g: 0.92, b: 0.78, a: 1 },
  },
  "lightAngle": {
    type: "number",
    label: "Light angle",
    defaultValue: 120,
    control: "slider",
    min: 0,
    max: 359.99,
    step: 0.5,
  },
  "intensity": {
    type: "number",
    label: "Intensity",
    defaultValue: 0.6,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.01,
  },
  "roughness": {
    type: "number",
    label: "Roughness",
    defaultValue: 0.45,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.01,
  },
  "flowSpeed": {
    type: "number",
    label: "Flow speed",
    defaultValue: 0.25,
    control: "slider",
    min: 0,
    max: 2,
    step: 0.01,
  },
})
