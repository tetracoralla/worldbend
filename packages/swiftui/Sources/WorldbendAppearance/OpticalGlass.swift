import SwiftUI

public enum OpticalGlassRuntime {
    /// Xcode compiles package .metal resources. Plain `swift test` on macOS
    /// only copies them; compilation tests do not prove a runnable shader.
    public static let hasCompiledShader = Bundle.module.url(forResource: "default", withExtension: "metallib") != nil
}

/// Core-compiled inputs for worldbend.rounded-glass-metal@0.1. Decode these
/// with the canonical receipt; do not reconstruct coefficients in the App.
public struct OpticalGlassConfiguration: Codable, Equatable, Sendable {
    public let profile, backdrop: String
    public let edgeWidth, refractionScale, chromaticOffset, frostRadius: Double
    public let lightDirection: [Double]
    public let highlightStrength: Double

    func validate() throws {
        guard profile == "worldbend.rounded-glass-metal@0.1", backdrop == "explicit-swiftui-layer",
              [edgeWidth, refractionScale, chromaticOffset, frostRadius, highlightStrength].allSatisfy(\.isFinite),
              (1...1000).contains(edgeWidth), (0...32).contains(refractionScale),
              (0...8).contains(chromaticOffset), (0...1000).contains(frostRadius),
              (0...0.6).contains(highlightStrength), lightDirection.count == 2,
              lightDirection.allSatisfy(\.isFinite),
              abs(lightDirection[0] * lightDirection[0] + lightDirection[1] * lightDirection[1] - 1) < 0.00001
        else { throw AppearanceError.invalidReceipt }
    }
}

/// A presentation-only layer supplied by the receiving scene, not a screen
/// capture. Foreground inputs and their lifecycle never enter this layer.
@MainActor public struct WorldbendOpticalBackdrop {
    fileprivate let content: AnyView
    fileprivate let size: CGSize
    fileprivate let coordinateSpace: UUID
}

/// Keep animation/media state outside `backdrop`: the same visual subtree is
/// rendered at the scene and at each pane. UIKit/AppKit-backed video/web views
/// cannot be sampled by SwiftUI layerEffect; use an explicit image texture or
/// the system backend for those hosts. No hidden capture or raster fallback.
@MainActor public struct WorldbendOpticalScene<Backdrop: View, Foreground: View>: View {
    private let backdrop: () -> Backdrop
    private let foreground: (WorldbendOpticalBackdrop) -> Foreground
    @State private var coordinateSpace = UUID()
    @Environment(\.self) private var sourceEnvironment

    public init(@ViewBuilder backdrop: @escaping () -> Backdrop,
                @ViewBuilder content: @escaping (WorldbendOpticalBackdrop) -> Foreground) {
        self.backdrop = backdrop; self.foreground = content
    }
    public var body: some View {
        GeometryReader { geometry in
            // A white-on-glass control may override its color scheme. Its
            // sampled artwork must retain the source's colors and state.
            let layer = WorldbendOpticalBackdrop(content: AnyView(backdrop()
                .environment(\.self, sourceEnvironment)
                .environment(\.colorScheme, sourceEnvironment.colorScheme)), size: geometry.size, coordinateSpace: coordinateSpace)
            ZStack {
                layer.content.frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    .allowsHitTesting(false).accessibilityHidden(true)
                foreground(layer)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .coordinateSpace(name: coordinateSpace)
        }
    }
}

/// Frame-hub optical scene: **one** `beginFrameAccess` + **one** shared
/// ``WorldbendFrameArtwork`` (CGImage materialized at most once per revision)
/// for the backdrop and every pane. Replaces the FRAMESOURCE-01 pattern of
/// embedding `WorldbendFramePresentedView` in the generic scene, which could
/// re-acquire and re-materialize per pane.
///
/// Honesty: SwiftUI `layerEffect` glass still samples this shared CGImage-
/// backed artwork (`swiftui-layer-effect-from-pixel-buffer`). That is **not**
/// Metal-direct glass rendering. Metal/CVPB accessors on the same generation
/// remain available to the App MTKView without a CPU pixel copy. Metal-only or
/// incompatible-format publications leave the presented artwork empty so hosts
/// can show opaqueFill / system routes instead of inventing a UIImage blit.
@MainActor
public struct WorldbendOpticalFrameScene<Foreground: View>: View {
    private let hub: WorldbendFrameHub
    private let foreground: (WorldbendOpticalBackdrop) -> Foreground
    @State private var access: WorldbendFrameAccess?
    @State private var artwork: WorldbendFrameArtwork?
    @State private var coordinateSpace = UUID()
    @Environment(\.self) private var sourceEnvironment

    public init(
        frameHub: WorldbendFrameHub,
        @ViewBuilder content: @escaping (WorldbendOpticalBackdrop) -> Foreground
    ) {
        self.hub = frameHub
        self.foreground = content
    }

    public var body: some View {
        let revision = hub.frameRevision
        return GeometryReader { geometry in
            let presented = WorldbendSharedFrameImage(artwork: artwork)
            let layer = WorldbendOpticalBackdrop(
                content: AnyView(
                    presented
                        .environment(\.self, sourceEnvironment)
                        .environment(\.colorScheme, sourceEnvironment.colorScheme)
                ),
                size: geometry.size,
                coordinateSpace: coordinateSpace
            )
            ZStack {
                layer.content
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                foreground(layer)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .coordinateSpace(name: coordinateSpace)
        }
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

@MainActor public struct WorldbendOpticalPane: View {
    private let backdrop: WorldbendOpticalBackdrop
    private let optics: OpticalGlassConfiguration?
    private let cornerRadius: CGFloat
    private let tint, opaqueFill: Color
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    public init(backdrop: WorldbendOpticalBackdrop, optics: OpticalGlassConfiguration?,
                cornerRadius: CGFloat, tint: Color = .clear, opaqueFill: Color = .gray) {
        self.backdrop = backdrop; self.optics = optics
        self.cornerRadius = cornerRadius.isFinite ? max(0, cornerRadius) : 0
        self.tint = tint; self.opaqueFill = opaqueFill
    }

    public var body: some View {
        GeometryReader { proxy in
            if let optics {
                let frame = proxy.frame(in: .named(backdrop.coordinateSpace))
                let radius = min(cornerRadius, min(proxy.size.width, proxy.size.height) / 2)
                let shape = RoundedRectangle(cornerRadius: radius, style: .circular)
                if reduceTransparency || contrast == .increased {
                    shape.fill(opaqueFill)
                } else {
                    // Crop before filtering: a 48 pt control must not run a
                    // full-screen shader pass. The gutter retains every source
                    // sample needed by the blur and displaced rim.
                    let gutter = min(ceil(optics.refractionScale + optics.chromaticOffset + optics.frostRadius * 3), max(backdrop.size.width, backdrop.size.height))
                    let sampleSize = CGSize(width: proxy.size.width + gutter * 2, height: proxy.size.height + gutter * 2)
                    let sampleFrame = CGRect(x: gutter, y: gutter, width: proxy.size.width, height: proxy.size.height)
                    backdrop.content
                        .frame(width: backdrop.size.width, height: backdrop.size.height)
                        .offset(x: gutter - frame.minX, y: gutter - frame.minY)
                        .frame(width: sampleSize.width, height: sampleSize.height, alignment: .topLeading)
                        .clipped()
                        .blur(radius: optics.frostRadius)
                        .layerEffect(shader(optics, frame: sampleFrame, canvasSize: sampleSize, radius: radius),
                                     maxSampleOffset: CGSize(width: optics.refractionScale + optics.chromaticOffset,
                                                             height: optics.refractionScale + optics.chromaticOffset))
                        .offset(x: -gutter, y: -gutter)
                        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                        .overlay(shape.fill(tint))
                        .clipShape(shape)
                        .overlay {
                            // A narrow reflected lip stays readable on smooth
                            // backdrops where displacement has little contrast.
                            // It follows the same received light, not a second
                            // consumer-specific material or fixed white border.
                            let direction = optics.lightDirection
                            let start = UnitPoint(x: 0.5 + direction[0] * 0.5, y: 0.5 + direction[1] * 0.5)
                            let end = UnitPoint(x: 1 - start.x, y: 1 - start.y)
                            shape.strokeBorder(LinearGradient(stops: [
                                .init(color: .white.opacity(optics.highlightStrength * 1.5), location: 0),
                                .init(color: .white.opacity(optics.highlightStrength * 0.12), location: 0.52),
                                .init(color: .white.opacity(optics.highlightStrength * 0.5), location: 1)
                            ], startPoint: start, endPoint: end), lineWidth: 0.85)
                        }
                }
            }
        }
        .clipped().contentShape(Rectangle())
        .allowsHitTesting(false).accessibilityHidden(true)
    }

    private func shader(_ optics: OpticalGlassConfiguration, frame: CGRect, canvasSize: CGSize, radius: CGFloat) -> Shader {
        Shader(function: ShaderFunction(library: .bundle(.module), name: "worldbendRoundedGlass"), arguments: [
            .float4(Float(frame.minX), Float(frame.minY), Float(frame.width), Float(frame.height)),
            .float2(canvasSize), .float(radius), .float(optics.edgeWidth),
            .float(optics.refractionScale), .float(optics.chromaticOffset),
            .float2(Float(optics.lightDirection[0]), Float(optics.lightDirection[1])), .float(optics.highlightStrength)
        ])
    }
}
