import Testing
@testable import WorldbendAppearance

struct HoldLightTests {
    @Test func fullTurnLandsAndJoinsSlowCounterclockwiseOrbitContinuously() {
        let a = WorldbendHoldLight.arrival, origin = WorldbendHoldLight.restingTurns
        let landed = WorldbendHoldLight.engaged(elapsed: a, reducedMotion: false, period: 96)
        #expect(abs(landed.turns - (origin - 1)) < 1e-9)
        let after = WorldbendHoldLight.engaged(elapsed: a + 24, reducedMotion: false, period: 96)
        #expect(abs(after.turns - landed.turns + 0.25) < 1e-9)
        let before = WorldbendHoldLight.engaged(elapsed: a - 0.0001, reducedMotion: false, period: 96)
        #expect(abs((landed.turns - before.turns) / 0.0001 + 1 / 96.0) < 0.002)
        var previous = origin
        for i in 0...6000 {
            let f = WorldbendHoldLight.engaged(elapsed: Double(i) / 50, reducedMotion: false)
            #expect(f.turns <= previous && (0...1).contains(f.energy)); previous = f.turns
        }
    }
    @Test func cancellationAndReentryPreservePhaseAndInvalidInputsStayFinite() {
        let held = WorldbendHoldLight.engaged(elapsed: 0.43, reducedMotion: false)
        let release = WorldbendHoldLight.releasing(held, elapsed: 0.12)
        #expect(release.turns == held.turns && release.energy < held.energy)
        #expect(WorldbendHoldLight.releasing(held, elapsed: 0.24).energy == 0)
        #expect(WorldbendHoldLight.engaged(elapsed: 0, reducedMotion: false, startingTurns: release.turns).turns == release.turns)
        for bad in [Double.nan, .infinity, -1] {
            let f = WorldbendHoldLight.engaged(elapsed: bad, reducedMotion: false, period: bad, startingTurns: bad)
            #expect(f.turns.isFinite && f.energy.isFinite)
            #expect(WorldbendHoldLight.releasing(.init(turns: bad, energy: bad), elapsed: bad).energy.isFinite)
        }
        #expect(WorldbendHoldLight.engaged(elapsed: 120, reducedMotion: true).turns == WorldbendHoldLight.restingTurns)
    }
}
