import CryptoKit
import Darwin
import Foundation

public enum WorldbendRasterWorkError: Error, LocalizedError, Equatable, Sendable {
  case invalidPackage(String)
  case resourceChanged(String)
  case cancelled, disposed, stale, notReady, superseded
  public var errorDescription: String? {
    switch self {
    case .invalidPackage(let detail): "Invalid raster work package: \(detail)"
    case .resourceChanged(let file): "Work resource changed or is unavailable: \(file)"
    case .cancelled: "Work receiving was cancelled."
    case .disposed: "Work receiver was disposed."
    case .stale: "Reread the current work before replacing it."
    case .notReady: "Receive a work package before playback."
    case .superseded: "Another producer replaced or cleared this frame source."
    }
  }
}

/// A fixed execution projection, not a second Spatial Document or geometry planner.
public struct WorldbendRasterWorkManifest: Codable, Sendable {
  public struct Receipt: Codable, Sendable {
    public struct Canvas: Codable, Sendable {
      public let width: Int
      public let height: Int
    }
    public struct Rate: Codable, Sendable {
      public let numerator: Int
      public let denominator: Int
    }
    public let schema: String
    public let version: String
    public let documentFingerprint: String
    public let sceneFingerprint: String
    public let canvas: Canvas
    public let timebase: Rate
    public let frameCount: Int
    public let durationMs: Double
  }
  public struct Resource: Codable, Sendable {
    public let file: String
    public let sha256: String
  }
  public struct Frame: Codable, Sendable {
    public let frame: Int
    public let milliseconds: Double
    public let file: String
    public let sha256: String
  }
  public let schema: String
  public let version: String
  public let workID: String
  public let receipt: Receipt
  public let colorSpace: String
  public let alpha: String
  public let frames: [Frame]
  public let sources: [Resource]
  public let losses: [String]

  func validate() throws {
    let r = receipt
    guard schema == "worldbend.raster-work-package", version == "0.1",
      !workID.isEmpty, workID.count <= 128,
      !workID.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      r.schema == "worldbend.scene3d-frames", r.version == "0.1",
      Self.isHash(r.documentFingerprint), Self.isHash(r.sceneFingerprint),
      colorSpace == "srgb", alpha == "premultiplied-bgra8",
      r.canvas.width > 0, r.canvas.height > 0,
      r.canvas.width <= 8192, r.canvas.height <= 8192,
      r.canvas.width * r.canvas.height <= 16_777_216,
      r.timebase.numerator > 0, r.timebase.denominator > 0,
      r.frameCount > 0, r.frameCount <= 240, frames.count == r.frameCount,
      r.durationMs.isFinite, r.durationMs > 0, sources.count <= 32
    else { throw WorldbendRasterWorkError.invalidPackage("unsupported or unbounded receipt") }
    var files = Set<String>()
    var lastTime = -Double.infinity
    for (index, f) in frames.enumerated() {
      guard f.frame == index, f.milliseconds.isFinite, f.milliseconds >= 0,
        f.milliseconds > lastTime, f.milliseconds < r.durationMs,
        f.file.hasSuffix(".png"), Self.isHash(f.sha256), files.insert(f.file).inserted
      else { throw WorldbendRasterWorkError.invalidPackage("invalid frame sample") }
      try RasterWorkFiles.validatePath(f.file)
      lastTime = f.milliseconds
    }
    guard frames[0].milliseconds == 0 else {
      throw WorldbendRasterWorkError.invalidPackage("first sample must start at zero")
    }
    for resource in sources {
      try RasterWorkFiles.validatePath(resource.file)
      guard Self.isHash(resource.sha256), files.insert(resource.file).inserted else {
        throw WorldbendRasterWorkError.invalidPackage("duplicate/invalid source resource")
      }
    }
  }
  static func isHash(_ value: String) -> Bool {
    WorldbendContentDigest.isSHA256(value)
  }

  /// Uses core-produced presentation samples. No new FPS/interpolation authority.
  public func frameIndex(at milliseconds: Double) throws -> Int {
    guard !frames.isEmpty, milliseconds.isFinite, milliseconds >= 0 else {
      throw WorldbendRasterWorkError.invalidPackage("invalid presentation time")
    }
    let time = min(milliseconds, receipt.durationMs)
    var low = 0
    var high = frames.count
    while low < high {
      let mid = (low + high) / 2
      if frames[mid].milliseconds <= time + 1e-8 { low = mid + 1 } else { high = mid }
    }
    return max(0, low - 1)
  }
}

/// Immutable verified metadata. Every later frame read checks its declared bytes again.
public struct WorldbendRasterWorkPackage: Sendable {
  public let root: URL
  public let manifestSHA256: String
  public let manifest: WorldbendRasterWorkManifest

  public static func open(root: URL, expectedManifestSHA256: String) throws -> Self {
    guard WorldbendRasterWorkManifest.isHash(expectedManifestSHA256) else {
      throw WorldbendRasterWorkError.invalidPackage("pin the manifest hash")
    }
    let bytes = try RasterWorkFiles.read(root: root, file: "manifest.json", limit: 8 * 1024 * 1024)
    guard RasterWorkFiles.hash(bytes) == expectedManifestSHA256 else {
      throw WorldbendRasterWorkError.resourceChanged("manifest.json")
    }
    let manifest = try JSONDecoder().decode(WorldbendRasterWorkManifest.self, from: bytes)
    try manifest.validate()
    var total = bytes.count
    for resource in manifest.sources
      + manifest.frames.map({ .init(file: $0.file, sha256: $0.sha256) })
    {
      try Task.checkCancellation()
      let data = try RasterWorkFiles.read(root: root, file: resource.file, limit: 64 * 1024 * 1024)
      total += data.count
      guard total <= 512 * 1024 * 1024 else {
        throw WorldbendRasterWorkError.invalidPackage("package byte budget")
      }
      guard RasterWorkFiles.hash(data) == resource.sha256 else {
        throw WorldbendRasterWorkError.resourceChanged(resource.file)
      }
    }
    return Self(root: root, manifestSHA256: expectedManifestSHA256, manifest: manifest)
  }
  func frameBytes(_ index: Int) throws -> Data {
    let f = manifest.frames[index]
    let data = try RasterWorkFiles.read(root: root, file: f.file, limit: 64 * 1024 * 1024)
    guard RasterWorkFiles.hash(data) == f.sha256 else {
      throw WorldbendRasterWorkError.resourceChanged(f.file)
    }
    return data
  }
}

/// Walk directory descriptors without following entry symlinks; a path swap
/// cannot make the receiver read an unrelated file before a hash mismatch.
enum RasterWorkFiles {
  static func hash(_ data: Data) -> String {
    "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  static func validatePath(_ file: String) throws {
    let parts = file.split(separator: "/", omittingEmptySubsequences: false)
    guard !parts.isEmpty, parts.count <= 8, file.utf8.count <= 512,
      parts.allSatisfy({
        !$0.isEmpty && $0 != "." && $0 != ".."
          && $0.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
              || [45, 46, 95].contains(byte)
          }
      })
    else { throw WorldbendRasterWorkError.invalidPackage("use package-relative resource paths") }
  }
  static func read(root: URL, file: String, limit: Int) throws -> Data {
    try validatePath(file)
    guard root.isFileURL else {
      throw WorldbendRasterWorkError.invalidPackage("local package required")
    }
    var directory = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard directory >= 0 else { throw WorldbendRasterWorkError.resourceChanged(file) }
    defer { Darwin.close(directory) }
    let parts = file.split(separator: "/").map(String.init)
    for part in parts.dropLast() {
      let next = openat(directory, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      guard next >= 0 else { throw WorldbendRasterWorkError.resourceChanged(file) }
      Darwin.close(directory)
      directory = next
    }
    let descriptor = openat(directory, parts.last!, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard descriptor >= 0 else { throw WorldbendRasterWorkError.resourceChanged(file) }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
      info.st_size >= 0, info.st_size <= limit
    else {
      throw WorldbendRasterWorkError.invalidPackage("bounded regular files required")
    }
    var result = Data()
    while true {
      try Task.checkCancellation()
      let chunk = try handle.read(upToCount: min(1024 * 1024, limit - result.count + 1)) ?? Data()
      if chunk.isEmpty { break }
      guard result.count + chunk.count <= limit else {
        throw WorldbendRasterWorkError.invalidPackage("resource byte budget")
      }
      result.append(chunk)
    }
    return result
  }
}
