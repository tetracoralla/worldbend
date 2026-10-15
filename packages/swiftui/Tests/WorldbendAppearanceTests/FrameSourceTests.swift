import CoreVideo
import Foundation
import Metal
import SwiftUI
import Testing
@testable import WorldbendAppearance

@MainActor
struct FrameSourceTests {
    @Test func rejectsMetadataOnlyAndInvalidGeometry() throws {
        let hub = WorldbendFrameHub()
        let id = hub.makeFrameID()
        let good = WorldbendFrameDescriptor(
            frameID: id,
            logicalSize: CGSize(width: 100, height: 80),
            contentRect: CGRect(x: 0, y: 0, width: 100, height: 80),
            pixelWidth: 100,
            pixelHeight: 80,
            colorSpace: .sRGB,
            pixelFormat: .bgra8Unorm
        )
        #expect(throws: WorldbendFrameError.self) {
            try hub.publish(descriptor: good)
        }
        var bad = good
        bad.logicalSize = .zero
        #expect(throws: WorldbendFrameError.self) {
            try hub.publish(descriptor: bad, cpuBytes: Data(count: 4), cpuBytesPerRow: 4)
        }
    }

    @Test func cpuFallbackPublishesCoherentFrameForMultipleAccesses() throws {
        let hub = WorldbendFrameHub()
        let id = hub.makeFrameID()
        let width = 2
        let height = 2
        let bytesPerRow = width * 4
        var pixels = Data(count: bytesPerRow * height)
        for i in 0..<pixels.count { pixels[i] = UInt8(i) }
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: id,
                logicalSize: CGSize(width: 2, height: 2),
                contentRect: CGRect(x: 0, y: 0, width: 2, height: 2),
                pixelWidth: width,
                pixelHeight: height,
                colorSpace: .displayP3,
                pixelFormat: .bgra8Unorm,
                presentationTime: .milliseconds(16)
            ),
            cpuBytes: pixels,
            cpuBytesPerRow: bytesPerRow
        )
        #expect(hub.frameRevision == 1)
        let a = try #require(hub.beginFrameAccess())
        let b = try #require(hub.beginFrameAccess())
        #expect(a.frame.frameID == id)
        #expect(b.frame.frameID == id)
        #expect(a.frame.presentationTime == .milliseconds(16))
        #expect(a.frame.colorSpace == .displayP3)
        #expect(a.frame.presentationPath == .swiftuiLayerEffectFromPixelBuffer)
        #expect(a.frame.metalTexture == nil)
        #expect(a.frame.pixelBuffer == nil)
        let rowHeld = a.frame.withCPUBytesIfAvailable { _, row in row }
        #expect(rowHeld == 8)
        let copied = a.frame.withCPUBytesIfAvailable { ptr, _ in Data(ptr) }
        #expect(copied == pixels)
        a.endAccess()
        b.endAccess()
    }

    @Test func pixelBufferRetainAllowsSharedAccessWithoutMetadataOnly() throws {
        let hub = WorldbendFrameHub()
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, 4, 4,
            kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary,
            &buffer
        )
        #expect(status == kCVReturnSuccess)
        let pixelBuffer = try #require(buffer)
        let id = hub.makeFrameID()
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: id,
                logicalSize: CGSize(width: 40, height: 40),
                contentRect: CGRect(x: 2, y: 2, width: 36, height: 36),
                pixelWidth: 4,
                pixelHeight: 4,
                colorSpace: .sRGB,
                pixelFormat: .bgra8Unorm
            ),
            pixelBuffer: pixelBuffer
        )
        let first = try #require(hub.beginFrameAccess())
        let second = try #require(hub.beginFrameAccess())
        #expect(first.frame.frameID == second.frame.frameID)
        #expect(first.frame.contentRect.width == 36)
        #expect(first.frame.pixelBuffer != nil)
        #expect(first.frame.presentationPath == .swiftuiLayerEffectFromPixelBuffer)
        #expect(first.frame.pixelBuffer != nil)
        first.endAccess()
        second.endAccess()
        hub.clear()
        #expect(hub.beginFrameAccess() == nil)
        #expect(hub.frameRevision >= 2)
    }

    @Test func metalOnlyPathDisclosesAndKeepsViewBackdropInit() throws {
        let hub = WorldbendFrameHub()
        if let device = MTLCreateSystemDefaultDevice() {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .bgra8Unorm, width: 8, height: 8, mipmapped: false
            )
            descriptor.usage = [.shaderRead]
            let texture = try #require(device.makeTexture(descriptor: descriptor))
            try hub.publish(
                descriptor: WorldbendFrameDescriptor(
                    frameID: hub.makeFrameID(),
                    logicalSize: CGSize(width: 8, height: 8),
                    contentRect: CGRect(x: 0, y: 0, width: 8, height: 8),
                    pixelWidth: 8,
                    pixelHeight: 8,
                    colorSpace: .sRGB,
                    pixelFormat: .bgra8Unorm
                ),
                metalTexture: texture
            )
            let access = try #require(hub.beginFrameAccess())
            #expect(access.frame.presentationPath == .metalOnlyNoLayerEffectSampling)
            #expect(access.frame.metalTexture != nil)
            #expect(access.frame.pixelBuffer == nil)
            let artwork = try #require(hub.presentationArtwork())
            #expect(artwork.image == nil)
            #expect(artwork.presentationPath == .metalOnlyNoLayerEffectSampling)
            access.endAccess()
        } else {
            #expect(WorldbendFramePresentationPath.metalOnlyNoLayerEffectSampling.rawValue
                    == "metal-only-no-layer-effect-sampling")
        }
        let frameScene = WorldbendOpticalFrameScene(frameHub: hub) { backdrop in
            WorldbendOpticalPane(backdrop: backdrop, optics: nil, cornerRadius: 8)
        }
        _ = frameScene
        let classic = WorldbendOpticalScene(backdrop: { Color.orange }) { backdrop in
            WorldbendOpticalPane(backdrop: backdrop, optics: nil, cornerRadius: 8)
        }
        _ = classic
    }

    @Test func sharedArtworkMaterializesOnceForMultiPaneGeneration() throws {
        let hub = WorldbendFrameHub()
        WorldbendFrameImaging.materializationCountForTests = 0
        let width = 4
        let height = 4
        let bytesPerRow = width * 4
        let pixels = Data(repeating: 0x7F, count: bytesPerRow * height)
        let crop = CGRect(x: 10, y: 20, width: 100, height: 80)
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 200, height: 160),
                contentRect: crop,
                pixelWidth: width,
                pixelHeight: height,
                colorSpace: .displayP3,
                pixelFormat: .bgra8Unorm,
                presentationTime: .milliseconds(8)
            ),
            cpuBytes: pixels,
            cpuBytesPerRow: bytesPerRow
        )
        let a = try #require(hub.presentationArtwork())
        let b = try #require(hub.presentationArtwork())
        let c = try #require(hub.presentationArtwork())
        #expect(a.frameID == b.frameID)
        #expect(b.frameID == c.frameID)
        #expect(a.contentRect == crop)
        #expect(a.colorSpace == .displayP3)
        #expect(a.presentationTime == .milliseconds(8))
        #expect(a.image != nil)
        #expect(b.image != nil)
        #expect(a.image === b.image)
        #expect(b.image === c.image)
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)

        // Multi-pane scene API compiles against one shared artwork generation.
        let scene = WorldbendOpticalFrameScene(frameHub: hub) { backdrop in
            ZStack {
                WorldbendOpticalPane(backdrop: backdrop, optics: nil, cornerRadius: 4)
                    .frame(width: 40, height: 24)
                WorldbendOpticalPane(backdrop: backdrop, optics: nil, cornerRadius: 4)
                    .frame(width: 40, height: 24)
                    .offset(x: 50, y: 0)
            }
        }
        _ = scene
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)
    }

    @Test func displayP3ColorSpaceAppliedToMaterializedImage() throws {
        let hub = WorldbendFrameHub()
        WorldbendFrameImaging.materializationCountForTests = 0
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, 2, 2,
            kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary,
            &buffer
        )
        #expect(status == kCVReturnSuccess)
        let pixelBuffer = try #require(buffer)
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 20, height: 20),
                contentRect: CGRect(x: 1, y: 1, width: 18, height: 18),
                pixelWidth: 2,
                pixelHeight: 2,
                colorSpace: .displayP3,
                pixelFormat: .bgra8Unorm
            ),
            pixelBuffer: pixelBuffer
        )
        let artwork = try #require(hub.presentationArtwork())
        let image = try #require(artwork.image)
        let expected = CGColorSpace.displayP3 as String
        #expect(image.colorSpace?.name as String? == expected)
        #expect(artwork.contentRect.origin == CGPoint(x: 1, y: 1))
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)
        _ = hub.presentationArtwork()
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)
    }

    @Test func rgba16FloatDoesNotMisinterpretAsBGRA() throws {
        let hub = WorldbendFrameHub()
        if let device = MTLCreateSystemDefaultDevice() {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .rgba16Float, width: 4, height: 4, mipmapped: false
            )
            descriptor.usage = [.shaderRead]
            let texture = try #require(device.makeTexture(descriptor: descriptor))
            try hub.publish(
                descriptor: WorldbendFrameDescriptor(
                    frameID: hub.makeFrameID(),
                    logicalSize: CGSize(width: 4, height: 4),
                    contentRect: CGRect(x: 0, y: 0, width: 4, height: 4),
                    pixelWidth: 4,
                    pixelHeight: 4,
                    colorSpace: .sRGB,
                    pixelFormat: .rgba16Float
                ),
                metalTexture: texture,
                // Even if someone also hands CPU bytes, float format must not
                // take the BGRA CGImage path.
                cpuBytes: Data(repeating: 0, count: 4 * 4 * 8),
                cpuBytesPerRow: 4 * 8
            )
            let access = try #require(hub.beginFrameAccess())
            #expect(access.frame.presentationPath == .incompatiblePixelFormatForLayerEffect)
            #expect(access.frame.metalTexture != nil)
            let artwork = try #require(hub.presentationArtwork())
            #expect(artwork.image == nil)
            #expect(artwork.presentationPath == .incompatiblePixelFormatForLayerEffect)
            access.endAccess()
        } else {
            #expect(
                WorldbendFramePresentationPath.incompatiblePixelFormatForLayerEffect.rawValue
                    == "incompatible-pixel-format-for-layer-effect"
            )
        }
    }

    @Test func metalDirectBindingSkipsCGImageMaterialization() throws {
        let hub = WorldbendFrameHub()
        WorldbendFrameImaging.materializationCountForTests = 0
        let device = try #require(MTLCreateSystemDefaultDevice())
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: 16, height: 16, mipmapped: false
        )
        descriptor.usage = [.shaderRead]
        let texture = try #require(device.makeTexture(descriptor: descriptor))
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 160, height: 160),
                contentRect: CGRect(x: 10, y: 10, width: 140, height: 140),
                pixelWidth: 16,
                pixelHeight: 16,
                colorSpace: .displayP3,
                pixelFormat: .bgra8Unorm
            ),
            metalTexture: texture
        )
        let before = WorldbendFrameImaging.materializationCountForTests
        let a = hub.metalOpticalBinding(device: device)
        let b = hub.metalOpticalBinding(device: device)
        #expect(a.path == .metalDirectFromTexture)
        #expect(a.isReady)
        #expect(a.texture != nil)
        #expect(a.frameID == b.frameID)
        #expect(a.texture === b.texture)
        #expect(WorldbendFrameImaging.materializationCountForTests == before)
        #expect(WorldbendFrameImaging.materializationCountForTests == 0)
        // Metal scene API must not force CGImage artwork.
        let scene = WorldbendOpticalMetalFrameScene(frameHub: hub) { context in
            let sharedRenderer = context.renderer
                ?? WorldbendMetalOpticalRenderer(device: device)
            return ZStack {
                WorldbendMetalOpticalPane(
                    binding: context.binding,
                    renderer: sharedRenderer,
                    optics: nil,
                    cornerRadius: 8,
                    coordinateSpace: context.coordinateSpace
                )
                .frame(width: 40, height: 24)
                WorldbendMetalOpticalPane(
                    binding: context.binding,
                    renderer: sharedRenderer,
                    optics: nil,
                    cornerRadius: 8,
                    coordinateSpace: context.coordinateSpace
                )
                .frame(width: 40, height: 24)
                .offset(x: 48, y: 0)
            }
        }
        _ = scene
        #expect(WorldbendFrameImaging.materializationCountForTests == 0)
        // CGImage path remains available separately and still counts once.
        let artwork = hub.presentationArtwork()
        #expect(artwork?.image == nil) // metal-only publication
        #expect(artwork?.presentationPath == .metalOnlyNoLayerEffectSampling)
        #expect(WorldbendFrameImaging.materializationCountForTests == 0)
    }

    @Test func metalDirectBindingFromPixelBufferSkipsCGImage() throws {
        let hub = WorldbendFrameHub()
        WorldbendFrameImaging.materializationCountForTests = 0
        let device = try #require(MTLCreateSystemDefaultDevice())
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, 8, 8,
            kCVPixelFormatType_32BGRA,
            [
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
                kCVPixelBufferMetalCompatibilityKey as String: true
            ] as CFDictionary,
            &buffer
        )
        #expect(status == kCVReturnSuccess)
        let pixelBuffer = try #require(buffer)
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 80, height: 80),
                contentRect: CGRect(x: 0, y: 0, width: 80, height: 80),
                pixelWidth: 8,
                pixelHeight: 8,
                colorSpace: .sRGB,
                pixelFormat: .bgra8Unorm
            ),
            pixelBuffer: pixelBuffer
        )
        let binding = hub.metalOpticalBinding(device: device)
        #expect(binding.path == .metalDirectFromPixelBuffer)
        #expect(binding.isReady)
        #expect(binding.texture != nil)
        #expect(WorldbendFrameImaging.materializationCountForTests == 0)
        // Asking for SwiftUI artwork afterward still materializes once — separate path.
        _ = hub.presentationArtwork()
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)
        _ = hub.metalOpticalBinding(device: device)
        #expect(WorldbendFrameImaging.materializationCountForTests == 1)
    }

    @Test func cpuOnlyFrameUnavailableForMetalDirect() throws {
        let hub = WorldbendFrameHub()
        WorldbendFrameImaging.materializationCountForTests = 0
        let pixels = Data(repeating: 0x20, count: 4 * 4 * 4)
        try hub.publish(
            descriptor: WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 4, height: 4),
                contentRect: CGRect(x: 0, y: 0, width: 4, height: 4),
                pixelWidth: 4,
                pixelHeight: 4,
                colorSpace: .sRGB,
                pixelFormat: .bgra8Unorm
            ),
            cpuBytes: pixels,
            cpuBytesPerRow: 16
        )
        let binding = hub.metalOpticalBinding(device: MTLCreateSystemDefaultDevice())
        #expect(binding.path == .unavailableCpuOnly)
        #expect(binding.texture == nil)
        #expect(WorldbendFrameImaging.materializationCountForTests == 0)
        #expect(WorldbendMetalOpticalPath.metalDirectFromTexture.rawValue
                == "metal-direct-from-texture")
    }


    @Test func frostUVStepUsesLogicalPointsNotTexels() {
        // Contract: frostRadius is logical points (layerEffect `.blur` unit).
        // UV step = frost / contentRect size — identical at 1x and @3x pixel buffers.
        let step1x = WorldbendMetalOpticalMath.frostUVStep(
            frostRadiusPoints: 12,
            contentSizePoints: SIMD2(390, 844)
        )
        let step3xLogical = WorldbendMetalOpticalMath.frostUVStep(
            frostRadiusPoints: 12,
            contentSizePoints: SIMD2(390, 844)
        )
        #expect(abs(step1x.x - 12 / 390) < 0.00001)
        #expect(abs(step1x.y - 12 / 844) < 0.00001)
        #expect(step1x == step3xLogical)
        // Wrong texel division would shrink ~3× on a 1170×2532 buffer.
        let wrongTexel = SIMD2<Float>(12 / 1170, 12 / 2532)
        #expect(abs(step1x.x - wrongTexel.x) > 0.001)
        #expect(WorldbendMetalOpticalRenderer.Status.missingMetallib.rawValue == "missing-metallib")
    }


}
