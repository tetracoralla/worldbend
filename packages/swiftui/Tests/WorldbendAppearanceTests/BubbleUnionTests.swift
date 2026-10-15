import CoreGraphics
import Foundation
import Testing
@testable import WorldbendAppearance

struct BubbleUnionTests {
    @Test func nearbyBodiesMakeOneMeniscusAndSeparateWithoutAnInventedBridge() throws {
        let a = WorldbendBubbleBody(rect: .init(x: 0, y: 0, width: 48, height: 48), radius: 24)
        let near = WorldbendBubbleBody(rect: .init(x: 0, y: 49, width: 48, height: 48), radius: 24)
        let joined = try WorldbendBubbleUnion.contours(bodies: [a, near], blendRadius: 12, cellSize: 1)
        #expect(joined.contours.count == 1)
        #expect(joined.contours[0].first == joined.contours[0].last)
        let far = WorldbendBubbleBody(rect: .init(x: 0, y: 70, width: 48, height: 48), radius: 24)
        let separated = try WorldbendBubbleUnion.contours(bodies: [a, far], blendRadius: 12, cellSize: 1)
        #expect(separated.contours.count == 2)
        #expect(separated.contours.allSatisfy { $0.first == $0.last })
        #expect(try WorldbendBubbleUnion.contours(bodies: [a, near], blendRadius: 0, cellSize: 1).contours.count == 2)
    }
    @Test func boundedInputsRejectTinyLostFeaturesAndUnboundedWork() {
        #expect(throws: WorldbendOutlineError.self) { try WorldbendBubbleUnion.contours(bodies: []) }
        #expect(throws: WorldbendOutlineError.self) { try WorldbendBubbleUnion.contours(bodies: [.init(rect: .init(x: 0, y: 0, width: 1, height: 1), radius: 0.5)]) }
        #expect(throws: WorldbendOutlineError.self) { try WorldbendBubbleUnion.contours(bodies: [.init(rect: .init(x: 0, y: 0, width: 10000, height: 10000), radius: 24)]) }
    }
}
