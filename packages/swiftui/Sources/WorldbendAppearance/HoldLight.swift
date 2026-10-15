import Foundation

/// A receiving-side motion primitive, not a task/progress state. Negative turns
/// are counterclockwise in screen coordinates. No wall clock or timer is owned.
public struct WorldbendHoldLightFrame: Equatable, Sendable {
    public var turns: Double
    public var energy: Double
    public init(turns: Double, energy: Double) { self.turns = turns; self.energy = energy }
}

public enum WorldbendHoldLight {
    public static let arrival = 0.8
    public static let release = 0.24
    public static let restingTurns = -0.375

    /// One whole revolution lands at the original orientation; its ending
    /// velocity matches the slow orbit, without a dwell or a phase discontinuity.
    public static func engaged(elapsed: Double, reducedMotion: Bool, period: Double = 96,
                               startingTurns: Double = restingTurns) -> WorldbendHoldLightFrame {
        let origin = startingTurns.isFinite ? startingTurns : restingTurns
        guard !reducedMotion else { return .init(turns: origin, energy: 1) }
        let t = elapsed.isFinite ? max(0, elapsed) : 0
        let orbit = period.isFinite ? max(30, period) : 96
        let x = min(1, t / arrival), v = arrival / orbit
        let landing = (-2 + v) * x * x * x + (3 - v) * x * x
        return .init(turns: origin - landing - max(0, t - arrival) / orbit,
                     energy: 0.24 + 0.76 * min(1, t / 0.14))
    }

    /// Release/cancel freezes the current phase and drains the light in place.
    /// A new touch can resume from this frame instead of rewinding the orbit.
    public static func releasing(_ frame: WorldbendHoldLightFrame, elapsed: Double) -> WorldbendHoldLightFrame {
        let t = elapsed.isFinite ? max(0, elapsed) : release
        let fade = max(0, 1 - t / release)
        return .init(turns: frame.turns.isFinite ? frame.turns : restingTurns,
                     energy: (frame.energy.isFinite ? min(1, max(0, frame.energy)) : 0) * fade * fade)
    }
}
