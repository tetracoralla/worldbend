// Test-only readback of submitted canvas frames, independent of presentation timing.
export function decodeCanvasPixels(bytes, width, height, bytesPerRow, format, alphaMode) {
  if (!['rgba8unorm', 'bgra8unorm'].includes(format)) throw Error(`Unsupported canvas format: ${format}`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || bytesPerRow < width * 4 || bytes.length < bytesPerRow * height) throw Error('Invalid canvas readback layout');
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = y * bytesPerRow + x * 4, target = (y * width + x) * 4;
    const alpha = alphaMode === 'opaque' ? 255 : bytes[source + 3];
    for (let channel = 0; channel < 3; channel++) {
      const value = bytes[source + (format === 'bgra8unorm' ? 2 - channel : channel)];
      pixels[target + channel] = alphaMode === 'premultiplied' ? (alpha ? Math.min(255, Math.round(value * 255 / alpha)) : 0) : value;
    }
    pixels[target + 3] = alpha;
  }
  return pixels;
}

// Retain the actual render target immediately after each real queue submission.
// Canvas2D drawImage(WebGPU canvas) can return transparent pixels in headless Chrome.
export function installCanvasReadback(decode) {
  const contexts = new WeakMap(), pending = new WeakMap();
  const configure = GPUCanvasContext.prototype.configure;
  const unconfigure = GPUCanvasContext.prototype.unconfigure;
  const getTexture = GPUCanvasContext.prototype.getCurrentTexture;
  const submit = GPUQueue.prototype.submit;
  GPUCanvasContext.prototype.configure = function (configuration) {
    contexts.get(this)?.snapshot?.destroy();
    const record = {...configuration, snapshot: null, error: null};
    configure.call(this, {...configuration, usage: (configuration.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC});
    contexts.set(this, record);
  };
  GPUCanvasContext.prototype.unconfigure = function () {
    contexts.get(this)?.snapshot?.destroy();
    contexts.delete(this);
    return unconfigure.call(this);
  };
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    const texture = getTexture.call(this), record = contexts.get(this);
    if (record) {
      record.texture = texture;
      const queue = record.device.queue;
      if (!pending.has(queue)) pending.set(queue, new Set());
      pending.get(queue).add(this);
    }
    return texture;
  };
  GPUQueue.prototype.submit = function (commands) {
    const result = submit.call(this, commands), ready = pending.get(this);
    pending.delete(this);
    for (const context of ready ?? []) {
      const record = contexts.get(context);
      if (!record) continue;
      try {
        const {device, texture, format} = record;
        if (!record.snapshot || record.snapshot.width !== texture.width || record.snapshot.height !== texture.height) {
          record.snapshot?.destroy();
          record.snapshot = device.createTexture({size: [texture.width, texture.height], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC});
        }
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToTexture({texture}, {texture: record.snapshot}, [texture.width, texture.height]);
        submit.call(this, [encoder.finish()]);
      } catch (error) { record.error = error; }
    }
    return result;
  };
  return async canvas => {
    const record = contexts.get(canvas.getContext('webgpu'));
    if (record?.error) throw record.error;
    if (!record?.snapshot) throw Error('No submitted WebGPU canvas frame');
    const {device, snapshot, format, alphaMode = 'opaque'} = record;
    const width = snapshot.width, height = snapshot.height, bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture: snapshot}, {buffer, bytesPerRow}, [width, height]);
      submit.call(device.queue, [encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      return decode(new Uint8Array(buffer.getMappedRange()), width, height, bytesPerRow, format, alphaMode);
    } finally {
      if (buffer.mapState === 'mapped') buffer.unmap();
      buffer.destroy();
    }
  };
}

export const canvasReadbackScript = `const readGpuPixels = (${installCanvasReadback})(${decodeCanvasPixels});`;
