import CoreGraphics
import Foundation
import Metal
import Testing

@testable import WorldbendAppearance

@MainActor
struct MetalFrameProducerTests {
  private func source(_ value: String = "first") -> WorldbendFrameResourceIdentity {
    .init(workID: "chromatic-tide", contentVersion: RasterWorkFiles.hash(Data(value.utf8)))
  }
  private func descriptor(
    _ hub: WorldbendFrameHub, source: WorldbendFrameResourceIdentity,
    time: Double = 0, format: WorldbendPixelFormatTag = .bgra8Unorm
  ) -> WorldbendFrameDescriptor {
    .init(
      frameID: hub.makeFrameID(), logicalSize: CGSize(width: 40, height: 20),
      contentRect: CGRect(x: 5, y: 3, width: 30, height: 14), pixelWidth: 4, pixelHeight: 2,
      colorSpace: .sRGB, pixelFormat: format, presentationTime: .milliseconds(time),
      resourceIdentity: source, alphaMode: .premultiplied)
  }
  private func waitUntil(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
    while !condition(), ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(2))
    }
    #expect(condition())
  }
  private func clear(
    _ command: any MTLCommandBuffer, _ texture: any MTLTexture,
    color: MTLClearColor = MTLClearColorMake(0.25, 0, 0.125, 0.5)
  ) throws {
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = color
    let encoder = try #require(command.makeRenderCommandEncoder(descriptor: pass))
    encoder.endEncoding()
  }
  private func pixels(_ texture: any MTLTexture, _ device: any MTLDevice) throws -> Data {
    let bytesPerPixel = texture.pixelFormat == .rgba16Float ? 8 : 4
    let row = ((texture.width * bytesPerPixel + 255) / 256) * 256
    let output = try #require(
      device.makeBuffer(length: row * texture.height, options: .storageModeShared))
    let command = try #require(device.makeCommandQueue()?.makeCommandBuffer())
    let blit = try #require(command.makeBlitCommandEncoder())
    blit.copy(
      from: texture, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
      sourceSize: MTLSize(width: texture.width, height: texture.height, depth: 1),
      to: output, destinationOffset: 0, destinationBytesPerRow: row,
      destinationBytesPerImage: row * texture.height)
    blit.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    #expect(command.status == .completed)
    return Data(bytes: output.contents(), count: bytesPerPixel)
  }

  @Test func onlyGPUCompletedPixelsPublishWithIdentityAndAlpha() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
    defer { producer.destroy() }
    let identity = source()
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    let event = try #require(device.makeSharedEvent())
    let request = descriptor(hub, source: identity, time: 1234)
    #expect(
      try producer.submit(descriptor: request) { command, target in
        command.encodeWaitForEvent(event, value: 1)
        try clear(command, target)
      } == .submitted)
    #expect(producer.inFlightCount == 1)
    #expect(hub.frameRevision == 0)
    #expect(hub.beginFrameAccess() == nil)
    event.signaledValue = 1
    try await waitUntil { producer.metrics.published == 1 }
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    #expect(access.frame.resourceIdentity == identity)
    #expect(access.frame.alphaMode == .premultiplied)
    #expect(access.frame.presentationTime == .milliseconds(1234))
    #expect(access.frame.logicalSize == request.logicalSize)
    let texture = try #require(access.frame.metalTexture)
    #expect(Array(try pixels(texture, device)) == [32, 0, 64, 128])
    let before = WorldbendFrameImaging.materializationCountForTests
    let binding = hub.metalOpticalBinding(device: device)
    #expect(binding.path == .metalDirectFromTexture)
    #expect(binding.texture === texture)
    #expect(WorldbendFrameImaging.materializationCountForTests == before)
  }

  @Test func stoppedDisposedAndReplacedGPUCompletionsAreRetired() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    for action in ["stop", "destroy", "replace"] {
      let hub = WorldbendFrameHub()
      let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
      defer { producer.destroy() }
      let first = source()
      let second = source("second")
      let event = try #require(device.makeSharedEvent())
      try producer.configure(source: first, expectedGuard: producer.guardValue)
      try producer.submit(descriptor: descriptor(hub, source: first)) { command, target in
        command.encodeWaitForEvent(event, value: 1)
        try clear(command, target)
      }
      if action == "stop" {
        producer.stop()
      } else if action == "destroy" {
        producer.destroy()
      } else {
        try producer.configure(source: second, expectedGuard: producer.guardValue)
      }
      event.signaledValue = 1
      try await waitUntil { producer.inFlightCount == 0 }
      #expect(producer.metrics.retired == 1)
      #expect(hub.beginFrameAccess() == nil)
      if action != "destroy" {
        try producer.configure(source: second, expectedGuard: producer.guardValue)
        try producer.submit(descriptor: descriptor(hub, source: second)) { try clear($0, $1) }
        try await waitUntil { producer.metrics.published == 1 }
        let access = try #require(hub.beginFrameAccess())
        defer { access.endAccess() }
        #expect(access.frame.resourceIdentity == second)
      }
    }
  }

  @Test func foreignTakeoverDuringGPUWorkIsNeverClearedOrReclaimed() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
    defer { producer.destroy() }
    let identity = source()
    let event = try #require(device.makeSharedEvent())
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    let stale = producer.guardValue
    try producer.submit(descriptor: descriptor(hub, source: identity)) { command, target in
      command.encodeWaitForEvent(event, value: 1)
      try clear(command, target)
    }
    let foreign = descriptor(hub, source: source("foreign"))
    try hub.publish(
      descriptor: foreign, cpuBytes: Data(repeating: 0, count: 32), cpuBytesPerRow: 16)
    event.signaledValue = 1
    try await waitUntil { producer.inFlightCount == 0 }
    #expect(producer.phase == .superseded)
    #expect(producer.metrics.published == 0)
    producer.stop()
    #expect(hub.frameRevision == 1)
    #expect(throws: WorldbendMetalFrameProducerError.self) {
      try producer.configure(source: identity, expectedGuard: stale)
    }
    // Latest-guard configure is an explicit host handoff; stopping before a
    // new publication must still leave the foreign frame untouched.
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    producer.stop()
    #expect(hub.frameRevision == 1)
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    #expect(access.frame.frameID == foreign.frameID)
  }

  @Test func oldHeldTexturesStayImmutableAndApplyBackpressure() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device, maxRetainedTextures: 2)
    defer { producer.destroy() }
    let identity = source()
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    try producer.submit(descriptor: descriptor(hub, source: identity)) { try clear($0, $1) }
    try await waitUntil { producer.metrics.published == 1 }
    var old = hub.beginFrameAccess()
    let before = try pixels(try #require(old?.frame.metalTexture), device)
    try producer.submit(descriptor: descriptor(hub, source: identity, time: 100)) {
      try clear($0, $1, color: MTLClearColorMake(0, 0.5, 0, 0.5))
    }
    try await waitUntil { producer.metrics.published == 2 }
    #expect(try pixels(try #require(old?.frame.metalTexture), device) == before)
    #expect(
      try producer.submit(descriptor: descriptor(hub, source: identity, time: 200)) {
        try clear($0, $1)
      } == .droppedRetainedResources)
    #expect(producer.liveTextureCount == 2)
    old?.endAccess()
    old = nil
    try await waitUntil { producer.liveTextureCount == 1 }
    try producer.submit(descriptor: descriptor(hub, source: identity, time: 300)) {
      try clear($0, $1)
    }
    try await waitUntil { producer.metrics.published == 3 }
    #expect(producer.liveTextureCount <= 2)
  }

  @Test func floatCarrierPreservesExtendedRangeAndInvalidRequestsDoNotPublish() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
    defer { producer.destroy() }
    let identity = source()
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    try producer.submit(descriptor: descriptor(hub, source: identity, format: .rgba16Float)) {
      try clear($0, $1, color: MTLClearColorMake(2, 0.25, 0.125, 0.5))
    }
    try await waitUntil { producer.metrics.published == 1 }
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    let data = try pixels(try #require(access.frame.metalTexture), device)
    let red = data.withUnsafeBytes { Float16(bitPattern: $0.loadUnaligned(as: UInt16.self)) }
    #expect(red == 2)
    #expect(hub.metalOpticalBinding(device: device).path == .metalDirectFromTexture)
    #expect(hub.presentationArtwork()?.image == nil)
    var request = descriptor(hub, source: identity)
    request.alphaMode = .unspecified
    #expect(throws: WorldbendMetalFrameProducerError.self) {
      try producer.submit(descriptor: request) { try clear($0, $1) }
    }
    request.alphaMode = .premultiplied
    request.colorSpace = .displayP3
    #expect(throws: WorldbendMetalFrameProducerError.self) {
      try producer.submit(descriptor: request) { try clear($0, $1) }
    }
    #expect(producer.metrics.published == 1)
  }

  @Test func encoderFailureAndReentrantStopCannotCommitOldWork() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
    defer { producer.destroy() }
    let identity = source()
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    try producer.submit(descriptor: descriptor(hub, source: identity)) { try clear($0, $1) }
    try await waitUntil { producer.metrics.published == 1 }
    let acceptedRevision = hub.frameRevision
    #expect(throws: CocoaError.self) {
      try producer.submit(descriptor: descriptor(hub, source: identity)) { _, _ in
        throw CocoaError(.fileReadCorruptFile)
      }
    }
    #expect(producer.inFlightCount == 0)
    #expect(hub.frameRevision == acceptedRevision)
    #expect(throws: WorldbendMetalFrameProducerError.self) {
      try producer.submit(descriptor: descriptor(hub, source: identity)) { command, target in
        try clear(command, target)
        producer.stop()
      }
    }
    #expect(producer.phase == .stopped)
    #expect(producer.inFlightCount == 0)
    #expect(producer.metrics.submitted == 1)
    #expect(hub.beginFrameAccess() == nil)
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    try producer.submit(descriptor: descriptor(hub, source: identity)) { try clear($0, $1) }
    try await waitUntil { producer.metrics.published == 2 }
  }

  @Test func bindingAndOutstandingSamplingCommandKeepOldTextureAlive() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device, maxRetainedTextures: 2)
    defer { producer.destroy() }
    let identity = source()
    try producer.configure(source: identity, expectedGuard: producer.guardValue)
    try producer.submit(descriptor: descriptor(hub, source: identity)) { try clear($0, $1) }
    try await waitUntil { producer.metrics.published == 1 }
    var binding: WorldbendMetalOpticalBinding? = hub.metalOpticalBinding(device: device)
    let event = try #require(device.makeSharedEvent())
    var consumer: (any MTLCommandBuffer)? = try #require(
      device.makeCommandQueue()?.makeCommandBuffer())
    let output = try #require(device.makeBuffer(length: 512, options: .storageModeShared))
    consumer?.encodeWaitForEvent(event, value: 1)
    let encoder = try #require(consumer?.makeBlitCommandEncoder())
    encoder.copy(
      from: try #require(binding?.texture), sourceSlice: 0, sourceLevel: 0,
      sourceOrigin: .init(x: 0, y: 0, z: 0), sourceSize: .init(width: 4, height: 2, depth: 1),
      to: output, destinationOffset: 0, destinationBytesPerRow: 256, destinationBytesPerImage: 512)
    encoder.endEncoding()
    consumer?.commit()
    try producer.submit(descriptor: descriptor(hub, source: identity)) {
      try clear($0, $1, color: MTLClearColorMake(0, 0.5, 0, 0.5))
    }
    try await waitUntil { producer.metrics.published == 2 }
    #expect(
      try producer.submit(descriptor: descriptor(hub, source: identity)) { try clear($0, $1) }
        == .droppedRetainedResources)
    binding = nil
    #expect(producer.liveTextureCount == 2)
    event.signaledValue = 1
    try await waitUntil { consumer?.status == .completed }
    consumer = nil
    #expect(Array(Data(bytes: output.contents(), count: 4)) == [32, 0, 64, 128])
    // The encoded command retained the old source until its GPU access ended.
    // An encoder object may still retain it here; identity/pixels prove no rewrite.
    #expect(producer.liveTextureCount <= 2)
  }
}
