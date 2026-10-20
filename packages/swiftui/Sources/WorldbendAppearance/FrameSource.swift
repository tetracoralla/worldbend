import CoreGraphics
import CoreVideo
import Foundation
import Metal
import Observation
import SwiftUI

/// Monotonic identity for one GPU-completed frame publication.
public struct WorldbendFrameID: Hashable, Sendable, Codable {
    public let rawValue: UInt64
    public init(_ rawValue: UInt64) { self.rawValue = rawValue }
}

public enum WorldbendColorSpaceTag: String, Sendable, Codable {
    case sRGB = "srgb"
    case displayP3 = "display-p3"
}

public enum WorldbendPixelFormatTag: String, Sendable, Codable {
    case bgra8Unorm = "bgra8-unorm"
    case rgba16Float = "rgba16-float"
    case unknown = "unknown"
}

public enum WorldbendFrameAlphaMode: String, Sendable, Codable {
    case unspecified, opaque, premultiplied
}

/// Identity of the producer's authored source/parameters, separate from one
/// completed frame ID. Versions use the same explicit content digest convention.
public struct WorldbendFrameResourceIdentity: Hashable, Sendable, Codable {
    public let workID: String
    public let contentVersion: String
    public init(workID: String, contentVersion: String) {
        self.workID = workID
        self.contentVersion = contentVersion
    }
    func validate() throws {
        guard !workID.isEmpty, workID.utf8.count <= 256,
            !workID.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
            WorldbendContentDigest.isSHA256(contentVersion)
        else { throw WorldbendFrameError.invalidResourceIdentity }
    }
}

enum WorldbendContentDigest {
    static func isSHA256(_ value: String) -> Bool {
        value.hasPrefix("sha256:") && value.utf8.count == 71
            && value.dropFirst(7).allSatisfy { "0123456789abcdef".contains($0) }
    }
}

/// How the SwiftUI `layerEffect` path obtained pixels for a published frame.
/// Metal/CVPixelBuffer accessors remain separate; this never pretends a
/// UIImage round-trip is the Metal binding, and never markets the glass
/// `layerEffect` path as zero-copy GPU sampling.
public enum WorldbendFramePresentationPath: String, Sendable, Codable {
    /// CVPixelBuffer (or disclosed CPU BGRA) was materialized **once per
    /// generation** to CGImage for SwiftUI layer sampling. Metal/CVPB
    /// accessors on the same frame stay zero-copy for APP GPU consumers.
    /// Glass panes that use SwiftUI `layerEffect` still sample this shared
    /// CGImage-backed artwork — that is not Metal-direct glass rendering.
    case swiftuiLayerEffectFromPixelBuffer = "swiftui-layer-effect-from-pixel-buffer"
    /// Only MTLTexture was published (or carriers are not SwiftUI-compatible);
    /// layerEffect cannot sample MTLTexture without a disclosed blit.
    /// Optical scene shows a clear fallback; Metal accessors remain zero-copy.
    case metalOnlyNoLayerEffectSampling = "metal-only-no-layer-effect-sampling"
    /// Carrier present but pixel format cannot feed the BGRA CGImage path
    /// (e.g. rgba16-float). View stays empty; use Metal accessors instead.
    case incompatiblePixelFormatForLayerEffect = "incompatible-pixel-format-for-layer-effect"
    /// No completed frame is currently retained.
    case missingFrame = "missing-frame"
}

public enum WorldbendFrameError: Error, LocalizedError, Sendable {
    case missingCarrier
    case invalidGeometry
    case invalidResourceIdentity

    public var errorDescription: String? {
        switch self {
        case .missingCarrier:
            "Publish at least one of CVPixelBuffer or MTLTexture; metadata alone is not a frame."
        case .invalidGeometry:
            "logicalSize, contentRect and pixel dimensions must be finite and positive."
        case .invalidResourceIdentity:
            "Use a bounded work ID and an exact sha256 content version."
        }
    }
}

/// Descriptor for one completed frame. Pixel carriers are supplied separately
/// so APP can bind GPU resources without packing them into Codable receipts.
public struct WorldbendFrameDescriptor: Sendable {
    public var frameID: WorldbendFrameID
    public var logicalSize: CGSize
    /// Region of interest inside logical coordinates (points), not pixels.
    /// Shared artwork places the buffer's pixels into this rect within
    /// `logicalSize`; panes share that same crop.
    public var contentRect: CGRect
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var colorSpace: WorldbendColorSpaceTag
    public var pixelFormat: WorldbendPixelFormatTag
    public var presentationTime: Duration?
    public var resourceIdentity: WorldbendFrameResourceIdentity?
    public var alphaMode: WorldbendFrameAlphaMode

    public init(
        frameID: WorldbendFrameID,
        logicalSize: CGSize,
        contentRect: CGRect,
        pixelWidth: Int,
        pixelHeight: Int,
        colorSpace: WorldbendColorSpaceTag,
        pixelFormat: WorldbendPixelFormatTag,
        presentationTime: Duration? = nil,
        resourceIdentity: WorldbendFrameResourceIdentity? = nil,
        alphaMode: WorldbendFrameAlphaMode = .unspecified
    ) {
        self.frameID = frameID
        self.logicalSize = logicalSize
        self.contentRect = contentRect
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.colorSpace = colorSpace
        self.pixelFormat = pixelFormat
        self.presentationTime = presentationTime
        self.resourceIdentity = resourceIdentity
        self.alphaMode = alphaMode
    }

    func validate() throws {
        guard logicalSize.width.isFinite, logicalSize.height.isFinite,
            logicalSize.width > 0, logicalSize.height > 0,
            contentRect.origin.x.isFinite, contentRect.origin.y.isFinite,
            contentRect.width.isFinite, contentRect.height.isFinite,
            contentRect.width >= 0, contentRect.height >= 0,
            pixelWidth > 0, pixelHeight > 0
        else { throw WorldbendFrameError.invalidGeometry }
        try resourceIdentity?.validate()
    }
}

/// One retained, GPU-completed frame. Acquire via `WorldbendFrameAccess`.
/// APP must not free the underlying CVPixelBuffer / MTLTexture until every
/// outstanding access ends and the hub has replaced or cleared the frame.
@MainActor
public final class WorldbendCompletedFrame {
    public let frameID: WorldbendFrameID
    public let logicalSize: CGSize
    public let contentRect: CGRect
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let colorSpace: WorldbendColorSpaceTag
    public let pixelFormat: WorldbendPixelFormatTag
    public let presentationTime: Duration?
    public let presentationPath: WorldbendFramePresentationPath
    public let resourceIdentity: WorldbendFrameResourceIdentity?
    public let alphaMode: WorldbendFrameAlphaMode

    private let retainedPixelBuffer: CVPixelBuffer?
    private let retainedTexture: (any MTLTexture)?
    private let cpuBytes: Data?
    private let cpuBytesPerRow: Int

    init(
        descriptor: WorldbendFrameDescriptor,
        pixelBuffer: CVPixelBuffer?,
        metalTexture: (any MTLTexture)?,
        cpuBytes: Data?,
        cpuBytesPerRow: Int,
        presentationPath: WorldbendFramePresentationPath
    ) {
        frameID = descriptor.frameID
        logicalSize = descriptor.logicalSize
        contentRect = descriptor.contentRect
        pixelWidth = descriptor.pixelWidth
        pixelHeight = descriptor.pixelHeight
        colorSpace = descriptor.colorSpace
        pixelFormat = descriptor.pixelFormat
        presentationTime = descriptor.presentationTime
        self.presentationPath = presentationPath
        resourceIdentity = descriptor.resourceIdentity
        alphaMode = descriptor.alphaMode
        retainedPixelBuffer = pixelBuffer
        retainedTexture = metalTexture
        self.cpuBytes = cpuBytes
        self.cpuBytesPerRow = cpuBytesPerRow
    }

    /// Zero-copy CVPixelBuffer binding for APP Metal / wet-glass producers.
    public var pixelBuffer: CVPixelBuffer? { retainedPixelBuffer }

    /// Zero-copy MTLTexture binding. Valid while an access retains this frame.
    public var metalTexture: (any MTLTexture)? { retainedTexture }

    /// Disclosed CPU path for tests/hosts without a live GPU buffer.
    /// Not the Metal binding.
    public func withCPUBytesIfAvailable<R>(
        _ body: (UnsafeRawBufferPointer, Int) throws -> R
    ) rethrows -> R? {
        guard let cpuBytes else { return nil }
        return try cpuBytes.withUnsafeBytes { try body($0, cpuBytesPerRow) }
    }
}

/// Scoped borrow of one completed frame. Call `endAccess()` when backdrop and
/// panes / Metal consumers finish using this generation. Dropping without
/// `endAccess` schedules a main-queue release as a safety net only.
@MainActor
public final class WorldbendFrameAccess {
    public let frame: WorldbendCompletedFrame
    private var open = true
    private let onEnd: @MainActor () -> Void

    init(frame: WorldbendCompletedFrame, onEnd: @MainActor @escaping () -> Void) {
        self.frame = frame
        self.onEnd = onEnd
    }

    /// Release Worldbend's retain. Required before APP reclaims GPU memory for
    /// this generation. Prefer an explicit call over relying on `deinit`.
    public func endAccess() {
        guard open else { return }
        open = false
        onEnd()
    }

    deinit {
        guard open else { return }
        let end = onEnd
        Task { @MainActor in end() }
    }
}

/// Shared completed-frame publisher. One acquired frame serves scene backdrop
/// and multiple panes / APP Metal consumers for the same `frameID`.
@MainActor
public protocol WorldbendFrameSource: AnyObject {
    /// Increments when a newer completed frame is published or cleared.
    var frameRevision: UInt64 { get }
    /// Begin a retain of the current completed frame, or nil if missing.
    func beginFrameAccess() -> WorldbendFrameAccess?
}

/// Immutable SwiftUI artwork for one hub generation. `image` is materialized
/// at most once per `frameRevision` via ``WorldbendFrameHub/presentationArtwork()``.
/// Multiple panes must share this value (see ``WorldbendOpticalFrameScene``);
/// do not re-lock CVPixelBuffer per pane.
@MainActor
public struct WorldbendFrameArtwork {
    public let frameID: WorldbendFrameID
    public let frameRevision: UInt64
    public let logicalSize: CGSize
    public let contentRect: CGRect
    public let colorSpace: WorldbendColorSpaceTag
    public let pixelFormat: WorldbendPixelFormatTag
    public let presentationTime: Duration?
    public let presentationPath: WorldbendFramePresentationPath
    /// Shared CGImage for SwiftUI `layerEffect` hosts; nil when path cannot
    /// feed layerEffect. Same instance across backdrop + panes for one revision.
    public let image: CGImage?
}

/// Default APP-facing hub: produce frames here; Worldbend and panes consume
/// through `beginFrameAccess()` / `presentationArtwork()` without screen capture.
@MainActor
@Observable
public final class WorldbendFrameHub: WorldbendFrameSource {
    public private(set) var frameRevision: UInt64 = 0

    private final class RetainedSlot {
        let frame: WorldbendCompletedFrame
        var accessCount = 0
        init(frame: WorldbendCompletedFrame) { self.frame = frame }
    }

    private var current: RetainedSlot?
    private var nextFrameID: UInt64 = 1
    private var artworkCacheRevision: UInt64?
    private var artworkCache: WorldbendFrameArtwork?
    private var metalBindingCacheRevision: UInt64?
    private var metalBindingCacheDeviceID: UInt64?
    private var metalBindingCache: WorldbendMetalOpticalBinding?
    private var metalTextureCache: CVMetalTextureCache?

    public init() {}

    /// Allocate a fresh frameID from this hub's counter.
    public func makeFrameID() -> WorldbendFrameID {
        defer { nextFrameID &+= 1 }
        return WorldbendFrameID(nextFrameID)
    }

    /// Publish a GPU-completed frame. Retains `pixelBuffer` / `metalTexture`
    /// until every access ends and a newer publish/clear replaces this slot.
    ///
    /// Prefer binding an already-completed `CVPixelBuffer` and/or `MTLTexture`
    /// so APP rain MTKView and optical panes share one coherent generation
    /// without per-frame GPU→CPU→GPU copies on the Metal accessors. Do not free
    /// those resources until Worldbend releases them (no outstanding
    /// `WorldbendFrameAccess` for that generation). CPU bytes alone are a
    /// disclosed test fallback — not the Metal path.
    ///
    /// SwiftUI glass via `layerEffect` still materializes a shared CGImage when
    /// a BGRA8 carrier is present — that is **not** Metal-direct glass sampling.
    public func publish(
        descriptor: WorldbendFrameDescriptor,
        pixelBuffer: CVPixelBuffer? = nil,
        metalTexture: (any MTLTexture)? = nil,
        cpuBytes: Data? = nil,
        cpuBytesPerRow: Int = 0
    ) throws {
        try descriptor.validate()
        guard pixelBuffer != nil || metalTexture != nil || cpuBytes != nil else {
            throw WorldbendFrameError.missingCarrier
        }

        let path = Self.resolvePresentationPath(
            descriptor: descriptor,
            pixelBuffer: pixelBuffer,
            metalTexture: metalTexture,
            cpuBytes: cpuBytes
        )

        let frame = WorldbendCompletedFrame(
            descriptor: descriptor,
            pixelBuffer: pixelBuffer,
            metalTexture: metalTexture,
            cpuBytes: cpuBytes,
            cpuBytesPerRow: cpuBytesPerRow,
            presentationPath: path
        )
        current = RetainedSlot(frame: frame)
        artworkCache = nil
        artworkCacheRevision = nil
        metalBindingCache = nil
        metalBindingCacheRevision = nil
        metalBindingCacheDeviceID = nil
        frameRevision &+= 1
    }

    public func clear() {
        current = nil
        artworkCache = nil
        artworkCacheRevision = nil
        metalBindingCache = nil
        metalBindingCacheRevision = nil
        metalBindingCacheDeviceID = nil
        frameRevision &+= 1
    }

    /// Shared ownership check for local producers. Stale owners cannot withdraw
    /// a later publication, even if a caller reused an explicit frame ID.
    @discardableResult
    func clearOwnedFrame(_ frameID: WorldbendFrameID, revision: UInt64) -> Bool {
        guard frameRevision == revision, current?.frame.frameID == frameID else { return false }
        clear()
        return true
    }

    public func beginFrameAccess() -> WorldbendFrameAccess? {
        guard let slot = current else { return nil }
        slot.accessCount += 1
        return WorldbendFrameAccess(frame: slot.frame) { [weak slot] in
            guard let slot else { return }
            slot.accessCount = max(0, slot.accessCount - 1)
        }
    }

    /// Shared SwiftUI artwork for the current generation. Materializes a
    /// CGImage **at most once** per `frameRevision`. Backdrop and every pane
    /// must reuse this value (``WorldbendOpticalFrameScene`` does).
    public func presentationArtwork() -> WorldbendFrameArtwork? {
        guard let slot = current else { return nil }
        if let artworkCache, artworkCacheRevision == frameRevision {
            return artworkCache
        }
        let artwork = WorldbendFrameImaging.makeArtwork(frame: slot.frame, revision: frameRevision)
        artworkCache = artwork
        artworkCacheRevision = frameRevision
        return artwork
    }

    /// Shared Metal-direct binding for the current generation. Resolves an
    /// `MTLTexture` **at most once** per `frameRevision` (+ device). Uses the
    /// published texture, or wraps a BGRA8/`rgba16-float`-compatible
    /// `CVPixelBuffer` through `CVMetalTextureCache`. Does **not** call
    /// ``WorldbendFrameImaging`` and does not increment the CGImage
    /// materialization counter. CPU-only publications stay unavailable here;
    /// use ``presentationArtwork()`` / ``WorldbendOpticalFrameScene`` instead.
    public func metalOpticalBinding(
        device: (any MTLDevice)? = MTLCreateSystemDefaultDevice()
    ) -> WorldbendMetalOpticalBinding {
        guard let slot = current else {
            return WorldbendMetalOpticalBinding.unavailable(
                path: .unavailableMissingFrame, revision: frameRevision, device: device
            )
        }
        guard let device else {
            return WorldbendMetalOpticalBinding.unavailable(
                path: .unavailableNoMetalDevice,
                revision: frameRevision,
                frame: slot.frame,
                device: nil
            )
        }
        let deviceID = device.registryID
        if let metalBindingCache,
            metalBindingCacheRevision == frameRevision,
            metalBindingCacheDeviceID == deviceID
        {
            return metalBindingCache
        }
        let binding = WorldbendMetalOpticalResolver.resolve(
            frame: slot.frame,
            revision: frameRevision,
            device: device,
            textureCache: &metalTextureCache
        )
        metalBindingCache = binding
        metalBindingCacheRevision = frameRevision
        metalBindingCacheDeviceID = deviceID
        return binding
    }

    static func resolvePresentationPath(
        descriptor: WorldbendFrameDescriptor,
        pixelBuffer: CVPixelBuffer?,
        metalTexture: (any MTLTexture)?,
        cpuBytes: Data?
    ) -> WorldbendFramePresentationPath {
        let wantsSwiftUI = pixelBuffer != nil || cpuBytes != nil
        guard wantsSwiftUI else {
            return metalTexture != nil
                ? .metalOnlyNoLayerEffectSampling
                : .missingFrame
        }
        guard descriptor.pixelFormat == .bgra8Unorm else {
            return .incompatiblePixelFormatForLayerEffect
        }
        if let pixelBuffer {
            let type = CVPixelBufferGetPixelFormatType(pixelBuffer)
            guard type == kCVPixelFormatType_32BGRA else {
                return .incompatiblePixelFormatForLayerEffect
            }
        }
        return .swiftuiLayerEffectFromPixelBuffer
    }
}

enum WorldbendFrameImaging {
    /// Test seam: increments only when a new CGImage is created (not cache hits).
    nonisolated(unsafe) static var materializationCountForTests = 0

    static func cgColorSpace(for tag: WorldbendColorSpaceTag) -> CGColorSpace {
        switch tag {
        case .sRGB:
            return CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        case .displayP3:
            return CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()
        }
    }

    @MainActor
    static func makeArtwork(frame: WorldbendCompletedFrame, revision: UInt64)
        -> WorldbendFrameArtwork
    {
        let image: CGImage?
        switch frame.presentationPath {
        case .swiftuiLayerEffectFromPixelBuffer:
            if let buffer = frame.pixelBuffer {
                image = cgImage(
                    from: buffer, colorSpace: frame.colorSpace, pixelFormat: frame.pixelFormat)
            } else {
                image =
                    frame.withCPUBytesIfAvailable { ptr, bytesPerRow in
                        cgImage(
                            bytes: ptr,
                            bytesPerRow: bytesPerRow,
                            width: frame.pixelWidth,
                            height: frame.pixelHeight,
                            colorSpace: frame.colorSpace,
                            pixelFormat: frame.pixelFormat
                        )
                    } ?? nil
            }
        case .metalOnlyNoLayerEffectSampling, .incompatiblePixelFormatForLayerEffect, .missingFrame:
            image = nil
        }
        return WorldbendFrameArtwork(
            frameID: frame.frameID,
            frameRevision: revision,
            logicalSize: frame.logicalSize,
            contentRect: frame.contentRect,
            colorSpace: frame.colorSpace,
            pixelFormat: frame.pixelFormat,
            presentationTime: frame.presentationTime,
            presentationPath: frame.presentationPath,
            image: image
        )
    }

    /// Materialize a CGImage for SwiftUI layerEffect sampling. Disclosed
    /// SwiftUI presentation path — **not** Metal-direct glass sampling and
    /// **not** a claim that optical Metal sampling is zero-copy. Honors the
    /// frame's color-space tag; rejects non-BGRA8 formats instead of
    /// misinterpreting rgba16-float as 8-bit BGRA.
    @MainActor
    static func cgImage(
        from pixelBuffer: CVPixelBuffer,
        colorSpace: WorldbendColorSpaceTag,
        pixelFormat: WorldbendPixelFormatTag
    ) -> CGImage? {
        guard pixelFormat == .bgra8Unorm else { return nil }
        let type = CVPixelBufferGetPixelFormatType(pixelBuffer)
        guard type == kCVPixelFormatType_32BGRA else { return nil }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard width > 0, height > 0 else { return nil }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let space = cgColorSpace(for: colorSpace)
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(
            CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
        )
        guard
            let context = CGContext(
                data: base, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: bytesPerRow, space: space, bitmapInfo: bitmapInfo.rawValue
            )
        else { return nil }
        guard let image = context.makeImage() else { return nil }
        materializationCountForTests &+= 1
        return image
    }

    @MainActor
    static func cgImage(
        bytes: UnsafeRawBufferPointer,
        bytesPerRow: Int,
        width: Int,
        height: Int,
        colorSpace: WorldbendColorSpaceTag,
        pixelFormat: WorldbendPixelFormatTag
    ) -> CGImage? {
        guard pixelFormat == .bgra8Unorm,
            bytesPerRow > 0, width > 0, height > 0,
            bytes.count >= bytesPerRow * height
        else { return nil }
        let space = cgColorSpace(for: colorSpace)
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(
            CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
        )
        var copy = Data(bytes)
        return copy.withUnsafeMutableBytes { raw -> CGImage? in
            guard let base = raw.baseAddress,
                let context = CGContext(
                    data: base, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: space,
                    bitmapInfo: bitmapInfo.rawValue
                ),
                let image = context.makeImage()
            else { return nil }
            materializationCountForTests &+= 1
            return image
        }
    }
}

/// Pure SwiftUI image of one ``WorldbendFrameArtwork``. No hub acquire and no
/// CVPixelBuffer lock — scenes must supply the shared artwork once.
@MainActor
public struct WorldbendSharedFrameImage: View {
    private let artwork: WorldbendFrameArtwork?

    public init(artwork: WorldbendFrameArtwork?) {
        self.artwork = artwork
    }

    public var body: some View {
        let logical = artwork?.logicalSize ?? .zero
        let content = artwork?.contentRect ?? .zero
        return ZStack(alignment: .topLeading) {
            Color.clear
                .frame(
                    width: max(logical.width, 1),
                    height: max(logical.height, 1)
                )
            if let artwork, let image = artwork.image,
                content.width > 0, content.height > 0
            {
                Image(decorative: image, scale: imageScale(image: image, content: content))
                    .resizable()
                    .interpolation(.high)
                    .frame(width: content.width, height: content.height)
                    .offset(x: content.minX, y: content.minY)
            }
        }
        .frame(
            width: max(logical.width, 1),
            height: max(logical.height, 1),
            alignment: .topLeading
        )
        .accessibilityHidden(true)
    }

    private func imageScale(image: CGImage, content: CGRect) -> CGFloat {
        let sx = CGFloat(image.width) / max(content.width, 1)
        let sy = CGFloat(image.height) / max(content.height, 1)
        let scale = min(sx, sy)
        return scale.isFinite && scale > 0 ? scale : 1
    }
}

/// Standalone SwiftUI artwork backed by the hub. Prefer
/// ``WorldbendOpticalFrameScene`` for multi-pane hosts so one generation and
/// one CGImage serve backdrop + panes. This view still uses the hub's shared
/// `presentationArtwork()` cache (no per-view re-lock) and holds one access
/// for lifetime honesty.
@MainActor
public struct WorldbendFramePresentedView: View {
    private let hub: WorldbendFrameHub
    @State private var access: WorldbendFrameAccess?
    @State private var artwork: WorldbendFrameArtwork?

    public init(hub: WorldbendFrameHub) {
        self.hub = hub
    }

    public var body: some View {
        let revision = hub.frameRevision
        return WorldbendSharedFrameImage(artwork: artwork)
            .onAppear { sync(revision: revision) }
            .onChange(of: hub.frameRevision) { _, newRevision in sync(revision: newRevision) }
            .onDisappear {
                access?.endAccess()
                access = nil
                artwork = nil
            }
    }

    private func sync(revision _: UInt64) {
        access?.endAccess()
        access = hub.beginFrameAccess()
        artwork = hub.presentationArtwork()
    }
}

/// Builds Metal-direct bindings without CGImage materialization.
enum WorldbendMetalOpticalResolver {
    @MainActor
    static func resolve(
        frame: WorldbendCompletedFrame,
        revision: UInt64,
        device: any MTLDevice,
        textureCache: inout CVMetalTextureCache?
    ) -> WorldbendMetalOpticalBinding {
        if let texture = frame.metalTexture,
            isMetalSampleable(frame.pixelFormat, texture: texture)
        {
            return WorldbendMetalOpticalBinding(
                frameID: frame.frameID,
                frameRevision: revision,
                logicalSize: frame.logicalSize,
                contentRect: frame.contentRect,
                colorSpace: frame.colorSpace,
                pixelFormat: frame.pixelFormat,
                path: .metalDirectFromTexture,
                texture: texture,
                retainedCVTexture: nil,
                device: device,
                resourceIdentity: frame.resourceIdentity,
                alphaMode: frame.alphaMode
            )
        }
        if let pixelBuffer = frame.pixelBuffer {
            if let wrapped = wrapPixelBuffer(
                pixelBuffer, frame: frame, device: device, textureCache: &textureCache
            ) {
                return WorldbendMetalOpticalBinding(
                    frameID: frame.frameID,
                    frameRevision: revision,
                    logicalSize: frame.logicalSize,
                    contentRect: frame.contentRect,
                    colorSpace: frame.colorSpace,
                    pixelFormat: frame.pixelFormat,
                    path: .metalDirectFromPixelBuffer,
                    texture: wrapped.texture,
                    retainedCVTexture: wrapped.cvTexture,
                    device: device,
                    resourceIdentity: frame.resourceIdentity,
                    alphaMode: frame.alphaMode
                )
            }
            return WorldbendMetalOpticalBinding.unavailable(
                path: .unavailableIncompatibleFormat,
                revision: revision,
                frame: frame,
                device: device
            )
        }
        if frame.withCPUBytesIfAvailable({ _, _ in true }) == true {
            return WorldbendMetalOpticalBinding.unavailable(
                path: .unavailableCpuOnly,
                revision: revision,
                frame: frame,
                device: device
            )
        }
        return WorldbendMetalOpticalBinding.unavailable(
            path: .unavailableMissingFrame,
            revision: revision,
            frame: frame,
            device: device
        )
    }

    private static func isMetalSampleable(
        _ tag: WorldbendPixelFormatTag, texture: any MTLTexture
    ) -> Bool {
        switch tag {
        case .bgra8Unorm:
            return texture.pixelFormat == .bgra8Unorm || texture.pixelFormat == .bgra8Unorm_srgb
        case .rgba16Float:
            return texture.pixelFormat == .rgba16Float
        case .unknown:
            return false
        }
    }

    private static func wrapPixelBuffer(
        _ pixelBuffer: CVPixelBuffer,
        frame: WorldbendCompletedFrame,
        device: any MTLDevice,
        textureCache: inout CVMetalTextureCache?
    ) -> (texture: any MTLTexture, cvTexture: CVMetalTexture)? {
        let metalFormat: MTLPixelFormat
        switch frame.pixelFormat {
        case .bgra8Unorm:
            guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else {
                return nil
            }
            metalFormat = .bgra8Unorm
        case .rgba16Float:
            // Common float camera/render buffers; reject unknown OSTypes.
            let type = CVPixelBufferGetPixelFormatType(pixelBuffer)
            guard type == kCVPixelFormatType_64RGBAHalf else { return nil }
            metalFormat = .rgba16Float
        case .unknown:
            return nil
        }
        if textureCache == nil {
            var cache: CVMetalTextureCache?
            let status = CVMetalTextureCacheCreate(
                kCFAllocatorDefault, nil, device, nil, &cache
            )
            guard status == kCVReturnSuccess else { return nil }
            textureCache = cache
        }
        guard let cache = textureCache else { return nil }
        var cvTexture: CVMetalTexture?
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, pixelBuffer, nil,
            metalFormat, width, height, 0, &cvTexture
        )
        guard status == kCVReturnSuccess,
            let cvTexture,
            let texture = CVMetalTextureGetTexture(cvTexture)
        else { return nil }
        return (texture, cvTexture)
    }
}
