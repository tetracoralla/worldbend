import CoreGraphics
import Foundation

/// An authored optical body in pane-local points. No gesture or hit-target
/// semantics are inferred from the visual outline.
public struct WorldbendBubbleBody: Equatable, Sendable {
    public var rect: CGRect
    public var radius: Double
    public init(rect: CGRect, radius: Double) { self.rect = rect; self.radius = radius }
    func distance(_ p: CGPoint) -> Double {
        let r = min(radius, min(rect.width, rect.height) / 2)
        let x = abs(p.x - rect.midX) - rect.width / 2 + r
        let y = abs(p.y - rect.midY) - rect.height / 2 + r
        return hypot(max(0, x), max(0, y)) + min(max(x, y), 0) - r
    }
}

public struct WorldbendBubbleUnionResult: Sendable {
    /// Separate bodies stay separate. Do not bridge disconnected paths by
    /// concatenating them into a single polygon; render separate optical panes.
    public let contours: [[CGPoint]]
    public let cellSize: Double
    public let contourTolerance: Double
    public let evaluatedCells: Int
    public let profile = "worldbend.bubble-union@0.1"
}

/// Polynomial smooth-min of 1...4 rounded bodies. A bounded marching-squares
/// contour adds the meniscus near contact and separates it as bodies move apart.
/// This is a 2D optical shape, not a fluid-volume simulation. Sampling tolerance
/// is explicit; a body narrower than two cells is rejected rather than lost.
public enum WorldbendBubbleUnion {
    public static func contours(bodies: [WorldbendBubbleBody], blendRadius: Double = 8,
                                cellSize: Double = 2, contourTolerance: Double = 0.15) throws -> WorldbendBubbleUnionResult {
        guard (1...4).contains(bodies.count), blendRadius.isFinite, (0...48).contains(blendRadius),
              cellSize.isFinite, (0.5...16).contains(cellSize), contourTolerance.isFinite,
              (0...cellSize / 2).contains(contourTolerance), bodies.allSatisfy({ body in
                  [body.rect.minX, body.rect.minY, body.rect.width, body.rect.height, body.radius].allSatisfy(\.isFinite)
                  && body.rect.width >= cellSize * 2 && body.rect.height >= cellSize * 2 && body.radius >= 0
              }) else { throw WorldbendOutlineError.invalidGeometry }
        let bounds = bodies.dropFirst().reduce(bodies[0].rect) { $0.union($1.rect) }.insetBy(dx: -blendRadius - cellSize * 2, dy: -blendRadius - cellSize * 2)
        guard bounds.width / cellSize < 256, bounds.height / cellSize < 256 else { throw WorldbendOutlineError.invalidGeometry }
        let nx = Int(ceil(bounds.width / cellSize)), ny = Int(ceil(bounds.height / cellSize))
        func point(_ x: Int, _ y: Int) -> CGPoint { .init(x: bounds.minX + Double(x) * cellSize, y: bounds.minY + Double(y) * cellSize) }
        func distance(_ p: CGPoint) -> Double {
            bodies.dropFirst().reduce(bodies[0].distance(p)) { a, body in
                let b = body.distance(p)
                guard blendRadius > 0 else { return min(a, b) }
                let h = max(0, min(1, 0.5 + 0.5 * (b - a) / blendRadius))
                return b * (1 - h) + a * h - blendRadius * h * (1 - h)
            }
        }
        var values = [Double](repeating: 0, count: (nx + 1) * (ny + 1))
        for y in 0...ny { for x in 0...nx { values[y * (nx + 1) + x] = distance(point(x, y)) } }
        var vertices: [Int: CGPoint] = [:], neighbors: [Int: [Int]] = [:]
        let verticalBase = (nx + 1) * (ny + 1)
        for y in 0..<ny { for x in 0..<nx {
            let corners = [point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)]
            let v = [values[y * (nx + 1) + x], values[y * (nx + 1) + x + 1], values[(y + 1) * (nx + 1) + x + 1], values[(y + 1) * (nx + 1) + x]]
            let mask = (0..<4).reduce(0) { $0 | (v[$1] < 0 ? 1 << $1 : 0) }
            guard mask != 0 && mask != 15 else { continue }
            let edgeIDs = [y * (nx + 1) + x, verticalBase + y * (nx + 1) + x + 1,
                           (y + 1) * (nx + 1) + x, verticalBase + y * (nx + 1) + x]
            let pairs: [(Int, Int)]
            switch mask {
            case 1, 14: pairs = [(3, 0)]
            case 2, 13: pairs = [(0, 1)]
            case 3, 12: pairs = [(3, 1)]
            case 4, 11: pairs = [(1, 2)]
            case 6, 9: pairs = [(0, 2)]
            case 7, 8: pairs = [(3, 2)]
            case 5, 10:
                let inside = distance(.init(x: corners[0].x + cellSize / 2, y: corners[0].y + cellSize / 2)) < 0
                pairs = (mask == 5) == inside ? [(0, 1), (2, 3)] : [(3, 0), (1, 2)]
            default: pairs = []
            }
            for (a, b) in pairs {
                for edge in [a, b] {
                    let id = edgeIDs[edge]
                    if vertices[id] == nil {
                        let next = (edge + 1) % 4
                        let t = v[edge] / (v[edge] - v[next])
                        vertices[id] = .init(x: corners[edge].x + (corners[next].x - corners[edge].x) * t,
                                             y: corners[edge].y + (corners[next].y - corners[edge].y) * t)
                    }
                }
                neighbors[edgeIDs[a], default: []].append(edgeIDs[b])
                neighbors[edgeIDs[b], default: []].append(edgeIDs[a])
            }
        } }
        var visited: Set<Int> = [], result: [[CGPoint]] = []
        for start in vertices.keys.sorted() where !visited.contains(start) {
            var current = start, previous = -1, loop: [CGPoint] = []
            repeat {
                guard let p = vertices[current], let next = neighbors[current], next.count == 2,
                      !visited.contains(current) else { throw WorldbendOutlineError.invalidGeometry }
                visited.insert(current); loop.append(p)
                let candidate = next[0] == previous ? next[1] : next[0]
                previous = current; current = candidate
            } while current != start
            if loop.count >= 3 {
                loop.append(loop[0])
                result.append(simplified(loop, tolerance: contourTolerance))
            }
        }
        return .init(contours: result, cellSize: cellSize, contourTolerance: contourTolerance, evaluatedCells: nx * ny)
    }

    /// Preserve the sampled surface within the disclosed point tolerance while
    /// avoiding hundreds of collinear vertices in the downstream normal bake.
    private static func simplified(_ points: [CGPoint], tolerance: Double) -> [CGPoint] {
        guard tolerance > 0, points.count > 4 else { return points }
        var keep: Set<Int> = [0, points.count - 1]
        var pending = [(0, points.count - 1)]
        while let (start, end) = pending.popLast() {
            guard end > start + 1 else { continue }
            let a = points[start], b = points[end]
            let dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
            var furthest = 0, error = tolerance
            for i in (start + 1)..<end {
                let p = points[i]
                let t = length > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
                let distance = hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
                if distance > error { error = distance; furthest = i }
            }
            if furthest > 0 {
                keep.insert(furthest); pending.append((start, furthest)); pending.append((furthest, end))
            }
        }
        return keep.sorted().map { points[$0] }
    }
}
