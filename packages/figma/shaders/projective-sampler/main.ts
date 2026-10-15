import { defineProperties } from "figma:shaders"

export default function Effect() {}

export function setup(device, frame) {
  var wgsl = `
diagnostic(off,derivative_uniformity);
struct Uniforms {
  frameData: vec4f,
  inputDimsData: vec4f,
  h00: vec4f,
  h01: vec4f,
  h02: vec4f,
  h10: vec4f,
  h11: vec4f,
  h12: vec4f,
  h20: vec4f,
  h21: vec4f,
  h22: vec4f,
  sourceRect: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

struct VsIn {
  @location(0) pos: vec2f,
  @location(1) uv: vec2f,
};
struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

fn clampedLoad(coords: vec2i, maxCoords: vec2i) -> vec4f {
  let c = clamp(coords, vec2i(0), maxCoords);
  return textureLoad(inputTex, c, 0);
}

fn bilinearSample(uvCoord: vec2f, clampUv: vec2f) -> vec4f {
  let tsize = textureDimensions(inputTex);
  let tsizef = vec2f(tsize);
  let p = uvCoord * tsizef - 0.5;
  let fi = floor(p);
  let fr = p - fi;
  let ic = vec2i(fi);
  // Max pixel coord for clamping to source rect edge
  let maxPx = vec2i(clamp(vec2i(floor(clampUv * tsizef - vec2f(0.5))), vec2i(0), vec2i(tsize) - vec2i(1)));

  var t00 = clampedLoad(ic, maxPx);
  var t10 = clampedLoad(ic + vec2i(1, 0), maxPx);
  var t01 = clampedLoad(ic + vec2i(0, 1), maxPx);
  var t11 = clampedLoad(ic + vec2i(1, 1), maxPx);

  // Figma supplies and consumes premultiplied RGBA textures. Interpolate
  // those values directly; multiplying or dividing alpha here would apply
  // the conversion twice and change colors at translucent boundaries.
  let top = mix(t00, t10, fr.x);
  let bot = mix(t01, t11, fr.x);
  return mix(top, bot, fr.y);
}



@vertex fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.position = vec4f(in.pos, 0.0, 1.0);
  out.uv = in.uv;
  return out;
}

@fragment fn fs_main(@location(0) outputUv_in: vec2f) -> @location(0) vec4f {
  let time = u.frameData.x;
  let outputUv = outputUv_in;
  let dims = max(u.frameData.yz, vec2f(1.0));
  let inputDims = max(u.inputDimsData.xy, vec2f(1.0));
  let inputTexel = vec2f(1.0) / inputDims;
  let uv = outputUv;
  // texel and aspect are input-relative to match uv. Zoom fills rescale texel
  // alongside their uv redefinition below (see zoomLocal).
  let texel = inputTexel;
  let aspect = inputDims.x / max(inputDims.y, 1.0);
  let h00 = u.h00.x;
  let h01 = u.h01.x;
  let h02 = u.h02.x;
  let h10 = u.h10.x;
  let h11 = u.h11.x;
  let h12 = u.h12.x;
  let h20 = u.h20.x;
  let h21 = u.h21.x;
  let h22 = u.h22.x;
  let H = mat3x3f(
    vec3f(h00, h10, h20),
    vec3f(h01, h11, h21),
    vec3f(h02, h12, h22)
  );
  let q = H * vec3f(uv, 1.0);
  if (abs(q.z) < 1e-12) {
    return vec4f(0.0);
  }
  let sourceUv = q.xy / q.z;
  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    return vec4f(0.0);
  }
  let srcRight = u.sourceRect.x;
  let srcBottom = u.sourceRect.y;
  let texUv = sourceUv * vec2f(srcRight, srcBottom);
  return bilinearSample(texUv, vec2f(srcRight, srcBottom));
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
    size: 192,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  frame.state.placeholder = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: frame.state.placeholder },
    new Uint8Array([0, 0, 0, 0]),
    { bytesPerRow: 4 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  )
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
  function boolParam(name, fallback) {
    if (typeof params[name] === 'boolean') return params[name] ? 1 : 0
    return fallback ? 1 : 0
  }
  function selectParam(name, count, fallbackIndex) {
    // A select is a numeric dropdown: params[name] is the chosen option's index.
    var index = Math.round(Number(params[name]))
    return Number.isFinite(index) && index >= 0 && index < count ? index : fallbackIndex
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
  function pointParam(name, fallback) {
    var value = params[name] || {}
    return [
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
    ]
  }
  function pointRadiusParam(name, fallback) {
    var value = params[name] || {}
    return [
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
      finiteNumber(value.radius, fallback[2]),
    ]
  }
  function pointPointLineParam(name, fallback) {
    var value = params[name] || {}
    return [
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
      finiteNumber(value.x2, fallback[2]),
      finiteNumber(value.y2, fallback[3]),
    ]
  }
  function pointAngleRadiusParam(name, fallback) {
    var value = params[name] || {}
    return [
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
      finiteNumber(value.radius, fallback[2]),
      finiteNumber(value.angle, fallback[3]),
    ]
  }
  function colorPointParam(name, fallback) {
    var value = params[name] || {}
    var color = value.color || {}
    return [
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
      0,
      0,
      finiteNumber(color.r, fallback[2]),
      finiteNumber(color.g, fallback[3]),
      finiteNumber(color.b, fallback[4]),
      finiteNumber(color.a, fallback[5]),
    ]
  }
  function gradientParam(name, fallback) {
    var value = params[name] || {}
    var stops = Array.isArray(value.stops) && value.stops.length > 0 ? value.stops : fallback
    // Layout: 8 stop colors (rgba), then 8 positions packed 4-per-vec4, then the live count.
    var out = new Array(44).fill(0)
    var count = Math.min(stops.length, 8)
    for (var i = 0; i < count; i++) {
      var stop = stops[i] || {}
      var color = stop.color || {}
      out[i * 4] = finiteNumber(color.r, 0)
      out[i * 4 + 1] = finiteNumber(color.g, 0)
      out[i * 4 + 2] = finiteNumber(color.b, 0)
      out[i * 4 + 3] = finiteNumber(color.a, 1)
      out[32 + i] = finiteNumber(stop.position, 0)
    }
    out[40] = count
    return out
  }

  var output = frame.output || {}
  var width = Math.max(1, finiteNumber(output.width, 1))
  var height = Math.max(1, finiteNumber(output.height, 1))
  var time = 0
  var inputWidth = width
  var inputHeight = height

  device.queue.writeBuffer(
    frame.state.uniformBuf,
    0,
    new Float32Array([
      time, width, height, 0,
      inputWidth, inputHeight, 0, 0,
      numberParam("h00", 1), 0, 0, 0,
      numberParam("h01", 0), 0, 0, 0,
      numberParam("h02", 0), 0, 0, 0,
      numberParam("h10", 0), 0, 0, 0,
      numberParam("h11", 1), 0, 0, 0,
      numberParam("h12", 0), 0, 0, 0,
      numberParam("h20", 0), 0, 0, 0,
      numberParam("h21", 0), 0, 0, 0,
      numberParam("h22", 1), 0, 0, 0,
      numberParam("sourceRight", 1), numberParam("sourceBottom", 1), 0, 0,
    ]),
  )

  var inputView = frame.input != null
    ? frame.input.createView()
    : frame.state.placeholder.createView()

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
      { binding: 1, resource: inputView },
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
  "h00": {
    type: "number",
    label: "H00 · set by Worldbend",
    defaultValue: 1,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h01": {
    type: "number",
    label: "H01 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h02": {
    type: "number",
    label: "H02 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h10": {
    type: "number",
    label: "H10 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h11": {
    type: "number",
    label: "H11 · set by Worldbend",
    defaultValue: 1,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h12": {
    type: "number",
    label: "H12 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h20": {
    type: "number",
    label: "H20 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h21": {
    type: "number",
    label: "H21 · set by Worldbend",
    defaultValue: 0,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "h22": {
    type: "number",
    label: "H22 · set by Worldbend",
    defaultValue: 1,
    control: "slider",
    min: -1000000,
    max: 1000000,
    step: 0.000001,
  },
  "sourceRight": {
    type: "number",
    label: "Source right · set by Worldbend",
    defaultValue: 1,
    control: "slider",
    min: 0.000001,
    max: 1,
    step: 0.000001,
  },
  "sourceBottom": {
    type: "number",
    label: "Source bottom · set by Worldbend",
    defaultValue: 1,
    control: "slider",
    min: 0.000001,
    max: 1,
    step: 0.000001,
  },
})
