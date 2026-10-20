import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import Metal
import WorldbendAppearance

struct TideParameters: Codable, Equatable, Sendable {
  var variation = 0
  var transparent = false
  var extendedRange = false
  var seed: UInt32 = 42
}

struct TideUniforms {
  var pixels: SIMD2<Float>
  var logicalSize: SIMD2<Float>
  var time: Float
  var variation: Float
  var transparent: Float
  var extendedRange: Float
  var seed: UInt32
}

@MainActor
final class TideProgram {
  let device: any MTLDevice
  let optics: OpticalGlassConfiguration
  let sourceBytes: Data
  let pipeline: any MTLComputePipelineState
  let composite: any MTLComputePipelineState
  let coldCompileMilliseconds: Double

  static var resourceBundle: Bundle {
    #if SWIFT_PACKAGE
      Bundle.module
    #else
      Bundle.main
    #endif
  }
  static func resource(_ name: String, extension suffix: String) throws -> URL {
    let direct = resourceBundle.bundleURL.appendingPathComponent(
      "WorkAssets/" + name + "." + suffix)
    if FileManager.default.fileExists(atPath: direct.path) { return direct }
    guard
      let file = resourceBundle.url(
        forResource: name, withExtension: suffix, subdirectory: "WorkAssets")
        ?? resourceBundle.url(forResource: name, withExtension: suffix)
    else { throw CocoaError(.fileReadNoSuchFile) }
    return file
  }
  init(device: any MTLDevice) throws {
    self.device = device
    sourceBytes = try Data(contentsOf: Self.resource("ChromaticTide", extension: "metal"))
    let data = try Data(contentsOf: Self.resource("optics", extension: "json"))
    let delivery = try AppearanceReceipt.decode(AppearanceDelivery.self, from: data)
    guard let optics = AppearanceSession(delivery).opticalConfiguration else {
      throw CocoaError(.fileReadCorruptFile)
    }
    self.optics = optics
    let clock = ContinuousClock()
    let start = clock.now
    let library = try device.makeLibrary(
      source: String(decoding: sourceBytes, as: UTF8.self), options: nil)
    guard let kernel = library.makeFunction(name: "chromaticTide"),
      let blend = library.makeFunction(name: "chromaticComposite")
    else { throw CocoaError(.fileReadCorruptFile) }
    pipeline = try device.makeComputePipelineState(function: kernel)
    composite = try device.makeComputePipelineState(function: blend)
    coldCompileMilliseconds = Self.milliseconds(start.duration(to: clock.now))
  }
  func identity(_ parameters: TideParameters) throws -> WorldbendFrameResourceIdentity {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var bytes = Data("worldbend.example.chromatic-tide@0.1\n".utf8)
    bytes.append(sourceBytes)
    bytes.append(try encoder.encode(parameters))
    return .init(workID: "chromatic-tide", contentVersion: Self.hash(bytes))
  }
  func encode(
    _ command: any MTLCommandBuffer, target: any MTLTexture,
    logicalSize: CGSize, seconds: Double, parameters: TideParameters
  ) throws {
    guard seconds.isFinite, seconds >= 0, logicalSize.width > 0, logicalSize.height > 0 else {
      throw CocoaError(.validationMissingMandatoryProperty)
    }
    var uniforms = TideUniforms(
      pixels: .init(Float(target.width), Float(target.height)),
      logicalSize: .init(Float(logicalSize.width), Float(logicalSize.height)),
      time: Float(seconds.truncatingRemainder(dividingBy: 12)),
      variation: Float(parameters.variation),
      transparent: parameters.transparent ? 1 : 0, extendedRange: parameters.extendedRange ? 1 : 0,
      seed: parameters.seed)
    guard let encoder = command.makeComputeCommandEncoder() else {
      throw CocoaError(.coderInvalidValue)
    }
    encoder.setComputePipelineState(pipeline)
    encoder.setTexture(target, index: 0)
    encoder.setBytes(&uniforms, length: MemoryLayout<TideUniforms>.stride, index: 0)
    dispatch(encoder, pipeline: pipeline, width: target.width, height: target.height)
    encoder.endEncoding()
  }
  func encodeComposite(
    _ command: any MTLCommandBuffer, scene: any MTLTexture,
    pane: any MTLTexture, origin: SIMD2<UInt32>
  ) throws {
    var origin = origin
    guard let encoder = command.makeComputeCommandEncoder() else {
      throw CocoaError(.coderInvalidValue)
    }
    encoder.setComputePipelineState(composite)
    encoder.setTexture(scene, index: 0)
    encoder.setTexture(pane, index: 1)
    encoder.setBytes(&origin, length: MemoryLayout<SIMD2<UInt32>>.stride, index: 0)
    dispatch(encoder, pipeline: composite, width: pane.width, height: pane.height)
    encoder.endEncoding()
  }
  private func dispatch(
    _ encoder: any MTLComputeCommandEncoder, pipeline: any MTLComputePipelineState, width: Int,
    height: Int
  ) {
    let w = pipeline.threadExecutionWidth
    let h = max(1, min(8, pipeline.maxTotalThreadsPerThreadgroup / w))
    encoder.dispatchThreads(
      .init(width: width, height: height, depth: 1),
      threadsPerThreadgroup: .init(width: w, height: h, depth: 1))
  }
  static func hash(_ bytes: Data) -> String {
    "sha256:" + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  static func milliseconds(_ duration: Duration) -> Double {
    let c = duration.components
    return Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15
  }
}

@MainActor
enum TideProof {
  static func submit(
    program: TideProgram, producer: WorldbendMetalFrameProducer, hub: WorldbendFrameHub,
    seconds: Double, size: CGSize, pixels: CGSize, parameters: TideParameters
  ) async throws {
    let identity = try program.identity(parameters)
    if producer.source != identity || producer.phase == .stopped {
      try producer.configure(source: identity, expectedGuard: producer.guardValue)
    }
    let before = producer.metrics.published
    let request = WorldbendFrameDescriptor(
      frameID: hub.makeFrameID(), logicalSize: size,
      contentRect: CGRect(origin: .zero, size: size), pixelWidth: Int(pixels.width),
      pixelHeight: Int(pixels.height),
      colorSpace: .sRGB, pixelFormat: parameters.extendedRange ? .rgba16Float : .bgra8Unorm,
      presentationTime: .seconds(seconds), resourceIdentity: identity,
      alphaMode: parameters.transparent ? .premultiplied : .opaque)
    guard
      try producer.submit(
        descriptor: request,
        encode: {
          try program.encode(
            $0, target: $1, logicalSize: size, seconds: seconds, parameters: parameters)
        }) == .submitted
    else { throw CocoaError(.fileWriteOutOfSpace) }
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while producer.metrics.published == before, ContinuousClock.now < deadline {
      if producer.phase == .failed || producer.phase == .superseded {
        throw CocoaError(.coderInvalidValue)
      }
      try await Task.sleep(for: .milliseconds(1))
    }
    guard producer.metrics.published > before else { throw CocoaError(.coderInvalidValue) }
  }
  static func composite(
    program: TideProgram, renderer: WorldbendMetalOpticalRenderer,
    binding: WorldbendMetalOpticalBinding,
    size: CGSize, pixels: CGSize, optical: Bool = true
  ) async throws -> any MTLTexture {
    let device = program.device
    let scene = try texture(device, width: Int(pixels.width), height: Int(pixels.height))
    guard let command = renderer.makeCommandBuffer(),
      renderer.encodeBackdrop(commandBuffer: command, into: scene, binding: binding)
    else { throw CocoaError(.coderInvalidValue) }
    if optical {
      let panels = [
        CGRect(x: size.width * 0.11, y: size.height * 0.14, width: size.width * 0.78, height: 76),
        CGRect(x: size.width * 0.18, y: size.height * 0.62, width: size.width * 0.64, height: 96),
      ]
      let sx = pixels.width / size.width
      let sy = pixels.height / size.height
      for rect in panels {
        let pane = try texture(
          device, width: max(1, Int((rect.width * sx).rounded())),
          height: max(1, Int((rect.height * sy).rounded())))
        guard
          renderer.encodeOptical(
            commandBuffer: command, into: pane, binding: binding, optics: program.optics,
            paneFrame: rect, cornerRadius: 24)
        else { throw CocoaError(.coderInvalidValue) }
        try program.encodeComposite(
          command, scene: scene, pane: pane,
          origin: .init(UInt32((rect.minX * sx).rounded()), UInt32((rect.minY * sy).rounded())))
      }
    }
    try await complete(command)
    return scene
  }
  static func complete(_ command: any MTLCommandBuffer) async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, any Error>) in
      command.addCompletedHandler { buffer in
        if buffer.status == .completed {
          continuation.resume()
        } else {
          continuation.resume(throwing: CocoaError(.coderInvalidValue))
        }
      }
      command.commit()
    }
  }
  static func texture(_ device: any MTLDevice, width: Int, height: Int) throws -> any MTLTexture {
    let spec = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
    spec.usage = [.shaderRead, .shaderWrite, .renderTarget]
    spec.storageMode = .private
    guard let texture = device.makeTexture(descriptor: spec) else {
      throw CocoaError(.fileWriteOutOfSpace)
    }
    return texture
  }
  // Explicit proof/export readback only. Production scene/panes do not call it.
  static func bytes(_ texture: any MTLTexture) async throws -> Data {
    let row = ((texture.width * 4 + 255) / 256) * 256
    guard
      let output = texture.device.makeBuffer(
        length: row * texture.height, options: .storageModeShared),
      let command = texture.device.makeCommandQueue()?.makeCommandBuffer(),
      let blit = command.makeBlitCommandEncoder()
    else { throw CocoaError(.coderInvalidValue) }
    blit.copy(
      from: texture, sourceSlice: 0, sourceLevel: 0, sourceOrigin: .init(x: 0, y: 0, z: 0),
      sourceSize: .init(width: texture.width, height: texture.height, depth: 1), to: output,
      destinationOffset: 0, destinationBytesPerRow: row,
      destinationBytesPerImage: row * texture.height)
    blit.endEncoding()
    try await complete(command)
    var bytes = Data(count: texture.width * texture.height * 4)
    bytes.withUnsafeMutableBytes { destination in
      for y in 0..<texture.height {
        destination.baseAddress!.advanced(by: y * texture.width * 4).copyMemory(
          from: output.contents().advanced(by: y * row), byteCount: texture.width * 4)
      }
    }
    return bytes
  }
  static func savePNG(_ texture: any MTLTexture, to url: URL) async throws {
    let bytes = try await self.bytes(texture)
    guard let provider = CGDataProvider(data: bytes as CFData),
      let image = CGImage(
        width: texture.width, height: texture.height, bitsPerComponent: 8, bitsPerPixel: 32,
        bytesPerRow: texture.width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGBitmapInfo(
          rawValue: CGBitmapInfo.byteOrder32Little.rawValue
            | CGImageAlphaInfo.premultipliedFirst.rawValue), provider: provider, decode: nil,
        shouldInterpolate: false, intent: .defaultIntent),
      let destination = CGImageDestinationCreateWithURL(
        url as CFURL, "public.png" as CFString, 1, nil)
    else { throw CocoaError(.coderInvalidValue) }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
  }
}
