import Foundation
import Metal
import simd

/// Shared-frame frost prefilter: one mip pyramid per completed Metal binding
/// keyed by **source identity + device + frameRevision**. Large `frostRadius`
/// (~12–40pt) samples this pyramid at a **conservative** LOD (prefilter only)
/// plus a fragment 7×7 Gaussian in UV spanning the frost radius — continuous
/// low-pass, not mip-box mosaic and not sparse multi-ring ghosts. No APP
/// background capturer.
///
/// Cost is bounded: one blit + `generateMipmaps` per key change (≈1.33× source
/// texels), encoded into the **same** renderer draw `commandBuffer` ahead of
/// the fragment pass (serial queue order; no MainActor `waitUntilCompleted`).
/// Fragment taps stay ≤49 Gaussian (≤147 with chromatic split).
@MainActor
public enum WorldbendFrostPyramid {
    /// Conservative mip LOD for a frost radius in logical points.
    /// `σ_texels ≈ frostPoints * (texels / contentPoints)` (SwiftUI radius ≈ σ).
    /// Returns `max(0, log2(σ) - lodHeadroom)` so the fragment 7×7 Gaussian
    /// keeps real spatial support; a full `log2(σ)` LOD made the old residual
    /// smaller than one mip texel (mosaic).
    public static let lodHeadroom: Float = 1.5

    public static func lod(
        frostRadiusPoints: Float,
        contentSizePoints: SIMD2<Float>,
        sourceSizeTexels: SIMD2<Float>
    ) -> Float {
        // SwiftUI `.blur(radius:)` ≈ Gaussian σ in points. Mean texels-per-point
        // × radius → σ in texels. Conservative LOD only prefilters for the
        // 7×7 UV Gaussian (tap spacing ≈ σ).
        let texelsPerPointX = sourceSizeTexels.x / max(contentSizePoints.x, 1)
        let texelsPerPointY = sourceSizeTexels.y / max(contentSizePoints.y, 1)
        let tppMean = 0.5 * (texelsPerPointX + texelsPerPointY)
        let sigmaTexels = frostRadiusPoints * tppMean
        return max(0, log2(max(sigmaTexels, 1)) - lodHeadroom)
    }

    /// Encode a mip-chain copy of `source` into `commandBuffer` (blit +
    /// `generateMipmaps`). Never waits on the GPU. Reuses `cache` storage when
    /// size/format match; always re-copies pixels (caller decides when to call).
    /// Returns the pyramid on successful encode, or `nil` if encode failed
    /// (caller must **not** publish that miss as ready).
    public static func encodeMipSource(
        device: any MTLDevice,
        commandBuffer: any MTLCommandBuffer,
        source: any MTLTexture,
        cache: inout (any MTLTexture)?
    ) -> (any MTLTexture)? {
        if source.mipmapLevelCount > 1 {
            return source
        }
        let width = max(source.width, 1)
        let height = max(source.height, 1)
        let pyramid: any MTLTexture
        if let existing = cache,
           existing.width == width,
           existing.height == height,
           existing.pixelFormat == source.pixelFormat,
           existing.mipmapLevelCount > 1 {
            pyramid = existing
        } else {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: source.pixelFormat,
                width: width,
                height: height,
                mipmapped: true
            )
            descriptor.usage = [.shaderRead, .shaderWrite]
            descriptor.storageMode = .private
            guard let created = device.makeTexture(descriptor: descriptor) else {
                return nil
            }
            pyramid = created
            cache = created
        }
        guard let blit = commandBuffer.makeBlitCommandEncoder() else {
            return nil
        }
        blit.copy(
            from: source,
            sourceSlice: 0,
            sourceLevel: 0,
            sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
            sourceSize: MTLSize(width: source.width, height: source.height, depth: 1),
            to: pyramid,
            destinationSlice: 0,
            destinationLevel: 0,
            destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.generateMipmaps(for: pyramid)
        blit.endEncoding()
        return pyramid
    }

    /// Legacy name kept for call-site clarity in older notes; forwards to
    /// ``encodeMipSource`` and never blocks the CPU.
    @available(*, deprecated, renamed: "encodeMipSource")
    public static func ensureMipSource(
        device: any MTLDevice,
        queue: any MTLCommandQueue,
        source: any MTLTexture,
        cache: inout (any MTLTexture)?
    ) -> any MTLTexture {
        guard let buffer = queue.makeCommandBuffer(),
              let built = encodeMipSource(
                device: device,
                commandBuffer: buffer,
                source: source,
                cache: &cache
              )
        else {
            return source
        }
        buffer.commit()
        // Intentionally no waitUntilCompleted — caller / serial queue owns order.
        return built
    }
}

/// Per-renderer cache slot for the shared frost pyramid.
/// Key = source ObjectIdentifier + device.registryID + frameRevision.
/// A new revision **or** a different source at the same revision forces
/// re-copy + generateMipmaps. Failed GPU commands clear ready and must not
/// be sampled as a published pyramid on later frames.
@MainActor
public final class WorldbendFrostPyramidCache {
    private var pyramid: (any MTLTexture)?
    private var frameRevision: UInt64?
    private var deviceID: UInt64?
    private var sourceID: ObjectIdentifier?
    /// Encode succeeded for the current key; safe to sample on this serial queue
    /// without re-blitting. Cleared when a completed handler reports failure.
    private var encodedForKey = false
    /// GPU completion confirmed for the current key (cross-check / diagnostics).
    private var gpuReady = false
    private var generation: UInt64 = 0
    private let queue: any MTLCommandQueue

    public init(queue: any MTLCommandQueue) {
        self.queue = queue
    }

    /// Whether the current key has a successfully encoded pyramid (not necessarily
    /// GPU-completed yet — same-buffer draw order still holds on this queue).
    public var hasEncodedPyramid: Bool { encodedForKey && pyramid != nil }

    /// Whether the last encode for the current key completed on the GPU without error.
    public var isGPUReady: Bool { gpuReady && encodedForKey }

    /// Texture to bind for large-frost sampling. When the cache key misses,
    /// encodes blit + mipmaps into `commandBuffer` **before** the caller's
    /// render encoder (same serial queue). Never calls `waitUntilCompleted`.
    /// On encode failure returns `source` and does **not** mark the pyramid ready.
    public func sampleTexture(
        device: any MTLDevice,
        source: any MTLTexture,
        frameRevision: UInt64,
        commandBuffer: any MTLCommandBuffer
    ) -> any MTLTexture {
        if source.mipmapLevelCount > 1 {
            return source
        }
        let srcID = ObjectIdentifier(source)
        let deviceMatch = device.registryID == deviceID
        let keyMatch =
            encodedForKey
            && frameRevision == self.frameRevision
            && deviceMatch
            && srcID == sourceID
            && pyramid != nil
            && pyramid?.width == source.width
            && pyramid?.height == source.height
            && pyramid?.pixelFormat == source.pixelFormat
        if keyMatch, let pyramid {
            return pyramid
        }

        var slot = pyramid
        guard let built = WorldbendFrostPyramid.encodeMipSource(
            device: device,
            commandBuffer: commandBuffer,
            source: source,
            cache: &slot
        ), built.mipmapLevelCount > 1, built !== source
        else {
            // Encode failed or source already mipped — do not publish ready.
            encodedForKey = false
            gpuReady = false
            return source
        }

        generation &+= 1
        let gen = generation
        pyramid = slot
        self.frameRevision = frameRevision
        deviceID = device.registryID
        sourceID = srcID
        encodedForKey = true
        gpuReady = false

        commandBuffer.addCompletedHandler { [weak self] buffer in
            let ok = buffer.status == .completed
            Task { @MainActor in
                guard let self, self.generation == gen else { return }
                if ok {
                    self.gpuReady = true
                } else {
                    // Failed command must not stay published as ready.
                    self.encodedForKey = false
                    self.gpuReady = false
                }
            }
        }
        return built
    }

    public func clear() {
        pyramid = nil
        frameRevision = nil
        deviceID = nil
        sourceID = nil
        encodedForKey = false
        gpuReady = false
        generation &+= 1
    }
}
