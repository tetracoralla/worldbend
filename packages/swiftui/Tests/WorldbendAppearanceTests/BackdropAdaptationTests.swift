import Foundation
import Testing
@testable import WorldbendAppearance

struct BackdropAdaptationTests {
    private func grid(_ rgb: (UInt8, UInt8, UInt8), alpha: UInt8 = 255) throws -> WorldbendBackdropGrid {
        let bytes = Data((0..<64).flatMap { _ in [rgb.2, rgb.1, rgb.0, alpha] })
        return try bytes.withUnsafeBytes { try .init(bgra: $0, width: 8, height: 8, bytesPerRow: 32,
            contentRect: CGRect(x: 10, y: 20, width: 80, height: 80)) }
    }
    @Test func samplesLocalCompletedPixelsWithLinearLuminanceAndHonestCoverage() throws {
        let white = try grid((255, 255, 255)), black = try grid((0, 0, 0)), green = try grid((0, 255, 0))
        let rect = CGRect(x: 10, y: 20, width: 40, height: 40)
        #expect(abs(try #require(white.statistics(in: rect)).meanLuminance - 1) < 0.0001)
        #expect(try #require(black.statistics(in: rect)).meanLuminance == 0)
        #expect(abs(try #require(green.statistics(in: rect)).meanLuminance - 0.7152) < 0.0001)
        #expect(try grid((255, 255, 255), alpha: 0).statistics(in: rect) == nil)
        #expect(white.statistics(in: CGRect(x: -100, y: -100, width: 50, height: 50)) == nil)
        var bytes = Data(repeating: 255, count: 8 * 8 * 4)
        for y in 0..<8 { for x in 0..<4 { for c in 0..<3 { bytes[(y * 8 + x) * 4 + c] = 0 } } }
        let split = try bytes.withUnsafeBytes { try WorldbendBackdropGrid(bgra: $0, width: 8, height: 8, bytesPerRow: 32, contentRect: .init(x: 0, y: 0, width: 80, height: 80)) }
        #expect(try #require(split.statistics(in: .init(x: 0, y: 0, width: 30, height: 80))).upperLuminance == 0)
        #expect(try #require(split.statistics(in: .init(x: 50, y: 0, width: 30, height: 80))).upperLuminance == 1)
    }
    @Test func adaptationIsBoundedCadenceIndependentAndDoesNotEraseAuthoredOptics() throws {
        let rect = CGRect(x: 10, y: 20, width: 80, height: 80)
        let light = try grid((255, 255, 255)).statistics(in: rect), dark = try grid((0, 0, 0)).statistics(in: rect)
        var a = WorldbendGlassAdaptationState(), b = WorldbendGlassAdaptationState()
        let recipe = WorldbendGlassAdaptationRecipe()
        _ = try a.update(statistics: dark, elapsed: 0, recipe: recipe)
        _ = try b.update(statistics: dark, elapsed: 0, recipe: recipe)
        for _ in 0..<10 { _ = try a.update(statistics: light, elapsed: 0.1, recipe: recipe) }
        _ = try b.update(statistics: light, elapsed: 1, recipe: recipe)
        #expect(abs(a.value.shadeOpacity - b.value.shadeOpacity) < 0.00001)
        #expect(a.value.shadeOpacity > 0.1 && a.value.shadeOpacity < recipe.maximumShade)
        let base = OpticalGlassConfiguration(profile: "worldbend.rounded-glass-metal@0.1", backdrop: "explicit-swiftui-layer", edgeWidth: 9, refractionScale: 4, chromaticOffset: 0.2, frostRadius: 1.2, lightDirection: [1, 0], highlightStrength: 0.3)
        let adapted = try a.value.applying(to: base)
        #expect(adapted.edgeWidth == base.edgeWidth && adapted.refractionScale == base.refractionScale && adapted.chromaticOffset == base.chromaticOffset)
        var invalid = recipe; invalid.responseSeconds = 0
        #expect(throws: WorldbendBackdropError.self) { try a.update(statistics: light, elapsed: 1, recipe: invalid) }
        #expect(throws: WorldbendBackdropError.self) { try a.update(statistics: light, elapsed: .nan, recipe: recipe) }
    }
    @Test func illuminationRetainsHueLinearAveragingAndFrameColorSpace() throws {
        let rect = CGRect(x: 10, y: 20, width: 80, height: 80)
        let red = try #require(grid((255, 0, 0)).statistics(in: rect)), blue = try #require(grid((0, 0, 255)).statistics(in: rect))
        #expect(red.meanLinearRGB == SIMD3(1, 0, 0))
        #expect(blue.meanLinearRGB == SIMD3(0, 0, 1))
        let bytes = Data((0..<64).flatMap { _ in [UInt8(0), 0, 255, 255] })
        let p3 = try bytes.withUnsafeBytes { try WorldbendBackdropGrid(bgra: $0, width: 8, height: 8, bytesPerRow: 32,
            contentRect: rect, colorSpace: .displayP3) }
        let p3Red = try #require(p3.statistics(in: rect)?.meanLinearRGB)
        #expect(p3Red.x > 1 && p3Red.y < 0 && p3Red.z < 0)
        var slow = WorldbendGlassAdaptationState(), fast = WorldbendGlassAdaptationState()
        let recipe = WorldbendGlassAdaptationRecipe()
        _ = try slow.update(statistics: red, elapsed: 0, recipe: recipe)
        _ = try fast.update(statistics: red, elapsed: 0, recipe: recipe)
        for _ in 0..<10 { _ = try fast.update(statistics: blue, elapsed: 0.1, recipe: recipe) }
        _ = try slow.update(statistics: blue, elapsed: 1, recipe: recipe)
        let a = try #require(slow.value.environmentLinearRGB), b = try #require(fast.value.environmentLinearRGB)
        #expect(abs(a.x - b.x) < 0.00001 && abs(a.z - b.z) < 0.00001)
        #expect(a.x > 0 && a.x < 1 && a.z > 0 && a.z < 1)
        #expect(try slow.update(statistics: nil, elapsed: 1, recipe: recipe).environmentLinearRGB == nil)
    }
    @Test func malformedPixelGeometryIsRejectedBeforeIndexing() {
        let bytes = Data(count: 4)
        #expect(throws: WorldbendBackdropError.self) {
            try bytes.withUnsafeBytes { try WorldbendBackdropGrid(bgra: $0, width: Int.max, height: 1, bytesPerRow: 4, contentRect: .init(x: 0, y: 0, width: 1, height: 1)) }
        }
    }
}
