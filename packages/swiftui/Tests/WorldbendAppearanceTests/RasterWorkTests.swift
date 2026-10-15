import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Metal
import Testing

@testable import WorldbendAppearance

private struct RasterFixture {
  let root: URL
  let pin: String
  let manifest: WorldbendRasterWorkManifest

  init(duration: Double = 300, color: UInt8 = 255) throws {
    let parent =
      ProcessInfo.processInfo.environment["WORLDBEND_RASTER_TEST_ROOT"].map {
        URL(fileURLWithPath: $0)
      }
      ?? FileManager.default.temporaryDirectory
    root = parent.appendingPathComponent("raster-" + UUID().uuidString)
    try FileManager.default.createDirectory(
      at: root.appendingPathComponent("frames"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: root.appendingPathComponent("sources"), withIntermediateDirectories: true)
    let source = Data("editable-test-source".utf8)
    try source.write(to: root.appendingPathComponent("sources/document.json"))
    var frames: [WorldbendRasterWorkManifest.Frame] = []
    for index in 0..<3 {
      // Row 0 red, row 1 half-transparent blue. Unequal channels detect
      // vertical reversal, channel swaps and missing premultiplication.
      let bytes = try Self.png(color: index == 0 ? color : UInt8(120 + index * 30))
      let file = "frames/\(index).png"
      try bytes.write(to: root.appendingPathComponent(file))
      frames.append(
        .init(
          frame: index, milliseconds: Double(index) * duration / 3,
          file: file, sha256: RasterWorkFiles.hash(bytes)))
    }
    let fingerprint = RasterWorkFiles.hash(source)
    manifest = .init(
      schema: "worldbend.raster-work-package", version: "0.1", workID: "test-paper-stage",
      receipt: .init(
        schema: "worldbend.scene3d-frames", version: "0.1",
        documentFingerprint: fingerprint, sceneFingerprint: fingerprint,
        canvas: .init(width: 2, height: 2), timebase: .init(numerator: 10, denominator: 1),
        frameCount: 3, durationMs: duration),
      colorSpace: "srgb", alpha: "premultiplied-bgra8", frames: frames,
      sources: [.init(file: "sources/document.json", sha256: fingerprint)],
      losses: ["test projection"])
    let data = try JSONEncoder().encode(manifest)
    pin = RasterWorkFiles.hash(data)
    try data.write(to: root.appendingPathComponent("manifest.json"))
  }
  func remove() { try? FileManager.default.removeItem(at: root) }
  func open() throws -> WorldbendRasterWorkPackage {
    try .open(root: root, expectedManifestSHA256: pin)
  }
  static func png(color: UInt8) throws -> Data {
    let bytes = Data([color, 0, 0, 255, color, 0, 0, 255, 0, 0, 255, 128, 0, 0, 255, 128])
    let image = try #require(
      CGImage(
        width: 2, height: 2, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 8,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
        provider: CGDataProvider(data: bytes as CFData)!, decode: nil, shouldInterpolate: false,
        intent: .defaultIntent))
    let data = NSMutableData()
    let destination = try #require(
      CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
    return data as Data
  }
}

private final class RasterDecodeBarrier: @unchecked Sendable {
  private let lock = NSLock()
  private let releaseSignal = DispatchSemaphore(value: 0)
  private var entered = false
  private var done = false
  let index: Int
  let pin: String?
  init(index: Int, pin: String? = nil) {
    self.index = index
    self.pin = pin
  }
  var started: Bool { lock.withLock { entered } }
  var finished: Bool { lock.withLock { done } }
  func release() { releaseSignal.signal() }
  func decode(_ package: WorldbendRasterWorkPackage, _ index: Int) throws -> RasterWorkDecodedFrame
  {
    let frame = try RasterWorkDecoder.decode(package, index: index)
    let shouldWait = lock.withLock { () -> Bool in
      guard index == self.index, pin == nil || pin == package.manifestSHA256, !entered else {
        return false
      }
      entered = true
      return true
    }
    if shouldWait {
      defer { lock.withLock { done = true } }
      guard releaseSignal.wait(timeout: .now() + 5) == .success else {
        throw WorldbendRasterWorkError.invalidPackage("test barrier timeout")
      }
      // Deliberately ignores the cancelled worker flag after its work has
      // completed: even an uncooperative decoder cannot publish late.
      return frame
    }
    return frame
  }
}

// Avoid adding a production decoder/provider API solely for tests. The barrier
// creates a completed buffer before waiting, so its late return is deterministic.

@MainActor
struct RasterWorkTests {
  private func session(_ hub: WorldbendFrameHub, barrier: RasterDecodeBarrier? = nil)
    -> WorldbendRasterWorkSession
  {
    if let barrier {
      return .init(
        hub: hub, logicalSize: CGSize(width: 200, height: 100),
        contentRect: CGRect(x: 10, y: 5, width: 180, height: 90), decode: barrier.decode)
    }
    return .init(
      hub: hub, logicalSize: CGSize(width: 200, height: 100),
      contentRect: CGRect(x: 10, y: 5, width: 180, height: 90))
  }
  private func waitUntil(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while !condition(), ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    #expect(condition())
  }
  private func frameID(_ hub: WorldbendFrameHub) -> WorldbendFrameID? {
    guard let access = hub.beginFrameAccess() else { return nil }
    defer { access.endAccess() }
    return access.frame.frameID
  }

  @Test func pinnedResourcesPathsAndContinuedReads() throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    #expect(throws: WorldbendRasterWorkError.self) {
      try WorldbendRasterWorkPackage.open(
        root: fixture.root, expectedManifestSHA256: "sha256:" + String(repeating: "0", count: 64))
    }
    let package = try fixture.open()
    #expect(try package.manifest.frameIndex(at: 99) == 0)
    #expect(try package.manifest.frameIndex(at: 100) == 1)
    #expect(try package.manifest.frameIndex(at: 999) == 2)
    #expect(throws: WorldbendRasterWorkError.self) { try package.manifest.frameIndex(at: .nan) }
    for path in [
      "../private.png", "/absolute.png", "frames//0.png", "frames/./0.png", "frames/../../0.png",
      "https://example.com/a.png",
    ] {
      #expect(throws: WorldbendRasterWorkError.self) {
        try RasterWorkFiles.read(root: fixture.root, file: path, limit: 100)
      }
    }
    try Data("tampered".utf8).write(to: fixture.root.appendingPathComponent("frames/1.png"))
    #expect(throws: WorldbendRasterWorkError.self) { try package.frameBytes(1) }
    #expect(throws: WorldbendRasterWorkError.self) { try fixture.open() }
    try FileManager.default.removeItem(at: fixture.root.appendingPathComponent("frames/0.png"))
    try FileManager.default.createSymbolicLink(
      at: fixture.root.appendingPathComponent("frames/0.png"),
      withDestinationURL: fixture.root.appendingPathComponent("sources/document.json"))
    #expect(throws: WorldbendRasterWorkError.self) { try package.frameBytes(0) }
    try FileManager.default.moveItem(
      at: fixture.root.appendingPathComponent("frames"),
      to: fixture.root.appendingPathComponent("real-frames"))
    try FileManager.default.createSymbolicLink(
      at: fixture.root.appendingPathComponent("frames"),
      withDestinationURL: fixture.root.appendingPathComponent("real-frames"))
    #expect(throws: WorldbendRasterWorkError.self) { try package.frameBytes(2) }
  }

  @Test func actualPNGOrientationAlphaAndSharedMetalFrame() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let hub = WorldbendFrameHub()
    let receiver = session(hub)
    defer { receiver.destroy() }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    let buffer = try #require(access.frame.pixelBuffer)
    #expect(access.frame.logicalSize == CGSize(width: 200, height: 100))
    #expect(access.frame.contentRect == CGRect(x: 10, y: 5, width: 180, height: 90))
    #expect(access.frame.presentationTime == .milliseconds(0))
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let pixels = try #require(CVPixelBufferGetBaseAddress(buffer)).assumingMemoryBound(
      to: UInt8.self)
    let row = CVPixelBufferGetBytesPerRow(buffer)
    #expect(Array(UnsafeBufferPointer(start: pixels, count: 4)) == [0, 0, 255, 255])
    #expect(Array(UnsafeBufferPointer(start: pixels + row, count: 4)) == [128, 0, 0, 128])
    if let device = MTLCreateSystemDefaultDevice() {
      let binding = hub.metalOpticalBinding(device: device)
      #expect(binding.path == .metalDirectFromPixelBuffer)
      #expect(binding.texture?.width == 2)
      #expect(binding.frameRevision == hub.frameRevision)
    }
    #expect(hub.presentationArtwork() != nil)
    #expect(frameID(hub) == access.frame.frameID)
  }

  @Test func atomicRevisionPreservesAcceptedWorkOnFailure() async throws {
    let first = try RasterFixture()
    let second = try RasterFixture(duration: 600, color: 200)
    defer {
      first.remove()
      second.remove()
    }
    let hub = WorldbendFrameHub()
    let receiver = session(hub)
    defer { receiver.destroy() }
    let stale = receiver.guardValue
    try await receiver.receive(
      root: first.root, expectedManifestSHA256: first.pin, expectedGuard: stale)
    try await receiver.seek(milliseconds: 150)
    let oldID = frameID(hub)
    await #expect(throws: WorldbendRasterWorkError.self) {
      try await receiver.receive(
        root: second.root, expectedManifestSHA256: second.pin, expectedGuard: stale)
    }
    #expect(frameID(hub) == oldID)
    await #expect(throws: WorldbendRasterWorkError.self) {
      try await receiver.receive(
        root: second.root, expectedManifestSHA256: first.pin, expectedGuard: receiver.guardValue)
    }
    #expect(receiver.guardValue.manifestSHA256 == first.pin)
    #expect(frameID(hub) == oldID)
    try await receiver.receive(
      root: second.root, expectedManifestSHA256: second.pin, expectedGuard: receiver.guardValue)
    #expect(receiver.timeMilliseconds == 300)
    #expect(receiver.displayedFrameIndex == 1)
    #expect(receiver.guardValue.manifestSHA256 == second.pin)
    #expect(frameID(hub) != oldID)
  }

  @Test func stopCancelsImmediatelyAndLateDecodeCannotPublish() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 1)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let seek = Task { try await receiver.seek(milliseconds: 100) }
    try await waitUntil { barrier.started }
    let held = try #require(hub.beginFrameAccess())
    receiver.stop()
    await #expect(throws: WorldbendRasterWorkError.cancelled) { try await seek.value }
    #expect(!barrier.finished)
    #expect(hub.beginFrameAccess() == nil)
    #expect(held.frame.pixelBuffer != nil)
    held.endAccess()
    barrier.release()
    try await waitUntil { barrier.finished }
    try await Task.sleep(for: .milliseconds(20))
    #expect(hub.beginFrameAccess() == nil)
    #expect(receiver.phase == .stopped)
    try await receiver.reset()
    #expect(receiver.displayedFrameIndex == 0)
    #expect(hub.beginFrameAccess() != nil)
  }

  @Test func newerSeekAndDestroyRetireOldOperations() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 1)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let old = Task { try await receiver.seek(milliseconds: 100) }
    try await waitUntil { barrier.started }
    let newer = Task { try await receiver.seek(milliseconds: 200) }
    await #expect(throws: WorldbendRasterWorkError.cancelled) { try await old.value }
    barrier.release()
    try await waitUntil { barrier.finished }
    try await newer.value
    try await Task.sleep(for: .milliseconds(20))
    #expect(receiver.displayedFrameIndex == 2)
    #expect(receiver.timeMilliseconds == 200)
    receiver.destroy()
    #expect(hub.beginFrameAccess() == nil)
    #expect(throws: WorldbendRasterWorkError.disposed) { try receiver.play() }
  }

  @Test func foreignProducerIsNotClearedOrReclaimedByStop() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let hub = WorldbendFrameHub()
    let receiver = session(hub)
    defer { receiver.destroy() }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let foreign = hub.makeFrameID()
    try hub.publish(
      descriptor: .init(
        frameID: foreign, logicalSize: CGSize(width: 1, height: 1),
        contentRect: CGRect(x: 0, y: 0, width: 1, height: 1), pixelWidth: 1, pixelHeight: 1,
        colorSpace: .sRGB, pixelFormat: .bgra8Unorm), cpuBytes: Data([0, 0, 0, 255]),
      cpuBytesPerRow: 4)
    receiver.stop()
    #expect(frameID(hub) == foreign)
    await #expect(throws: WorldbendRasterWorkError.superseded) {
      try await receiver.seek(milliseconds: 0)
    }
    #expect(frameID(hub) == foreign)
    // An explicit receive with the latest guard can perform a host-directed handoff.
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    #expect(frameID(hub) != foreign)
  }

  @Test func layoutDuringPreparationUsesLatestHostGeometry() async throws {
    let first = try RasterFixture()
    let second = try RasterFixture(duration: 600, color: 200)
    defer {
      first.remove()
      second.remove()
    }
    let barrier = RasterDecodeBarrier(index: 1, pin: second.pin)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: first.root, expectedManifestSHA256: first.pin, expectedGuard: receiver.guardValue)
    try await receiver.seek(milliseconds: 150)
    let candidate = Task {
      try await receiver.receive(
        root: second.root, expectedManifestSHA256: second.pin, expectedGuard: receiver.guardValue)
    }
    try await waitUntil { barrier.started }
    try receiver.setLayout(
      logicalSize: CGSize(width: 400, height: 200),
      contentRect: CGRect(x: 0, y: 0, width: 400, height: 200))
    #expect(receiver.busy)
    #expect(throws: WorldbendFrameError.self) {
      try receiver.setLayout(logicalSize: .zero, contentRect: .zero)
    }
    barrier.release()
    try await waitUntil { barrier.finished }
    try await candidate.value
    #expect(!receiver.busy)
    #expect(receiver.guardValue.manifestSHA256 == second.pin)
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    #expect(access.frame.logicalSize.width == 400)
    try await receiver.reset()
    #expect(receiver.displayedFrameIndex == 0)
  }

  @Test func layoutDuringSeekKeepsTimeAndUsesNewGeometry() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 1)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let seek = Task { try await receiver.seek(milliseconds: 100) }
    try await waitUntil { barrier.started }
    try receiver.setLayout(
      logicalSize: CGSize(width: 500, height: 400),
      contentRect: CGRect(x: 20, y: 30, width: 400, height: 300))
    barrier.release()
    try await seek.value
    let access = try #require(hub.beginFrameAccess())
    defer { access.endAccess() }
    #expect(access.frame.logicalSize == CGSize(width: 500, height: 400))
    #expect(access.frame.contentRect == CGRect(x: 20, y: 30, width: 400, height: 300))
    #expect(receiver.timeMilliseconds == 100)
    #expect(receiver.displayedFrameIndex == 1)
  }

  @Test func playSuspendResumeCompletionAndReplay() async throws {
    let fixture = try RasterFixture(duration: 450)
    defer { fixture.remove() }
    let hub = WorldbendFrameHub()
    let receiver = session(hub)
    defer { receiver.destroy() }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    try receiver.play()
    try await Task.sleep(for: .milliseconds(75))
    receiver.setActive(false)
    let suspended = receiver.timeMilliseconds
    try await Task.sleep(for: .milliseconds(500))
    #expect(receiver.timeMilliseconds == suspended)
    #expect(receiver.phase == .suspended)
    receiver.setActive(true)
    #expect(receiver.phase == .playing)
    try await waitUntil { receiver.phase == .completed }
    #expect(receiver.displayedFrameIndex == 2)
    #expect(receiver.timeMilliseconds == 450)
    try receiver.play()
    try await waitUntil { receiver.displayedFrameIndex == 0 }
    receiver.pause()
    let paused = receiver.timeMilliseconds
    try await Task.sleep(for: .milliseconds(40))
    #expect(receiver.timeMilliseconds == paused)
    #expect(receiver.phase == .paused)
  }

  @Test func seekingDuringPlaybackRetiresTickerDecode() async throws {
    let fixture = try RasterFixture(duration: 6000)
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 1)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    try await receiver.seek(milliseconds: 1900)
    try receiver.play()
    try await waitUntil { barrier.started }
    let seek = Task { try await receiver.seek(milliseconds: 4000) }
    try await Task.sleep(for: .milliseconds(20))
    barrier.release()
    try await seek.value
    #expect(receiver.displayedFrameIndex == 2)
    #expect(receiver.phase == .playing)
    receiver.pause()
    #expect(receiver.timeMilliseconds >= 4000)
    #expect(receiver.timeMilliseconds < 4500)
  }

  @Test func destroyDuringPreparationAndCallerCancellation() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 0)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    let receive = Task {
      try await receiver.receive(
        root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    }
    try await waitUntil { barrier.started }
    receiver.destroy()
    await #expect(throws: WorldbendRasterWorkError.cancelled) { try await receive.value }
    #expect(!barrier.finished)
    barrier.release()
    try await waitUntil { barrier.finished }
    try await Task.sleep(for: .milliseconds(20))
    #expect(receiver.phase == .disposed)
    #expect(hub.beginFrameAccess() == nil)

    let secondBarrier = RasterDecodeBarrier(index: 0)
    let second = session(hub, barrier: secondBarrier)
    defer {
      secondBarrier.release()
      second.destroy()
    }
    let cancelled = Task {
      try await second.receive(
        root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: second.guardValue)
    }
    try await waitUntil { secondBarrier.started }
    cancelled.cancel()
    await #expect(throws: WorldbendRasterWorkError.cancelled) { try await cancelled.value }
    #expect(!second.busy)
    #expect(hub.beginFrameAccess() == nil)
    secondBarrier.release()
    try await waitUntil { secondBarrier.finished }
    try await second.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: second.guardValue)
    #expect(second.phase == .paused)
  }

  @Test func callerCancelledSeekRestoresAcceptedPlayback() async throws {
    let fixture = try RasterFixture(duration: 6000)
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 2)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    try receiver.play()
    let seek = Task { try await receiver.seek(milliseconds: 4000) }
    try await waitUntil { barrier.started }
    let acceptedID = frameID(hub)
    seek.cancel()
    await #expect(throws: WorldbendRasterWorkError.cancelled) { try await seek.value }
    let heldTime = receiver.timeMilliseconds
    #expect(receiver.phase == .playing)
    #expect(receiver.displayedFrameIndex == 0)
    #expect(frameID(hub) == acceptedID)
    barrier.release()
    try await waitUntil { barrier.finished }
    try await waitUntil { receiver.timeMilliseconds > heldTime + 50 }
    receiver.pause()
    #expect(receiver.phase == .paused)
    let pausedTime = receiver.timeMilliseconds
    try await Task.sleep(for: .milliseconds(50))
    #expect(receiver.timeMilliseconds == pausedTime)
  }

  @Test func foreignFrameDuringDecodeRetainsItsPixels() async throws {
    let fixture = try RasterFixture()
    defer { fixture.remove() }
    let barrier = RasterDecodeBarrier(index: 1)
    let hub = WorldbendFrameHub()
    let receiver = session(hub, barrier: barrier)
    defer {
      barrier.release()
      receiver.destroy()
    }
    try await receiver.receive(
      root: fixture.root, expectedManifestSHA256: fixture.pin, expectedGuard: receiver.guardValue)
    let seek = Task { try await receiver.seek(milliseconds: 100) }
    try await waitUntil { barrier.started }
    let foreign = hub.makeFrameID()
    try hub.publish(
      descriptor: .init(
        frameID: foreign, logicalSize: CGSize(width: 1, height: 1),
        contentRect: CGRect(x: 0, y: 0, width: 1, height: 1), pixelWidth: 1, pixelHeight: 1,
        colorSpace: .sRGB, pixelFormat: .bgra8Unorm), cpuBytes: Data([0, 0, 0, 255]),
      cpuBytesPerRow: 4)
    barrier.release()
    await #expect(throws: WorldbendRasterWorkError.superseded) { try await seek.value }
    #expect(receiver.phase == .superseded)
    #expect(frameID(hub) == foreign)
    receiver.destroy()
    #expect(frameID(hub) == foreign)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["WORLDBEND_RASTER_CANDIDATES"] != nil))
  func actualBlenderThreeWorkReceivesRevisesAndPublishes() async throws {
    let directory = try #require(ProcessInfo.processInfo.environment["WORLDBEND_RASTER_CANDIDATES"])
    let root = URL(fileURLWithPath: directory)
    func pin(_ name: String) throws -> String {
      let data = try Data(contentsOf: root.appendingPathComponent(name + "/candidate-receipt.json"))
      let record = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
      return try #require(record["manifestSHA256"] as? String)
    }
    let initialPin = try pin("work-initial")
    let revisedPin = try pin("work-revised")
    let hub = WorldbendFrameHub()
    let receiver = session(hub)
    defer { receiver.destroy() }
    let clock = ContinuousClock()
    let started = clock.now
    try await receiver.receive(
      root: root.appendingPathComponent("work-initial"), expectedManifestSHA256: initialPin,
      expectedGuard: receiver.guardValue)
    let receiveDuration = started.duration(to: clock.now)
    #expect(receiver.manifest?.workID == "field-notes-paper-theatre")
    #expect(receiver.durationMilliseconds == 4000)
    try await receiver.seek(milliseconds: 2000)
    let old = try #require(hub.beginFrameAccess())
    defer { old.endAccess() }
    #expect(old.frame.pixelWidth == 960)
    #expect(old.frame.pixelHeight == 720)
    let oldArtwork = try #require(hub.presentationArtwork())
    try await receiver.receive(
      root: root.appendingPathComponent("work-revised"), expectedManifestSHA256: revisedPin,
      expectedGuard: receiver.guardValue)
    #expect(receiver.timeMilliseconds == 3000)
    #expect(receiver.displayedFrameIndex == 72)
    #expect(receiver.durationMilliseconds == 6000)
    let revisedArtwork = try #require(hub.presentationArtwork())
    let oldImage = try #require(oldArtwork.image)
    let revisedImage = try #require(revisedArtwork.image)
    let oldPixels = try #require(oldImage.dataProvider?.data) as Data
    let revisedPixels = try #require(revisedImage.dataProvider?.data) as Data
    #expect(oldPixels != revisedPixels)
    for (name, image) in [
      ("native-initial-mid.png", oldImage), ("native-revised-mid.png", revisedImage),
    ] {
      let destination = try #require(
        CGImageDestinationCreateWithURL(
          root.appendingPathComponent(name) as CFURL, "public.png" as CFString, 1, nil))
      CGImageDestinationAddImage(destination, image, nil)
      #expect(CGImageDestinationFinalize(destination))
    }
    if let device = MTLCreateSystemDefaultDevice() {
      #expect(hub.metalOpticalBinding(device: device).path == .metalDirectFromPixelBuffer)
    }
    try await receiver.reset()
    try receiver.play()
    try await waitUntil { receiver.timeMilliseconds > 300 }
    receiver.setActive(false)
    let heldTime = receiver.timeMilliseconds
    try await Task.sleep(for: .milliseconds(100))
    #expect(receiver.timeMilliseconds == heldTime)
    receiver.setActive(true)
    try await receiver.seek(milliseconds: 5850)
    try await waitUntil { receiver.phase == .completed }
    #expect(receiver.displayedFrameIndex == 143)
    receiver.stop()
    #expect(hub.beginFrameAccess() == nil)
    #expect(old.frame.pixelBuffer != nil)
    try await receiver.reset()
    #expect(receiver.displayedFrameIndex == 0)
    // Decode every actually delivered frame, rather than inferring all
    // resources from the first frame or from the Web video receipt.
    let package = try WorldbendRasterWorkPackage.open(
      root: root.appendingPathComponent("work-revised"), expectedManifestSHA256: revisedPin)
    let allFramesStart = clock.now
    let digest = try await Task.detached { () -> String in
      var digest = Data()
      for index in package.manifest.frames.indices {
        try autoreleasepool {
          let frame = try RasterWorkDecoder.decode(package, index: index)
          CVPixelBufferLockBaseAddress(frame.pixelBuffer, .readOnly)
          defer { CVPixelBufferUnlockBaseAddress(frame.pixelBuffer, .readOnly) }
          let pixels = try #require(CVPixelBufferGetBaseAddress(frame.pixelBuffer))
          digest.append(Data(bytes: pixels, count: 4))
        }
      }
      return RasterWorkFiles.hash(digest)
    }.value
    let report: [String: Any] = [
      "schema": "worldbend.raster-native-proof@0.1", "platform": "macOS",
      "initialManifestSHA256": initialPin, "revisedManifestSHA256": revisedPin,
      "initialReceiveDuration": String(describing: receiveDuration),
      "all144FramesDecodeDuration": String(describing: allFramesStart.duration(to: clock.now)),
      "pixelProbeDigest": digest,
      "checks": [
        "pinned full work", "actual 960x720 completed CVPixelBuffer",
        "4s-to-6s normalized continuation", "changed artwork pixels", "shared Metal binding",
        "play/suspend/seek/end", "stop/reset", "old borrowed frame retention",
        "all 144 real PNGs decoded",
      ],
      "limits": [
        "macOS source runtime; iOS and App acceptance pending", "CPU decoding/upload",
        "baked camera; no realtime3D or seeded particles",
      ],
    ]
    try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
      .write(to: root.appendingPathComponent("native-proof.json"))
  }
}
