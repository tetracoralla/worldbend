import CoreGraphics
import Foundation
import Metal
import MetalKit
import simd

/// Metallib readiness for wet-glass kernels. Plain `swift test` copies `.metal`
/// sources; Xcode hosts compile `default.metallib` including wet-glass symbols.
public enum WorldbendWetGlassRuntime {
    public static var hasCompiledShader: Bool {
        Bundle.module.url(forResource: "default", withExtension: "metallib") != nil
    }

    /// Bundled Raindrop FX MIT license text when package resources are present.
    public static var raindropLicenseURL: URL? {
        Bundle.module.url(forResource: "RaindropFX-LICENSE", withExtension: "txt")
    }
}

/// CPU-side uniforms matching `WorldbendWetGlass.metal`.
public struct WorldbendWetGlassUniforms: Equatable, Sendable {
    public var viewSize: SIMD2<Float>
    public var cardMode: Float
    public var padding: Float

    public init(viewSize: CGSize, mode: WorldbendWetGlassComposeMode) {
        self.viewSize = SIMD2(Float(viewSize.width), Float(viewSize.height))
        self.cardMode = mode == .cardRim ? 1 : 0
        self.padding = 0
    }
}

/// Optics pushed as a second constant buffer so recipe fields stay editable
/// without rebuilding the metallib. Layout must match the Metal struct.
public struct WorldbendWetGlassOpticsUniforms: Equatable, Sendable {
    // Scalar layout matched to WetGlass.metal (no SIMD3 padding surprises).
    public var normalStrength: Float
    public var refractionBase: Float
    public var refractionHeight: Float
    public var specularPower: Float
    public var specularGain: Float
    public var diffuseGain: Float
    public var diffuseReference: Float
    public var rimShadeGain: Float
    public var coverageMin: Float
    public var coverageMax: Float
    public var edgeSafety: Float
    public var occlusionProbes: Float
    public var surfaceLightX: Float
    public var surfaceLightY: Float
    public var surfaceLightZ: Float
    public var cardLightX: Float
    public var cardLightY: Float
    public var cardGleamGain: Float
    public var cardShadeGain: Float
    public var padding: Float

    public init(optics: WorldbendWetGlassRecipe.Optics) {
        normalStrength = Float(optics.normalStrength)
        refractionBase = Float(optics.refractionBasePoints)
        refractionHeight = Float(optics.refractionHeightPoints)
        specularPower = Float(optics.specularPower)
        specularGain = Float(optics.specularGain)
        diffuseGain = Float(optics.diffuseGain)
        diffuseReference = Float(optics.diffuseReference)
        rimShadeGain = Float(optics.rimShadeGain)
        coverageMin = Float(optics.coverageHeightRange.min)
        coverageMax = Float(optics.coverageHeightRange.max)
        edgeSafety = Float(optics.edgeSafetyPoints)
        occlusionProbes = Float(optics.occlusionRayProbes)
        let L = optics.surfaceLightVector
        surfaceLightX = Float(L[0]); surfaceLightY = Float(L[1]); surfaceLightZ = Float(L[2])
        let C = optics.cardLightDirection
        cardLightX = Float(C[0]); cardLightY = Float(C[1])
        cardGleamGain = Float(optics.cardGleamGain)
        cardShadeGain = Float(optics.cardShadeGain)
        padding = 0
    }
}

/// Documented water / composite blend factors so tests can assert APP parity
/// without requiring a live metallib.
public struct WorldbendWetGlassWaterBlendConfiguration: Equatable, Sendable {
    public var isBlendingEnabled: Bool
    public var sourceRGBBlendFactor: MTLBlendFactor
    public var destinationRGBBlendFactor: MTLBlendFactor
    public var sourceAlphaBlendFactor: MTLBlendFactor
    public var destinationAlphaBlendFactor: MTLBlendFactor

    public init(
        isBlendingEnabled: Bool,
        sourceRGBBlendFactor: MTLBlendFactor,
        destinationRGBBlendFactor: MTLBlendFactor,
        sourceAlphaBlendFactor: MTLBlendFactor,
        destinationAlphaBlendFactor: MTLBlendFactor
    ) {
        self.isBlendingEnabled = isBlendingEnabled
        self.sourceRGBBlendFactor = sourceRGBBlendFactor
        self.destinationRGBBlendFactor = destinationRGBBlendFactor
        self.sourceAlphaBlendFactor = sourceAlphaBlendFactor
        self.destinationAlphaBlendFactor = destinationAlphaBlendFactor
    }

    /// Additive one+one — overlapping height must accumulate.
    public var isAdditiveOneOne: Bool {
        isBlendingEnabled
            && sourceRGBBlendFactor == .one
            && destinationRGBBlendFactor == .one
            && sourceAlphaBlendFactor == .one
            && destinationAlphaBlendFactor == .one
    }

    /// Water-height field (`.r16Float`): additive accumulate.
    public static let waterField = WorldbendWetGlassWaterBlendConfiguration(
        isBlendingEnabled: true,
        sourceRGBBlendFactor: .one,
        destinationRGBBlendFactor: .one,
        sourceAlphaBlendFactor: .one,
        destinationAlphaBlendFactor: .one
    )

    /// Photo / composite: premultiplied one / oneMinusSourceAlpha.
    public static let composite = WorldbendWetGlassWaterBlendConfiguration(
        isBlendingEnabled: true,
        sourceRGBBlendFactor: .one,
        destinationRGBBlendFactor: .oneMinusSourceAlpha,
        sourceAlphaBlendFactor: .one,
        destinationAlphaBlendFactor: .oneMinusSourceAlpha
    )
}

/// Shared Metal wet-glass composer. APP supplies mask + backdrop texture (from
/// FrameHub Metal binding or local loader) and simulation particles; Worldbend
/// owns water-field accumulation and refraction/rim compose. Does not capture
/// the screen and does not own product weather clocks.
@MainActor
public final class WorldbendWetGlassComposer {
    public enum Status: Equatable, Sendable {
        case ready
        case missingMetallib
        case pipelineFailed(String)
    }

    public let device: MTLDevice
    public private(set) var status: Status
    private let queue: MTLCommandQueue?
    private var waterPipeline: MTLRenderPipelineState?
    private var photoPipeline: MTLRenderPipelineState?
    private var compositePipeline: MTLRenderPipelineState?
    private var waterField: (any MTLTexture)?
    private var dropBuffers: [MTLBuffer?] = [nil, nil, nil]
    private var bufferIndex = 0
    /// Gates triple-buffered drop uploads (APP ArrivalRainWindow parity).
    private let inFlight = DispatchSemaphore(value: 3)

    public init(device: MTLDevice = MTLCreateSystemDefaultDevice()!) {
        self.device = device
        self.queue = device.makeCommandQueue()
        self.status = .missingMetallib
        let library: MTLLibrary?
        if let bundled = try? device.makeDefaultLibrary(bundle: .module) {
            library = bundled
        } else {
            library = device.makeDefaultLibrary()
        }
        guard let library else {
            self.status = WorldbendWetGlassRuntime.hasCompiledShader
                ? .pipelineFailed("default library unavailable")
                : .missingMetallib
            return
        }
        do {
            try buildPipelines(library: library)
            self.status = .ready
        } catch {
            self.status = .pipelineFailed(String(describing: error))
        }
    }

    public var isReady: Bool { if case .ready = status { return true }; return false }

    /// Water-height field blend: additive one+one (APP ArrivalRainWindow /
    /// ArrivalRainGlass height accumulation). Overlapping / merging drops must
    /// **add** height, not replace with the last draw. Photo/composite stay
    /// premultiplied one / oneMinusSourceAlpha.
    /// Nonisolated alias of `WorldbendWetGlassWaterBlendConfiguration.waterField`.
    nonisolated public static var waterFieldBlend: WorldbendWetGlassWaterBlendConfiguration {
        .waterField
    }

    /// Nonisolated alias of `WorldbendWetGlassWaterBlendConfiguration.composite`.
    nonisolated public static var compositeBlend: WorldbendWetGlassWaterBlendConfiguration {
        .composite
    }

    private func buildPipelines(library: MTLLibrary) throws {
        func pipeline(
            _ vertex: String,
            _ fragment: String,
            pixelFormat: MTLPixelFormat,
            blend: WorldbendWetGlassWaterBlendConfiguration?
        ) throws -> MTLRenderPipelineState {
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = library.makeFunction(name: vertex)
            desc.fragmentFunction = library.makeFunction(name: fragment)
            desc.colorAttachments[0].pixelFormat = pixelFormat
            if let blend {
                let attachment = desc.colorAttachments[0]!
                attachment.isBlendingEnabled = blend.isBlendingEnabled
                attachment.sourceRGBBlendFactor = blend.sourceRGBBlendFactor
                attachment.destinationRGBBlendFactor = blend.destinationRGBBlendFactor
                attachment.sourceAlphaBlendFactor = blend.sourceAlphaBlendFactor
                attachment.destinationAlphaBlendFactor = blend.destinationAlphaBlendFactor
            }
            guard desc.vertexFunction != nil, desc.fragmentFunction != nil else {
                throw WorldbendWetGlassError.encodeFailed("missing \(vertex)/\(fragment)")
            }
            return try device.makeRenderPipelineState(descriptor: desc)
        }
        // r16Float water target: additive accumulate (one+one), matching APP.
        waterPipeline = try pipeline(
            "worldbendWetGlassWaterVertex", "worldbendWetGlassWaterFragment",
            pixelFormat: .r16Float, blend: Self.waterFieldBlend
        )
        photoPipeline = try pipeline(
            "worldbendWetGlassFullscreenVertex", "worldbendWetGlassPhotoFragment",
            pixelFormat: .bgra8Unorm, blend: Self.compositeBlend
        )
        compositePipeline = try pipeline(
            "worldbendWetGlassFullscreenVertex", "worldbendWetGlassFragment",
            pixelFormat: .bgra8Unorm, blend: Self.compositeBlend
        )
    }

    /// Encode only the water-height field and return the peak `.r` sample after
    /// GPU completion. Used to prove overlapping drops **accumulate** under
    /// additive blending (not last-draw overwrite). Requires a ready metallib.
    public func waterFieldPeakHeight(
        particles: [SIMD4<Float>],
        logicalSize: CGSize,
        pixelSize: CGSize
    ) throws -> Float {
        guard isReady, let waterPipeline, let queue else {
            throw WorldbendWetGlassError.missingMetallib
        }
        guard let command = queue.makeCommandBuffer() else {
            throw WorldbendWetGlassError.encodeFailed("command buffer")
        }
        guard inFlight.wait(timeout: .now()) == .success else {
            throw WorldbendWetGlassError.encodeFailed("GPU in-flight drop buffers saturated")
        }
        var submitted = false
        defer { if !submitted { inFlight.signal() } }

        let width = max(1, Int(pixelSize.width.rounded()))
        let height = max(1, Int(pixelSize.height.rounded()))
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .r16Float, width: width, height: height, mipmapped: false
        )
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .shared
        guard let water = device.makeTexture(descriptor: descriptor) else {
            throw WorldbendWetGlassError.encodeFailed("shared water field")
        }
        guard let buffer = upload(particles) else {
            throw WorldbendWetGlassError.encodeFailed("drop buffer")
        }
        var view = WorldbendWetGlassUniforms(viewSize: logicalSize, mode: .window)

        let waterPass = MTLRenderPassDescriptor()
        waterPass.colorAttachments[0].texture = water
        waterPass.colorAttachments[0].loadAction = .clear
        waterPass.colorAttachments[0].storeAction = .store
        waterPass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
        guard let fieldEncoder = command.makeRenderCommandEncoder(descriptor: waterPass) else {
            throw WorldbendWetGlassError.encodeFailed("water encoder")
        }
        fieldEncoder.setRenderPipelineState(waterPipeline)
        fieldEncoder.setVertexBuffer(buffer, offset: 0, index: 0)
        fieldEncoder.setVertexBytes(&view, length: MemoryLayout<WorldbendWetGlassUniforms>.stride, index: 1)
        if !particles.isEmpty {
            fieldEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: particles.count * 6)
        }
        fieldEncoder.endEncoding()

        let semaphore = inFlight
        command.addCompletedHandler { _ in semaphore.signal() }
        bufferIndex = (bufferIndex + 1) % dropBuffers.count
        submitted = true
        command.commit()
        command.waitUntilCompleted()
        if command.status != .completed {
            throw WorldbendWetGlassError.encodeFailed("water field GPU status \(command.status.rawValue)")
        }

        // Sample a dense grid; peak proves additive overlap at shared centers.
        var peak: Float = 0
        var pixel = SIMD2<Float16>(repeating: 0)
        let bytesPerRow = MemoryLayout<Float16>.stride
        for y in 0..<height {
            for x in 0..<width {
                let region = MTLRegionMake2D(x, y, 1, 1)
                water.getBytes(&pixel, bytesPerRow: bytesPerRow, from: region, mipmapLevel: 0)
                peak = max(peak, Float(pixel.x))
            }
        }
        return peak
    }

    /// Encode water field + optional photo blit + wet composite into `pass`.
    /// `backdrop` is the **content-pixel** photograph / shared completed frame
    /// (FrameHub Metal texture). UV 0…1 maps to that texture extent — the same
    /// contract as APP `ArrivalRainWindow.produceFrame` (`logicalSize` =
    /// `contentRect.size`). Letterboxed placement into a larger viewport stays
    /// with APP (or optical backdrop blit); this encoder does not re-map
    /// `contentRect` inside a larger canvas. `mask` is APP glazing (R channel).
    ///
    /// Triple-buffers drop uploads with an in-flight gate (capacity 3). Caller
    /// **must** `commit` the command buffer so the completion handler releases
    /// a slot; skipping commit after a successful encode leaks a slot until
    /// process end. Color tags on the frame are not converted here (raw sample,
    /// matching APP ArrivalRainGlass).
    @discardableResult
    public func encode(
        command: MTLCommandBuffer,
        pass: MTLRenderPassDescriptor,
        backdrop: any MTLTexture,
        mask: any MTLTexture,
        particles: [SIMD4<Float>],
        logicalSize: CGSize,
        pixelSize: CGSize,
        recipe: WorldbendWetGlassRecipe,
        mode: WorldbendWetGlassComposeMode,
        paintBackground: Bool
    ) throws -> Int {
        guard isReady,
              let waterPipeline, let photoPipeline, let compositePipeline else {
            throw WorldbendWetGlassError.missingMetallib
        }
        guard inFlight.wait(timeout: .now()) == .success else {
            throw WorldbendWetGlassError.encodeFailed(
                "GPU in-flight drop buffers saturated; skip frame or wait for completion"
            )
        }
        var submitted = false
        defer { if !submitted { inFlight.signal() } }

        guard let water = waterField(size: pixelSize) else {
            throw WorldbendWetGlassError.encodeFailed("water field")
        }
        guard let buffer = upload(particles) else {
            throw WorldbendWetGlassError.encodeFailed("drop buffer")
        }
        var view = WorldbendWetGlassUniforms(viewSize: logicalSize, mode: mode)
        var optics = WorldbendWetGlassOpticsUniforms(optics: recipe.optics)

        let waterPass = MTLRenderPassDescriptor()
        waterPass.colorAttachments[0].texture = water
        waterPass.colorAttachments[0].loadAction = .clear
        waterPass.colorAttachments[0].storeAction = .store
        waterPass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
        guard let fieldEncoder = command.makeRenderCommandEncoder(descriptor: waterPass) else {
            throw WorldbendWetGlassError.encodeFailed("water encoder")
        }
        fieldEncoder.setRenderPipelineState(waterPipeline)
        fieldEncoder.setVertexBuffer(buffer, offset: 0, index: 0)
        fieldEncoder.setVertexBytes(&view, length: MemoryLayout<WorldbendWetGlassUniforms>.stride, index: 1)
        if !particles.isEmpty {
            fieldEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: particles.count * 6)
        }
        fieldEncoder.endEncoding()

        guard let encoder = command.makeRenderCommandEncoder(descriptor: pass) else {
            throw WorldbendWetGlassError.encodeFailed("composite encoder")
        }
        if paintBackground {
            encoder.setRenderPipelineState(photoPipeline)
            encoder.setFragmentTexture(backdrop, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        }
        encoder.setRenderPipelineState(compositePipeline)
        encoder.setFragmentTexture(backdrop, index: 0)
        encoder.setFragmentTexture(mask, index: 1)
        encoder.setFragmentTexture(water, index: 2)
        encoder.setFragmentBytes(&view, length: MemoryLayout<WorldbendWetGlassUniforms>.stride, index: 1)
        encoder.setFragmentBytes(&optics, length: MemoryLayout<WorldbendWetGlassOpticsUniforms>.stride, index: 2)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()

        let semaphore = inFlight
        command.addCompletedHandler { _ in semaphore.signal() }
        bufferIndex = (bufferIndex + 1) % dropBuffers.count
        submitted = true
        return particles.count
    }

    /// Convenience: beginFrameAccess on a hub, require Metal texture, encode.
    ///
    /// Requires `logicalSize` ≈ `frame.contentRect.size` (content-local points).
    /// FrameHub `contentRect` origin/letterboxing into a larger viewport is not
    /// applied inside this encoder — publish/crop the content texture (APP
    /// produceFrame pattern) or blit with optical backdrop first.
    @discardableResult
    public func encodeFromFrameHub(
        hub: WorldbendFrameHub,
        command: MTLCommandBuffer,
        pass: MTLRenderPassDescriptor,
        mask: any MTLTexture,
        particles: [SIMD4<Float>],
        logicalSize: CGSize,
        pixelSize: CGSize,
        recipe: WorldbendWetGlassRecipe,
        mode: WorldbendWetGlassComposeMode,
        paintBackground: Bool
    ) throws -> Int {
        guard let access = hub.beginFrameAccess() else {
            throw WorldbendWetGlassError.encodeFailed("no published frame")
        }
        defer { access.endAccess() }
        let frame = access.frame
        let content = frame.contentRect
        let tol: CGFloat = 0.5
        guard abs(content.width - logicalSize.width) <= tol,
              abs(content.height - logicalSize.height) <= tol else {
            throw WorldbendWetGlassError.encodeFailed(
                "encodeFromFrameHub expects logicalSize == frame.contentRect.size (content-local); got logical \(logicalSize) contentRect \(content). Letterbox/placement is APP-side or optical blit."
            )
        }
        let binding = hub.metalOpticalBinding(device: device)
        guard let texture = binding.texture ?? frame.metalTexture else {
            throw WorldbendWetGlassError.encodeFailed("frame has no Metal texture; publish MTLTexture or BGRA CVPixelBuffer")
        }
        return try encode(
            command: command, pass: pass, backdrop: texture, mask: mask,
            particles: particles, logicalSize: logicalSize, pixelSize: pixelSize,
            recipe: recipe, mode: mode, paintBackground: paintBackground
        )
    }

    private func waterField(size: CGSize) -> (any MTLTexture)? {
        let width = max(1, Int(size.width.rounded()))
        let height = max(1, Int(size.height.rounded()))
        if let waterField, waterField.width == width, waterField.height == height {
            return waterField
        }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .r16Float, width: width, height: height, mipmapped: false
        )
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .private
        waterField = device.makeTexture(descriptor: descriptor)
        return waterField
    }

    private func upload(_ packed: [SIMD4<Float>]) -> MTLBuffer? {
        let bytes = MemoryLayout<SIMD4<Float>>.stride * max(1, packed.count)
        if dropBuffers[bufferIndex] == nil || (dropBuffers[bufferIndex]?.length ?? 0) < bytes {
            dropBuffers[bufferIndex] = device.makeBuffer(length: max(bytes, 4096), options: .storageModeShared)
        }
        guard let dropBuffer = dropBuffers[bufferIndex] else { return nil }
        if !packed.isEmpty {
            packed.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                dropBuffer.contents().copyMemory(from: base, byteCount: raw.count)
            }
        }
        return dropBuffer
    }
}
