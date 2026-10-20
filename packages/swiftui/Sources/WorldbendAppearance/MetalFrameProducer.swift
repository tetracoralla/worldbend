import Foundation
import Metal
import Observation

public enum WorldbendMetalFrameProducerError: Error, LocalizedError, Sendable {
  case noDevice, notReady, disposed, stale, superseded, invalidRequest
  public var errorDescription: String? {
    switch self {
    case .noDevice: "A Metal command queue is unavailable."
    case .notReady: "Configure the current source before submitting frames."
    case .disposed: "The GPU producer was disposed."
    case .stale: "Reread the current producer before replacing its source."
    case .superseded: "Another producer replaced or cleared this frame source."
    case .invalidRequest: "Use a bounded sRGB frame, explicit alpha and matching resource identity."
    }
  }
}

public struct WorldbendMetalFrameProducerGuard: Equatable, Sendable {
  public let instance: UUID
  public let revision: UInt64
  public let source: WorldbendFrameResourceIdentity?
  public let hubRevision: UInt64
}

public enum WorldbendMetalFrameSubmission: String, Sendable {
  case submitted, droppedInFlight, droppedRetainedResources
}

public struct WorldbendMetalFrameMetrics: Sendable {
  public fileprivate(set) var submitted: UInt64 = 0
  public fileprivate(set) var completed: UInt64 = 0
  public fileprivate(set) var published: UInt64 = 0
  public fileprivate(set) var retired: UInt64 = 0
  public fileprivate(set) var gpuFailures: UInt64 = 0
  public fileprivate(set) var droppedInFlight: UInt64 = 0
  public fileprivate(set) var droppedRetainedResources: UInt64 = 0
  public fileprivate(set) var lastCPUEncodeMilliseconds: Double = 0
  public fileprivate(set) var lastCPUSubmitMilliseconds: Double = 0
  /// nil means Metal supplied no valid GPU timing (common on Simulator).
  public fileprivate(set) var lastGPUMilliseconds: Double?
  public fileprivate(set) var lastCompletionMilliseconds: Double = 0
}

/// A lifecycle/ownership boundary for host-authored GPU pixels. It is neither a
/// second FrameHub nor a shader/scene authoring engine. Target textures are fresh
/// and immutable after completion, including while an old consumer retains one.
@MainActor @Observable
public final class WorldbendMetalFrameProducer {
  public enum Phase: String, Sendable { case stopped, ready, failed, superseded, disposed }
  public let device: any MTLDevice
  public private(set) var phase: Phase = .stopped
  public private(set) var source: WorldbendFrameResourceIdentity?
  public private(set) var metrics = WorldbendMetalFrameMetrics()
  public private(set) var inFlightCount = 0
  public private(set) var lastErrorDescription: String?
  public var guardValue: WorldbendMetalFrameProducerGuard {
    .init(instance: instance, revision: revision, source: source, hubRevision: hub.frameRevision)
  }
  public var liveTextureCount: Int { targets.filter { $0.texture != nil }.count }
  public var liveTextureBytes: Int { targets.reduce(0) { $0 + ($1.texture == nil ? 0 : $1.bytes) } }

  @ObservationIgnored private let hub: WorldbendFrameHub
  @ObservationIgnored private let queue: any MTLCommandQueue
  @ObservationIgnored private let instance = UUID()
  @ObservationIgnored private var revision: UInt64 = 1
  @ObservationIgnored private var ownedHubRevision: UInt64?
  @ObservationIgnored private var ownedFrameID: WorldbendFrameID?
  @ObservationIgnored private var lastSubmittedID: UInt64 = 0
  @ObservationIgnored private let maxTextures: Int
  @ObservationIgnored private let maxBytes: Int
  @ObservationIgnored private var targets: [WeakTarget] = []
  @ObservationIgnored private let clock = ContinuousClock()

  private final class WeakTarget {
    weak var texture: (any MTLTexture)?
    let bytes: Int
    init(_ texture: any MTLTexture, bytes: Int) {
      self.texture = texture
      self.bytes = bytes
    }
  }
  private final class SubmittedFrame: @unchecked Sendable {
    let texture: any MTLTexture
    let descriptor: WorldbendFrameDescriptor
    let generation: UInt64
    let hubRevision: UInt64
    let started: ContinuousClock.Instant
    init(
      texture: any MTLTexture, descriptor: WorldbendFrameDescriptor, generation: UInt64,
      hubRevision: UInt64, started: ContinuousClock.Instant
    ) {
      self.texture = texture
      self.descriptor = descriptor
      self.generation = generation
      self.hubRevision = hubRevision
      self.started = started
    }
  }

  public init(
    hub: WorldbendFrameHub, device: any MTLDevice,
    maxRetainedTextures: Int = 6, maxRetainedBytes: Int = 128 * 1024 * 1024
  ) throws {
    guard (1...8).contains(maxRetainedTextures), (1...512 * 1024 * 1024).contains(maxRetainedBytes)
    else {
      throw WorldbendMetalFrameProducerError.invalidRequest
    }
    guard let queue = device.makeCommandQueue() else {
      throw WorldbendMetalFrameProducerError.noDevice
    }
    self.hub = hub
    self.device = device
    self.queue = queue
    maxTextures = maxRetainedTextures
    maxBytes = maxRetainedBytes
  }

  /// Explicit host-directed source adoption/recovery. Keeps accepted pixels
  /// while the next source prepares; every earlier GPU completion is retired.
  public func configure(
    source: WorldbendFrameResourceIdentity,
    expectedGuard: WorldbendMetalFrameProducerGuard
  ) throws {
    try ensureAlive()
    try source.validate()
    guard expectedGuard == guardValue else { throw WorldbendMetalFrameProducerError.stale }
    if ownedHubRevision != hub.frameRevision { ownedFrameID = nil }
    revision &+= 1
    self.source = source
    ownedHubRevision = hub.frameRevision
    phase = .ready
    lastErrorDescription = nil
  }

  /// The host encodes into the supplied *fresh* texture and must not retain
  /// it for later writes, commit this command buffer, or request unretained
  /// references. This method registers completion before committing. A nil
  /// presentationTime or mismatched source cannot masquerade as a timed frame.
  @discardableResult
  public func submit(
    descriptor: WorldbendFrameDescriptor,
    encode: (any MTLCommandBuffer, any MTLTexture) throws -> Void
  ) throws -> WorldbendMetalFrameSubmission {
    let submitStarted = clock.now
    defer {
      metrics.lastCPUSubmitMilliseconds = Self.milliseconds(submitStarted.duration(to: clock.now))
    }
    try ensureAlive()
    guard phase == .ready || phase == .failed, let source else {
      throw WorldbendMetalFrameProducerError.notReady
    }
    guard ownedHubRevision == hub.frameRevision else {
      phase = .superseded
      throw WorldbendMetalFrameProducerError.superseded
    }
    try descriptor.validate()
    guard descriptor.resourceIdentity == source, descriptor.frameID.rawValue > lastSubmittedID,
      descriptor.presentationTime.map({ $0 >= .zero }) == true, descriptor.colorSpace == .sRGB,
      descriptor.alphaMode == .premultiplied || descriptor.alphaMode == .opaque,
      descriptor.pixelFormat == .bgra8Unorm || descriptor.pixelFormat == .rgba16Float,
      descriptor.pixelWidth <= 8192, descriptor.pixelHeight <= 8192,
      descriptor.pixelWidth * descriptor.pixelHeight <= 16_777_216
    else { throw WorldbendMetalFrameProducerError.invalidRequest }
    if inFlightCount != 0 {
      metrics.droppedInFlight &+= 1
      return .droppedInFlight
    }
    targets.removeAll { $0.texture == nil }
    let bytes =
      descriptor.pixelWidth * descriptor.pixelHeight
      * (descriptor.pixelFormat == .rgba16Float ? 8 : 4)
    if targets.count >= maxTextures || liveTextureBytes + bytes > maxBytes {
      metrics.droppedRetainedResources &+= 1
      return .droppedRetainedResources
    }
    let spec = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: descriptor.pixelFormat == .rgba16Float ? .rgba16Float : .bgra8Unorm,
      width: descriptor.pixelWidth, height: descriptor.pixelHeight, mipmapped: false)
    spec.usage = [.shaderRead, .shaderWrite, .renderTarget]
    spec.storageMode = .private
    guard let texture = device.makeTexture(descriptor: spec),
      let command = queue.makeCommandBuffer()
    else {
      throw WorldbendMetalFrameProducerError.noDevice
    }
    texture.label = source.workID + "/" + String(descriptor.frameID.rawValue)
    let allocationBytes = max(bytes, texture.allocatedSize)
    if liveTextureBytes + allocationBytes > maxBytes {
      metrics.droppedRetainedResources &+= 1
      return .droppedRetainedResources
    }
    let started = clock.now
    let generation = revision
    let expectedHubRevision = hub.frameRevision
    targets.append(WeakTarget(texture, bytes: allocationBytes))
    inFlightCount = 1
    do { try encode(command, texture) } catch {
      inFlightCount = 0
      if revision == generation {
        phase = .failed
        lastErrorDescription = error.localizedDescription
      }
      throw error
    }
    guard revision == generation, phase != .disposed, phase != .stopped else {
      inFlightCount = 0
      throw WorldbendMetalFrameProducerError.stale
    }
    guard hub.frameRevision == expectedHubRevision else {
      inFlightCount = 0
      phase = .superseded
      throw WorldbendMetalFrameProducerError.superseded
    }
    guard command.status == .notEnqueued, command.retainedReferences else {
      inFlightCount = 0
      throw WorldbendMetalFrameProducerError.invalidRequest
    }
    metrics.lastCPUEncodeMilliseconds = Self.milliseconds(started.duration(to: clock.now))
    let frame = SubmittedFrame(
      texture: texture, descriptor: descriptor, generation: generation,
      hubRevision: expectedHubRevision, started: started)
    lastSubmittedID = descriptor.frameID.rawValue
    metrics.submitted &+= 1
    command.addCompletedHandler { [weak self, frame] buffer in
      let succeeded = buffer.status == .completed
      let seconds = buffer.gpuEndTime - buffer.gpuStartTime
      let gpuMS = buffer.gpuStartTime > 0 && seconds.isFinite && seconds >= 0 ? seconds * 1000 : nil
      let error = buffer.error?.localizedDescription
      Task { @MainActor in self?.finish(frame, succeeded: succeeded, gpuMS: gpuMS, error: error) }
    }
    command.commit()
    phase = .ready
    return .submitted
  }

  public func stop() {
    guard phase != .disposed else { return }
    revision &+= 1
    clearOwned()
    phase = .stopped
  }
  public func destroy() {
    guard phase != .disposed else { return }
    revision &+= 1
    clearOwned()
    source = nil
    phase = .disposed
  }
  private func ensureAlive() throws {
    if phase == .disposed { throw WorldbendMetalFrameProducerError.disposed }
  }
  private func clearOwned() {
    if let ownedFrameID, let ownedHubRevision,
      hub.clearOwnedFrame(ownedFrameID, revision: ownedHubRevision)
    {
      self.ownedHubRevision = hub.frameRevision
    }
    ownedFrameID = nil
  }
  private func finish(_ frame: SubmittedFrame, succeeded: Bool, gpuMS: Double?, error: String?) {
    inFlightCount = max(0, inFlightCount - 1)
    metrics.completed &+= 1
    metrics.lastGPUMilliseconds = gpuMS
    metrics.lastCompletionMilliseconds = Self.milliseconds(frame.started.duration(to: clock.now))
    guard phase != .disposed, phase != .stopped, frame.generation == revision else {
      metrics.retired &+= 1
      return
    }
    guard succeeded else {
      metrics.gpuFailures &+= 1
      phase = .failed
      lastErrorDescription = error ?? "GPU command failed."
      return
    }
    guard hub.frameRevision == frame.hubRevision else {
      metrics.retired &+= 1
      phase = .superseded
      lastErrorDescription = WorldbendMetalFrameProducerError.superseded.localizedDescription
      return
    }
    do {
      try hub.publish(descriptor: frame.descriptor, metalTexture: frame.texture)
      ownedHubRevision = hub.frameRevision
      ownedFrameID = frame.descriptor.frameID
      metrics.published &+= 1
      phase = .ready
      lastErrorDescription = nil
    } catch {
      phase = .failed
      lastErrorDescription = error.localizedDescription
    }
  }
  private static func milliseconds(_ duration: Duration) -> Double {
    let c = duration.components
    return Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15
  }
}
