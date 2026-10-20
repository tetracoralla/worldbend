import SwiftUI

/// A bounded specular meniscus over an existing lens, not a second sampler or
/// fluid simulation. The host owns touch interpretation and silhouette motion.
public struct WorldbendContactMeniscus<S: Shape>: View {
    let shape: S
    let intensity: Double
    let expansion: Double
    let center: UnitPoint
    public init(shape: S, intensity: Double, expansion: Double, center: UnitPoint = .init(x: 0.4, y: 0.3)) {
        self.shape = shape
        self.intensity = intensity.isFinite ? min(1, max(0, intensity)) : 0
        self.expansion = expansion.isFinite ? min(1, max(0, expansion)) : 0
        self.center = center.x.isFinite && center.y.isFinite ? center : .center
    }
    public var body: some View {
        GeometryReader { g in
            let width = 1.2 + min(10, min(g.size.width, g.size.height) * 0.12) * expansion
            ZStack {
                shape.stroke(LinearGradient(colors: [.white.opacity(intensity), .white.opacity(intensity * 0.12),
                    .clear, .white.opacity(intensity * 0.45)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: width)
                    .blur(radius: 0.7 + 1.2 * expansion).mask(shape)
                shape.fill(RadialGradient(colors: [.white.opacity(intensity * 0.7), .clear], center: center,
                    startRadius: 0, endRadius: min(g.size.width, g.size.height) * (0.48 + 0.16 * expansion)))
            }.blendMode(.screen)
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}
