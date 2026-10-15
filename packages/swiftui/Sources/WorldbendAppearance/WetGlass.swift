import CoreGraphics
import Foundation
import simd

/// Profile id for the portable wet-glass surface recipe.
public let worldbendWetGlassSurfaceProfile = "worldbend.wet-glass-surface@0.1"

/// Authored vs effective resource / parameter bounds for wet-glass recipes.
/// `referenceCapacity` (1200) is the accepted visual scale — do **not** reduce
/// it to mask CPU cost. `capacityMax` / `initialSpawnLoopMax` are hard
/// validation ceilings so hostile recipes cannot Int-overflow or spin forever.
public struct WorldbendWetGlassResourceLimits: Codable, Equatable, Sendable {
    /// Accepted product capacity (APP wet-glass-reference / ArrivalWaterSimulation).
    public static let referenceCapacity: Int = 1200
    /// Maximum `simulation.capacity` a recipe may author.
    public static let capacityMax: Int = 4096
    /// Maximum per-band `initialDrops` before population scaling.
    public static let initialDropsBandMax: Double = 4096
    /// Maximum `Int(initialDrops * population)` loop iterations at sim init.
    public static let initialSpawnLoopMax: Int = 4096
    /// Maximum authored `spawnPerSecond` per band.
    public static let spawnPerSecondMax: Double = 1000
    /// Maximum authored `|gravity|` per band (units / s²).
    public static let gravityAbsMax: Double = 10_000
    /// Reject light vectors shorter than this (illegal normals).
    public static let lightVectorMinLengthSquared: Double = 1e-12
    /// Maximum field-band lane count used when building spawn lanes.
    public static let fieldBandCountMax: Int = 512

    public var authoredCapacity: Int
    public var effectiveCapacity: Int
    public var authoredInitialDrops: WorldbendWetGlassRecipe.BandTable
    public var effectiveInitialSpawnLoopMax: Int

    public init(recipe: WorldbendWetGlassRecipe) {
        authoredCapacity = recipe.simulation.capacity
        effectiveCapacity = min(recipe.simulation.capacity, Self.capacityMax)
        authoredInitialDrops = recipe.simulation.initialDrops
        effectiveInitialSpawnLoopMax = min(Self.initialSpawnLoopMax, effectiveCapacity)
    }
}


/// Intensity band selecting recipe spawn/gravity tables. Product weather UX
/// (ArrivalWeather enums, scene copy) stays in the APP; this is shared physics.
public enum WorldbendWetGlassBand: String, Codable, Sendable, CaseIterable, Equatable {
    case light, medium, heavy
}

/// Composition mode for the Metal wet-glass pass.
public enum WorldbendWetGlassComposeMode: String, Codable, Sendable, Equatable {
    /// Refract an explicit photograph / shared frame backdrop inside the mask.
    case window
    /// Clear centre + rim gleam/shade only; does not sample UIKit/live controls.
    case cardRim
}

/// Portable recipe extracted from APP wet-glass reference / ArrivalWater*.
/// Schema: `worldbend.wet-glass-surface@0.1`. Scene mask artwork, weather enum
/// and brand chrome remain APP-owned.
public struct WorldbendWetGlassRecipe: Codable, Equatable, Sendable {
    public struct Provenance: Codable, Equatable, Sendable {
        public var project: String
        public var revision: String
        public var license: String
        public var source: String
        public init(
            project: String = "Raindrop FX",
            revision: String = "bae4081bc15815bb094ea040a976dca083bbc3a5",
            license: String = "MIT",
            source: String = "https://github.com/SardineFish/raindrop-fx"
        ) {
            self.project = project; self.revision = revision
            self.license = license; self.source = source
        }
    }

    public struct BandTable: Codable, Equatable, Sendable {
        public var light: Double
        public var medium: Double
        public var heavy: Double
        public init(light: Double, medium: Double, heavy: Double) {
            self.light = light; self.medium = medium; self.heavy = heavy
        }
        public func value(for band: WorldbendWetGlassBand) -> Double {
            switch band {
            case .light: return light
            case .medium: return medium
            case .heavy: return heavy
            }
        }
    }

    public struct Range: Codable, Equatable, Sendable {
        public var min: Double
        public var max: Double
        public init(min: Double, max: Double) { self.min = min; self.max = max }
        public func sample(_ t: Double) -> Double {
            let lo = self.min
            let hi = self.max
            let u = Swift.min(1, Swift.max(0, t))
            return lo + u * (hi - lo)
        }
    }

    public struct FieldBand: Codable, Equatable, Sendable {
        /// Lane density used only when building spawn lanes from polygons.
        public var count: Int
        public var radius: Double
        public var speed: Double
        public var trail: Double
        public init(count: Int, radius: Double, speed: Double, trail: Double) {
            self.count = count; self.radius = radius; self.speed = speed; self.trail = trail
        }
    }

    public struct Simulation: Codable, Equatable, Sendable {
        public var capacity: Int
        public var stepSeconds: Double
        public var maxCatchupSeconds: Double
        public var initialDrops: BandTable
        public var spawnPerSecond: BandTable
        public var gravityInUnits: BandTable
        public var smallRadiusUnits: Range
        public var largeRadiusUnits: Range
        public var largeProbability: Double
        public var releaseRadiusUnits: Range
        public var initialSlidingSpeedUnits: Range
        public var maximumRadiusUnits: Double
        public var maximumSpeedUnits: Double
        public var dragPerSecond: Double
        public var evaporationUnitSquaredPerSecond: Double
        public var mergeReach: Double
        public var mergeGridMinimumUnits: Double
        public var trailMinimumSpeedUnits: Double
        public var trailMinimumDistanceUnits: Double
        public var trailRelativeDistance: Double
        public var trailMaximumRadiusUnits: Double
        public var trailRelativeRadius: Double
        public var trailAdhesionUnitSquared: Double
        public var drainingSpeedUnits: Double
        public var fieldBands: [String: FieldBand]
    }

    public struct Optics: Codable, Equatable, Sendable {
        public var normalStrength: Double
        public var refractionBasePoints: Double
        public var refractionHeightPoints: Double
        public var surfaceLightVector: [Double]
        public var specularPower: Double
        public var specularGain: Double
        public var diffuseGain: Double
        public var diffuseReference: Double
        public var rimShadeGain: Double
        public var coverageHeightRange: Range
        public var edgeSafetyPoints: Double
        public var occlusionRayProbes: Int
        public var cardLightDirection: [Double]
        public var cardGleamGain: Double
        public var cardShadeGain: Double
    }

    public var profile: String
    public var provenance: Provenance
    public var simulation: Simulation
    public var optics: Optics

    public init(profile: String = worldbendWetGlassSurfaceProfile,
                provenance: Provenance = .init(),
                simulation: Simulation,
                optics: Optics) {
        self.profile = profile
        self.provenance = provenance
        self.simulation = simulation
        self.optics = optics
    }

    /// Authored vs effective resource limits for receipts / APP sync notes.
    public var resourceLimits: WorldbendWetGlassResourceLimits {
        WorldbendWetGlassResourceLimits(recipe: self)
    }

    public func validate() throws {
        guard profile == worldbendWetGlassSurfaceProfile else {
            throw WorldbendWetGlassError.invalidRecipe("profile must be \(worldbendWetGlassSurfaceProfile)")
        }
        guard provenance.license.uppercased().contains("MIT") else {
            throw WorldbendWetGlassError.invalidRecipe("provenance.license must remain MIT")
        }
        let s = simulation
        let limits = WorldbendWetGlassResourceLimits.self
        guard s.capacity > 0, s.capacity <= limits.capacityMax else {
            throw WorldbendWetGlassError.invalidRecipe(
                "simulation.capacity must be in 1...\(limits.capacityMax) (reference \(limits.referenceCapacity))"
            )
        }
        guard s.stepSeconds.isFinite, s.stepSeconds > 0, s.stepSeconds <= 0.05 else {
            throw WorldbendWetGlassError.invalidRecipe("simulation.stepSeconds must be finite in (0, 0.05]")
        }
        guard s.maxCatchupSeconds.isFinite, s.maxCatchupSeconds > 0, s.maxCatchupSeconds <= 1 else {
            throw WorldbendWetGlassError.invalidRecipe("simulation.maxCatchupSeconds must be finite in (0, 1]")
        }
        guard s.largeProbability.isFinite, s.largeProbability >= 0, s.largeProbability <= 1 else {
            throw WorldbendWetGlassError.invalidRecipe("simulation.largeProbability must be finite in [0, 1]")
        }
        try Self.validateBandTable(s.initialDrops, name: "initialDrops", min: 0, max: limits.initialDropsBandMax)
        try Self.validateBandTable(s.spawnPerSecond, name: "spawnPerSecond", min: 0, max: limits.spawnPerSecondMax)
        try Self.validateBandTable(s.gravityInUnits, name: "gravityInUnits", min: -limits.gravityAbsMax, max: limits.gravityAbsMax)
        if abs(s.gravityInUnits.light) < 1e-12 && abs(s.gravityInUnits.medium) < 1e-12
            && abs(s.gravityInUnits.heavy) < 1e-12 {
            throw WorldbendWetGlassError.invalidRecipe("gravityInUnits must be non-zero in at least one band")
        }
        try Self.validateRange(s.smallRadiusUnits, name: "smallRadiusUnits", minAllowed: 0)
        try Self.validateRange(s.largeRadiusUnits, name: "largeRadiusUnits", minAllowed: 0)
        try Self.validateRange(s.releaseRadiusUnits, name: "releaseRadiusUnits", minAllowed: 0)
        try Self.validateRange(s.initialSlidingSpeedUnits, name: "initialSlidingSpeedUnits", minAllowed: 0)
        for (label, value) in [
            ("maximumRadiusUnits", s.maximumRadiusUnits),
            ("maximumSpeedUnits", s.maximumSpeedUnits),
            ("dragPerSecond", s.dragPerSecond),
            ("evaporationUnitSquaredPerSecond", s.evaporationUnitSquaredPerSecond),
            ("mergeReach", s.mergeReach),
            ("mergeGridMinimumUnits", s.mergeGridMinimumUnits),
            ("trailMinimumSpeedUnits", s.trailMinimumSpeedUnits),
            ("trailMinimumDistanceUnits", s.trailMinimumDistanceUnits),
            ("trailRelativeDistance", s.trailRelativeDistance),
            ("trailMaximumRadiusUnits", s.trailMaximumRadiusUnits),
            ("trailRelativeRadius", s.trailRelativeRadius),
            ("trailAdhesionUnitSquared", s.trailAdhesionUnitSquared),
            ("drainingSpeedUnits", s.drainingSpeedUnits)
        ] {
            guard value.isFinite else {
                throw WorldbendWetGlassError.invalidRecipe("simulation.\(label) must be finite")
            }
        }
        guard s.maximumRadiusUnits > 0, s.maximumSpeedUnits > 0, s.mergeReach > 0 else {
            throw WorldbendWetGlassError.invalidRecipe("simulation radius/speed/mergeReach must be > 0")
        }
        guard s.dragPerSecond >= 0, s.evaporationUnitSquaredPerSecond >= 0 else {
            throw WorldbendWetGlassError.invalidRecipe("drag/evaporation must be >= 0")
        }
        // initialDrops must not exceed capacity: Int(initialDrops*population) loop
        // is bounded by capacity at init, but authored values above capacity are
        // wasteful and rejected so APP sync cannot silently author giant loops.
        for band in WorldbendWetGlassBand.allCases {
            let drops = s.initialDrops.value(for: band)
            if drops > Double(s.capacity) + 1e-9 {
                throw WorldbendWetGlassError.invalidRecipe(
                    "initialDrops.\(band.rawValue)=\(drops) exceeds capacity \(s.capacity)"
                )
            }
        }
        for key in ["light", "medium", "heavy"] {
            guard let band = s.fieldBands[key] else {
                throw WorldbendWetGlassError.invalidRecipe("simulation.fieldBands missing \(key)")
            }
            guard band.count >= 0, band.count <= limits.fieldBandCountMax,
                  band.radius.isFinite, band.radius >= 0,
                  band.speed.isFinite, band.speed >= 0,
                  band.trail.isFinite, band.trail >= 0 else {
                throw WorldbendWetGlassError.invalidRecipe("simulation.fieldBands.\(key) out of range")
            }
        }

        let o = optics
        guard o.surfaceLightVector.count == 3 else {
            throw WorldbendWetGlassError.invalidRecipe("optics.surfaceLightVector must have 3 components")
        }
        guard o.cardLightDirection.count == 2 else {
            throw WorldbendWetGlassError.invalidRecipe("optics.cardLightDirection must have 2 components")
        }
        guard o.surfaceLightVector.allSatisfy(\.isFinite) else {
            throw WorldbendWetGlassError.invalidRecipe("optics.surfaceLightVector must be finite")
        }
        guard o.cardLightDirection.allSatisfy(\.isFinite) else {
            throw WorldbendWetGlassError.invalidRecipe("optics.cardLightDirection must be finite")
        }
        let sLen2 = o.surfaceLightVector.reduce(0) { $0 + $1 * $1 }
        guard sLen2 > limits.lightVectorMinLengthSquared else {
            throw WorldbendWetGlassError.invalidRecipe(
                "optics.surfaceLightVector must be non-zero (illegal normals)"
            )
        }
        let cLen2 = o.cardLightDirection.reduce(0) { $0 + $1 * $1 }
        guard cLen2 > limits.lightVectorMinLengthSquared else {
            throw WorldbendWetGlassError.invalidRecipe(
                "optics.cardLightDirection must be non-zero (illegal normals)"
            )
        }
        for (label, value) in [
            ("normalStrength", o.normalStrength),
            ("refractionBasePoints", o.refractionBasePoints),
            ("refractionHeightPoints", o.refractionHeightPoints),
            ("specularPower", o.specularPower),
            ("specularGain", o.specularGain),
            ("diffuseGain", o.diffuseGain),
            ("diffuseReference", o.diffuseReference),
            ("rimShadeGain", o.rimShadeGain),
            ("edgeSafetyPoints", o.edgeSafetyPoints),
            ("cardGleamGain", o.cardGleamGain),
            ("cardShadeGain", o.cardShadeGain)
        ] {
            guard value.isFinite else {
                throw WorldbendWetGlassError.invalidRecipe("optics.\(label) must be finite")
            }
        }
        guard o.occlusionRayProbes >= 1, o.occlusionRayProbes <= 16 else {
            throw WorldbendWetGlassError.invalidRecipe("optics.occlusionRayProbes must be in 1...16")
        }
        try Self.validateRange(o.coverageHeightRange, name: "coverageHeightRange", minAllowed: nil)
        guard o.coverageHeightRange.min < o.coverageHeightRange.max else {
            throw WorldbendWetGlassError.invalidRecipe("optics.coverageHeightRange.min must be < max")
        }
    }

    private static func validateBandTable(
        _ table: BandTable, name: String, min: Double, max: Double
    ) throws {
        for (band, value) in [("light", table.light), ("medium", table.medium), ("heavy", table.heavy)] {
            guard value.isFinite else {
                throw WorldbendWetGlassError.invalidRecipe("simulation.\(name).\(band) must be finite")
            }
            guard value >= min, value <= max else {
                throw WorldbendWetGlassError.invalidRecipe(
                    "simulation.\(name).\(band)=\(value) outside [\(min), \(max)]"
                )
            }
        }
    }

    private static func validateRange(
        _ range: Range, name: String, minAllowed: Double?
    ) throws {
        guard range.min.isFinite, range.max.isFinite else {
            throw WorldbendWetGlassError.invalidRecipe("\(name) min/max must be finite")
        }
        guard range.min <= range.max else {
            throw WorldbendWetGlassError.invalidRecipe("\(name).min must be <= max")
        }
        if let minAllowed, range.min < minAllowed {
            throw WorldbendWetGlassError.invalidRecipe("\(name).min must be >= \(minAllowed)")
        }
    }

    /// Default deterministic drop simulation and optical parameters.
    public static let referenceDefaults: WorldbendWetGlassRecipe = {
        let sim = Simulation(
            capacity: 1200,
            stepSeconds: 1.0 / 60.0,
            maxCatchupSeconds: 0.1,
            initialDrops: .init(light: 130, medium: 280, heavy: 500),
            spawnPerSecond: .init(light: 4, medium: 10, heavy: 24),
            gravityInUnits: .init(light: 180, medium: 240, heavy: 310),
            smallRadiusUnits: .init(min: 1.8, max: 4.9),
            largeRadiusUnits: .init(min: 6.5, max: 12),
            largeProbability: 0.16,
            releaseRadiusUnits: .init(min: 6.8, max: 10.6),
            initialSlidingSpeedUnits: .init(min: 18, max: 53),
            maximumRadiusUnits: 12,
            maximumSpeedUnits: 220,
            dragPerSecond: 0.65,
            evaporationUnitSquaredPerSecond: 0.16,
            mergeReach: 0.74,
            mergeGridMinimumUnits: 24,
            trailMinimumSpeedUnits: 12,
            trailMinimumDistanceUnits: 4,
            trailRelativeDistance: 0.85,
            trailMaximumRadiusUnits: 2.6,
            trailRelativeRadius: 0.2,
            trailAdhesionUnitSquared: 400,
            drainingSpeedUnits: 120,
            fieldBands: [
                "light": .init(count: 18, radius: 2.4, speed: 0.18, trail: 34),
                "medium": .init(count: 46, radius: 3.8, speed: 0.46, trail: 64),
                "heavy": .init(count: 92, radius: 5.6, speed: 0.92, trail: 108)
            ]
        )
        let optics = Optics(
            normalStrength: 8,
            refractionBasePoints: 0.6,
            refractionHeightPoints: 1.5,
            surfaceLightVector: [-0.45, -0.8, 1.4],
            specularPower: 90,
            specularGain: 0.1,
            diffuseGain: 0.1,
            diffuseReference: 0.72,
            rimShadeGain: 0.14,
            coverageHeightRange: .init(min: 0.09, max: 0.17),
            edgeSafetyPoints: 2,
            occlusionRayProbes: 4,
            cardLightDirection: [-0.6, -0.8],
            cardGleamGain: 0.32,
            cardShadeGain: 0.2
        )
        return WorldbendWetGlassRecipe(simulation: sim, optics: optics)
    }()

    /// APP reference scene defaults from wet-glass-reference.json `scene` block.
    /// Product weather UX still chooses which scale/population to bind; these
    /// constants exist so receivers do not re-derive ArrivalRoomArtwork values.
    public static let referenceRoomWaterScale: CGFloat = 0.26
    public static let referenceCardWaterScale: CGFloat = 0.45
    public static let referenceCardPopulation: Double = 0.3

    public static func decode(_ data: Data) throws -> WorldbendWetGlassRecipe {
        let value = try JSONDecoder().decode(WorldbendWetGlassRecipe.self, from: data)
        try value.validate()
        return value
    }
}

public enum WorldbendWetGlassError: Error, LocalizedError, Sendable {
    case invalidRecipe(String)
    case missingMetallib
    case encodeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRecipe(let detail): return "Invalid wet-glass recipe: \(detail)"
        case .missingMetallib: return "Wet-glass Metal library unavailable (build with Xcode)"
        case .encodeFailed(let detail): return "Wet-glass encode failed: \(detail)"
        }
    }
}

/// Unit conversion: `sourceWidth / 1024 * waterScale` (APP wet-glass-reference).
public enum WorldbendWetGlassUnit {
    public static func make(sourceWidth: CGFloat, waterScale: CGFloat) -> CGFloat {
        max(0.0001, sourceWidth / 1024 * max(0.05, min(1, waterScale)))
    }
}

/// Spawn lane in source (artwork) coordinates. APP may supply lanes directly
/// after intersecting glazing/occlusion, or use ``WorldbendWetGlassField``.
public struct WorldbendWetGlassLane: Equatable, Sendable {
    public var index: Int
    public var pane: Int
    public var x: CGFloat
    public var start: CGFloat
    public var end: CGFloat

    public init(index: Int, pane: Int, x: CGFloat, start: CGFloat, end: CGFloat) {
        self.index = index; self.pane = pane; self.x = x; self.start = start; self.end = end
    }
}

public struct WorldbendWetGlassField: Equatable, Sendable {
    public var lanes: [WorldbendWetGlassLane]
    public init(lanes: [WorldbendWetGlassLane]) { self.lanes = lanes }

    /// Build spawn lanes from glazing polygons and opaque holes in source space.
    /// Port of ArrivalRainStep.roomField lane geometry (not sky precipitation).
    public static func build(
        panes: [[CGPoint]],
        holes: [[CGPoint]] = [],
        sourceSize: CGSize,
        band: WorldbendWetGlassBand,
        recipe: WorldbendWetGlassRecipe = .referenceDefaults
    ) -> WorldbendWetGlassField {
        guard sourceSize.width > 0, sourceSize.height > 0, !panes.isEmpty else {
            return .init(lanes: [])
        }
        let profile = recipe.simulation.fieldBands[band.rawValue]
            ?? recipe.simulation.fieldBands["medium"]!
        let area = sourceSize.width * sourceSize.height
        let authored = panes.enumerated().flatMap { index, pane in
            lanes(pane: pane, holes: holes, profile: profile, paneIndex: index, area: area)
        }
        return .init(lanes: authored)
    }

    private static func lanes(
        pane: [CGPoint], holes: [[CGPoint]], profile: WorldbendWetGlassRecipe.FieldBand,
        paneIndex: Int, area: CGFloat
    ) -> [WorldbendWetGlassLane] {
        guard pane.count >= 3, area > 0,
              let minX = pane.map(\.x).min(), let maxX = pane.map(\.x).max(),
              maxX > minX + 2 else { return [] }
        let polygonArea = abs(pane.indices.reduce(CGFloat.zero) { sum, i in
            let next = pane[(i + 1) % pane.count]
            return sum + pane[i].x * next.y - next.x * pane[i].y
        }) / 2
        let count = max(2, min(profile.count, Int(ceil(CGFloat(profile.count) * polygonArea / area * 12))))
        return (0..<count).compactMap { lane in
            let index = paneIndex * 1_000 + lane
            let x = minX + (maxX - minX) * (0.06 + 0.88 * (CGFloat(lane) + CGFloat(noise(index, salt: 43))) / CGFloat(count))
            let spans = wetSpans(x: x, pane: pane, holes: holes)
            guard !spans.isEmpty else { return nil }
            let span = spans[lane % spans.count]
            let radius = CGFloat(profile.radius) * (0.65 + 0.65 * CGFloat(noise(index, salt: 811)))
            let pad = radius + 1.5
            let start = span.0 + pad, end = span.1 - pad
            guard end - start > 2 else { return nil }
            return WorldbendWetGlassLane(index: index, pane: paneIndex, x: x, start: start, end: end)
        }
    }

    static func noise(_ index: Int, salt: UInt64) -> Double {
        var value = UInt64(max(0, index)) &+ salt
        value = (value ^ (value >> 30)) &* 0xbf58476d1ce4e5b9
        value = (value ^ (value >> 27)) &* 0x94d049bb133111eb
        return Double((value ^ (value >> 31)) & 0xffffff) / Double(0x1000000)
    }

    private static func contains(_ point: CGPoint, polygon: [CGPoint]) -> Bool {
        guard polygon.count >= 3 else { return false }
        var inside = false
        var previous = polygon[polygon.count - 1]
        for vertex in polygon {
            if (vertex.y > point.y) != (previous.y > point.y), previous.y != vertex.y {
                let x = (previous.x - vertex.x) * (point.y - vertex.y) / (previous.y - vertex.y) + vertex.x
                if point.x < x { inside.toggle() }
            }
            previous = vertex
        }
        return inside
    }

    private static func verticalSpans(x: CGFloat, polygon: [CGPoint]) -> [(CGFloat, CGFloat)] {
        guard polygon.count >= 3 else { return [] }
        var crossings: [CGFloat] = []
        for index in polygon.indices {
            let start = polygon[index]
            let end = polygon[(index + 1) % polygon.count]
            let straddles = (start.x <= x && end.x > x) || (end.x <= x && start.x > x)
            guard straddles, start.x != end.x else { continue }
            let t = (x - start.x) / (end.x - start.x)
            crossings.append(start.y + t * (end.y - start.y))
        }
        crossings.sort()
        var spans: [(CGFloat, CGFloat)] = []
        var index = 0
        while index + 1 < crossings.count {
            if crossings[index + 1] - crossings[index] > 0.5 {
                spans.append((crossings[index], crossings[index + 1]))
            }
            index += 2
        }
        return spans
    }

    private static func wetSpans(x: CGFloat, pane: [CGPoint], holes: [[CGPoint]]) -> [(CGFloat, CGFloat)] {
        var spans = verticalSpans(x: x, polygon: pane)
        for hole in holes {
            for cut in verticalSpans(x: x, polygon: hole) {
                var next: [(CGFloat, CGFloat)] = []
                for span in spans {
                    if cut.1 <= span.0 || cut.0 >= span.1 { next.append(span); continue }
                    if cut.0 > span.0 { next.append((span.0, min(cut.0, span.1))) }
                    if cut.1 < span.1 { next.append((max(cut.1, span.0), span.1)) }
                }
                spans = next
            }
        }
        return spans
    }

    static func pointInPane(_ point: CGPoint, panes: [[CGPoint]], pane: Int) -> Bool {
        guard panes.indices.contains(pane) else { return false }
        return contains(point, polygon: panes[pane])
    }
}

/// One surface bead. Adaptation of Raindrop FX mass/resistance/merge/trail
/// (SardineFish, MIT). See Licenses/RaindropFX-LICENSE.txt.
public struct WorldbendWetGlassDrop: Equatable, Sendable {
    public let id: Int
    public let pane: Int
    public var position: CGPoint
    public var mass: CGFloat
    public var velocity: CGPoint
    public var resistance: CGFloat
    public var spread: CGFloat
    public var lastTrail: CGPoint
    public var parent: Int?
    public var age: Double

    public var radius: CGFloat { sqrt(max(0, mass)) }

    public init(
        id: Int, pane: Int, position: CGPoint, mass: CGFloat,
        velocity: CGPoint = .zero, resistance: CGFloat, spread: CGFloat = 0,
        lastTrail: CGPoint, parent: Int? = nil, age: Double = 0
    ) {
        self.id = id; self.pane = pane; self.position = position; self.mass = mass
        self.velocity = velocity; self.resistance = resistance; self.spread = spread
        self.lastTrail = lastTrail; self.parent = parent; self.age = age
    }

    public mutating func absorb(_ other: Self) {
        let total = mass + other.mass
        guard total > 0 else { return }
        position = CGPoint(
            x: (position.x * mass + other.position.x * other.mass) / total,
            y: (position.y * mass + other.position.y * other.mass) / total
        )
        velocity = CGPoint(
            x: (velocity.x * mass + other.velocity.x * other.mass) / total,
            y: (velocity.y * mass + other.velocity.y * other.mass) / total
        )
        mass = total
        resistance = min(resistance, other.resistance)
        spread = min(0.3, spread + 0.12)
    }
}

/// Inputs APP owns per scene instance. Mask bytes and weather UX stay outside.
public struct WorldbendWetGlassSurfaceBinding: Equatable, Sendable {
    public var sourceSize: CGSize
    public var waterScale: CGFloat
    public var band: WorldbendWetGlassBand
    public var population: Double
    public var seed: Int
    public var panes: [[CGPoint]]
    public var field: WorldbendWetGlassField
    public var composeMode: WorldbendWetGlassComposeMode

    public init(
        sourceSize: CGSize,
        waterScale: CGFloat,
        band: WorldbendWetGlassBand,
        population: Double = 1,
        seed: Int = 0,
        panes: [[CGPoint]],
        field: WorldbendWetGlassField,
        composeMode: WorldbendWetGlassComposeMode = .window
    ) {
        self.sourceSize = sourceSize
        self.waterScale = waterScale
        self.band = band
        // Effective product range is [0.1, 1]. Non-finite values are preserved
        // so `WorldbendWetGlassSimulation` rejects them instead of silently
        // becoming 1.0 (APP must not author Inf/NaN population).
        if population.isFinite {
            self.population = min(1, max(0.1, population))
        } else {
            self.population = population
        }
        self.seed = seed
        self.panes = panes
        self.field = field
        self.composeMode = composeMode
    }

    public var unit: CGFloat {
        WorldbendWetGlassUnit.make(sourceWidth: sourceSize.width, waterScale: waterScale)
    }
}

/// Fixed-step wet-glass simulation in source coordinates. Port of
/// `ArrivalWaterSimulation` without APP artwork/weather types.
/// Pre-multiply resource guard for mergeNearby dense bins.
public enum WorldbendWetGlassMergeGrid {
    public static let maxBins = 1_000_000

    public struct Count: Equatable, Sendable {
        public let binCount: Int
        public let plane: Int
    }

    /// Returns nil when the span is non-positive or the product would exceed
    /// ``maxBins``. Factors are checked before any multiplying Int64 so a
    /// hostile width/height/paneCount cannot trap on overflow.
    public static func checkedBinCount(
        width: Int,
        height: Int,
        paneCount: Int,
        maxBins: Int = maxBins
    ) -> Count? {
        guard width > 0, height > 0, paneCount > 0, maxBins > 0 else { return nil }
        guard width <= maxBins, height <= maxBins, paneCount <= maxBins else { return nil }
        let maxW = Int64(maxBins)
        let w64 = Int64(width)
        let h64 = Int64(height)
        let p64 = Int64(paneCount)
        guard h64 > 0, w64 <= maxW / h64 else { return nil }
        let plane64 = w64 * h64
        guard p64 > 0, plane64 <= maxW / p64 else { return nil }
        let binCount64 = plane64 * p64
        guard binCount64 > 0, binCount64 <= maxW else { return nil }
        return Count(binCount: Int(binCount64), plane: Int(plane64))
    }
}

public final class WorldbendWetGlassSimulation: @unchecked Sendable {
    public private(set) var drops: [WorldbendWetGlassDrop] = []
    public private(set) var mergeCount = 0
    public private(set) var trailCount = 0
    public private(set) var elapsed: Double = 0
    public private(set) var drainedMass: CGFloat = 0
    public private(set) var stepCount: Int = 0

    public let recipe: WorldbendWetGlassRecipe
    public let binding: WorldbendWetGlassSurfaceBinding

    private var sequence: Int
    private var nextID = 0
    private var accumulated: Double = 0
    private var inputTime: Double?

    public var maximumRadius: CGFloat {
        CGFloat(recipe.simulation.maximumRadiusUnits) * binding.unit
    }

    public init(recipe: WorldbendWetGlassRecipe = .referenceDefaults,
                binding: WorldbendWetGlassSurfaceBinding) throws {
        try recipe.validate()
        guard binding.population.isFinite, binding.population >= 0, binding.population <= 8 else {
            throw WorldbendWetGlassError.invalidRecipe(
                "binding.population must be finite in [0, 8] (got \(binding.population))"
            )
        }
        self.recipe = recipe
        self.binding = binding
        self.sequence = binding.seed
        let scaled = recipe.simulation.initialDrops.value(for: binding.band) * binding.population
        guard scaled.isFinite, scaled >= 0 else {
            throw WorldbendWetGlassError.invalidRecipe("initialDrops*population must be finite and >= 0")
        }
        let loopMax = WorldbendWetGlassResourceLimits.initialSpawnLoopMax
        let capped = min(Double(recipe.simulation.capacity), min(Double(loopMax), scaled))
        let initial = Int(capped)
        for _ in 0..<initial { spawn(initial: true) }
    }

    /// Advance simulation clock. Fixed step from recipe; catch-up clamped.
    public func advance(to time: Double) {
        guard time.isFinite else { return }
        guard let previous = inputTime else { inputTime = time; return }
        inputTime = time
        let sim = recipe.simulation
        accumulated += min(sim.maxCatchupSeconds, max(0, time - previous))
        while accumulated + 1e-9 >= sim.stepSeconds {
            update(dt: sim.stepSeconds)
            accumulated -= sim.stepSeconds
            stepCount += 1
        }
    }

    /// Run exactly `steps` fixed steps (tests / deterministic checkpoints).
    public func advanceSteps(_ steps: Int) {
        let dt = recipe.simulation.stepSeconds
        for _ in 0..<max(0, steps) {
            update(dt: dt)
            stepCount += 1
        }
    }

    /// Pack drops into canvas (logical) coordinates as SIMD4(x,y,rx,ry).
    public func particles(in canvas: CGRect) -> [SIMD4<Float>] {
        let sx = canvas.width / binding.sourceSize.width
        let sy = canvas.height / binding.sourceSize.height
        let unit = binding.unit
        return drops.map { drop in
            let stretch = min(1.15, drop.velocity.y / (150 * unit))
            let rx = drop.radius * (1 + drop.spread) / (1 + stretch * 0.22)
            let ry = drop.radius * (1 + stretch)
            return SIMD4(
                Float(canvas.minX + drop.position.x * sx),
                Float(canvas.minY + drop.position.y * sy),
                Float(rx * sx),
                Float(ry * sy)
            )
        }
    }

    /// Checkpoint fingerprint for in-process tests (Swift `Hasher` is
    /// randomly seeded per execution — compare only within one process).
    public func checkpointFingerprint() -> String {
        var hasher = Hasher()
        hasher.combine(drops.count)
        hasher.combine(mergeCount)
        hasher.combine(trailCount)
        hasher.combine(stepCount)
        for drop in drops.sorted(by: { $0.id < $1.id }) {
            hasher.combine(drop.id)
            hasher.combine(drop.pane)
            hasher.combine(Int((drop.position.x * 1000).rounded()))
            hasher.combine(Int((drop.position.y * 1000).rounded()))
            hasher.combine(Int((drop.mass * 1000).rounded()))
            hasher.combine(Int((drop.velocity.y * 1000).rounded()))
        }
        hasher.combine(Int((drainedMass * 1000).rounded()))
        return String(UInt64(bitPattern: Int64(hasher.finalize())), radix: 16)
    }

    /// Cross-run stable evolution checkpoint (milli-bins). Used to prove
    /// mergeNearby rewrites do not change particle recipe / evolution results.
    public func stableEvolutionCheckpoint() -> String {
        var lines: [String] = [
            "n=\(drops.count)",
            "merge=\(mergeCount)",
            "trail=\(trailCount)",
            "steps=\(stepCount)",
            "drain=\(Int((drainedMass * 1000).rounded()))"
        ]
        for drop in drops.sorted(by: { $0.id < $1.id }) {
            lines.append(
                String(
                    format: "d%d|p%d|x%d|y%d|m%d|vy%d|r%d|par%@",
                    drop.id,
                    drop.pane,
                    Int((drop.position.x * 1000).rounded()),
                    Int((drop.position.y * 1000).rounded()),
                    Int((drop.mass * 1000).rounded()),
                    Int((drop.velocity.y * 1000).rounded()),
                    Int((drop.resistance * 1000).rounded()),
                    drop.parent.map(String.init) ?? "-"
                )
            )
        }
        return lines.joined(separator: ";")
    }

    private func sample() -> Double {
        sequence += 1
        return WorldbendWetGlassField.noise(sequence, salt: 0xa317)
    }

    private func spawn(initial: Bool) {
        let sim = recipe.simulation
        let unit = binding.unit
        guard drops.count < sim.capacity, !binding.field.lanes.isEmpty else { return }
        let lane = binding.field.lanes[
            min(binding.field.lanes.count - 1, Int(sample() * Double(binding.field.lanes.count)))
        ]
        let radius: CGFloat
        if sample() < sim.largeProbability {
            radius = CGFloat(sim.largeRadiusUnits.sample(sample())) * unit
        } else {
            radius = CGFloat(sim.smallRadiusUnits.sample(sample())) * unit
        }
        let y = lane.start + (lane.end - lane.start) * sample()
        let point = CGPoint(x: lane.x, y: y)
        nextID += 1
        let release = CGFloat(sim.releaseRadiusUnits.sample(sample())) * unit
        var drop = WorldbendWetGlassDrop(
            id: nextID, pane: lane.pane, position: point, mass: radius * radius,
            resistance: release * release, lastTrail: point
        )
        if initial, radius > release {
            drop.velocity.y = CGFloat(sim.initialSlidingSpeedUnits.sample(sample())) * unit
        }
        drop.spread = initial ? 0 : 0.2
        drops.append(drop)
    }

    private func update(dt: Double) {
        elapsed += dt
        let sim = recipe.simulation
        let unit = binding.unit
        _spawnCredit += sim.spawnPerSecond.value(for: binding.band) * binding.population * dt
        while _spawnCredit >= 1 {
            spawn(initial: false)
            _spawnCredit -= 1
        }
        let gravity = CGFloat(sim.gravityInUnits.value(for: binding.band)) * unit
        var trails: [WorldbendWetGlassDrop] = []
        for index in drops.indices {
            var drop = drops[index]
            drop.age += dt
            drop.mass = max(0, drop.mass - CGFloat(sim.evaporationUnitSquaredPerSecond) * unit * unit * dt)
            if drop.mass < unit * unit { drops[index] = drop; continue }
            let acceleration = gravity * max(0, 1 - drop.resistance / drop.mass)
            drop.velocity.y = min(
                CGFloat(sim.maximumSpeedUnits) * unit,
                (drop.velocity.y + acceleration * dt) * exp(-CGFloat(sim.dragPerSecond) * dt)
            )
            let bend = sin(elapsed * 0.8 + Double(drop.id) * 0.71) * 0.025
            drop.velocity.x = drop.velocity.y * bend
            let next = CGPoint(
                x: drop.position.x + drop.velocity.x * dt,
                y: drop.position.y + drop.velocity.y * dt
            )
            if !WorldbendWetGlassField.pointInPane(next, panes: binding.panes, pane: drop.pane) {
                drop.mass = 0
                drops[index] = drop
                continue
            }
            drop.position = next
            drop.spread *= exp(-4 * dt)
            let distance = hypot(drop.position.x - drop.lastTrail.x, drop.position.y - drop.lastTrail.y)
            if drop.velocity.y > CGFloat(sim.trailMinimumSpeedUnits) * unit,
               distance > max(CGFloat(sim.trailMinimumDistanceUnits) * unit, drop.radius * CGFloat(sim.trailRelativeDistance)),
               drops.count + trails.count < sim.capacity {
                let radius = min(CGFloat(sim.trailMaximumRadiusUnits) * unit, drop.radius * CGFloat(sim.trailRelativeRadius))
                let mass = radius * radius
                nextID += 1
                let point = drop.lastTrail
                trails.append(WorldbendWetGlassDrop(
                    id: nextID, pane: drop.pane, position: point, mass: mass,
                    resistance: CGFloat(sim.trailAdhesionUnitSquared) * unit * unit,
                    lastTrail: point, parent: drop.id
                ))
                drop.mass = max(0, drop.mass - mass)
                drop.lastTrail = drop.position
                trailCount += 1
            }
            drops[index] = drop
        }
        drops.append(contentsOf: trails)
        mergeNearby()
        let maximumMass = maximumRadius * maximumRadius
        for index in drops.indices where drops[index].mass > maximumMass {
            drainedMass += drops[index].mass - maximumMass
            drops[index].mass = maximumMass
            drops[index].velocity.y = max(drops[index].velocity.y, CGFloat(sim.drainingSpeedUnits) * unit)
        }
        drops.removeAll { $0.mass < unit * unit }
    }

    // Fractional spawn credit retained across fixed steps (APP ArrivalWaterSimulation).
    private var _spawnCredit: Double = 0

    /// Neighbor offsets in the same order as nested `for dx in -1...1 { for dy in -1...1 }`,
    /// avoiding Debug `ClosedRange` generic iteration on the merge hot path.
    private static let mergeNeighborOffsets: [(Int, Int)] = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1), (0, 0), (0, 1),
        (1, -1), (1, 0), (1, 1)
    ]

    /// Dense pane×cell bins — no `Dictionary` / `ClosedRange` on the merge hot path.
    /// Append order per bin matches ascending drop index (same as the pre-r3 dict path),
    /// so `stableEvolutionCheckpoint` stays bit-identical to WET-GLASS-01-r2.
    private func mergeNearby() {
        let sim = recipe.simulation
        let unit = binding.unit
        var maxRadius: CGFloat = 0
        for drop in drops {
            let radius = drop.radius
            if radius > maxRadius { maxRadius = radius }
        }
        let cellSize = max(CGFloat(sim.mergeGridMinimumUnits) * unit, maxRadius * 2.5)
        guard cellSize.isFinite, cellSize > 0 else { return }

        var active: [Int] = []
        active.reserveCapacity(drops.count)
        var cellX: [Int] = []
        var cellY: [Int] = []
        var cellPane: [Int] = []
        cellX.reserveCapacity(drops.count)
        cellY.reserveCapacity(drops.count)
        cellPane.reserveCapacity(drops.count)

        var minX = Int.max, maxX = Int.min
        var minY = Int.max, maxY = Int.min
        var minPane = Int.max, maxPane = Int.min
        for index in drops.indices where drops[index].mass > 0 {
            let drop = drops[index]
            let cx = Int(floor(drop.position.x / cellSize))
            let cy = Int(floor(drop.position.y / cellSize))
            let pane = drop.pane
            active.append(index)
            cellX.append(cx)
            cellY.append(cy)
            cellPane.append(pane)
            if cx < minX { minX = cx }
            if cx > maxX { maxX = cx }
            if cy < minY { minY = cy }
            if cy > maxY { maxY = cy }
            if pane < minPane { minPane = pane }
            if pane > maxPane { maxPane = pane }
        }
        guard !active.isEmpty else { return }

        // Pad by 1 so neighbor lookups never leave the grid.
        minX -= 1; maxX += 1
        minY -= 1; maxY += 1
        let width = maxX - minX + 1
        let height = maxY - minY + 1
        let paneCount = maxPane - minPane + 1
        // Hostile / NaN-derived spans: refuse unbounded allocation. Pre-check
        // products before Int64 multiply (r4 guarded only after multiply).
        guard let counted = WorldbendWetGlassMergeGrid.checkedBinCount(
            width: width, height: height, paneCount: paneCount
        ) else { return }
        let binCount = counted.binCount
        let plane = counted.plane

        var bins = [[Int]](repeating: [], count: binCount)
        func binIndex(pane: Int, x: Int, y: Int) -> Int {
            (pane - minPane) * plane + (y - minY) * width + (x - minX)
        }
        for i in 0..<active.count {
            let b = binIndex(pane: cellPane[i], x: cellX[i], y: cellY[i])
            bins[b].append(active[i])
        }

        let offsets = Self.mergeNeighborOffsets
        for i in 0..<active.count {
            let index = active[i]
            if drops[index].mass <= 0 { continue }
            let ox = cellX[i], oy = cellY[i], op = cellPane[i]
            var absorbed = false
            for offset in offsets {
                let nx = ox + offset.0
                let ny = oy + offset.1
                let neighbors = bins[binIndex(pane: op, x: nx, y: ny)]
                for other in neighbors {
                    guard other > index, drops[other].mass > 0,
                          drops[index].parent != drops[other].id,
                          drops[other].parent != drops[index].id else { continue }
                    let a = drops[index], b = drops[other]
                    let reach = (a.radius + b.radius) * CGFloat(sim.mergeReach)
                    if hypot(a.position.x - b.position.x, a.position.y - b.position.y) < reach {
                        drops[index].absorb(b)
                        drops[other].mass = 0
                        mergeCount += 1
                        absorbed = true
                        break
                    }
                }
                if absorbed { break }
            }
        }
    }
}
