import CoreVideo
import Foundation
import Metal
import MetalKit
import Observation
import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// How a Metal-direct optical host obtained its shared GPU texture.
/// Distinct from ``WorldbendFramePresentationPath`` (SwiftUI layerEffect /
/// CGImage). Never claims layerEffect binds MTLTexture.
public enum WorldbendMetalOpticalPath: String, Sendable, Codable {
    /// Published `MTLTexture` sampled directly by the Metal optical host.
    case metalDirectFromTexture = "metal-direct-from-texture"
    /// `CVPixelBuffer` wrapped through `CVMetalTextureCache` (IOSurface-backed
    /// zero-copy when the buffer supports it). No CGImage materialization.
    case metalDirectFromPixelBuffer = "metal-direct-from-pixel-buffer"
    case unavailableMissingFrame = "unavailable-missing-frame"
    case unavailableNoMetalDevice = "unavailable-no-metal-device"
    case unavailableCpuOnly = "unavailable-cpu-only"
    case unavailableIncompatibleFormat = "unavailable-incompatible-format"
}

/// One shared Metal binding for backdrop + every optical pane of a generation.
/// Constructed at most once per `frameRevision` via
/// ``WorldbendFrameHub/metalOpticalBinding(device:)``. Does **not** go through
/// ``WorldbendFrameImaging`` / CGImage.
@MainActor
public struct WorldbendMetalOpticalBinding {
    public let frameID: WorldbendFrameID
    public let frameRevision: UInt64
    public let logicalSize: CGSize
    public let contentRect: CGRect
    public let colorSpace: WorldbendColorSpaceTag
    public let pixelFormat: WorldbendPixelFormatTag
    public let path: WorldbendMetalOpticalPath
    public let resourceIdentity: WorldbendFrameResourceIdentity?
    public let alphaMode: WorldbendFrameAlphaMode
    /// Shared source texture for Metal-direct hosts. Nil when `path` is unavailable.
    public let texture: (any MTLTexture)?
    /// Keeps CVMetalTexture alive when the binding wraps a pixel buffer.
    let retainedCVTexture: CVMetalTexture?
    public let device: (any MTLDevice)?

    public var isReady: Bool { texture != nil }

    init(
        frameID: WorldbendFrameID,
        frameRevision: UInt64,
        logicalSize: CGSize,
        contentRect: CGRect,
        colorSpace: WorldbendColorSpaceTag,
        pixelFormat: WorldbendPixelFormatTag,
        path: WorldbendMetalOpticalPath,
        texture: (any MTLTexture)?,
        retainedCVTexture: CVMetalTexture?,
        device: (any MTLDevice)?,
        resourceIdentity: WorldbendFrameResourceIdentity? = nil,
        alphaMode: WorldbendFrameAlphaMode = .unspecified
    ) {
        self.frameID = frameID
        self.frameRevision = frameRevision
        self.logicalSize = logicalSize
        self.contentRect = contentRect
        self.colorSpace = colorSpace
        self.pixelFormat = pixelFormat
        self.path = path
        self.texture = texture
        self.retainedCVTexture = retainedCVTexture
        self.device = device
        self.resourceIdentity = resourceIdentity
        self.alphaMode = alphaMode
    }

    static func unavailable(
        path: WorldbendMetalOpticalPath,
        revision: UInt64,
        frame: WorldbendCompletedFrame? = nil,
        device: (any MTLDevice)? = nil
    ) -> WorldbendMetalOpticalBinding {
        WorldbendMetalOpticalBinding(
            frameID: frame?.frameID ?? WorldbendFrameID(0),
            frameRevision: revision,
            logicalSize: frame?.logicalSize ?? .zero,
            contentRect: frame?.contentRect ?? .zero,
            colorSpace: frame?.colorSpace ?? .sRGB,
            pixelFormat: frame?.pixelFormat ?? .unknown,
            path: path,
            texture: nil,
            retainedCVTexture: nil,
            device: device,
            resourceIdentity: frame?.resourceIdentity,
            alphaMode: frame?.alphaMode ?? .unspecified
        )
    }
}

public struct WorldbendMetalOpticalSceneContext {
    public let binding: WorldbendMetalOpticalBinding
    public let renderer: WorldbendMetalOpticalRenderer?
    public let coordinateSpace: UUID
    public let sceneSize: CGSize
}

/// Pure helpers shared with the Metal-direct shader unit contract.
enum WorldbendMetalOpticalMath {
    /// `frostRadius` is logical points (same unit as SwiftUI `.blur(radius:)`).
    /// Returns a UV-space step across `contentRect` size — resolution-independent,
    /// not `frost / texturePixels` (which under-blurred @2x/@3x hosts).
    static func frostUVStep(
        frostRadiusPoints: Float,
        contentSizePoints: SIMD2<Float>
    ) -> SIMD2<Float> {
        SIMD2(
            frostRadiusPoints / max(contentSizePoints.x, 1),
            frostRadiusPoints / max(contentSizePoints.y, 1)
        )
    }
}

struct WorldbendMetalOpticalUniforms {
    var paneFrame: SIMD4<Float>
    var contentRect: SIMD4<Float>
    var logicalSize: SIMD2<Float>
    var drawableSize: SIMD2<Float>
    var cornerRadius: Float
    var edgeWidth: Float
    var refractionScale: Float
    var chromaticOffset: Float
    var lightDirection: SIMD2<Float>
    var highlightStrength: Float
    var frostRadius: Float
    var frostLod: Float
    var coverageMode: Float
}

public struct WorldbendMetalPresentationSample: Sendable {
    public enum Role: String, Sendable { case backdrop, optical }
    public let frameID: WorldbendFrameID
    public let role: Role
    /// CAMetalDrawable's actual presented time, not command submission time.
    public let time: Double
}

public struct WorldbendMetalOpticalMetrics: Sendable {
    public fileprivate(set) var encodedBackdrops: UInt64 = 0
    public fileprivate(set) var encodedPanes: UInt64 = 0
    public fileprivate(set) var gpuCompleted: UInt64 = 0
    public fileprivate(set) var gpuFailed: UInt64 = 0
    public fileprivate(set) var presentedBackdrops: UInt64 = 0
    public fileprivate(set) var presentedPanes: UInt64 = 0
    public fileprivate(set) var measuredGPUCommands: UInt64 = 0
    public fileprivate(set) var totalGPUMilliseconds: Double = 0
}

/// Loads the package metallib and encodes Metal-direct optical draws.
/// Plain `swift test` may lack `default.metallib`; hosts built with Xcode have it.
@MainActor
public final class WorldbendMetalOpticalRenderer {
    public enum Status: String, Sendable {
        case ready
        case missingMetallib = "missing-metallib"
        case pipelineFailure = "pipeline-failure"
        case noDevice = "no-device"
    }

    public let device: any MTLDevice
    public private(set) var status: Status
    public let recordsPresentation: Bool
    public var presentationTelemetryAvailable: Bool {
        #if targetEnvironment(simulator)
            false  // Current Apple Simulator headers omit drawable presentation APIs.
        #else
            true
        #endif
    }
    public private(set) var metrics = WorldbendMetalOpticalMetrics()
    public private(set) var recentPresentations: [WorldbendMetalPresentationSample] = []
    private let queue: (any MTLCommandQueue)?
    private var opticalPipeline: (any MTLRenderPipelineState)?
    private var blitPipeline: (any MTLRenderPipelineState)?
    private let frostPyramid: WorldbendFrostPyramidCache?

    public init(device: any MTLDevice, libraryURL: URL? = nil, recordsPresentation: Bool = false) {
        self.device = device
        self.recordsPresentation = recordsPresentation
        self.queue = device.makeCommandQueue()
        self.frostPyramid = queue.map { WorldbendFrostPyramidCache(queue: $0) }
        guard queue != nil else {
            status = .noDevice
            return
        }
        if let states = Self.makePipelines(device: device, libraryURL: libraryURL) {
            opticalPipeline = states.optical
            blitPipeline = states.blit
            status = .ready
        } else if libraryURL == nil
            && Bundle.module.url(forResource: "default", withExtension: "metallib") == nil
        {
            status = .missingMetallib
        } else {
            status = .pipelineFailure
        }
    }

    public var isReady: Bool { status == .ready && opticalPipeline != nil }

    /// Fallback clears reuse the renderer queue (no per-draw `makeCommandQueue`).
    func makeCommandBufferForFallback() -> (any MTLCommandBuffer)? {
        queue?.makeCommandBuffer()
    }

    /// Test / diagnostics: true only when a draw encoded successfully.
    nonisolated(unsafe) static var drawEncodeCountForTests = 0

    /// Allocate command buffers from this renderer's queue. Optical frost
    /// intermediates are shared and queue-ordered; foreign queues are rejected.
    public func makeCommandBuffer() -> (any MTLCommandBuffer)? { queue?.makeCommandBuffer() }

    /// Encode the same optical pass used by MTKView into a pane-sized target.
    /// The caller commits after any other composition passes. No CPU readback.
    @discardableResult
    public func encodeOptical(
        commandBuffer: any MTLCommandBuffer, into target: any MTLTexture,
        binding: WorldbendMetalOpticalBinding, optics: OpticalGlassConfiguration,
        paneFrame: CGRect, cornerRadius: CGFloat
    ) -> Bool {
        guard let texture = binding.texture, let pipeline = opticalPipeline,
            canEncode(commandBuffer, target: target, source: texture),
            (try? optics.validate()) != nil
        else { return false }
        let sampleSource: any MTLTexture
        if optics.frostRadius > WorldbendFrostSamplingBudget.legacyMaxPoints, let frostPyramid {
            sampleSource = frostPyramid.sampleTexture(
                device: device, source: texture,
                frameRevision: binding.frameRevision, commandBuffer: commandBuffer)
        } else {
            sampleSource = texture
        }
        var uniforms = makeUniforms(
            binding: binding, paneFrame: paneFrame,
            drawableSize: CGSize(width: target.width, height: target.height),
            cornerRadius: cornerRadius, optics: optics, coverageMode: 0, source: sampleSource)
        guard
            encode(
                commandBuffer: commandBuffer, pipeline: pipeline, target: target,
                source: sampleSource, uniforms: &uniforms)
        else { return false }
        metrics.encodedPanes &+= 1
        Self.drawEncodeCountForTests &+= 1
        return true
    }

    @discardableResult
    public func encodeBackdrop(
        commandBuffer: any MTLCommandBuffer, into target: any MTLTexture,
        binding: WorldbendMetalOpticalBinding
    ) -> Bool {
        guard let texture = binding.texture, let pipeline = blitPipeline,
            canEncode(commandBuffer, target: target, source: texture)
        else { return false }
        var uniforms = makeUniforms(
            binding: binding, paneFrame: CGRect(origin: .zero, size: binding.logicalSize),
            drawableSize: CGSize(width: target.width, height: target.height),
            cornerRadius: 0, optics: nil, coverageMode: 1, source: texture)
        guard
            encode(
                commandBuffer: commandBuffer, pipeline: pipeline, target: target,
                source: texture, uniforms: &uniforms)
        else { return false }
        metrics.encodedBackdrops &+= 1
        Self.drawEncodeCountForTests &+= 1
        return true
    }

    private func canEncode(
        _ command: any MTLCommandBuffer, target: any MTLTexture, source: any MTLTexture
    ) -> Bool {
        isReady && command.commandQueue === queue && command.status == .notEnqueued
            && target.pixelFormat == .bgra8Unorm && target !== source
            && target.device.registryID == device.registryID
            && source.device.registryID == device.registryID
    }

    func drawOptical(
        into drawable: CAMetalDrawable, binding: WorldbendMetalOpticalBinding,
        optics: OpticalGlassConfiguration, paneFrame: CGRect, cornerRadius: CGFloat
    ) {
        guard let command = makeCommandBuffer(),
            encodeOptical(
                commandBuffer: command, into: drawable.texture,
                binding: binding, optics: optics, paneFrame: paneFrame, cornerRadius: cornerRadius)
        else { return }
        commit(command, drawable: drawable, frameID: binding.frameID, role: .optical)
    }

    func drawBackdrop(into drawable: CAMetalDrawable, binding: WorldbendMetalOpticalBinding) {
        guard let command = makeCommandBuffer(),
            encodeBackdrop(
                commandBuffer: command, into: drawable.texture,
                binding: binding)
        else { return }
        commit(command, drawable: drawable, frameID: binding.frameID, role: .backdrop)
    }

    private func commit(
        _ command: any MTLCommandBuffer, drawable: CAMetalDrawable,
        frameID: WorldbendFrameID, role: WorldbendMetalPresentationSample.Role
    ) {
        if recordsPresentation {
            command.addCompletedHandler { [weak self] buffer in
                let ok = buffer.status == .completed
                let seconds = buffer.gpuEndTime - buffer.gpuStartTime
                let timing =
                    buffer.gpuStartTime > 0 && seconds.isFinite && seconds >= 0
                    ? seconds * 1000 : nil
                Task { @MainActor in
                    guard let self else { return }
                    self.metrics.gpuCompleted &+= 1
                    if !ok { self.metrics.gpuFailed &+= 1 }
                    if let timing {
                        self.metrics.measuredGPUCommands &+= 1
                        self.metrics.totalGPUMilliseconds += timing
                    }
                }
            }
            #if !targetEnvironment(simulator)
                drawable.addPresentedHandler { [weak self] shown in
                    let time = shown.presentedTime
                    Task { @MainActor in
                        guard let self, time.isFinite, time > 0 else { return }
                        if role == .backdrop {
                            self.metrics.presentedBackdrops &+= 1
                        } else {
                            self.metrics.presentedPanes &+= 1
                        }
                        self.recentPresentations.append(
                            .init(frameID: frameID, role: role, time: time))
                        if self.recentPresentations.count > 240 {
                            self.recentPresentations.removeFirst(
                                self.recentPresentations.count - 240)
                        }
                    }
                }
            #endif
        }
        command.present(drawable)
        command.commit()
    }

    private func makeUniforms(
        binding: WorldbendMetalOpticalBinding,
        paneFrame: CGRect,
        drawableSize: CGSize,
        cornerRadius: CGFloat,
        optics: OpticalGlassConfiguration?,
        coverageMode: Float,
        source: any MTLTexture
    ) -> WorldbendMetalOpticalUniforms {
        let light = optics?.lightDirection ?? [0, -1]
        let frost = Float(optics?.frostRadius ?? 0)
        let content = SIMD2(Float(binding.contentRect.width), Float(binding.contentRect.height))
        let texels = SIMD2(Float(source.width), Float(source.height))
        let lod: Float
        if let optics, optics.frostRadius > WorldbendFrostSamplingBudget.legacyMaxPoints {
            lod = WorldbendFrostPyramid.lod(
                frostRadiusPoints: frost, contentSizePoints: content, sourceSizeTexels: texels
            )
        } else {
            lod = 0
        }
        return WorldbendMetalOpticalUniforms(
            paneFrame: SIMD4(
                Float(paneFrame.minX), Float(paneFrame.minY),
                Float(paneFrame.width), Float(paneFrame.height)),
            contentRect: SIMD4(
                Float(binding.contentRect.minX), Float(binding.contentRect.minY),
                Float(binding.contentRect.width), Float(binding.contentRect.height)),
            logicalSize: SIMD2(Float(binding.logicalSize.width), Float(binding.logicalSize.height)),
            drawableSize: SIMD2(Float(drawableSize.width), Float(drawableSize.height)),
            cornerRadius: Float(cornerRadius),
            edgeWidth: Float(optics?.edgeWidth ?? 1),
            refractionScale: Float(optics?.refractionScale ?? 0),
            chromaticOffset: Float(optics?.chromaticOffset ?? 0),
            lightDirection: SIMD2(Float(light[0]), Float(light[1])),
            highlightStrength: Float(optics?.highlightStrength ?? 0),
            frostRadius: frost,
            frostLod: lod,
            coverageMode: coverageMode
        )
    }

    private func encode(
        commandBuffer: any MTLCommandBuffer,
        pipeline: any MTLRenderPipelineState,
        target: any MTLTexture,
        source: any MTLTexture,
        uniforms: inout WorldbendMetalOpticalUniforms
    ) -> Bool {
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = target
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return false
        }
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBytes(
            &uniforms, length: MemoryLayout<WorldbendMetalOpticalUniforms>.stride, index: 0)
        encoder.setFragmentBytes(
            &uniforms, length: MemoryLayout<WorldbendMetalOpticalUniforms>.stride, index: 0)
        encoder.setFragmentTexture(source, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        return true
    }

    private static func makePipelines(device: any MTLDevice, libraryURL: URL?) -> (
        optical: any MTLRenderPipelineState,
        blit: any MTLRenderPipelineState
    )? {
        guard
            let url = libraryURL
                ?? Bundle.module.url(forResource: "default", withExtension: "metallib"),
            let library = try? device.makeLibrary(URL: url),
            let vertex = library.makeFunction(name: "worldbendMetalOpticalVertex"),
            let fragment = library.makeFunction(name: "worldbendMetalOpticalFragment")
        else { return nil }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        descriptor.colorAttachments[0].isBlendingEnabled = true
        descriptor.colorAttachments[0].sourceRGBBlendFactor = .one
        descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        guard let optical = try? device.makeRenderPipelineState(descriptor: descriptor) else {
            return nil
        }
        // Same shader; coverageMode selects blit vs optical.
        guard let blit = try? device.makeRenderPipelineState(descriptor: descriptor) else {
            return nil
        }
        return (optical, blit)
    }
}

// MARK: - Platform metal view

@MainActor
final class WorldbendMetalOpticalPlatformView: MTKView {
    enum Mode {
        case optical(OpticalGlassConfiguration, CGFloat, CGRect)
        case backdrop
    }

    private let renderer: WorldbendMetalOpticalRenderer
    private var binding: WorldbendMetalOpticalBinding?
    private var mode: Mode = .backdrop
    private var opaqueFallback: SIMD4<Float> = SIMD4(0.5, 0.5, 0.5, 1)

    init(renderer: WorldbendMetalOpticalRenderer) {
        self.renderer = renderer
        super.init(frame: .zero, device: renderer.device)
        framebufferOnly = true
        isPaused = true
        enableSetNeedsDisplay = true
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        #if canImport(UIKit)
            backgroundColor = .clear
            isOpaque = false
        #elseif canImport(AppKit)
            layer?.isOpaque = false
        #endif
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(binding: WorldbendMetalOpticalBinding?, mode: Mode, opaqueFill: SIMD4<Float>) {
        self.binding = binding
        self.mode = mode
        self.opaqueFallback = opaqueFill
        if let layer = layer as? CAMetalLayer {
            layer.colorspace = CGColorSpace(
                name: binding?.colorSpace == .displayP3 ? CGColorSpace.displayP3 : CGColorSpace.sRGB
            )
        }
        #if canImport(UIKit)
            setNeedsDisplay()
        #elseif canImport(AppKit)
            needsDisplay = true
        #endif
    }

    override func draw(_ rect: CGRect) {
        guard let drawable = currentDrawable else { return }
        // Binding without a ready metallib/pipeline must not leave a stale or
        // empty drawable; fall back to the host opaque fill (same policy as the
        // SwiftUI pane body when `renderer.isReady` is false).
        guard let binding, binding.isReady, renderer.isReady else {
            clear(drawable: drawable, color: opaqueFallback)
            return
        }
        switch mode {
        case .backdrop:
            renderer.drawBackdrop(into: drawable, binding: binding)
        case .optical(let optics, let radius, let paneFrame):
            renderer.drawOptical(
                into: drawable,
                binding: binding,
                optics: optics,
                paneFrame: paneFrame,
                cornerRadius: radius
            )
        }
    }

    private func clear(drawable: CAMetalDrawable, color: SIMD4<Float>) {
        guard let buffer = renderer.makeCommandBufferForFallback() else { return }
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = drawable.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColor(
            red: Double(color.x), green: Double(color.y),
            blue: Double(color.z), alpha: Double(color.w)
        )
        if let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) {
            encoder.endEncoding()
        }
        buffer.present(drawable)
        buffer.commit()
    }
}

#if canImport(UIKit)
    @MainActor
    struct WorldbendMetalOpticalUIView: UIViewRepresentable {
        let renderer: WorldbendMetalOpticalRenderer
        let binding: WorldbendMetalOpticalBinding?
        let mode: WorldbendMetalOpticalPlatformView.Mode
        let opaqueFill: Color

        func makeUIView(context: Context) -> WorldbendMetalOpticalPlatformView {
            WorldbendMetalOpticalPlatformView(renderer: renderer)
        }

        func updateUIView(_ view: WorldbendMetalOpticalPlatformView, context: Context) {
            view.configure(binding: binding, mode: mode, opaqueFill: Self.rgba(opaqueFill))
        }

        private static func rgba(_ color: Color) -> SIMD4<Float> {
            #if canImport(UIKit)
                let ui = UIColor(color)
                var r: CGFloat = 0.5
                var g: CGFloat = 0.5
                var b: CGFloat = 0.5
                var a: CGFloat = 1
                ui.getRed(&r, green: &g, blue: &b, alpha: &a)
                return SIMD4(Float(r), Float(g), Float(b), Float(a))
            #else
                return SIMD4(0.5, 0.5, 0.5, 1)
            #endif
        }
    }
#elseif canImport(AppKit)
    @MainActor
    struct WorldbendMetalOpticalNSView: NSViewRepresentable {
        let renderer: WorldbendMetalOpticalRenderer
        let binding: WorldbendMetalOpticalBinding?
        let mode: WorldbendMetalOpticalPlatformView.Mode
        let opaqueFill: Color

        func makeNSView(context: Context) -> WorldbendMetalOpticalPlatformView {
            WorldbendMetalOpticalPlatformView(renderer: renderer)
        }

        func updateNSView(_ view: WorldbendMetalOpticalPlatformView, context: Context) {
            view.configure(binding: binding, mode: mode, opaqueFill: Self.rgba(opaqueFill))
        }

        private static func rgba(_ color: Color) -> SIMD4<Float> {
            let ns = NSColor(color)
            guard let converted = ns.usingColorSpace(.deviceRGB) else {
                return SIMD4(0.5, 0.5, 0.5, 1)
            }
            return SIMD4(
                Float(converted.redComponent),
                Float(converted.greenComponent),
                Float(converted.blueComponent),
                Float(converted.alphaComponent)
            )
        }
    }
#endif

/// Metal-direct backdrop blit of the shared completed frame (no CGImage).
@MainActor
public struct WorldbendMetalFrameBackdrop: View {
    private let binding: WorldbendMetalOpticalBinding?
    private let renderer: WorldbendMetalOpticalRenderer
    private let opaqueFill: Color

    public init(
        binding: WorldbendMetalOpticalBinding?,
        renderer: WorldbendMetalOpticalRenderer,
        opaqueFill: Color = .clear
    ) {
        self.binding = binding
        self.renderer = renderer
        self.opaqueFill = opaqueFill
    }

    public var body: some View {
        metalHost(mode: .backdrop)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func metalHost(mode: WorldbendMetalOpticalPlatformView.Mode) -> some View {
        #if canImport(UIKit)
            WorldbendMetalOpticalUIView(
                renderer: renderer, binding: binding, mode: mode, opaqueFill: opaqueFill
            )
        #elseif canImport(AppKit)
            WorldbendMetalOpticalNSView(
                renderer: renderer, binding: binding, mode: mode, opaqueFill: opaqueFill
            )
        #else
            Color.clear
        #endif
    }
}

/// Metal-direct optical pane. Samples the shared hub texture / CVPixelBuffer
/// wrap without ``WorldbendFrameImaging`` CGImage materialization.
@MainActor
public struct WorldbendMetalOpticalPane: View {
    private let binding: WorldbendMetalOpticalBinding?
    private let renderer: WorldbendMetalOpticalRenderer
    private let optics: OpticalGlassConfiguration?
    private let cornerRadius: CGFloat
    private let coordinateSpace: UUID
    private let opaqueFill: Color
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    public init(
        binding: WorldbendMetalOpticalBinding?,
        renderer: WorldbendMetalOpticalRenderer,
        optics: OpticalGlassConfiguration?,
        cornerRadius: CGFloat,
        coordinateSpace: UUID,
        opaqueFill: Color = .gray
    ) {
        self.binding = binding
        self.renderer = renderer
        self.optics = optics
        self.cornerRadius = cornerRadius.isFinite ? max(0, cornerRadius) : 0
        self.coordinateSpace = coordinateSpace
        self.opaqueFill = opaqueFill
    }

    public var body: some View {
        GeometryReader { proxy in
            let frame = proxy.frame(in: .named(coordinateSpace))
            let radius = min(cornerRadius, min(proxy.size.width, proxy.size.height) / 2)
            // `binding.isReady` is texture presence; `renderer.isReady` is the
            // Xcode-built metallib/pipeline. Either missing → opaque fill, not
            // an empty MTKView drawable.
            if reduceTransparency || contrast == .increased || optics == nil
                || binding?.isReady != true || !renderer.isReady
            {
                RoundedRectangle(cornerRadius: radius, style: .circular).fill(opaqueFill)
            } else if let optics {
                metalHost(mode: .optical(optics, radius, frame))
                    .clipShape(RoundedRectangle(cornerRadius: radius, style: .circular))
            }
        }
        .clipped()
        .contentShape(Rectangle())
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func metalHost(mode: WorldbendMetalOpticalPlatformView.Mode) -> some View {
        #if canImport(UIKit)
            WorldbendMetalOpticalUIView(
                renderer: renderer, binding: binding, mode: mode, opaqueFill: opaqueFill
            )
        #elseif canImport(AppKit)
            WorldbendMetalOpticalNSView(
                renderer: renderer, binding: binding, mode: mode, opaqueFill: opaqueFill
            )
        #else
            Color.clear
        #endif
    }
}

/// Frame-hub scene with **Metal-direct** backdrop + panes. One
/// `beginFrameAccess` and one ``WorldbendMetalOpticalBinding`` per revision.
/// Does not materialize CGImage for optical panes. The named coordinate space
/// is the published `logicalSize` canvas (letterboxed top-leading inside the
/// layout proposal). Classic View-backdrop ``WorldbendOpticalScene`` and
/// CGImage ``WorldbendOpticalFrameScene`` remain.
@MainActor
public struct WorldbendOpticalMetalFrameScene<Foreground: View>: View {
    private let hub: WorldbendFrameHub
    private let presentsBackdrop: Bool
    private let foreground: (WorldbendMetalOpticalSceneContext) -> Foreground
    @State private var access: WorldbendFrameAccess?
    @State private var binding: WorldbendMetalOpticalBinding?
    @State private var renderer: WorldbendMetalOpticalRenderer?
    @State private var coordinateSpace = UUID()

    public init(
        frameHub: WorldbendFrameHub,
        presentsBackdrop: Bool = true,
        renderer: WorldbendMetalOpticalRenderer? = nil,
        @ViewBuilder content: @escaping (WorldbendMetalOpticalSceneContext) -> Foreground
    ) {
        self.hub = frameHub
        self.presentsBackdrop = presentsBackdrop
        self._renderer = State(initialValue: renderer)
        self.foreground = content
    }

    public var body: some View {
        let revision = hub.frameRevision
        return GeometryReader { geometry in
            let activeBinding =
                binding
                ?? WorldbendMetalOpticalBinding.unavailable(
                    path: .unavailableMissingFrame, revision: revision
                )
            // Canvas matches `descriptor.logicalSize` so pane frames (named
            // coordinate space) share the same point space as backdrop uniforms
            // (`paneFrame` / `contentRect`). Hosts should size this scene to
            // that logical size; other geometries letterbox top-leading.
            let canvas: CGSize = {
                let logical = activeBinding.logicalSize
                if logical.width > 0, logical.height > 0 { return logical }
                return geometry.size
            }()
            let context = WorldbendMetalOpticalSceneContext(
                binding: activeBinding,
                renderer: renderer,
                coordinateSpace: coordinateSpace,
                sceneSize: canvas
            )
            ZStack(alignment: .topLeading) {
                if presentsBackdrop, let renderer {
                    WorldbendMetalFrameBackdrop(binding: binding, renderer: renderer)
                        .frame(width: canvas.width, height: canvas.height)
                        .clipped()
                }
                foreground(context)
            }
            .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
            .coordinateSpace(name: coordinateSpace)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .onAppear { sync(revision: revision) }
        .onChange(of: hub.frameRevision) { _, newRevision in sync(revision: newRevision) }
        .onDisappear {
            access?.endAccess()
            access = nil
            binding = nil
        }
    }

    private func sync(revision _: UInt64) {
        if renderer == nil, let device = MTLCreateSystemDefaultDevice() {
            renderer = WorldbendMetalOpticalRenderer(device: device)
        }
        access?.endAccess()
        access = hub.beginFrameAccess()
        binding = hub.metalOpticalBinding(device: renderer?.device)
    }
}
