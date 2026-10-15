import CoreGraphics
import Foundation
import Observation

public struct WorldbendRasterWorkGuard: Equatable, Sendable {
  public let instance: UUID
  public let revision: UInt64
  public let manifestSHA256: String?
  public let hubRevision: UInt64
}

public enum WorldbendRasterWorkPhase: String, Sendable {
  case empty, preparing, paused, playing, suspended, completed, stopped, failed, superseded,
    disposed
}

/// Local execution of core-produced frames through the existing completed-frame
/// hub. The host owns event eligibility, scene layout, foreground and audio.
@MainActor @Observable
public final class WorldbendRasterWorkSession {
  public private(set) var phase: WorldbendRasterWorkPhase = .empty
  public private(set) var timeMilliseconds: Double = 0
  public private(set) var displayedFrameIndex: Int?
  public private(set) var lastErrorDescription: String?
  public private(set) var busy = false
  public private(set) var active = true
  public var durationMilliseconds: Double { package?.manifest.receipt.durationMs ?? 0 }
  public var manifest: WorldbendRasterWorkManifest? { package?.manifest }
  public var guardValue: WorldbendRasterWorkGuard {
    .init(
      instance: instance, revision: revision, manifestSHA256: package?.manifestSHA256,
      hubRevision: hub.frameRevision)
  }

  @ObservationIgnored private let hub: WorldbendFrameHub
  @ObservationIgnored private let instance = UUID()
  @ObservationIgnored private var revision: UInt64 = 1
  @ObservationIgnored private var logicalSize: CGSize
  @ObservationIgnored private var contentRect: CGRect
  @ObservationIgnored private var package: WorldbendRasterWorkPackage?
  @ObservationIgnored private var ownedHubRevision: UInt64?
  @ObservationIgnored private var ownedFrameID: WorldbendFrameID?
  @ObservationIgnored private var currentFrame: RasterWorkDecodedFrame?
  @ObservationIgnored private var cache: [Int: RasterWorkDecodedFrame] = [:]
  @ObservationIgnored private var cacheOrder: [Int] = []
  @ObservationIgnored private var requestedPlayback = false
  @ObservationIgnored private let clock = ContinuousClock()
  @ObservationIgnored private var anchor: ContinuousClock.Instant?
  @ObservationIgnored private var anchoredTime: Double = 0
  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var pending: Pending?
  @ObservationIgnored private var candidateHubRevision: UInt64?
  @ObservationIgnored private let worker = Worker()
  @ObservationIgnored private let decode:
    @Sendable (WorldbendRasterWorkPackage, Int) throws -> RasterWorkDecodedFrame

  private enum ResultValue: Sendable {
    case package(WorldbendRasterWorkPackage, RasterWorkDecodedFrame)
    case frame(RasterWorkDecodedFrame)
  }
  private struct Pending {
    let id: UUID
    let task: Task<Void, Never>
    let continuation: CheckedContinuation<ResultValue, any Error>
  }
  // ImageIO's synchronous decode cannot be forcibly interrupted. Serialize
  // work per receiver so repeated cancellation cannot fan out large buffers.
  // Cancelled queued jobs check their flag before opening or decoding bytes.
  private actor Worker {
    func perform(_ work: @Sendable () throws -> ResultValue) throws -> ResultValue {
      try Task.checkCancellation()
      let value = try work()
      try Task.checkCancellation()
      return value
    }
  }

  public convenience init(hub: WorldbendFrameHub, logicalSize: CGSize, contentRect: CGRect) {
    self.init(
      hub: hub, logicalSize: logicalSize, contentRect: contentRect, decode: RasterWorkDecoder.decode
    )
  }
  init(
    hub: WorldbendFrameHub, logicalSize: CGSize, contentRect: CGRect,
    decode: @escaping @Sendable (WorldbendRasterWorkPackage, Int) throws -> RasterWorkDecodedFrame
  ) {
    self.hub = hub
    self.logicalSize = logicalSize
    self.contentRect = contentRect
    self.decode = decode
  }
  deinit {
    ticker?.cancel()
    pending?.task.cancel()
  }

  /// Candidate package and selected frame prepare before changing the accepted
  /// work. The pin comes from the fixed delivery receipt, never from this loader.
  public func receive(
    root: URL, expectedManifestSHA256: String, expectedGuard: WorldbendRasterWorkGuard
  ) async throws {
    try ensureAlive()
    if Task.isCancelled { throw WorldbendRasterWorkError.cancelled }
    guard expectedGuard == guardValue else { throw WorldbendRasterWorkError.stale }
    guard !busy else {
      throw WorldbendRasterWorkError.invalidPackage("another candidate is preparing")
    }
    let beforeTime = clockTime()
    let progress = durationMilliseconds > 0 ? beforeTime / durationMilliseconds : 0
    let wasPlaying = requestedPlayback
    freeze()
    cancelPending()
    busy = true
    phase = .preparing
    candidateHubRevision = expectedGuard.hubRevision
    let operationRevision = revision
    do {
      let decoder = decode
      let value = try await run {
        let candidate = try WorldbendRasterWorkPackage.open(
          root: root, expectedManifestSHA256: expectedManifestSHA256)
        let index = try candidate.manifest.frameIndex(
          at: progress * candidate.manifest.receipt.durationMs)
        return .package(candidate, try decoder(candidate, index))
      }
      try ensureOperation(operationRevision)
      guard revision == operationRevision, hub.frameRevision == candidateHubRevision else {
        throw WorldbendRasterWorkError.stale
      }
      guard case .package(let candidate, let frame) = value else {
        throw WorldbendRasterWorkError.notReady
      }
      try publish(frame, package: candidate, requiringHubRevision: candidateHubRevision)
      candidateHubRevision = nil
      package = candidate
      cache = [frame.index: frame]
      cacheOrder = [frame.index]
      timeMilliseconds = progress * candidate.manifest.receipt.durationMs
      revision &+= 1
      busy = false
      lastErrorDescription = nil
      requestedPlayback = wasPlaying
      phase = active ? .paused : .suspended
      if wasPlaying && active { resumeClock() }
    } catch {
      if phase != .disposed && revision == operationRevision {
        candidateHubRevision = nil
        busy = false
        requestedPlayback = false
        phase = .failed
        lastErrorDescription = error.localizedDescription
      }
      throw error
    }
  }

  public func seek(milliseconds: Double) async throws {
    try ensureAlive()
    guard let package else { throw WorldbendRasterWorkError.notReady }
    guard milliseconds.isFinite, milliseconds >= 0 else {
      throw WorldbendRasterWorkError.invalidPackage("invalid seek time")
    }
    guard !busy else {
      throw WorldbendRasterWorkError.invalidPackage("candidate preparation is active")
    }
    try ensureOwnership()
    let time = min(milliseconds, durationMilliseconds)
    let index = try package.manifest.frameIndex(at: time)
    freeze()
    revision &+= 1
    cancelPending()
    let operationRevision = revision
    do {
      try await present(index, package: package, operationRevision: operationRevision)
      try ensureOperation(operationRevision)
      timeMilliseconds = time
      lastErrorDescription = nil
      if requestedPlayback && active {
        resumeClock()
      } else {
        phase = active ? .paused : .suspended
      }
    } catch {
      if case WorldbendRasterWorkError.cancelled = error {
        // A caller cancellation freezes preparation, not the accepted clock.
        // Newer pause/seek/stop/lifecycle actions already own their state and
        // must never be resumed by this obsolete operation.
        if phase != .disposed && revision == operationRevision {
          if requestedPlayback && active { resumeClock() }
          else { phase = active ? .paused : .suspended }
        }
        throw error
      }
      if phase != .disposed && revision == operationRevision {
        freeze()
        requestedPlayback = false
        phase = error as? WorldbendRasterWorkError == .superseded ? .superseded : .failed
        lastErrorDescription = error.localizedDescription
      }
      throw error
    }
  }

  public func play() throws {
    try ensureAlive()
    guard package != nil else { throw WorldbendRasterWorkError.notReady }
    guard !busy else {
      throw WorldbendRasterWorkError.invalidPackage("candidate preparation is active")
    }
    try ensureOwnership()
    revision &+= 1
    cancelPending()
    if phase == .completed { timeMilliseconds = 0 }
    requestedPlayback = true
    if active { resumeClock() } else { phase = .suspended }
  }
  public func pause() {
    guard phase != .disposed else { return }
    revision &+= 1
    freeze()
    cancelPending()
    busy = false
    requestedPlayback = false
    phase = package == nil ? .empty : .paused
  }
  /// Stop retires only this producer's publication. It never clears a later
  /// background/scene published by another owner into the same hub.
  public func stop() {
    guard phase != .disposed else { return }
    revision &+= 1
    freeze()
    cancelPending()
    busy = false
    requestedPlayback = false
    timeMilliseconds = 0
    clearOwned()
    currentFrame = nil
    displayedFrameIndex = nil
    cache.removeAll()
    cacheOrder.removeAll()
    phase = .stopped
  }
  public func reset() async throws {
    pause()
    try await seek(milliseconds: 0)
  }

  /// Background/hidden suspension excludes elapsed wall time while retaining
  /// user playback intent. App calls this from its own lifecycle.
  public func setActive(_ value: Bool) {
    guard phase != .disposed, active != value else { return }
    revision &+= 1
    freeze()
    cancelPending()
    busy = false
    active = value
    if !value {
      phase = .suspended
    } else if requestedPlayback, package != nil {
      resumeClock()
    } else {
      phase = package == nil ? .empty : .paused
    }
  }
  public func setLayout(logicalSize: CGSize, contentRect: CGRect) throws {
    try ensureAlive()
    let beforeSize = self.logicalSize
    let beforeRect = self.contentRect
    self.logicalSize = logicalSize
    self.contentRect = contentRect
    do {
      if let frame = currentFrame, let package {
        try publish(frame, package: package, requiringHubRevision: ownedHubRevision)
        if busy { candidateHubRevision = hub.frameRevision }
      } else {
        try WorldbendFrameDescriptor(
          frameID: .init(0), logicalSize: logicalSize, contentRect: contentRect, pixelWidth: 1,
          pixelHeight: 1, colorSpace: .sRGB, pixelFormat: .bgra8Unorm
        ).validate()
      }
      // Layout belongs to the host. A resize does not cancel source
      // preparation or seek; their completed frame uses the latest valid
      // geometry. Only our own successful republish advances this guard.
    } catch {
      self.logicalSize = beforeSize
      self.contentRect = beforeRect
      throw error
    }
  }
  public func destroy() {
    guard phase != .disposed else { return }
    revision &+= 1
    freeze()
    cancelPending()
    requestedPlayback = false
    busy = false
    clearOwned()
    currentFrame = nil
    package = nil
    cache.removeAll()
    cacheOrder.removeAll()
    displayedFrameIndex = nil
    phase = .disposed
  }

  private func ensureAlive() throws {
    if phase == .disposed { throw WorldbendRasterWorkError.disposed }
  }
  private func ensureOperation(_ expectedRevision: UInt64) throws {
    try ensureAlive()
    if Task.isCancelled || revision != expectedRevision { throw WorldbendRasterWorkError.cancelled }
  }
  private func ensureOwnership() throws {
    if let ownedHubRevision, ownedHubRevision != hub.frameRevision {
      throw WorldbendRasterWorkError.superseded
    }
  }
  private func clearOwned() {
    if let ownedFrameID, let ownedHubRevision,
      hub.clearOwnedFrame(ownedFrameID, revision: ownedHubRevision)
    {
      self.ownedHubRevision = hub.frameRevision
    }
    // Keep a superseded revision stale. Only an explicit guarded receive can
    // take ownership back from another producer.
    ownedFrameID = nil
  }
  private func publish(
    _ frame: RasterWorkDecodedFrame, package: WorldbendRasterWorkPackage,
    requiringHubRevision: UInt64?
  ) throws {
    if let requiringHubRevision, requiringHubRevision != hub.frameRevision {
      throw WorldbendRasterWorkError.superseded
    }
    let receipt = package.manifest.receipt
    let sample = package.manifest.frames[frame.index]
    let id = hub.makeFrameID()
    let descriptor = WorldbendFrameDescriptor(
      frameID: id, logicalSize: logicalSize, contentRect: contentRect,
      pixelWidth: receipt.canvas.width, pixelHeight: receipt.canvas.height, colorSpace: .sRGB,
      pixelFormat: .bgra8Unorm,
      presentationTime: .milliseconds(sample.milliseconds),
      resourceIdentity: .init(
        workID: package.manifest.workID, contentVersion: package.manifestSHA256),
      alphaMode: .premultiplied)
    try hub.publish(descriptor: descriptor, pixelBuffer: frame.pixelBuffer)
    ownedFrameID = id
    ownedHubRevision = hub.frameRevision
    currentFrame = frame
    displayedFrameIndex = frame.index
  }
  private func present(_ index: Int, package: WorldbendRasterWorkPackage, operationRevision: UInt64)
    async throws
  {
    let frame: RasterWorkDecodedFrame
    if let cached = cache[index] {
      frame = cached
    } else {
      let decoder = decode
      let value = try await run { .frame(try decoder(package, index)) }
      guard case .frame(let decoded) = value else { throw WorldbendRasterWorkError.notReady }
      frame = decoded
    }
    try ensureOperation(operationRevision)
    try ensureOwnership()
    try publish(frame, package: package, requiringHubRevision: ownedHubRevision)
    cache[index] = frame
    cacheOrder.removeAll { $0 == index }
    cacheOrder.append(index)
    while cacheOrder.count > 2 { cache.removeValue(forKey: cacheOrder.removeFirst()) }
  }
  private func clockTime() -> Double {
    guard let anchor, requestedPlayback, active else { return timeMilliseconds }
    let c = anchor.duration(to: clock.now).components
    let elapsed = Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15
    return min(durationMilliseconds, anchoredTime + max(0, elapsed))
  }
  private func freeze() {
    timeMilliseconds = clockTime()
    anchor = nil
    ticker?.cancel()
    ticker = nil
  }
  private func resumeClock() {
    ticker?.cancel()
    anchor = clock.now
    anchoredTime = timeMilliseconds
    phase = .playing
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        guard await self?.tick() == true else { break }
        do { try await Task.sleep(for: .milliseconds(16)) } catch { break }
      }
    }
  }
  private func tick() async -> Bool {
    guard !Task.isCancelled, requestedPlayback, active, !busy, let package, phase != .disposed
    else { return false }
    let operationRevision = revision
    timeMilliseconds = clockTime()
    do {
      try ensureOwnership()
      let index = try package.manifest.frameIndex(at: timeMilliseconds)
      if displayedFrameIndex != index {
        try await present(index, package: package, operationRevision: operationRevision)
      }
      try ensureOperation(operationRevision)
      if timeMilliseconds >= durationMilliseconds {
        anchor = nil
        requestedPlayback = false
        phase = .completed
        return false
      }
      return true
    } catch {
      if case WorldbendRasterWorkError.cancelled = error { return false }
      if phase != .disposed && revision == operationRevision {
        freeze()
        requestedPlayback = false
        phase = error as? WorldbendRasterWorkError == .superseded ? .superseded : .failed
        lastErrorDescription = error.localizedDescription
      }
      return false
    }
  }

  private func run(_ work: @escaping @Sendable () throws -> ResultValue) async throws -> ResultValue
  {
    let id = UUID()
    let worker = worker
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let task = Task.detached(priority: .userInitiated) { [weak self] in
          let result: Result<ResultValue, any Error>
          do { result = .success(try await worker.perform(work)) } catch {
            result = .failure(error)
          }
          await self?.finish(id, result: result)
        }
        pending = Pending(id: id, task: task, continuation: continuation)
        if Task.isCancelled { cancelPending(id: id) }
      }
    } onCancel: { [weak self] in
      Task { @MainActor in self?.cancelPending(id: id) }
    }
  }
  private func finish(_ id: UUID, result: Result<ResultValue, any Error>) {
    guard let current = pending, current.id == id else { return }
    pending = nil
    current.continuation.resume(with: result)
  }
  private func cancelPending(id: UUID? = nil) {
    guard let current = pending, id == nil || current.id == id else { return }
    pending = nil
    current.task.cancel()
    current.continuation.resume(throwing: WorldbendRasterWorkError.cancelled)
  }
}
