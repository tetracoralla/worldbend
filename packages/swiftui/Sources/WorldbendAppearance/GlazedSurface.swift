import SwiftUI

/// Dielectric body + clear-coat approximation. This is a native
/// procedural surface, not a glass receipt or a Figma material projection.
/// The host owns pigment, role colors, input, persistence and theme identity.
public struct WorldbendGlazeRecipe: Codable, Equatable, Sendable {
    public var bevelWidth: Double
    public var coat: Double
    public var roughness: Double
    public var curvature: Double
    public var pooling: Double
    /// Body coverage only. Foreground and clear-coat reflection are independent;
    /// this compositor approximation is not physical subsurface transmission.
    public var coverage: Double
    public init(bevelWidth: Double = 6, coat: Double = 0.7, roughness: Double = 0.22,
                curvature: Double = 0.45, pooling: Double = 0.18, coverage: Double = 1) {
        self.bevelWidth = bevelWidth; self.coat = coat; self.roughness = roughness
        self.curvature = curvature; self.pooling = pooling; self.coverage = coverage
    }
    enum CodingKeys: String, CodingKey { case bevelWidth, coat, roughness, curvature, pooling, coverage }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(bevelWidth: try c.decode(Double.self, forKey: .bevelWidth), coat: try c.decode(Double.self, forKey: .coat),
            roughness: try c.decode(Double.self, forKey: .roughness), curvature: try c.decode(Double.self, forKey: .curvature),
            pooling: try c.decode(Double.self, forKey: .pooling), coverage: try c.decodeIfPresent(Double.self, forKey: .coverage) ?? 1)
    }
    public var isValid: Bool {
        [bevelWidth, coat, roughness, curvature, pooling, coverage].allSatisfy(\.isFinite)
        && (1...24).contains(bevelWidth) && (0...1).contains(coat)
        && (0.08...1).contains(roughness) && (0...1).contains(curvature) && (0...0.5).contains(pooling) && (0...1).contains(coverage)
    }
    /// Invalid authored input falls back as a whole; it is never saved back.
    public var effective: Self { isValid ? self : .init() }
}

public enum WorldbendGlazeRuntime {
    public static let profile = "worldbend.swiftui-glazed-surface@0.1"
    public static var hasCompiledShader: Bool { OpticalGlassRuntime.hasCompiledShader }
}

/// Only the supplied shape enters the shader. Foreground text is never sampled
/// or faded. The alpha silhouette supplies bevel normals for arbitrary shapes;
/// broad body curvature and window reflections are deliberately art-directed.
/// No capture, frame clock, external textures, model or rebake is required.
public struct WorldbendGlazedSurface<S: Shape>: View, Animatable {
    let shape: S
    let pigment: Color
    let reflection: Color
    let recipe: WorldbendGlazeRecipe
    nonisolated var contact: Double
    nonisolated public var animatableData: Double {
        get { contact }
        set { contact = newValue }
    }
    @Environment(\.colorSchemeContrast) private var contrast
    public init(shape: S, pigment: Color, reflection: Color = .white,
                recipe: WorldbendGlazeRecipe = .init(), contact: Double = 0) {
        self.shape = shape; self.pigment = pigment; self.reflection = reflection
        self.recipe = recipe; self.contact = contact
    }
    public var body: some View {
        GeometryReader { geometry in
            let r = recipe.effective
            if WorldbendGlazeRuntime.hasCompiledShader && contrast != .increased {
                shape.fill(pigment).layerEffect(Shader(
                    function: ShaderFunction(library: .bundle(.module), name: "worldbendGlazedSurface"),
                    arguments: [.float2(geometry.size), .color(reflection), .float(r.bevelWidth),
                        .float(r.coat), .float(r.roughness), .float(r.curvature), .float(r.pooling), .float(r.coverage),
                        .float(contact.isFinite ? min(1, max(0, contact)) : 0)]),
                    maxSampleOffset: CGSize(width: r.bevelWidth, height: r.bevelWidth))
            } else {
                // Explicit opaque fallback. Compilation on plain SwiftPM does
                // not establish the shader or the artistic appearance.
                shape.fill(pigment)
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}
