import CoreGraphics
import Foundation
import simd

/// Shared glass press / bulge / stretch / cancel / bubble-menu morph profile.
/// Deforms an APP-supplied rest (or round/capsule) contour toward a menu contour
/// and contact-driven bulge/stretch. **Optics stay on Outline / optical glass** —
/// feed ``WorldbendGlassPressFrame/deformedContour`` into
/// ``WorldbendOutlineFieldBaker``; do not invent a second normal/refraction kernel.
public let worldbendGlassPressDeformProfile = "worldbend.glass-press-deform@0.1"

// MARK: - Errors

public enum WorldbendGlassPressError: Error, Equatable, Sendable {
    case invalidRecipe(String)
    case invalidInput(String)
    case budgetExceeded(used: Int, limit: Int, what: String)
}

// MARK: - Resource / parameter ceilings

/// Authored vs effective bounds for press-deform recipes (receipt + hostile caps).
public struct WorldbendGlassPressResourceLimits: Codable, Equatable, Sendable {
    public static let pressDepthMax: Double = 48
    public static let bulgeRadiusMax: Double = 240
    public static let stretchStiffnessMax: Double = 80
    public static let stretchDampingMax: Double = 40
    public static let longPressDelayMax: Double = 2
    public static let longPressGainMax: Double = 4
    public static let cancelSpringFrequencyMax: Double = 24
    public static let cancelSpringDampingMax: Double = 40
    public static let morphWeightMax: Double = 1
    public static let lightingResponseMax: Double = 2
    public static let maxStretchMax: Double = 96
    public static let maxBulgeMax: Double = 64
    public static let morphSamplesMax: Int = 256
    public static let morphSamplesMin: Int = 8
    public static let maxStepsPerTickCap: Int = 8
    public static let maxDeformVerticesCap: Int = 512
    public static let dtMax: Double = 1.0 / 15.0
    public static let catchupMax: Double = 0.25

    public var authoredMorphSamples: Int
    public var effectiveMorphSamples: Int
    public var authoredMaxStepsPerTick: Int
    public var effectiveMaxStepsPerTick: Int
    public var authoredMaxDeformVertices: Int
    public var effectiveMaxDeformVertices: Int

    public init(recipe: WorldbendGlassPressRecipe) {
        authoredMorphSamples = recipe.morphSamples
        effectiveMorphSamples = min(
            max(Self.morphSamplesMin, recipe.morphSamples),
            Self.morphSamplesMax
        )
        authoredMaxStepsPerTick = recipe.maxStepsPerTick
        effectiveMaxStepsPerTick = min(
            max(1, recipe.maxStepsPerTick),
            Self.maxStepsPerTickCap
        )
        authoredMaxDeformVertices = recipe.maxDeformVertices
        effectiveMaxDeformVertices = min(
            max(Self.morphSamplesMin, recipe.maxDeformVertices),
            Self.maxDeformVerticesCap
        )
    }
}

// MARK: - Recipe

public struct WorldbendGlassPressRecipe: Codable, Equatable, Sendable {
    public var profile: String
    /// Logical-point bulge depth at full press (clamped by ``maxBulge``).
    public var pressDepth: Double
    /// Soft falloff radius around contact for bulge (logical points).
    public var bulgeRadius: Double
    /// Spring stiffness pulling stretch toward drag target (1/s² scale).
    public var stretchStiffness: Double
    /// Stretch velocity damping (1/s).
    public var stretchDamping: Double
    /// Seconds before long-press gain ramps (host may still drive ``pressAmount``).
    public var longPressDelay: Double
    /// Extra bulge multiplier after delay while pressed.
    public var longPressGain: Double
    /// Cancel / spring-back angular frequency (Hz-ish, rad/s = 2πf).
    public var cancelSpringFrequency: Double
    /// Cancel spring damping ratio-ish (higher = less bounce).
    public var cancelSpringDamping: Double
    /// Weight of rest→menu contour morph when phase is morphing / menu open (0…1).
    public var morphToMenuWeight: Double
    /// Scales outline optical modulators (refraction / highlight) with deformation.
    public var lightingResponse: Double
    /// Hard clamp on stretch vector length (logical points).
    public var maxStretch: Double
    /// Hard clamp on bulge amplitude (logical points).
    public var maxBulge: Double
    /// Resample count for rest↔menu morph (bounded).
    public var morphSamples: Int
    /// Integrator substeps per ``tick`` (bounded).
    public var maxStepsPerTick: Int
    /// Reject rest/menu polylines longer than this after resample.
    public var maxDeformVertices: Int

    public static let referenceDefaults = WorldbendGlassPressRecipe(
        profile: worldbendGlassPressDeformProfile,
        pressDepth: 10,
        bulgeRadius: 36,
        stretchStiffness: 28,
        stretchDamping: 12,
        longPressDelay: 0.35,
        longPressGain: 1.6,
        cancelSpringFrequency: 6,
        cancelSpringDamping: 14,
        morphToMenuWeight: 1,
        lightingResponse: 1,
        maxStretch: 48,
        maxBulge: 28,
        morphSamples: 64,
        maxStepsPerTick: 4,
        maxDeformVertices: 256
    )

    public init(
        profile: String = worldbendGlassPressDeformProfile,
        pressDepth: Double,
        bulgeRadius: Double,
        stretchStiffness: Double,
        stretchDamping: Double,
        longPressDelay: Double,
        longPressGain: Double,
        cancelSpringFrequency: Double,
        cancelSpringDamping: Double,
        morphToMenuWeight: Double,
        lightingResponse: Double,
        maxStretch: Double,
        maxBulge: Double,
        morphSamples: Int,
        maxStepsPerTick: Int,
        maxDeformVertices: Int
    ) {
        self.profile = profile
        self.pressDepth = pressDepth
        self.bulgeRadius = bulgeRadius
        self.stretchStiffness = stretchStiffness
        self.stretchDamping = stretchDamping
        self.longPressDelay = longPressDelay
        self.longPressGain = longPressGain
        self.cancelSpringFrequency = cancelSpringFrequency
        self.cancelSpringDamping = cancelSpringDamping
        self.morphToMenuWeight = morphToMenuWeight
        self.lightingResponse = lightingResponse
        self.maxStretch = maxStretch
        self.maxBulge = maxBulge
        self.morphSamples = morphSamples
        self.maxStepsPerTick = maxStepsPerTick
        self.maxDeformVertices = maxDeformVertices
    }

    public var resourceLimits: WorldbendGlassPressResourceLimits {
        WorldbendGlassPressResourceLimits(recipe: self)
    }

    /// Reject non-finite / out-of-range authored values. Effective clamps are
    /// applied at simulation time and disclosed on the receipt.
    public func validate() throws {
        guard profile == worldbendGlassPressDeformProfile else {
            throw WorldbendGlassPressError.invalidRecipe(
                "profile must be \(worldbendGlassPressDeformProfile)"
            )
        }
        let L = WorldbendGlassPressResourceLimits.self
        func finitePositive(_ v: Double, _ name: String, max: Double) throws {
            guard v.isFinite, v >= 0, v <= max else {
                throw WorldbendGlassPressError.invalidRecipe(
                    "\(name) must be finite in [0, \(max)]"
                )
            }
        }
        try finitePositive(pressDepth, "pressDepth", max: L.pressDepthMax)
        try finitePositive(bulgeRadius, "bulgeRadius", max: L.bulgeRadiusMax)
        guard bulgeRadius > 0 else {
            throw WorldbendGlassPressError.invalidRecipe("bulgeRadius must be > 0")
        }
        try finitePositive(stretchStiffness, "stretchStiffness", max: L.stretchStiffnessMax)
        try finitePositive(stretchDamping, "stretchDamping", max: L.stretchDampingMax)
        try finitePositive(longPressDelay, "longPressDelay", max: L.longPressDelayMax)
        try finitePositive(longPressGain, "longPressGain", max: L.longPressGainMax)
        try finitePositive(
            cancelSpringFrequency, "cancelSpringFrequency", max: L.cancelSpringFrequencyMax
        )
        guard cancelSpringFrequency > 0 else {
            throw WorldbendGlassPressError.invalidRecipe("cancelSpringFrequency must be > 0")
        }
        try finitePositive(
            cancelSpringDamping, "cancelSpringDamping", max: L.cancelSpringDampingMax
        )
        try finitePositive(morphToMenuWeight, "morphToMenuWeight", max: L.morphWeightMax)
        try finitePositive(lightingResponse, "lightingResponse", max: L.lightingResponseMax)
        try finitePositive(maxStretch, "maxStretch", max: L.maxStretchMax)
        guard maxStretch > 0 else {
            throw WorldbendGlassPressError.invalidRecipe("maxStretch must be > 0")
        }
        try finitePositive(maxBulge, "maxBulge", max: L.maxBulgeMax)
        guard maxBulge > 0 else {
            throw WorldbendGlassPressError.invalidRecipe("maxBulge must be > 0")
        }
        guard morphSamples >= L.morphSamplesMin, morphSamples <= L.morphSamplesMax else {
            throw WorldbendGlassPressError.invalidRecipe(
                "morphSamples must be in \(L.morphSamplesMin)...\(L.morphSamplesMax)"
            )
        }
        guard maxStepsPerTick >= 1, maxStepsPerTick <= L.maxStepsPerTickCap else {
            throw WorldbendGlassPressError.invalidRecipe(
                "maxStepsPerTick must be in 1...\(L.maxStepsPerTickCap)"
            )
        }
        guard maxDeformVertices >= L.morphSamplesMin,
              maxDeformVertices <= L.maxDeformVerticesCap else {
            throw WorldbendGlassPressError.invalidRecipe(
                "maxDeformVertices must be in \(L.morphSamplesMin)...\(L.maxDeformVerticesCap)"
            )
        }
        // Resampled morph polyline length is morphSamples (+ optional close). Reject
        // authored morphSamples > maxDeformVertices so tick cannot budget-fail every frame.
        guard morphSamples <= maxDeformVertices else {
            throw WorldbendGlassPressError.invalidRecipe(
                "morphSamples (\(morphSamples)) must be <= maxDeformVertices (\(maxDeformVertices))"
            )
        }
        // pressDepth must not author unbound bulge beyond maxBulge without disclosure —
        // allow authored pressDepth > maxBulge (effective clamp + receipt loss).
        if pressDepth > maxBulge + 1e-9 {
            // Valid, but receipt will record a loss; keep validate permissive here.
        }
    }
}

// MARK: - Phase / input

public enum WorldbendGlassPressPhase: String, Codable, Equatable, Sendable {
    case idle
    case pressing
    case dragging
    case cancelling
    case morphingToMenu
}

/// Host-authored gesture + shape binding for one tick. APP owns hit-testing,
/// Button activation, menu IA, and focus; this struct is physics input only.
public struct WorldbendGlassPressInput: Equatable, Sendable {
    public var phase: WorldbendGlassPressPhase
    /// Contact in the same space as rest/menu polylines (pane-local preferred).
    public var contact: CGPoint?
    /// Host press amount in 0…1 (from touch force / progress); combined with phase.
    public var pressAmount: Double
    /// Drag offset from press origin (logical points).
    public var dragOffset: CGSize
    public var pressed: Bool
    public var disabled: Bool
    public var reduceMotion: Bool
    /// Rest contour (round / capsule / APP shape). Required.
    public var restContour: WorldbendOutlineContour
    /// Target menu contour for continuous morph. Nil → morph stays at rest.
    public var menuContour: WorldbendOutlineContour?
    /// Desired morph progress override in 0…1 when phase is ``morphingToMenu``
    /// (APP may drive open fraction). Nil → recipe weight + phase defaults.
    public var morphTarget: Double?

    public init(
        phase: WorldbendGlassPressPhase = .idle,
        contact: CGPoint? = nil,
        pressAmount: Double = 0,
        dragOffset: CGSize = .zero,
        pressed: Bool = false,
        disabled: Bool = false,
        reduceMotion: Bool = false,
        restContour: WorldbendOutlineContour,
        menuContour: WorldbendOutlineContour? = nil,
        morphTarget: Double? = nil
    ) {
        self.phase = phase
        self.contact = contact
        self.pressAmount = pressAmount
        self.dragOffset = dragOffset
        self.pressed = pressed
        self.disabled = disabled
        self.reduceMotion = reduceMotion
        self.restContour = restContour
        self.menuContour = menuContour
        self.morphTarget = morphTarget
    }

    public func validate(limits: WorldbendGlassPressResourceLimits) throws {
        try restContour.validate()
        if let menu = menuContour {
            try menu.validate()
            guard menu.fieldSpace == restContour.fieldSpace else {
                throw WorldbendGlassPressError.invalidInput(
                    "menuContour.fieldSpace must match restContour.fieldSpace"
                )
            }
            guard abs(menu.logicalSize.width - restContour.logicalSize.width) < 0.5,
                  abs(menu.logicalSize.height - restContour.logicalSize.height) < 0.5 else {
                throw WorldbendGlassPressError.invalidInput(
                    "menuContour.logicalSize must match restContour.logicalSize"
                )
            }
        }
        guard pressAmount.isFinite, pressAmount >= 0, pressAmount <= 1 else {
            throw WorldbendGlassPressError.invalidInput("pressAmount must be finite in [0, 1]")
        }
        guard dragOffset.width.isFinite, dragOffset.height.isFinite else {
            throw WorldbendGlassPressError.invalidInput("dragOffset must be finite")
        }
        if let c = contact {
            guard c.x.isFinite, c.y.isFinite else {
                throw WorldbendGlassPressError.invalidInput("contact must be finite")
            }
        }
        if let m = morphTarget {
            guard m.isFinite, m >= 0, m <= 1 else {
                throw WorldbendGlassPressError.invalidInput("morphTarget must be finite in [0, 1]")
            }
        }
        let restCount = restContour.polyline.count
        if restCount > limits.effectiveMaxDeformVertices {
            throw WorldbendGlassPressError.budgetExceeded(
                used: restCount,
                limit: limits.effectiveMaxDeformVertices,
                what: "restContour.polyline"
            )
        }
        if let menu = menuContour, menu.polyline.count > limits.effectiveMaxDeformVertices {
            throw WorldbendGlassPressError.budgetExceeded(
                used: menu.polyline.count,
                limit: limits.effectiveMaxDeformVertices,
                what: "menuContour.polyline"
            )
        }
    }
}

// MARK: - Optics modulators (Outline reuse — not a second kernel)

/// Multipliers applied to an existing ``OutlineOpticalGlassConfiguration``.
/// APP composes: `refractionScale * refractionScaleMultiplier`, etc.
public struct WorldbendGlassPressOpticsModulators: Codable, Equatable, Sendable {
    public var refractionScaleMultiplier: Double
    public var highlightStrengthMultiplier: Double
    public var edgeWidthMultiplier: Double

    public static let identity = WorldbendGlassPressOpticsModulators(
        refractionScaleMultiplier: 1,
        highlightStrengthMultiplier: 1,
        edgeWidthMultiplier: 1
    )

    public init(
        refractionScaleMultiplier: Double,
        highlightStrengthMultiplier: Double,
        edgeWidthMultiplier: Double
    ) {
        self.refractionScaleMultiplier = refractionScaleMultiplier
        self.highlightStrengthMultiplier = highlightStrengthMultiplier
        self.edgeWidthMultiplier = edgeWidthMultiplier
    }

    public func applying(to optics: OutlineOpticalGlassConfiguration) throws
        -> OutlineOpticalGlassConfiguration {
        // Clamp into OutlineOpticalGlassConfiguration.validate() domains so
        // lightingResponse / deform energy cannot push APP optics out of range.
        let next = OutlineOpticalGlassConfiguration(
            profile: optics.profile,
            backdrop: optics.backdrop,
            edgeWidth: min(1000, max(1, optics.edgeWidth * edgeWidthMultiplier)),
            refractionScale: min(32, max(0, optics.refractionScale * refractionScaleMultiplier)),
            chromaticOffset: optics.chromaticOffset,
            frostRadius: optics.frostRadius,
            lightDirection: optics.lightDirection,
            highlightStrength: min(0.6, max(0, optics.highlightStrength * highlightStrengthMultiplier))
        )
        try next.validate()
        return next
    }
}

// MARK: - Receipt

public struct WorldbendGlassPressReceipt: Codable, Equatable, Sendable {
    public var profile: String
    public var phase: String
    public var pressed: Bool
    public var disabled: Bool
    public var reduceMotion: Bool
    public var reduceMotionMode: String
    public var authored: [String: Double]
    public var effective: [String: Double]
    public var losses: [String]
    public var morphProgress: Double
    public var bulgeAmount: Double
    public var stretchX: Double
    public var stretchY: Double
    public var budgetUsedVertices: Int
    public var budgetLimitVertices: Int
    public var stepsTaken: Int
    public var stepLimit: Int

    public init(
        profile: String,
        phase: String,
        pressed: Bool,
        disabled: Bool,
        reduceMotion: Bool,
        reduceMotionMode: String,
        authored: [String: Double],
        effective: [String: Double],
        losses: [String],
        morphProgress: Double,
        bulgeAmount: Double,
        stretchX: Double,
        stretchY: Double,
        budgetUsedVertices: Int,
        budgetLimitVertices: Int,
        stepsTaken: Int,
        stepLimit: Int
    ) {
        self.profile = profile
        self.phase = phase
        self.pressed = pressed
        self.disabled = disabled
        self.reduceMotion = reduceMotion
        self.reduceMotionMode = reduceMotionMode
        self.authored = authored
        self.effective = effective
        self.losses = losses
        self.morphProgress = morphProgress
        self.bulgeAmount = bulgeAmount
        self.stretchX = stretchX
        self.stretchY = stretchY
        self.budgetUsedVertices = budgetUsedVertices
        self.budgetLimitVertices = budgetLimitVertices
        self.stepsTaken = stepsTaken
        self.stepLimit = stepLimit
    }
}

// MARK: - Frame output

public struct WorldbendGlassPressFrame: Equatable, Sendable {
    public var deformedPolyline: [CGPoint]
    public var deformedContour: WorldbendOutlineContour
    public var morphProgress: Double
    public var bulgeAmount: Double
    public var stretch: CGVector
    public var opticsModulators: WorldbendGlassPressOpticsModulators
    public var receipt: WorldbendGlassPressReceipt
    /// Suggested dynamics revision bump so Outline rebake sees shape change.
    public var contourRevision: UInt64

    public init(
        deformedPolyline: [CGPoint],
        deformedContour: WorldbendOutlineContour,
        morphProgress: Double,
        bulgeAmount: Double,
        stretch: CGVector,
        opticsModulators: WorldbendGlassPressOpticsModulators,
        receipt: WorldbendGlassPressReceipt,
        contourRevision: UInt64
    ) {
        self.deformedPolyline = deformedPolyline
        self.deformedContour = deformedContour
        self.morphProgress = morphProgress
        self.bulgeAmount = bulgeAmount
        self.stretch = stretch
        self.opticsModulators = opticsModulators
        self.receipt = receipt
        self.contourRevision = contourRevision
    }
}

// MARK: - Rest shape helpers (tests / APP convenience — not menu IA)

public enum WorldbendGlassPressRestShape {
    /// Closed capsule (stadium) polyline in pane-local points.
    public static func capsule(
        in rect: CGRect,
        samples: Int = 64
    ) -> [CGPoint] {
        let n = max(WorldbendGlassPressResourceLimits.morphSamplesMin, samples)
        let r = min(rect.width, rect.height) * 0.5
        let cx = rect.midX
        let cy = rect.midY
        let halfW = max(0, rect.width * 0.5 - r)
        var points: [CGPoint] = []
        // Right semicircle, then left semicircle (counter-clockwise).
        let half = max(4, n / 2)
        for i in 0..<half {
            let t = Double(i) / Double(half - 1)
            let a = -Double.pi / 2 + t * Double.pi
            points.append(CGPoint(x: cx + halfW + r * CGFloat(cos(a)),
                                  y: cy + r * CGFloat(sin(a))))
        }
        for i in 0..<half {
            let t = Double(i) / Double(half - 1)
            let a = Double.pi / 2 + t * Double.pi
            points.append(CGPoint(x: cx - halfW + r * CGFloat(cos(a)),
                                  y: cy + r * CGFloat(sin(a))))
        }
        if let first = points.first {
            points.append(first)
        }
        return points
    }

    /// Closed rounded-rect polyline.
    public static func roundedRect(
        in rect: CGRect,
        cornerRadius: CGFloat,
        samplesPerCorner: Int = 8
    ) -> [CGPoint] {
        let rr = min(cornerRadius, min(rect.width, rect.height) * 0.5)
        let sp = max(2, samplesPerCorner)
        var points: [CGPoint] = []
        func arc(cx: CGFloat, cy: CGFloat, start: Double, end: Double) {
            for i in 0...sp {
                let t = Double(i) / Double(sp)
                let a = start + (end - start) * t
                points.append(CGPoint(x: cx + rr * CGFloat(cos(a)),
                                      y: cy + rr * CGFloat(sin(a))))
            }
        }
        let minX = rect.minX, maxX = rect.maxX, minY = rect.minY, maxY = rect.maxY
        arc(cx: maxX - rr, cy: minY + rr, start: -Double.pi / 2, end: 0)
        arc(cx: maxX - rr, cy: maxY - rr, start: 0, end: Double.pi / 2)
        arc(cx: minX + rr, cy: maxY - rr, start: Double.pi / 2, end: Double.pi)
        arc(cx: minX + rr, cy: minY + rr, start: Double.pi, end: 3 * Double.pi / 2)
        if let first = points.first {
            points.append(first)
        }
        return points
    }

    public static func contour(
        polyline: [CGPoint],
        logicalSize: CGSize,
        revision: UInt64,
        fieldSpace: WorldbendOutlineFieldSpace = .paneLocal,
        contourKind: String = "capsule"
    ) -> WorldbendOutlineContour {
        let dynamics = WorldbendOutlineDynamics(
            top: 0,
            depth: 0,
            contactX: 0.5,
            bend: 0,
            viewportWidth: Double(logicalSize.width),
            viewportHeight: Double(logicalSize.height),
            contourKind: contourKind,
            contourRevision: revision
        )
        return WorldbendOutlineContour(
            logicalSize: logicalSize,
            origin: .zero,
            polyline: polyline,
            dynamics: dynamics,
            closesImplicitly: true,
            fieldSpace: fieldSpace
        )
    }
}

// MARK: - Geometry helpers

enum WorldbendGlassPressGeometry {
    static func polylineLength(_ points: [CGPoint]) -> CGFloat {
        guard points.count >= 2 else { return 0 }
        var total: CGFloat = 0
        for i in 1..<points.count {
            let dx = points[i].x - points[i - 1].x
            let dy = points[i].y - points[i - 1].y
            total += (dx * dx + dy * dy).squareRoot()
        }
        return total
    }

    /// Arc-length resample to exactly `count` points (closed if first≈last).
    static func resample(_ points: [CGPoint], count: Int) -> [CGPoint] {
        let n = max(3, count)
        guard points.count >= 2 else { return points }
        var pts = points
        if let first = pts.first, let last = pts.last {
            let dx = first.x - last.x, dy = first.y - last.y
            if (dx * dx + dy * dy).squareRoot() > 1e-4 {
                pts.append(first)
            }
        }
        let total = polylineLength(pts)
        if total < 1e-6 {
            return Array(repeating: pts[0], count: n)
        }
        var out: [CGPoint] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            let target = total * CGFloat(i) / CGFloat(n - 1)
            var walked: CGFloat = 0
            var placed = false
            for s in 1..<pts.count {
                let a = pts[s - 1], b = pts[s]
                let dx = b.x - a.x, dy = b.y - a.y
                let seg = (dx * dx + dy * dy).squareRoot()
                if walked + seg >= target - 1e-9 || s == pts.count - 1 {
                    let t = seg > 1e-9 ? (target - walked) / seg : 0
                    let u = min(1, max(0, t))
                    out.append(CGPoint(x: a.x + dx * u, y: a.y + dy * u))
                    placed = true
                    break
                }
                walked += seg
            }
            if !placed {
                out.append(pts.last!)
            }
        }
        return out
    }

    static func lerp(_ a: [CGPoint], _ b: [CGPoint], t: Double) -> [CGPoint] {
        let u = CGFloat(min(1, max(0, t)))
        let n = min(a.count, b.count)
        var out: [CGPoint] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            out.append(CGPoint(
                x: a[i].x + (b[i].x - a[i].x) * u,
                y: a[i].y + (b[i].y - a[i].y) * u
            ))
        }
        return out
    }

    /// Outward-ish normals from closed polyline (screen +y down).
    static func outwardNormals(_ points: [CGPoint]) -> [CGVector] {
        let n = points.count
        guard n >= 3 else { return [] }
        var normals: [CGVector] = []
        normals.reserveCapacity(n)
        // Shoelace to decide winding.
        var area: CGFloat = 0
        for i in 0..<(n - 1) {
            area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y
        }
        let outwardSign: CGFloat = area > 0 ? 1 : -1 // CCW positive → outward is right of edge
        for i in 0..<n {
            let prev = points[(i - 1 + n) % n]
            let next = points[(i + 1) % n]
            let tx = next.x - prev.x
            let ty = next.y - prev.y
            let len = (tx * tx + ty * ty).squareRoot()
            if len < 1e-8 {
                normals.append(.zero)
                continue
            }
            // Perpendicular: (ty, -tx) or (-ty, tx)
            var nx = ty / len * outwardSign
            var ny = -tx / len * outwardSign
            let nl = (nx * nx + ny * ny).squareRoot()
            if nl > 1e-8 {
                nx /= nl
                ny /= nl
            }
            normals.append(CGVector(dx: nx, dy: ny))
        }
        return normals
    }
}

// MARK: - Simulation

/// Interruptible press / bulge / stretch / cancel / menu-morph integrator.
/// Bounded deformation + bounded budget; outputs a deformed outline contour for
/// the existing Outline baker (no second optics kernel).
public final class WorldbendGlassPressSimulation: @unchecked Sendable {
    public let recipe: WorldbendGlassPressRecipe
    public let limits: WorldbendGlassPressResourceLimits

    private var bulge: Double = 0
    private var bulgeVelocity: Double = 0
    private var stretchX: Double = 0
    private var stretchY: Double = 0
    private var stretchVX: Double = 0
    private var stretchVY: Double = 0
    private var morph: Double = 0
    private var morphVelocity: Double = 0
    private var pressHoldSeconds: Double = 0
    private var clock: Double = 0
    private var revision: UInt64 = 0

    public init(recipe: WorldbendGlassPressRecipe = .referenceDefaults) throws {
        try recipe.validate()
        self.recipe = recipe
        self.limits = recipe.resourceLimits
    }

    public var currentBulge: Double { bulge }
    public var currentStretch: CGVector { CGVector(dx: stretchX, dy: stretchY) }
    public var currentMorph: Double { morph }

    /// Advance simulation by `dt` seconds and emit a deformed frame.
    @discardableResult
    public func tick(dt: Double, input: WorldbendGlassPressInput) throws -> WorldbendGlassPressFrame {
        try input.validate(limits: limits)
        guard dt.isFinite, dt >= 0 else {
            throw WorldbendGlassPressError.invalidInput("dt must be finite and >= 0")
        }

        var losses: [String] = []
        let authored: [String: Double] = [
            "pressDepth": recipe.pressDepth,
            "bulgeRadius": recipe.bulgeRadius,
            "stretchStiffness": recipe.stretchStiffness,
            "stretchDamping": recipe.stretchDamping,
            "longPressDelay": recipe.longPressDelay,
            "longPressGain": recipe.longPressGain,
            "cancelSpringFrequency": recipe.cancelSpringFrequency,
            "cancelSpringDamping": recipe.cancelSpringDamping,
            "morphToMenuWeight": recipe.morphToMenuWeight,
            "lightingResponse": recipe.lightingResponse,
            "maxStretch": recipe.maxStretch,
            "maxBulge": recipe.maxBulge,
            "morphSamples": Double(recipe.morphSamples),
            "maxStepsPerTick": Double(recipe.maxStepsPerTick),
            "pressAmount": input.pressAmount
        ]

        let effPressDepth = min(recipe.pressDepth, recipe.maxBulge, WorldbendGlassPressResourceLimits.pressDepthMax)
        if recipe.pressDepth > recipe.maxBulge + 1e-9 {
            losses.append("pressDepth clamped by maxBulge (\(recipe.maxBulge))")
        }
        let effBulgeRadius = min(max(1e-3, recipe.bulgeRadius), WorldbendGlassPressResourceLimits.bulgeRadiusMax)
        let effStiffness = min(max(0, recipe.stretchStiffness), WorldbendGlassPressResourceLimits.stretchStiffnessMax)
        let effDamping = min(max(0, recipe.stretchDamping), WorldbendGlassPressResourceLimits.stretchDampingMax)
        let effLongDelay = min(max(0, recipe.longPressDelay), WorldbendGlassPressResourceLimits.longPressDelayMax)
        let effLongGain = min(max(0, recipe.longPressGain), WorldbendGlassPressResourceLimits.longPressGainMax)
        let effCancelFreq = min(max(0.1, recipe.cancelSpringFrequency), WorldbendGlassPressResourceLimits.cancelSpringFrequencyMax)
        let effCancelDamp = min(max(0, recipe.cancelSpringDamping), WorldbendGlassPressResourceLimits.cancelSpringDampingMax)
        let effMorphWeight = min(max(0, recipe.morphToMenuWeight), WorldbendGlassPressResourceLimits.morphWeightMax)
        let effLighting = min(max(0, recipe.lightingResponse), WorldbendGlassPressResourceLimits.lightingResponseMax)
        let effMaxStretch = min(max(1e-3, recipe.maxStretch), WorldbendGlassPressResourceLimits.maxStretchMax)
        let effMaxBulge = min(max(1e-3, recipe.maxBulge), WorldbendGlassPressResourceLimits.maxBulgeMax)
        let sampleCount = limits.effectiveMorphSamples
        if recipe.morphSamples != sampleCount {
            losses.append("morphSamples effective \(sampleCount) (authored \(recipe.morphSamples))")
        }
        let stepLimit = limits.effectiveMaxStepsPerTick
        if recipe.maxStepsPerTick != stepLimit {
            losses.append("maxStepsPerTick effective \(stepLimit) (authored \(recipe.maxStepsPerTick))")
        }

        let reduceMotionMode: String
        if input.disabled {
            reduceMotionMode = "disabled-rest"
            losses.append("disabled: snap to rest, ignore gesture")
            bulge = 0; bulgeVelocity = 0
            stretchX = 0; stretchY = 0; stretchVX = 0; stretchVY = 0
            morph = 0; morphVelocity = 0
            pressHoldSeconds = 0
        } else if input.reduceMotion {
            reduceMotionMode = "snap"
            losses.append("reduceMotion: snap targets (no spring flight)")
        } else {
            reduceMotionMode = "spring"
        }

        // Desired targets from phase / host.
        var targetBulge: Double = 0
        var targetStretchX: Double = 0
        var targetStretchY: Double = 0
        var targetMorph: Double = 0

        if !input.disabled {
            let pressGate = input.pressed || input.phase == .pressing || input.phase == .dragging
            if pressGate {
                pressHoldSeconds += min(dt, WorldbendGlassPressResourceLimits.catchupMax)
            } else if input.phase != .cancelling {
                pressHoldSeconds = 0
            }

            let longMul: Double
            if pressGate && pressHoldSeconds >= effLongDelay {
                longMul = effLongGain
            } else {
                longMul = 1
            }

            switch input.phase {
            case .idle:
                targetBulge = 0
                targetStretchX = 0
                targetStretchY = 0
                targetMorph = 0
            case .pressing:
                targetBulge = Double(input.pressAmount) * effPressDepth * longMul
                targetStretchX = 0
                targetStretchY = 0
                targetMorph = 0
            case .dragging:
                targetBulge = Double(input.pressAmount) * effPressDepth * longMul
                targetStretchX = Double(input.dragOffset.width)
                targetStretchY = Double(input.dragOffset.height)
                targetMorph = 0
            case .cancelling:
                targetBulge = 0
                targetStretchX = 0
                targetStretchY = 0
                targetMorph = 0
            case .morphingToMenu:
                targetBulge = Double(input.pressAmount) * effPressDepth * 0.35 * longMul
                targetStretchX = Double(input.dragOffset.width) * 0.25
                targetStretchY = Double(input.dragOffset.height) * 0.25
                if let override = input.morphTarget {
                    targetMorph = override * effMorphWeight
                } else {
                    targetMorph = effMorphWeight
                }
            }

            // Clamp stretch target.
            let stretchLen = (targetStretchX * targetStretchX + targetStretchY * targetStretchY).squareRoot()
            if stretchLen > effMaxStretch {
                let s = effMaxStretch / stretchLen
                targetStretchX *= s
                targetStretchY *= s
                losses.append("stretch target clamped by maxStretch (\(effMaxStretch))")
            }
            if targetBulge > effMaxBulge {
                targetBulge = effMaxBulge
                losses.append("bulge target clamped by maxBulge (\(effMaxBulge))")
            }
        }

        // Integrate (or snap).
        // Cap host hitch catch-up, then further bound per-substep dt so semi-implicit
        // Euler stays stable when cancelSpringFrequency / stretchStiffness are high
        // and the host passes an extreme dt (or hitch).
        let cappedDt = min(dt, WorldbendGlassPressResourceLimits.catchupMax)
        var stepsTaken = 0
        if input.disabled {
            stepsTaken = 0
        } else if input.reduceMotion {
            bulge = targetBulge
            bulgeVelocity = 0
            stretchX = targetStretchX
            stretchY = targetStretchY
            stretchVX = 0
            stretchVY = 0
            morph = targetMorph
            morphVelocity = 0
            stepsTaken = 1
        } else {
            let omega = 2 * Double.pi * effCancelFreq
            let stretchRate = effStiffness.squareRoot()
            // Stay well under the explicit-Euler stability wall (~2/ω).
            let stableStep = min(
                1.0 / 60.0,
                0.35 / max(omega, 1),
                0.35 / max(stretchRate, 1)
            )
            let requested = cappedDt > 0 ? cappedDt / Double(stepLimit) : 0
            let stepDt = cappedDt > 0 ? min(requested, stableStep) : 0
            var steps = 0
            if cappedDt > 0, stepDt > 0 {
                let need = Int((cappedDt / stepDt).rounded(.up))
                steps = min(stepLimit, max(1, need))
                if Double(steps) * stepDt + 1e-12 < cappedDt {
                    losses.append(
                        "dt truncated for spring stability (simulated \(Double(steps) * stepDt) of \(cappedDt); stepLimit \(stepLimit))"
                    )
                }
            }
            for _ in 0..<steps {
                // Bulge spring toward target.
                let bulgeAcc = omega * omega * (targetBulge - bulge)
                    - effCancelDamp * bulgeVelocity
                bulgeVelocity += bulgeAcc * stepDt
                bulge += bulgeVelocity * stepDt

                // Stretch spring.
                let sxAcc = effStiffness * (targetStretchX - stretchX) - effDamping * stretchVX
                let syAcc = effStiffness * (targetStretchY - stretchY) - effDamping * stretchVY
                stretchVX += sxAcc * stepDt
                stretchVY += syAcc * stepDt
                stretchX += stretchVX * stepDt
                stretchY += stretchVY * stepDt

                // Morph spring (same cancel spring family — interruptible mid-flight).
                let morphAcc = omega * omega * (targetMorph - morph) - effCancelDamp * morphVelocity
                morphVelocity += morphAcc * stepDt
                morph += morphVelocity * stepDt

                stepsTaken += 1
            }
            // Hard bounds + finite clamp after integrate (hostile dt / stiffness).
            func finiteOrZero(_ v: Double) -> Double { v.isFinite ? v : 0 }
            bulge = finiteOrZero(bulge)
            bulgeVelocity = finiteOrZero(bulgeVelocity)
            stretchX = finiteOrZero(stretchX)
            stretchY = finiteOrZero(stretchY)
            stretchVX = finiteOrZero(stretchVX)
            stretchVY = finiteOrZero(stretchVY)
            morph = finiteOrZero(morph)
            morphVelocity = finiteOrZero(morphVelocity)
            if bulge > effMaxBulge { bulge = effMaxBulge; bulgeVelocity = min(0, bulgeVelocity) }
            if bulge < 0 { bulge = 0; bulgeVelocity = max(0, bulgeVelocity) }
            let sLen = (stretchX * stretchX + stretchY * stretchY).squareRoot()
            if sLen > effMaxStretch {
                let s = effMaxStretch / sLen
                stretchX *= s
                stretchY *= s
            }
            morph = min(1, max(0, morph))
        }

        clock += cappedDt
        revision &+= 1

        // Build deformed polyline: morph rest→menu, then contact bulge + stretch.
        let restResampled = WorldbendGlassPressGeometry.resample(
            input.restContour.polyline, count: sampleCount
        )
        let menuSource = input.menuContour?.polyline ?? input.restContour.polyline
        let menuResampled = WorldbendGlassPressGeometry.resample(menuSource, count: sampleCount)
        var poly = WorldbendGlassPressGeometry.lerp(restResampled, menuResampled, t: morph)

        if poly.count > limits.effectiveMaxDeformVertices {
            throw WorldbendGlassPressError.budgetExceeded(
                used: poly.count,
                limit: limits.effectiveMaxDeformVertices,
                what: "deformedPolyline"
            )
        }

        let normals = WorldbendGlassPressGeometry.outwardNormals(poly)
        if let contact = input.contact, bulge > 1e-6, normals.count == poly.count {
            let radius = CGFloat(effBulgeRadius)
            let amount = CGFloat(bulge)
            for i in 0..<poly.count {
                let dx = poly[i].x - contact.x
                let dy = poly[i].y - contact.y
                let dist = (dx * dx + dy * dy).squareRoot()
                let w = dist >= radius ? 0 : CGFloat(0.5 + 0.5 * Foundation.cos(Double.pi * Double(dist / radius)))
                if w > 0 {
                    let n = normals[i]
                    poly[i].x += n.dx * amount * w
                    poly[i].y += n.dy * amount * w
                }
            }
        }

        // Uniform stretch (follow drag) — bounded.
        if abs(stretchX) > 1e-9 || abs(stretchY) > 1e-9 {
            let cx = poly.reduce(CGFloat(0)) { $0 + $1.x } / CGFloat(poly.count)
            let cy = poly.reduce(CGFloat(0)) { $0 + $1.y } / CGFloat(poly.count)
            for i in 0..<poly.count {
                // Shear-ish follow: offset grows with distance from center along drag.
                let along = (poly[i].x - cx) * CGFloat(stretchX) + (poly[i].y - cy) * CGFloat(stretchY)
                let norm = (stretchX * stretchX + stretchY * stretchY)
                let scale = norm > 1e-9 ? along / CGFloat(norm) : 0
                let fall = min(1, abs(scale))
                poly[i].x += CGFloat(stretchX) * fall * 0.35
                poly[i].y += CGFloat(stretchY) * fall * 0.35
            }
        }

        // Ensure closed.
        if let first = poly.first, let last = poly.last {
            let dx = first.x - last.x, dy = first.y - last.y
            if (dx * dx + dy * dy).squareRoot() > 1e-3 {
                poly.append(first)
            } else {
                poly[poly.count - 1] = first
            }
        }

        var dynamics = input.restContour.dynamics
        dynamics.contourRevision = revision
        dynamics.contourKind = (dynamics.contourKind ?? "press") + "+deform"
        let deformedContour = WorldbendOutlineContour(
            logicalSize: input.restContour.logicalSize,
            origin: input.restContour.origin,
            polyline: poly,
            dynamics: dynamics,
            closesImplicitly: true,
            fieldSpace: input.restContour.fieldSpace
        )
        try deformedContour.validate()

        let deformEnergy = min(1, (abs(bulge) / max(1e-3, effMaxBulge)
            + (stretchX * stretchX + stretchY * stretchY).squareRoot() / max(1e-3, effMaxStretch)
            + morph) / 3)
        let modulators = WorldbendGlassPressOpticsModulators(
            refractionScaleMultiplier: 1 + 0.25 * deformEnergy * effLighting,
            highlightStrengthMultiplier: 1 + 0.35 * deformEnergy * effLighting,
            edgeWidthMultiplier: 1 + 0.1 * deformEnergy * effLighting
        )

        let effective: [String: Double] = [
            "pressDepth": effPressDepth,
            "bulgeRadius": effBulgeRadius,
            "stretchStiffness": effStiffness,
            "stretchDamping": effDamping,
            "longPressDelay": effLongDelay,
            "longPressGain": effLongGain,
            "cancelSpringFrequency": effCancelFreq,
            "cancelSpringDamping": effCancelDamp,
            "morphToMenuWeight": effMorphWeight,
            "lightingResponse": effLighting,
            "maxStretch": effMaxStretch,
            "maxBulge": effMaxBulge,
            "morphSamples": Double(sampleCount),
            "maxStepsPerTick": Double(stepLimit),
            "pressAmount": input.pressAmount,
            "targetBulge": targetBulge,
            "targetMorph": targetMorph
        ]

        let receipt = WorldbendGlassPressReceipt(
            profile: recipe.profile,
            phase: input.phase.rawValue,
            pressed: input.pressed,
            disabled: input.disabled,
            reduceMotion: input.reduceMotion,
            reduceMotionMode: reduceMotionMode,
            authored: authored,
            effective: effective,
            losses: losses,
            morphProgress: morph,
            bulgeAmount: bulge,
            stretchX: stretchX,
            stretchY: stretchY,
            budgetUsedVertices: poly.count,
            budgetLimitVertices: limits.effectiveMaxDeformVertices,
            stepsTaken: stepsTaken,
            stepLimit: stepLimit
        )

        return WorldbendGlassPressFrame(
            deformedPolyline: poly,
            deformedContour: deformedContour,
            morphProgress: morph,
            bulgeAmount: bulge,
            stretch: CGVector(dx: stretchX, dy: stretchY),
            opticsModulators: modulators,
            receipt: receipt,
            contourRevision: revision
        )
    }

    /// Immediate retarget helper: begin cancel from current state (interruptible).
    public func beginCancel() {
        // State retained; next tick with phase `.cancelling` springs back.
        pressHoldSeconds = 0
    }

    /// Reset to rest without a tick (hard clear; prefer cancel phase for elastic return).
    public func reset() {
        bulge = 0; bulgeVelocity = 0
        stretchX = 0; stretchY = 0; stretchVX = 0; stretchVY = 0
        morph = 0; morphVelocity = 0
        pressHoldSeconds = 0
    }
}
