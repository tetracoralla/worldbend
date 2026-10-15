import CoreGraphics
import Foundation
import Metal
import MetalKit
import Observation
import simd
import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Profile id for irregular-contour optical glass (SetupArc class).
public let worldbendOutlineGlassMetalProfile = "worldbend.outline-glass-metal@0.1"

/// Disclosed frost / soften sampling budget for Outline + Metal-optical panes.
/// Small frost (≤``legacyMaxPoints``) keeps the historical 3×3 kernel so ~1.2pt
/// clear buttons stay unchanged. Larger frost (~12–40pt menus) samples a
/// shared-frame mip pyramid at a **conservative** LOD plus a 7×7 Gaussian in
/// UV spanning the frost radius — continuous low-pass (not mip-box mosaic),
/// no APP-side capturer, no sparse multi-ring disk on the sharp source.
public enum WorldbendFrostSamplingBudget: Sendable {
    /// Points at/below this use the legacy 3×3 discrete kernel (includes 1.2pt buttons).
    public static let legacyMaxPoints: Double = 2
    /// Large-frost Gaussian taps per `sampleSource` call (7×7).
    public static let largeGaussianTapsPerCall: Int = 49
    /// Backward-compatible alias used by older notes / tests.
    public static let mipResidualTapsPerCall: Int = largeGaussianTapsPerCall
    /// Chromatic split samples the frost kernel three times (R/G/B offsets).
    public static var worstCaseTapsPerFragment: Int {
        largeGaussianTapsPerCall * 3
    }
    /// Legacy path taps (3×3) × chromatic split.
    public static var legacyWorstCaseTapsPerFragment: Int { 9 * 3 }
    /// One shared mip pyramid build per source×device×frameRevision key
    /// (blit + generateMipmaps into the draw commandBuffer).
    /// Relative to source texel count: ∑ 4^(-k) ≈ 4/3.
    public static let pyramidTexelCostFactor: Double = 4.0 / 3.0
    /// LOD headroom subtracted from `log2(sigma)` so residual Gaussian keeps support.
    /// Keep in sync with ``WorldbendFrostPyramid/lodHeadroom`` (literal avoids MainActor coupling).
    public static let lodHeadroom: Double = 1.5
}

public enum WorldbendOutlineGlassRuntime {
    /// Xcode compiles package `.metal` into `default.metallib`. Plain `swift test`
    /// copies sources and does not prove a runnable outline shader.
    public static let hasCompiledShader =
        Bundle.module.url(forResource: "default", withExtension: "metallib") != nil
}

public enum WorldbendOutlineError: Error, Equatable, Sendable {
    case invalidProfile
    case invalidGeometry
    case emptyPolyline
    case invalidDynamics
    case bakeFailed
    /// Exact-segment refine would exceed ``WorldbendOutlineFieldBaker/maxRefineQueries``.
    /// Thrown from preflight (before refine work) or in-loop when the cap is hit;
    /// never after consuming an over-budget full pass.
    case refineBudgetExceeded(estimated: Int, limit: Int)
    case metalUnavailable
}

/// Where the normal field is authored relative to the optical pane.
///
/// - ``paneLocal`` (preferred): field matches APP `Shape.path` pane-local
///   points. The Metal shader subtracts `paneFrame.xy` before sampling, so
///   **translating** the control does not require rebake; size / shape /
///   dynamics changes do.
/// - ``scene``: field is authored in the named scene coordinate space (r1
///   behavior). APP must supply scene-space polylines and rebake when the
///   contour moves in scene space.
public enum WorldbendOutlineFieldSpace: String, Codable, Equatable, Sendable, Hashable {
    case paneLocal = "pane-local"
    case scene = "scene"
}

/// Animating SetupArc / ceiling parameters APP already owns. Worldbend does
/// **not** own `SetupArc` / `CeilingContour` Shape math — APP supplies the
/// sampled contour — but these fields travel with the contour so rebake can
/// track real dynamics (top/depth/contactX/bend + viewport), not a static demo.
public struct WorldbendOutlineDynamics: Codable, Equatable, Sendable, Hashable {
    public var top: Double
    public var depth: Double
    public var contactX: Double
    public var bend: Double
    public var viewportWidth: Double
    public var viewportHeight: Double
    /// Opaque APP contour id (e.g. `rounded` / `straight` / `folded`). Not interpreted.
    public var contourKind: String?
    /// Bump whenever APP regenerates the polyline for animation or layout.
    public var contourRevision: UInt64

    public init(
        top: Double,
        depth: Double,
        contactX: Double,
        bend: Double,
        viewportWidth: Double,
        viewportHeight: Double,
        contourKind: String? = nil,
        contourRevision: UInt64
    ) {
        self.top = top
        self.depth = depth
        self.contactX = contactX
        self.bend = bend
        self.viewportWidth = viewportWidth
        self.viewportHeight = viewportHeight
        self.contourKind = contourKind
        self.contourRevision = contourRevision
    }

    public func validate() throws {
        let numbers = [top, depth, contactX, bend, viewportWidth, viewportHeight]
        // contactX is clamped when APP samples SetupArc (`min(1,max(0,contactX))`),
        // but SwiftUI animatable interpolation can briefly leave [0,1]. Accept any
        // finite value here so rebake is not blocked mid-gesture; fingerprint keeps
        // the raw value so overshoot still invalidates caches.
        guard numbers.allSatisfy(\.isFinite),
              depth >= 0,
              viewportWidth > 0, viewportHeight > 0
        else { throw WorldbendOutlineError.invalidDynamics }
    }

    /// Stable identity for cache keys (includes revision + viewport + animatable params).
    public var fingerprint: String {
        let kind = contourKind ?? ""
        return String(
            format: "r%llu|t%.6f|d%.6f|c%.6f|b%.6f|vw%.3f|vh%.3f|%@",
            contourRevision, top, depth, contactX, bend,
            viewportWidth, viewportHeight, kind
        )
    }
}

/// One APP-authored contour sample in logical points (pane / viewport space).
public struct WorldbendOutlineSample: Codable, Equatable, Sendable, Hashable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
    public init(_ point: CGPoint) { self.x = Double(point.x); self.y = Double(point.y) }
    public var cgPoint: CGPoint { CGPoint(x: x, y: y) }
}

/// APP-supplied outline. Rebuild `polyline` whenever SetupArc
/// `top`/`depth`/`contactX`/`bend` or the viewport changes, bump
/// `dynamics.contourRevision`, then rebake the normal field.
public struct WorldbendOutlineContour: Equatable, Sendable {
    public var logicalSize: CGSize
    public var origin: CGPoint
    public var polyline: [CGPoint]
    public var dynamics: WorldbendOutlineDynamics
    /// When true, last point closes to first if not already coincident.
    public var closesImplicitly: Bool
    /// Pane-local (default) vs scene-authored field. See ``WorldbendOutlineFieldSpace``.
    public var fieldSpace: WorldbendOutlineFieldSpace

    public init(
        logicalSize: CGSize,
        origin: CGPoint = .zero,
        polyline: [CGPoint],
        dynamics: WorldbendOutlineDynamics,
        closesImplicitly: Bool = true,
        fieldSpace: WorldbendOutlineFieldSpace = .paneLocal
    ) {
        self.logicalSize = logicalSize
        self.origin = origin
        self.polyline = polyline
        self.dynamics = dynamics
        self.closesImplicitly = closesImplicitly
        self.fieldSpace = fieldSpace
    }

    public func validate() throws {
        try dynamics.validate()
        guard logicalSize.width.isFinite, logicalSize.height.isFinite,
              logicalSize.width > 0, logicalSize.height > 0,
              origin.x.isFinite, origin.y.isFinite,
              polyline.count >= 3,
              polyline.allSatisfy({ $0.x.isFinite && $0.y.isFinite })
        else { throw WorldbendOutlineError.invalidGeometry }
        // Viewport in dynamics should match the contour's authored size when APP
        // samples SetupArc in the same space (honest contract for rebake tests).
        guard abs(dynamics.viewportWidth - Double(logicalSize.width)) < 0.5,
              abs(dynamics.viewportHeight - Double(logicalSize.height)) < 0.5
        else { throw WorldbendOutlineError.invalidGeometry }
    }

    public var sampleFingerprint: String {
        var hasher = Hasher()
        hasher.combine(polyline.count)
        for p in polyline {
            hasher.combine(Int((p.x * 1000).rounded()))
            hasher.combine(Int((p.y * 1000).rounded()))
        }
        hasher.combine(closesImplicitly)
        hasher.combine(fieldSpace.rawValue)
        hasher.combine(Int((origin.x * 1000).rounded()))
        hasher.combine(Int((origin.y * 1000).rounded()))
        return "\(dynamics.fingerprint)|sz\(Int(logicalSize.width))x\(Int(logicalSize.height))|\(fieldSpace.rawValue)|\(hasher.finalize())"
    }
}

/// Core-owned normal field over an APP contour. Distances in logical points
/// (negative inside). Normals are outward unit vectors in screen space
/// (+x right, +y down — same as optical lightDirection).
public struct WorldbendOutlineNormalField: Equatable, Sendable {
    public let profile: String
    public let width: Int
    public let height: Int
    /// Authored viewport / pane size (not necessarily the expanded bake coverage).
    public let logicalSize: CGSize
    /// Origin of texel (0,0) corner in the field's coordinate space
    /// (pane-local or scene — see ``fieldSpace``).
    public let origin: CGPoint
    /// Logical points per texel (uniform).
    public let cellSize: CGFloat
    public let fieldSpace: WorldbendOutlineFieldSpace
    public let dynamicsFingerprint: String
    public let sampleFingerprint: String
    /// Row-major, length `width * height`.
    public let distances: [Float]
    /// Row-major outward normals.
    public let normalsX: [Float]
    public let normalsY: [Float]

    public var texelCount: Int { width * height }

    public func validate() throws {
        guard profile == worldbendOutlineGlassMetalProfile,
              width > 0, height > 0,
              distances.count == texelCount,
              normalsX.count == texelCount,
              normalsY.count == texelCount,
              cellSize > 0, cellSize.isFinite,
              logicalSize.width > 0, logicalSize.height > 0
        else { throw WorldbendOutlineError.bakeFailed }
    }
}

/// Optical kernel inputs for outline glass. Same portable magnitudes as
/// rounded-glass-metal; profile id differs so receivers cannot confuse shapes.
public struct OutlineOpticalGlassConfiguration: Codable, Equatable, Sendable {
    public let profile, backdrop: String
    public let edgeWidth, refractionScale, chromaticOffset, frostRadius: Double
    public let lightDirection: [Double]
    public let highlightStrength: Double

    public init(
        profile: String = worldbendOutlineGlassMetalProfile,
        backdrop: String = "explicit-swiftui-layer",
        edgeWidth: Double,
        refractionScale: Double,
        chromaticOffset: Double,
        frostRadius: Double,
        lightDirection: [Double],
        highlightStrength: Double
    ) {
        self.profile = profile
        self.backdrop = backdrop
        self.edgeWidth = edgeWidth
        self.refractionScale = refractionScale
        self.chromaticOffset = chromaticOffset
        self.frostRadius = frostRadius
        self.lightDirection = lightDirection
        self.highlightStrength = highlightStrength
    }

    /// Lift rounded optical coeffs onto the outline profile (APP still supplies contour).
    public init(fromRounded optics: OpticalGlassConfiguration) throws {
        try optics.validate()
        self.init(
            edgeWidth: optics.edgeWidth,
            refractionScale: optics.refractionScale,
            chromaticOffset: optics.chromaticOffset,
            frostRadius: optics.frostRadius,
            lightDirection: optics.lightDirection,
            highlightStrength: optics.highlightStrength
        )
        try validate()
    }

    public func validate() throws {
        guard profile == worldbendOutlineGlassMetalProfile,
              backdrop == "explicit-swiftui-layer",
              [edgeWidth, refractionScale, chromaticOffset, frostRadius, highlightStrength]
                .allSatisfy(\.isFinite),
              (1...1000).contains(edgeWidth),
              (0...32).contains(refractionScale),
              (0...8).contains(chromaticOffset),
              (0...1000).contains(frostRadius),
              (0...0.6).contains(highlightStrength),
              lightDirection.count == 2,
              lightDirection.allSatisfy(\.isFinite),
              abs(lightDirection[0] * lightDirection[0] + lightDirection[1] * lightDirection[1] - 1) < 0.00001
        else { throw WorldbendOutlineError.invalidProfile }
    }
}

// MARK: - Baker

struct OutlineFieldBakePrep {
    let contour: WorldbendOutlineContour
    let shifted: [CGPoint]
    let width: Int
    let height: Int
    let cell: CGFloat
    let fieldOrigin: CGPoint
    let inside: [Bool]
    let bandCells: CGFloat
    let queryLimit: Int
}

struct OutlineRefinePrepared {
    let segments: [OutlineRefineSegment]
    let spatial: OutlineSegmentSpatialIndex
    let cellF: Float
    let band: Float
}

func prepareOutlineRefine(
    ring: [CGPoint],
    width: Int,
    height: Int,
    cell: CGFloat,
    refineBandCells: CGFloat
) -> OutlineRefinePrepared? {
    let segmentCount = max(ring.count - 1, 0)
    guard width > 0, height > 0, segmentCount > 0, cell > 0, cell.isFinite else { return nil }
    let band = Float(refineBandCells * cell)
    guard band.isFinite, band > 0 else { return nil }
    var segments: [OutlineRefineSegment] = []
    segments.reserveCapacity(segmentCount)
    for s in 0..<segmentCount {
        let a = ring[s], b = ring[s + 1]
        let ax = Float(a.x), ay = Float(a.y)
        let bx = Float(b.x), by = Float(b.y)
        let abx = bx - ax, aby = by - ay
        segments.append(
            OutlineRefineSegment(
                ax: ax, ay: ay, abx: abx, aby: aby, ab2: abx * abx + aby * aby,
                minX: min(ax, bx), minY: min(ay, by), maxX: max(ax, bx), maxY: max(ay, by)
            )
        )
    }
    let cellF = Float(cell)
    let margin = band + 4 * cellF
    let spatial = OutlineSegmentSpatialIndex(
        segments: segments, margin: margin,
        fieldWidth: cellF * Float(width), fieldHeight: cellF * Float(height)
    )
    return OutlineRefinePrepared(segments: segments, spatial: spatial, cellF: cellF, band: band)
}

public enum WorldbendOutlineFieldBaker {
    /// Default texel pitch in logical points. Fine enough for SetupArc shoulder
    /// (~rise 32pt) without claiming sub-pixel CAD fidelity.
    public static let defaultCellSize: CGFloat = 2

    /// Resource ceiling so hostile viewports cannot allocate unbounded fields.
    public static let maxTexelsPerAxis = 1024
    public static let maxTotalTexels = 1024 * 1024

    /// Exact segment-distance refine band in cells around the binary boundary.
    /// Keeps default `cellSize` (~2pt) for sustainable full-field DT while
    /// restoring subpixel distance/normals on curved highlights (APP evidence:
    /// FloatingTaskShape @3x staircasing from 2pt binary seeds).
    public static let defaultRefineBandCells: CGFloat = 2.5

    /// Hard ceiling on segment×texel refine queries (hostile dense polylines).
    public static let maxRefineQueries = 5_000_000

    /// Safe `bandTexels × segmentCount` for refine budget preflight.
    /// Returns `nil` when any factor is non-positive or the product would
    /// overflow / exceed `limit` (default ``maxRefineQueries``).
    public static func checkedRefineQueryCount(
        bandTexels: Int,
        segmentCount: Int,
        limit: Int = maxRefineQueries
    ) -> Int? {
        guard bandTexels > 0, segmentCount > 0, limit > 0 else { return nil }
        let b = Int64(bandTexels)
        let s = Int64(segmentCount)
        let lim = Int64(limit)
        guard b <= lim, s <= lim else { return nil }
        guard s > 0, b <= lim / s else { return nil }
        let product = b * s
        guard product > 0, product <= lim else { return nil }
        return Int(product)
    }

    /// Diagnostics for cost / continuity evidence (tests + APP handshake).
    public struct BakeDiagnostics: Equatable, Sendable {
        public let width: Int
        public let height: Int
        public let cellSize: CGFloat
        public let segmentCount: Int
        public let refinedTexels: Int
        public let segmentDistanceQueries: Int
        public let refineBandCells: CGFloat

        public var texelCount: Int { width * height }
    }

    /// Resolved grid covering the **full** logical viewport. Prefer growing
    /// `cellSize` over truncating width/height (which dropped right/bottom).
    public struct ResolvedGrid: Equatable, Sendable {
        public let width: Int
        public let height: Int
        public let cellSize: CGFloat
        public var texelCount: Int { width * height }
    }

    public static func needsRebake(
        previous: WorldbendOutlineNormalField?,
        contour: WorldbendOutlineContour
    ) -> Bool {
        guard let previous else { return true }
        return previous.sampleFingerprint != contour.sampleFingerprint
            || previous.dynamicsFingerprint != contour.dynamics.fingerprint
            || previous.fieldSpace != contour.fieldSpace
            || abs(previous.logicalSize.width - contour.logicalSize.width) > 0.01
            || abs(previous.logicalSize.height - contour.logicalSize.height) > 0.01
    }

    /// Map a scene-space sample point into the field's authored space.
    /// Pane-local fields subtract `paneFrame.origin` so translating the pane
    /// keeps UV stable without rebake.
    public static func fieldSamplePoint(
        sceneLogical: CGPoint,
        paneFrame: CGRect,
        fieldSpace: WorldbendOutlineFieldSpace
    ) -> CGPoint {
        switch fieldSpace {
        case .paneLocal:
            return CGPoint(
                x: sceneLogical.x - paneFrame.origin.x,
                y: sceneLogical.y - paneFrame.origin.y
            )
        case .scene:
            return sceneLogical
        }
    }

    /// Safe grid sizing: finite checks before `Double→Int`, full coverage, no axis clip.
    public static func resolvedGrid(
        logicalSize: CGSize,
        requestedCellSize: CGFloat = defaultCellSize
    ) throws -> ResolvedGrid {
        guard logicalSize.width.isFinite, logicalSize.height.isFinite,
              logicalSize.width > 0, logicalSize.height > 0
        else { throw WorldbendOutlineError.invalidGeometry }
        var cell = requestedCellSize.isFinite && requestedCellSize > 0
            ? requestedCellSize : defaultCellSize
        for _ in 0..<64 {
            let widthD = ceil(Double(logicalSize.width) / Double(cell))
            let heightD = ceil(Double(logicalSize.height) / Double(cell))
            guard widthD.isFinite, heightD.isFinite, widthD >= 1, heightD >= 1
            else { throw WorldbendOutlineError.bakeFailed }
            let fitsAxis = widthD <= Double(maxTexelsPerAxis)
                && heightD <= Double(maxTexelsPerAxis)
            let fitsTotal = widthD * heightD <= Double(maxTotalTexels)
            if fitsAxis && fitsTotal {
                // Int() is safe: values are finite and ≤ maxTexelsPerAxis ≤ 1024.
                let width = Int(widthD)
                let height = Int(heightD)
                // Coverage: last texel center still maps inside/beyond logical extent.
                guard CGFloat(width) * cell + 1e-6 >= logicalSize.width,
                      CGFloat(height) * cell + 1e-6 >= logicalSize.height
                else { throw WorldbendOutlineError.bakeFailed }
                return ResolvedGrid(width: width, height: height, cellSize: cell)
            }
            let cellForWidth = logicalSize.width / CGFloat(maxTexelsPerAxis)
            let cellForHeight = logicalSize.height / CGFloat(maxTexelsPerAxis)
            let area = logicalSize.width * logicalSize.height
            let cellForTotal = sqrt(max(area / CGFloat(maxTotalTexels), 0))
            let needed = max(cellForWidth, cellForHeight, cellForTotal, .leastNonzeroMagnitude)
            let next = max(needed, cell * 1.125)
            if next <= cell || !next.isFinite { throw WorldbendOutlineError.bakeFailed }
            cell = next
        }
        throw WorldbendOutlineError.bakeFailed
    }

    public static func bake(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat = defaultCellSize,
        refineBandCells: CGFloat = defaultRefineBandCells,
        maxRefineQueries: Int = Self.maxRefineQueries,
        processor: WorldbendOutlineFieldProcessor = .cpu,
        device: (any MTLDevice)? = nil
    ) throws -> WorldbendOutlineNormalField {
        try bakeWithDiagnostics(
            contour: contour,
            cellSize: cellSize,
            refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries,
            processor: processor,
            device: device
        ).field
    }

    /// Same as ``bake`` but returns refine cost evidence (segment×band queries).
    /// `.cpu` is the r6 pointer kernel. `.gpu` is Metal compute and throws if
    /// the device or encode fails. `.automatic` uses the GPU only when the
    /// measured policy says so, and otherwise stays on the CPU kernel.
    public static func bakeWithDiagnostics(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat = defaultCellSize,
        refineBandCells: CGFloat = defaultRefineBandCells,
        maxRefineQueries: Int = Self.maxRefineQueries,
        processor: WorldbendOutlineFieldProcessor = .cpu,
        device: (any MTLDevice)? = nil
    ) throws -> (field: WorldbendOutlineNormalField, diagnostics: BakeDiagnostics) {
        switch processor {
        case .cpu:
            return try bakeWithDiagnosticsCPU(
                contour: contour, cellSize: cellSize,
                refineBandCells: refineBandCells, maxRefineQueries: maxRefineQueries
            )
        case .gpu:
            guard let resolved = device ?? MTLCreateSystemDefaultDevice() else {
                throw WorldbendOutlineError.metalUnavailable
            }
            return try WorldbendOutlineFieldGPU.bake(
                contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
                maxRefineQueries: maxRefineQueries, device: resolved,
                honorAutomaticThreshold: false
            )
        case .automatic:
            guard WorldbendOutlineFieldGPU.automaticPrefersGPU,
                  let resolved = device ?? MTLCreateSystemDefaultDevice()
            else {
                return try bakeWithDiagnosticsCPU(
                    contour: contour, cellSize: cellSize,
                    refineBandCells: refineBandCells, maxRefineQueries: maxRefineQueries
                )
            }
            do {
                return try WorldbendOutlineFieldGPU.bake(
                    contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
                    maxRefineQueries: maxRefineQueries, device: resolved,
                    honorAutomaticThreshold: true
                )
            } catch let error as WorldbendOutlineError {
                if case .refineBudgetExceeded = error { throw error }
                return try bakeWithDiagnosticsCPU(
                    contour: contour, cellSize: cellSize,
                    refineBandCells: refineBandCells, maxRefineQueries: maxRefineQueries
                )
            } catch {
                return try bakeWithDiagnosticsCPU(
                    contour: contour, cellSize: cellSize,
                    refineBandCells: refineBandCells, maxRefineQueries: maxRefineQueries
                )
            }
        }
    }

    /// Shared grid, scanline mask, and field origin for the CPU and GPU bakers.
    static func prepareOutlineFieldBake(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int
    ) throws -> OutlineFieldBakePrep {
        try contour.validate()

        var ring = contour.polyline.map {
            CGPoint(x: $0.x - contour.origin.x, y: $0.y - contour.origin.y)
        }
        if contour.closesImplicitly {
            if let first = ring.first, let last = ring.last {
                let dx = first.x - last.x, dy = first.y - last.y
                if dx * dx + dy * dy > 0.01 {
                    ring.append(first)
                }
            }
        }
        guard ring.count >= 4 else { throw WorldbendOutlineError.emptyPolyline }

        // Cover the full contour AABB ∪ authored viewport. SetupArc closes at
        // height+200 past the visible viewport; baking only the viewport made
        // the chamfer treat the grid rim as exterior and paint a false bottom
        // edge. Expand (with pad) so the true contour boundary is inside the
        // field; optical panes still clip to paneFrame.
        let requested = cellSize.isFinite && cellSize > 0 ? cellSize : defaultCellSize
        var minX: CGFloat = 0
        var minY: CGFloat = 0
        var maxX: CGFloat = contour.logicalSize.width
        var maxY: CGFloat = contour.logicalSize.height
        for p in ring {
            guard p.x.isFinite, p.y.isFinite else { throw WorldbendOutlineError.invalidGeometry }
            minX = min(minX, p.x)
            minY = min(minY, p.y)
            maxX = max(maxX, p.x)
            maxY = max(maxY, p.y)
        }
        let pad = max(requested * 2, 4)
        minX -= pad
        minY -= pad
        maxX += pad
        maxY += pad
        let coverageSize = CGSize(width: maxX - minX, height: maxY - minY)
        guard coverageSize.width.isFinite, coverageSize.height.isFinite,
              coverageSize.width > 0, coverageSize.height > 0
        else { throw WorldbendOutlineError.bakeFailed }

        let grid = try resolvedGrid(
            logicalSize: coverageSize,
            requestedCellSize: cellSize
        )
        let width = grid.width
        let height = grid.height
        let cell = grid.cellSize
        let coverageOrigin = CGPoint(x: minX, y: minY)
        let shifted = ring.map {
            CGPoint(x: $0.x - coverageOrigin.x, y: $0.y - coverageOrigin.y)
        }
        let inside = scanlineInsideMask(ring: shifted, width: width, height: height, cell: cell)
        let bandCells = refineBandCells.isFinite && refineBandCells > 0
            ? refineBandCells : defaultRefineBandCells
        let fieldOrigin = CGPoint(
            x: contour.origin.x + coverageOrigin.x,
            y: contour.origin.y + coverageOrigin.y
        )
        return OutlineFieldBakePrep(
            contour: contour, shifted: shifted, width: width, height: height,
            cell: cell, fieldOrigin: fieldOrigin, inside: inside,
            bandCells: bandCells, queryLimit: maxRefineQueries
        )
    }

    /// Fail closed before exact-segment work. `estimated` stays `limit + 1`,
    /// matching the previous clamped diagnostic.
    static func enforceRefinePreflight(bandTexels: Int, segmentCount: Int, limit: Int) throws {
        if bandTexels > 0, segmentCount > 0 {
            guard checkedRefineQueryCount(
                bandTexels: bandTexels, segmentCount: segmentCount, limit: limit
            ) != nil else {
                throw WorldbendOutlineError.refineBudgetExceeded(estimated: limit + 1, limit: limit)
            }
        }
    }

    static func bakeWithDiagnosticsCPU(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int
    ) throws -> (field: WorldbendOutlineNormalField, diagnostics: BakeDiagnostics) {
        let prep = try prepareOutlineFieldBake(
            contour: contour, cellSize: cellSize,
            refineBandCells: refineBandCells, maxRefineQueries: maxRefineQueries
        )
        let contour = prep.contour
        let shifted = prep.shifted
        let width = prep.width
        let height = prep.height
        let cell = prep.cell
        let inside = prep.inside
        let bandCells = prep.bandCells
        let queryLimit = prep.queryLimit
        let fieldOrigin = prep.fieldOrigin

        // Sustainable path: scanline + chamfer DT over the full field, then
        // exact segment-distance refine ONLY near the boundary band. This keeps
        // default ~2pt cells (no full-viewport density raise) while removing
        // binary-seed staircasing on curved highlights.
        // Hot loops live in the pointer kernel below: Swift 6.3 `@_optimize(speed)`
        // does not run the -O pipeline under `-Onone` (attribute only clears optnone).
        var distances = chamferSignedDistance(inside: inside, width: width, height: height, cell: cell)
        var normalsX = [Float](repeating: 0, count: width * height)
        var normalsY = [Float](repeating: -1, count: width * height)
        fillOutwardNormals(
            distances: distances, normalsX: &normalsX, normalsY: &normalsY,
            width: width, height: height
        )
        let band = Float(bandCells * cell)
        let segmentCount = max(shifted.count - 1, 0)
        // Preflight BEFORE any exact-segment work. Checking after refine finishes
        // cannot stop runaway complex contours (APP OUTLINE-r5 feedback).
        let bandTexels = countRefineBandTexels(
            distances: distances, width: width, height: height, band: band
        )
        try enforceRefinePreflight(
            bandTexels: bandTexels, segmentCount: segmentCount, limit: queryLimit
        )
        let refine = try refineExactSegmentField(
            ring: shifted,
            inside: inside,
            distances: &distances,
            normalsX: &normalsX,
            normalsY: &normalsY,
            width: width,
            height: height,
            cell: cell,
            refineBandCells: bandCells,
            maxQueries: queryLimit
        )

        let field = WorldbendOutlineNormalField(
            profile: worldbendOutlineGlassMetalProfile,
            width: width,
            height: height,
            logicalSize: contour.logicalSize,
            origin: fieldOrigin,
            cellSize: cell,
            fieldSpace: contour.fieldSpace,
            dynamicsFingerprint: contour.dynamics.fingerprint,
            sampleFingerprint: contour.sampleFingerprint,
            distances: distances,
            normalsX: normalsX,
            normalsY: normalsY
        )
        try field.validate()
        let diagnostics = BakeDiagnostics(
            width: width,
            height: height,
            cellSize: cell,
            segmentCount: max(shifted.count - 1, 0),
            refinedTexels: refine.refinedTexels,
            segmentDistanceQueries: refine.segmentDistanceQueries,
            refineBandCells: bandCells
        )
        return (field, diagnostics)
    }

    /// Encode GPU field generation into `commandBuffer` without waiting.
    /// Refine-budget and encode failures throw and do not publish a field.
    /// The synchronous wait, when a band count is required, runs off the main thread.
    public static func encodeGPUField(
        contour: WorldbendOutlineContour,
        commandBuffer: any MTLCommandBuffer,
        device: (any MTLDevice)? = nil,
        cellSize: CGFloat = defaultCellSize,
        refineBandCells: CGFloat = defaultRefineBandCells,
        maxRefineQueries: Int = Self.maxRefineQueries,
        packInto texture: (any MTLTexture)? = nil
    ) throws -> WorldbendOutlineFieldGPU.Pending {
        let resolved = device ?? commandBuffer.device
        return try WorldbendOutlineFieldGPU.encode(
            contour: contour,
            cellSize: cellSize,
            refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries,
            device: resolved,
            commandBuffer: commandBuffer,
            packInto: texture
        )
    }

    /// Sample field at logical point (for tests / CPU light probes).
    public static func sample(
        _ field: WorldbendOutlineNormalField,
        at logical: CGPoint
    ) -> (distance: Float, normal: SIMD2<Float>) {
        let lx = logical.x - field.origin.x
        let ly = logical.y - field.origin.y
        let fx = lx / field.cellSize - 0.5
        let fy = ly / field.cellSize - 0.5
        let x0 = max(0, min(field.width - 1, Int(floor(fx))))
        let y0 = max(0, min(field.height - 1, Int(floor(fy))))
        let x1 = max(0, min(field.width - 1, x0 + 1))
        let y1 = max(0, min(field.height - 1, y0 + 1))
        let tx = Float(max(0, min(1, fx - CGFloat(x0))))
        let ty = Float(max(0, min(1, fy - CGFloat(y0))))
        func d(_ x: Int, _ y: Int) -> Float { field.distances[y * field.width + x] }
        func nx(_ x: Int, _ y: Int) -> Float { field.normalsX[y * field.width + x] }
        func ny(_ x: Int, _ y: Int) -> Float { field.normalsY[y * field.width + x] }
        let distance =
            mix(mix(d(x0, y0), d(x1, y0), tx), mix(d(x0, y1), d(x1, y1), tx), ty)
        var normal = SIMD2(
            mix(mix(nx(x0, y0), nx(x1, y0), tx), mix(nx(x0, y1), nx(x1, y1), tx), ty),
            mix(mix(ny(x0, y0), ny(x1, y0), tx), mix(ny(x0, y1), ny(x1, y1), tx), ty)
        )
        let len = simd_length(normal)
        if len > 1e-5 { normal /= len }
        return (distance, normal)
    }

    public static func edgeLightResponse(
        normal: SIMD2<Float>,
        lightDirection: SIMD2<Float>,
        rim: Float,
        highlightStrength: Float
    ) -> Float {
        let facing = simd_dot(normal, lightDirection)
        let light = max(0, facing) + 0.24 * max(0, -facing)
        return highlightStrength * (
            (0.3 + 0.7 * light) * pow(rim, 8) + 0.16 * light * pow(rim, 2)
        )
    }

    /// Texture UV for a logical point against a baked field. Matches
    /// `OutlineGlass.metal` `sampleField` — texel *i* was authored at logical
    /// center `((i+0.5)*cell)`, which is Metal UV `(i+0.5)/texelCount`.
    public static func fieldTextureUV(
        logical: CGPoint,
        origin: CGPoint,
        cellSize: CGFloat,
        texelWidth: Int,
        texelHeight: Int
    ) -> SIMD2<Float> {
        let localX = logical.x - origin.x
        let localY = logical.y - origin.y
        let denomX = max(cellSize * CGFloat(texelWidth), 0.0001)
        let denomY = max(cellSize * CGFloat(texelHeight), 0.0001)
        return SIMD2(Float(localX / denomX), Float(localY / denomY))
    }
}

// MARK: - GPU field upload

/// Metal-resident outline field for optical panes. APP keeps the CPU field /
/// contour; Worldbend uploads when dynamics/polyline change.
@MainActor
public final class WorldbendOutlineFieldTexture {
    public private(set) var field: WorldbendOutlineNormalField
    public private(set) var texture: (any MTLTexture)?
    public let device: any MTLDevice

    public init(device: any MTLDevice, field: WorldbendOutlineNormalField) throws {
        self.device = device
        self.field = field
        try field.validate()
        self.texture = try Self.makeTexture(device: device, field: field)
    }

    public func update(_ field: WorldbendOutlineNormalField) throws {
        try field.validate()
        if self.field.width != field.width || self.field.height != field.height || texture == nil {
            texture = try Self.makeTexture(device: device, field: field)
        } else {
            try Self.upload(field: field, into: texture!)
        }
        self.field = field
    }

    /// Encode a GPU field into `commandBuffer` and, when this texture already
    /// matches the grid, pack rgba16 on that same buffer. Does not wait.
    /// The pack can precede the CPU repair of on-segment samples. Call
    /// ``applyResolvedGPUField(_:)`` after the buffer completes and
    /// ``WorldbendOutlineFieldGPU/Pending/resolve(commandBuffer:)`` succeeds
    /// so the texture matches the resolved field.
    public func encodeGPUField(
        contour: WorldbendOutlineContour,
        commandBuffer: any MTLCommandBuffer,
        cellSize: CGFloat = WorldbendOutlineFieldBaker.defaultCellSize,
        refineBandCells: CGFloat = WorldbendOutlineFieldBaker.defaultRefineBandCells,
        maxRefineQueries: Int = WorldbendOutlineFieldBaker.maxRefineQueries
    ) throws -> WorldbendOutlineFieldGPU.Pending {
        guard let texture else { throw WorldbendOutlineError.metalUnavailable }
        return try WorldbendOutlineFieldBaker.encodeGPUField(
            contour: contour,
            commandBuffer: commandBuffer,
            device: device,
            cellSize: cellSize,
            refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries,
            packInto: texture
        )
    }

    /// Publish `field` as the current CPU field and texture. Uploads pixels so
    /// a same-buffer pack that ran before degenerate even-odd repair cannot
    /// stay visible. Call only after that command buffer has completed.
    public func applyResolvedGPUField(_ field: WorldbendOutlineNormalField) throws {
        try field.validate()
        guard let texture, texture.width == field.width, texture.height == field.height else {
            throw WorldbendOutlineError.bakeFailed
        }
        try Self.upload(field: field, into: texture)
        self.field = field
    }

    private static func makeTexture(device: any MTLDevice, field: WorldbendOutlineNormalField) throws -> any MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba16Float,
            width: field.width,
            height: field.height,
            mipmapped: false
        )
        descriptor.usage = [.shaderRead, .shaderWrite]
        descriptor.storageMode = .shared
        guard let texture = device.makeTexture(descriptor: descriptor) else {
            throw WorldbendOutlineError.metalUnavailable
        }
        try upload(field: field, into: texture)
        return texture
    }

    private static func upload(field: WorldbendOutlineNormalField, into texture: any MTLTexture) throws {
        var pixels = [SIMD4<Float16>](repeating: .zero, count: field.texelCount)
        for i in 0..<field.texelCount {
            pixels[i] = SIMD4(
                Float16(field.distances[i]),
                Float16(field.normalsX[i]),
                Float16(field.normalsY[i]),
                Float16(field.distances[i] <= 0 ? 1 : 0)
            )
        }
        pixels.withUnsafeBytes { bytes in
            texture.replace(
                region: MTLRegionMake2D(0, 0, field.width, field.height),
                mipmapLevel: 0,
                withBytes: bytes.baseAddress!,
                bytesPerRow: field.width * MemoryLayout<SIMD4<Float16>>.stride
            )
        }
    }
}

// MARK: - Metal outline renderer

struct WorldbendOutlineOpticalUniforms {
    var paneFrame: SIMD4<Float>
    var contentRect: SIMD4<Float>
    var logicalSize: SIMD2<Float>
    var drawableSize: SIMD2<Float>
    var fieldOrigin: SIMD2<Float>
    var fieldCellSize: SIMD2<Float>
    var fieldTexelSize: SIMD2<Float>
    /// 1 = pane-local field (subtract paneFrame.xy before sample); 0 = scene.
    var fieldSpacePaneLocal: Float
    var edgeWidth: Float
    var refractionScale: Float
    var chromaticOffset: Float
    var lightDirection: SIMD2<Float>
    var highlightStrength: Float
    var frostRadius: Float
    var frostLod: Float
}

/// Loads outline fragment from the package metallib and encodes Metal-direct
/// outline glass draws. Requires an APP-baked field texture + shared frame binding.
@MainActor
public final class WorldbendOutlineMetalRenderer {
    public enum Status: String, Sendable {
        case ready
        case missingMetallib = "missing-metallib"
        case pipelineFailure = "pipeline-failure"
        case noDevice = "no-device"
    }

    public let device: any MTLDevice
    public private(set) var status: Status
    private let queue: (any MTLCommandQueue)?
    private var pipeline: (any MTLRenderPipelineState)?
    private let frostPyramid: WorldbendFrostPyramidCache?

    public init(device: any MTLDevice) {
        self.device = device
        self.queue = device.makeCommandQueue()
        self.frostPyramid = queue.map { WorldbendFrostPyramidCache(queue: $0) }
        guard queue != nil else {
            status = .noDevice
            return
        }
        if let state = Self.makePipeline(device: device) {
            pipeline = state
            status = .ready
        } else if Bundle.module.url(forResource: "default", withExtension: "metallib") == nil {
            status = .missingMetallib
        } else {
            status = .pipelineFailure
        }
    }

    public var isReady: Bool { status == .ready && pipeline != nil }

    nonisolated(unsafe) static var drawEncodeCountForTests = 0

    func draw(
        into drawable: CAMetalDrawable,
        binding: WorldbendMetalOpticalBinding,
        field: WorldbendOutlineFieldTexture,
        optics: OutlineOpticalGlassConfiguration,
        paneFrame: CGRect
    ) {
        guard isReady,
              let source = binding.texture,
              let fieldTexture = field.texture,
              let pipeline,
              let buffer = queue?.makeCommandBuffer()
        else { return }
        let sampleSource: any MTLTexture
        if optics.frostRadius > WorldbendFrostSamplingBudget.legacyMaxPoints,
           let frostPyramid {
            // Encode mip rebuild into this draw buffer (no MainActor GPU wait).
            sampleSource = frostPyramid.sampleTexture(
                device: device,
                source: source,
                frameRevision: binding.frameRevision,
                commandBuffer: buffer
            )
        } else {
            sampleSource = source
        }
        var uniforms = makeUniforms(
            binding: binding,
            field: field.field,
            paneFrame: paneFrame,
            drawableSize: CGSize(width: drawable.texture.width, height: drawable.texture.height),
            optics: optics,
            source: sampleSource
        )
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = drawable.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) else { return }
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<WorldbendOutlineOpticalUniforms>.stride, index: 0)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WorldbendOutlineOpticalUniforms>.stride, index: 0)
        encoder.setFragmentTexture(sampleSource, index: 0)
        encoder.setFragmentTexture(fieldTexture, index: 1)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
        Self.drawEncodeCountForTests &+= 1
    }

    private func makeUniforms(
        binding: WorldbendMetalOpticalBinding,
        field: WorldbendOutlineNormalField,
        paneFrame: CGRect,
        drawableSize: CGSize,
        optics: OutlineOpticalGlassConfiguration,
        source: any MTLTexture
    ) -> WorldbendOutlineOpticalUniforms {
        let light = optics.lightDirection
        let content = SIMD2(Float(binding.contentRect.width), Float(binding.contentRect.height))
        let texels = SIMD2(Float(source.width), Float(source.height))
        let frost = Float(optics.frostRadius)
        let lod: Float
        if optics.frostRadius > WorldbendFrostSamplingBudget.legacyMaxPoints {
            lod = WorldbendFrostPyramid.lod(
                frostRadiusPoints: frost, contentSizePoints: content, sourceSizeTexels: texels
            )
        } else {
            lod = 0
        }
        return WorldbendOutlineOpticalUniforms(
            paneFrame: SIMD4(Float(paneFrame.minX), Float(paneFrame.minY),
                             Float(paneFrame.width), Float(paneFrame.height)),
            contentRect: SIMD4(Float(binding.contentRect.minX), Float(binding.contentRect.minY),
                               Float(binding.contentRect.width), Float(binding.contentRect.height)),
            logicalSize: SIMD2(Float(binding.logicalSize.width), Float(binding.logicalSize.height)),
            drawableSize: SIMD2(Float(drawableSize.width), Float(drawableSize.height)),
            fieldOrigin: SIMD2(Float(field.origin.x), Float(field.origin.y)),
            fieldCellSize: SIMD2(Float(field.cellSize), Float(field.cellSize)),
            fieldTexelSize: SIMD2(Float(field.width), Float(field.height)),
            fieldSpacePaneLocal: field.fieldSpace == .paneLocal ? 1 : 0,
            edgeWidth: Float(optics.edgeWidth),
            refractionScale: Float(optics.refractionScale),
            chromaticOffset: Float(optics.chromaticOffset),
            lightDirection: SIMD2(Float(light[0]), Float(light[1])),
            highlightStrength: Float(optics.highlightStrength),
            frostRadius: frost,
            frostLod: lod
        )
    }

    private static func makePipeline(device: any MTLDevice) -> (any MTLRenderPipelineState)? {
        guard let url = Bundle.module.url(forResource: "default", withExtension: "metallib"),
              let library = try? device.makeLibrary(URL: url),
              let vertex = library.makeFunction(name: "worldbendOutlineOpticalVertex"),
              let fragment = library.makeFunction(name: "worldbendOutlineOpticalFragment")
        else { return nil }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        descriptor.colorAttachments[0].isBlendingEnabled = true
        descriptor.colorAttachments[0].sourceRGBBlendFactor = .one
        descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        return try? device.makeRenderPipelineState(descriptor: descriptor)
    }
}

// MARK: - Platform view + SwiftUI pane

@MainActor
final class WorldbendOutlineMetalPlatformView: MTKView {
    enum Mode {
        case idle
        case outline(OutlineOpticalGlassConfiguration, CGRect)
    }

    private var renderer: WorldbendOutlineMetalRenderer?
    private var binding: WorldbendMetalOpticalBinding?
    private var fieldTexture: WorldbendOutlineFieldTexture?
    private var mode: Mode = .idle
    private var opaqueFill = SIMD4<Float>(0.5, 0.5, 0.5, 1)

    override init(frame frameRect: CGRect, device: (any MTLDevice)?) {
        super.init(frame: frameRect, device: device)
        isPaused = true
        enableSetNeedsDisplay = true
        framebufferOnly = true
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        #if canImport(UIKit)
        backgroundColor = .clear
        isOpaque = false
        #elseif canImport(AppKit)
        layer?.isOpaque = false
        #endif
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(
        renderer: WorldbendOutlineMetalRenderer?,
        binding: WorldbendMetalOpticalBinding?,
        field: WorldbendOutlineFieldTexture?,
        mode: Mode,
        opaqueFill: SIMD4<Float>
    ) {
        self.renderer = renderer
        self.binding = binding
        self.fieldTexture = field
        self.mode = mode
        self.opaqueFill = opaqueFill
        self.device = renderer?.device
        #if canImport(UIKit)
        setNeedsDisplay()
        #elseif canImport(AppKit)
        needsDisplay = true
        #endif
    }

    override func draw(_ rect: CGRect) {
        guard let drawable = currentDrawable else { return }
        guard case let .outline(optics, paneFrame) = mode,
              let renderer, renderer.isReady,
              let binding, binding.isReady,
              let fieldTexture
        else {
            clear(drawable: drawable, color: opaqueFill)
            return
        }
        renderer.draw(
            into: drawable,
            binding: binding,
            field: fieldTexture,
            optics: optics,
            paneFrame: paneFrame
        )
    }

    private func clear(drawable: CAMetalDrawable, color: SIMD4<Float>) {
        guard let renderer,
              let buffer = renderer.device.makeCommandQueue()?.makeCommandBuffer()
        else { return }
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = drawable.texture
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColorMake(
            Double(color.x), Double(color.y), Double(color.z), Double(color.w)
        )
        if let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) {
            encoder.endEncoding()
        }
        buffer.present(drawable)
        buffer.commit()
    }
}

#if canImport(UIKit)
struct WorldbendOutlineMetalUIView: UIViewRepresentable {
    let renderer: WorldbendOutlineMetalRenderer?
    let binding: WorldbendMetalOpticalBinding?
    let field: WorldbendOutlineFieldTexture?
    let mode: WorldbendOutlineMetalPlatformView.Mode
    let opaqueFill: Color

    func makeUIView(context: Context) -> WorldbendOutlineMetalPlatformView {
        WorldbendOutlineMetalPlatformView(frame: .zero, device: renderer?.device)
    }

    func updateUIView(_ view: WorldbendOutlineMetalPlatformView, context: Context) {
        view.configure(
            renderer: renderer, binding: binding, field: field,
            mode: mode, opaqueFill: Self.rgba(opaqueFill)
        )
    }

    private static func rgba(_ color: Color) -> SIMD4<Float> {
        #if canImport(UIKit)
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return SIMD4(Float(r), Float(g), Float(b), Float(a))
        #else
        return SIMD4(0.5, 0.5, 0.5, 1)
        #endif
    }
}
#elseif canImport(AppKit)
struct WorldbendOutlineMetalNSView: NSViewRepresentable {
    let renderer: WorldbendOutlineMetalRenderer?
    let binding: WorldbendMetalOpticalBinding?
    let field: WorldbendOutlineFieldTexture?
    let mode: WorldbendOutlineMetalPlatformView.Mode
    let opaqueFill: Color

    func makeNSView(context: Context) -> WorldbendOutlineMetalPlatformView {
        WorldbendOutlineMetalPlatformView(frame: .zero, device: renderer?.device)
    }

    func updateNSView(_ view: WorldbendOutlineMetalPlatformView, context: Context) {
        view.configure(
            renderer: renderer, binding: binding, field: field,
            mode: mode, opaqueFill: Self.rgba(opaqueFill)
        )
    }

    private static func rgba(_ color: Color) -> SIMD4<Float> {
        let ns = NSColor(color)
        guard let rgb = ns.usingColorSpace(.deviceRGB) else {
            return SIMD4(0.5, 0.5, 0.5, 1)
        }
        return SIMD4(Float(rgb.redComponent), Float(rgb.greenComponent),
                     Float(rgb.blueComponent), Float(rgb.alphaComponent))
    }
}
#endif

/// Metal-direct outline optical pane. APP supplies contour → baked field;
/// Worldbend samples shared frame + field normals. Does not own SetupArc Shape.
@MainActor
public struct WorldbendOutlineMetalPane: View {
    private let binding: WorldbendMetalOpticalBinding?
    private let renderer: WorldbendOutlineMetalRenderer?
    private let field: WorldbendOutlineFieldTexture?
    private let optics: OutlineOpticalGlassConfiguration?
    private let coordinateSpace: UUID
    private let opaqueFill: Color
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    public init(
        binding: WorldbendMetalOpticalBinding?,
        renderer: WorldbendOutlineMetalRenderer?,
        field: WorldbendOutlineFieldTexture?,
        optics: OutlineOpticalGlassConfiguration?,
        coordinateSpace: UUID,
        opaqueFill: Color = .gray
    ) {
        self.binding = binding
        self.renderer = renderer
        self.field = field
        self.optics = optics
        self.coordinateSpace = coordinateSpace
        self.opaqueFill = opaqueFill
    }

    public var body: some View {
        GeometryReader { proxy in
            let frame = proxy.frame(in: .named(coordinateSpace))
            if reduceTransparency || contrast == .increased || optics == nil
                || binding?.isReady != true || renderer?.isReady != true || field?.texture == nil {
                Rectangle().fill(opaqueFill)
            } else if let optics {
                metalHost(mode: .outline(optics, frame))
            }
        }
        .clipped()
        .contentShape(Rectangle())
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func metalHost(mode: WorldbendOutlineMetalPlatformView.Mode) -> some View {
        #if canImport(UIKit)
        WorldbendOutlineMetalUIView(
            renderer: renderer, binding: binding, field: field,
            mode: mode, opaqueFill: opaqueFill
        )
        #elseif canImport(AppKit)
        WorldbendOutlineMetalNSView(
            renderer: renderer, binding: binding, field: field,
            mode: mode, opaqueFill: opaqueFill
        )
        #else
        Color.clear
        #endif
    }
}

// MARK: - Geometry helpers

private func mix(_ a: Float, _ b: Float, _ t: Float) -> Float { a + (b - a) * t }

/// Even-odd scanline fill at texel centers. O(segments·height + width·height).
/// Span fills use an unchecked pointer so Debug `-Onone` does not bounds-check
/// every covered texel. Crossing math stays in `CGFloat` (Double on arm64).
func scanlineInsideMask(
    ring: [CGPoint],
    width: Int,
    height: Int,
    cell: CGFloat
) -> [Bool] {
    var inside = [Bool](repeating: false, count: width * height)
    if width == 0 || height == 0 || ring.count < 2 { return inside }
    var crossings = [[CGFloat]](repeating: [], count: height)
    let segmentCount = ring.count - 1
    var s = 0
    while s < segmentCount {
        let a = ring[s], b = ring[s + 1]
        s += 1
        if a.y == b.y { continue }
        let y0 = min(a.y, b.y), y1 = max(a.y, b.y)
        let rowStart = max(0, Int(floor(y0 / cell)))
        let rowEnd = min(height - 1, Int(ceil(y1 / cell)) - 1)
        if rowStart > rowEnd { continue }
        let dy = b.y - a.y
        let dx = b.x - a.x
        var row = rowStart
        while row <= rowEnd {
            let py = (CGFloat(row) + 0.5) * cell
            if py >= y0 && py < y1 {
                let t = (py - a.y) / dy
                let xInt = a.x + dx * t
                if xInt.isFinite { crossings[row].append(xInt) }
            }
            row += 1
        }
    }
    inside.withUnsafeMutableBufferPointer { buffer in
        guard let basePtr = buffer.baseAddress else { return }
        var row = 0
        while row < height {
            let xs = crossings[row].sorted()
            let rowBase = row * width
            var i = 0
            while i + 1 < xs.count {
                let x0 = xs[i], x1 = xs[i + 1]
                let c0 = max(0, Int(floor(x0 / cell)))
                let c1 = min(width - 1, Int(floor((x1 - 1e-9) / cell)))
                if c0 <= c1 {
                    var col = c0
                    while col <= c1 {
                        basePtr[rowBase + col] = true
                        col += 1
                    }
                }
                i += 2
            }
            row += 1
        }
    }
    return inside
}

/// 3-4 chamfer signed distance in logical points. Seeds are inside/outside
/// boundary faces; O(width·height) independent of polyline length.
/// Unchecked pointers: same min-order as the previous subscript loops, without
/// Debug `-Onone` bounds checks on every neighbor.
private func chamferSignedDistance(
    inside: [Bool],
    width: Int,
    height: Int,
    cell: CGFloat
) -> [Float] {
    let count = width * height
    let inf: Float = 1.0e20
    var dist = [Float](repeating: inf, count: count)
    if count == 0 || width <= 0 || height <= 0 { return dist }
    let scale = Float(cell) / 3
    let far = Float(cell) * 1e3
    inside.withUnsafeBufferPointer { insideBuf in
        dist.withUnsafeMutableBufferPointer { distBuf in
            guard let inn = insideBuf.baseAddress, let d = distBuf.baseAddress else { return }
            var y = 0
            while y < height {
                let row = y * width
                var x = 0
                while x < width {
                    let i = row + x
                    let here = inn[i]
                    let left = x > 0 ? inn[i - 1] : false
                    let right = x + 1 < width ? inn[i + 1] : false
                    let up = y > 0 ? inn[i - width] : false
                    let down = y + 1 < height ? inn[i + width] : false
                    if here != left || here != right || here != up || here != down {
                        d[i] = 0
                    }
                    x += 1
                }
                y += 1
            }
            y = 0
            while y < height {
                let row = y * width
                var x = 0
                while x < width {
                    let i = row + x
                    var v = d[i]
                    if x > 0 { v = min(v, d[i - 1] + 3) }
                    if y > 0 {
                        v = min(v, d[i - width] + 3)
                        if x > 0 { v = min(v, d[i - width - 1] + 4) }
                        if x + 1 < width { v = min(v, d[i - width + 1] + 4) }
                    }
                    d[i] = v
                    x += 1
                }
                y += 1
            }
            y = height - 1
            while y >= 0 {
                let row = y * width
                var x = width - 1
                while x >= 0 {
                    let i = row + x
                    var v = d[i]
                    if x + 1 < width { v = min(v, d[i + 1] + 3) }
                    if y + 1 < height {
                        v = min(v, d[i + width] + 3)
                        if x + 1 < width { v = min(v, d[i + width + 1] + 4) }
                        if x > 0 { v = min(v, d[i + width - 1] + 4) }
                    }
                    d[i] = v
                    x -= 1
                }
                y -= 1
            }
            var i = 0
            while i < count {
                let signed = inn[i] ? -d[i] : d[i]
                d[i] = signed >= inf / 2 ? (inn[i] ? -far : far) : signed * scale
                i += 1
            }
        }
    }
    return dist
}

/// Exact closest-segment distance + outward normals for texels inside a
/// narrow band around the binary boundary. Cost ≈ O(bandTexels · segments),
/// not O(W·H·N). Far-field chamfer values are left unchanged.
///
/// Stops **inside** the loop when the query cap would be exceeded and throws
/// ``WorldbendOutlineError/refineBudgetExceeded`` — never finishes an
/// over-budget pass then rejects.
private struct OutlineRefineStats: Equatable, Sendable {
    var refinedTexels: Int = 0
    var segmentDistanceQueries: Int = 0
}

func countRefineBandTexels(
    distances: [Float],
    width: Int,
    height: Int,
    band: Float
) -> Int {
    guard width > 0, height > 0, band.isFinite, band > 0 else { return 0 }
    let total = width * height
    guard distances.count >= total else { return 0 }
    var count = 0
    distances.withUnsafeBufferPointer { buffer in
        guard let base = buffer.baseAddress else { return }
        var index = 0
        while index < total {
            if abs(base[index]) <= band { count += 1 }
            index += 1
        }
    }
    return count
}

/// Precomputed segment for Float hot-path closest-point queries.
struct OutlineRefineSegment: Sendable {
    var ax: Float, ay: Float
    var abx: Float, aby: Float
    var ab2: Float
    var minX: Float, minY: Float, maxX: Float, maxY: Float
}

/// Uniform grid of segment indices. A segment is inserted into every cell that
/// overlaps its AABB expanded by `margin`. Querying the cell that contains a
/// point therefore returns every segment within Chebyshev distance `margin`
/// of that point — enough to recover the exact closest boundary sample for
/// band texels without testing all N segments (menu morph ≈128).
struct OutlineSegmentSpatialIndex {
    let originX: Float
    let originY: Float
    let cell: Float
    let cols: Int
    let rows: Int
    /// CSR-like: `offsets[i]..<offsets[i+1]` indexes into `items` for cell i.
    let offsets: [Int]
    let items: [Int]

    init(segments: [OutlineRefineSegment], margin: Float, fieldWidth: Float, fieldHeight: Float) {
        let m = max(margin, 1e-3 as Float)
        // Coarse cell ≈ 2×margin so a typical band texel probes one bucket.
        let cell = max(m * 2, 8 as Float)
        let cols = max(1, Int(ceil(fieldWidth / cell)))
        let rows = max(1, Int(ceil(fieldHeight / cell)))
        self.originX = 0
        self.originY = 0
        self.cell = cell
        self.cols = cols
        self.rows = rows

        var buckets = [[Int]](repeating: [], count: cols * rows)
        for (si, seg) in segments.enumerated() {
            let x0 = max(0, Int(floor((seg.minX - m - originX) / cell)))
            let y0 = max(0, Int(floor((seg.minY - m - originY) / cell)))
            let x1 = min(cols - 1, Int(floor((seg.maxX + m - originX) / cell)))
            let y1 = min(rows - 1, Int(floor((seg.maxY + m - originY) / cell)))
            if x0 > x1 || y0 > y1 { continue }
            for gy in y0...y1 {
                for gx in x0...x1 {
                    buckets[gy * cols + gx].append(si)
                }
            }
        }
        var offsets = [Int](repeating: 0, count: buckets.count + 1)
        var items: [Int] = []
        items.reserveCapacity(buckets.reduce(0) { $0 + $1.count })
        for i in 0..<buckets.count {
            offsets[i] = items.count
            items.append(contentsOf: buckets[i])
        }
        offsets[buckets.count] = items.count
        self.offsets = offsets
        self.items = items
    }
}

private func refineExactSegmentField(
    ring: [CGPoint],
    inside: [Bool],
    distances: inout [Float],
    normalsX: inout [Float],
    normalsY: inout [Float],
    width: Int,
    height: Int,
    cell: CGFloat,
    refineBandCells: CGFloat,
    maxQueries: Int
) throws -> OutlineRefineStats {
    var stats = OutlineRefineStats()
    let segmentCount = max(ring.count - 1, 0)
    guard width > 0, height > 0, segmentCount > 0, cell > 0, cell.isFinite else { return stats }
    let band = Float(refineBandCells * cell)
    guard band.isFinite, band > 0 else { return stats }
    let limit = maxQueries
    guard limit > 0 else {
        throw WorldbendOutlineError.refineBudgetExceeded(estimated: segmentCount, limit: limit)
    }

    // Same segment grid the GPU refine uploads. Margin stays band + 4×cell.
    guard let prepared = prepareOutlineRefine(
        ring: ring, width: width, height: height, cell: cell, refineBandCells: refineBandCells
    ) else { return stats }
    let segments = prepared.segments
    let spatial = prepared.spatial
    let cellF = prepared.cellF

    // Collect band texels once so the hot loop does not re-test abs(d) over WH.
    var bandIndices: [Int] = []
    let total = width * height
    bandIndices.reserveCapacity(min(total, (width + height) * 8))
    distances.withUnsafeBufferPointer { buffer in
        if let base = buffer.baseAddress {
            var i = 0
            while i < total {
                if abs(base[i]) <= band { bandIndices.append(i) }
                i += 1
            }
        }
    }

    let cols = spatial.cols
    let rows = spatial.rows
    let gridCell = spatial.cell
    let originX = spatial.originX
    let originY = spatial.originY

    try distances.withUnsafeMutableBufferPointer { distBuf in
        try normalsX.withUnsafeMutableBufferPointer { nxBuf in
            try normalsY.withUnsafeMutableBufferPointer { nyBuf in
                try inside.withUnsafeBufferPointer { inBuf in
                    try segments.withUnsafeBufferPointer { segBuf in
                        try spatial.offsets.withUnsafeBufferPointer { offBuf in
                            try spatial.items.withUnsafeBufferPointer { itemBuf in
                                guard let distBase = distBuf.baseAddress,
                                      let nxBase = nxBuf.baseAddress,
                                      let nyBase = nyBuf.baseAddress,
                                      let inBase = inBuf.baseAddress,
                                      let segBase = segBuf.baseAddress,
                                      let offBase = offBuf.baseAddress,
                                      let itemBase = itemBuf.baseAddress
                                else { return }
                                var queries = stats.segmentDistanceQueries
                                var refined = stats.refinedTexels
                                var bandCursor = 0
                                let bandCount = bandIndices.count
                                while bandCursor < bandCount {
                                    let indexTexel = bandIndices[bandCursor]
                                    bandCursor += 1
                                    let y = indexTexel / width
                                    let x = indexTexel - y * width
                                    let px = (Float(x) + 0.5) * cellF
                                    let py = (Float(y) + 0.5) * cellF
                                    let gx = min(cols - 1, max(0, Int(floor((px - originX) / gridCell))))
                                    let gy = min(rows - 1, max(0, Int(floor((py - originY) / gridCell))))
                                    let cellIndex = gy * cols + gx
                                    let rangeStart = offBase[cellIndex]
                                    let rangeEnd = offBase[cellIndex + 1]
                                    let useAll = rangeStart == rangeEnd
                                    let candidateCount = useAll ? segmentCount : (rangeEnd - rangeStart)
                                    if limit - queries < candidateCount {
                                        stats.segmentDistanceQueries = queries
                                        stats.refinedTexels = refined
                                        throw WorldbendOutlineError.refineBudgetExceeded(
                                            estimated: queries + candidateCount,
                                            limit: limit
                                        )
                                    }
                                    queries += candidateCount

                                    var bestDist2 = Float.greatestFiniteMagnitude
                                    var bestCX = px, bestCY = py
                                    var bestTX: Float = 1, bestTY: Float = 0
                                    if useAll {
                                        var si = 0
                                        while si < segmentCount {
                                            let seg = segBase[si]
                                            let apx = px - seg.ax
                                            let apy = py - seg.ay
                                            let t: Float
                                            if seg.ab2 < 1e-12 {
                                                t = 0
                                            } else {
                                                t = max(0, min(1, (apx * seg.abx + apy * seg.aby) / seg.ab2))
                                            }
                                            let cx = seg.ax + seg.abx * t
                                            let cy = seg.ay + seg.aby * t
                                            let dx = px - cx
                                            let dy = py - cy
                                            let d2 = dx * dx + dy * dy
                                            if d2 < bestDist2 {
                                                bestDist2 = d2
                                                bestCX = cx
                                                bestCY = cy
                                                bestTX = seg.abx
                                                bestTY = seg.aby
                                            }
                                            si += 1
                                        }
                                    } else {
                                        var k = rangeStart
                                        while k < rangeEnd {
                                            let seg = segBase[itemBase[k]]
                                            let apx = px - seg.ax
                                            let apy = py - seg.ay
                                            let t: Float
                                            if seg.ab2 < 1e-12 {
                                                t = 0
                                            } else {
                                                t = max(0, min(1, (apx * seg.abx + apy * seg.aby) / seg.ab2))
                                            }
                                            let cx = seg.ax + seg.abx * t
                                            let cy = seg.ay + seg.aby * t
                                            let dx = px - cx
                                            let dy = py - cy
                                            let d2 = dx * dx + dy * dy
                                            if d2 < bestDist2 {
                                                bestDist2 = d2
                                                bestCX = cx
                                                bestCY = cy
                                                bestTX = seg.abx
                                                bestTY = seg.aby
                                            }
                                            k += 1
                                        }
                                    }

                                    refined += 1
                                    let unsigned = bestDist2.squareRoot()
                                    let inn = inBase[indexTexel]
                                    distBase[indexTexel] = inn ? -unsigned : unsigned

                                    let vx = px - bestCX
                                    let vy = py - bestCY
                                    let vlen = (vx * vx + vy * vy).squareRoot()
                                    if vlen > 1e-6 {
                                        var nx = vx / vlen
                                        var ny = vy / vlen
                                        if inn {
                                            nx = -nx
                                            ny = -ny
                                        }
                                        nxBase[indexTexel] = nx
                                        nyBase[indexTexel] = ny
                                    } else {
                                        let tlen = (bestTX * bestTX + bestTY * bestTY).squareRoot()
                                        if tlen > 1e-6 {
                                            var nx = bestTY / tlen
                                            var ny = -bestTX / tlen
                                            let probeX = CGFloat(px + nx * (cellF * 0.25))
                                            let probeY = CGFloat(py + ny * (cellF * 0.25))
                                            let probeInside = outlinePointInsideEvenOdd(
                                                x: probeX, y: probeY, ring: ring
                                            )
                                            if probeInside {
                                                nx = -nx
                                                ny = -ny
                                            }
                                            nxBase[indexTexel] = nx
                                            nyBase[indexTexel] = ny
                                        }
                                    }
                                }
                                stats.segmentDistanceQueries = queries
                                stats.refinedTexels = refined
                            }
                        }
                    }
                }
            }
        }
    }
    return stats
}

func outlinePointInsideEvenOdd(x: CGFloat, y: CGFloat, ring: [CGPoint]) -> Bool {
    guard ring.count >= 2 else { return false }
    var inside = false
    for i in 0..<(ring.count - 1) {
        let a = ring[i]
        let b = ring[i + 1]
        let straddles = (a.y > y) != (b.y > y)
        if !straddles || a.y == b.y { continue }
        let t = (y - a.y) / (b.y - a.y)
        let xInt = a.x + (b.x - a.x) * t
        if xInt > x { inside.toggle() }
    }
    return inside
}

/// CPU recompute of one degenerate refine texel (vlen ≤ 1e-6). The even-odd
/// probe is CGFloat, which the GPU does not run. Not used by the r6 hot loop.
func outlineRepairDegenerateTexel(
    index: Int,
    width: Int,
    cellF: Float,
    ring: [CGPoint],
    inside: [Bool],
    segments: [OutlineRefineSegment],
    spatial: OutlineSegmentSpatialIndex,
    distances: inout [Float],
    normalsX: inout [Float],
    normalsY: inout [Float]
) {
    guard width > 0, index >= 0, index < width * (distances.count / max(width, 1)) else { return }
    let segmentCount = segments.count
    guard segmentCount > 0 else { return }
    let y = index / width
    let x = index - y * width
    let px = (Float(x) + 0.5) * cellF
    let py = (Float(y) + 0.5) * cellF
    let cols = spatial.cols
    let rows = spatial.rows
    let gridCell = spatial.cell
    let gx = min(cols - 1, max(0, Int(floor((px - spatial.originX) / gridCell))))
    let gy = min(rows - 1, max(0, Int(floor((py - spatial.originY) / gridCell))))
    let cellIndex = gy * cols + gx
    let rangeStart = spatial.offsets[cellIndex]
    let rangeEnd = spatial.offsets[cellIndex + 1]
    let useAll = rangeStart == rangeEnd
    var bestDist2 = Float.greatestFiniteMagnitude
    var bestCX = px, bestCY = py
    var bestTX: Float = 1, bestTY: Float = 0
    let consider = { (seg: OutlineRefineSegment) in
        let apx = px - seg.ax
        let apy = py - seg.ay
        let t: Float
        if seg.ab2 < 1e-12 {
            t = 0
        } else {
            t = max(0, min(1, (apx * seg.abx + apy * seg.aby) / seg.ab2))
        }
        let cx = seg.ax + seg.abx * t
        let cy = seg.ay + seg.aby * t
        let dx = px - cx
        let dy = py - cy
        let d2 = dx * dx + dy * dy
        if d2 < bestDist2 {
            bestDist2 = d2
            bestCX = cx
            bestCY = cy
            bestTX = seg.abx
            bestTY = seg.aby
        }
    }
    if useAll {
        for seg in segments { consider(seg) }
    } else {
        var k = rangeStart
        while k < rangeEnd {
            consider(segments[spatial.items[k]])
            k += 1
        }
    }
    let unsigned = bestDist2.squareRoot()
    let inn = inside[index]
    distances[index] = inn ? -unsigned : unsigned
    let vx = px - bestCX
    let vy = py - bestCY
    let vlen = (vx * vx + vy * vy).squareRoot()
    if vlen > 1e-6 {
        var nx = vx / vlen
        var ny = vy / vlen
        if inn {
            nx = -nx
            ny = -ny
        }
        normalsX[index] = nx
        normalsY[index] = ny
    } else {
        let tlen = (bestTX * bestTX + bestTY * bestTY).squareRoot()
        if tlen > 1e-6 {
            var nx = bestTY / tlen
            var ny = -bestTX / tlen
            let probeX = CGFloat(px + nx * (cellF * 0.25))
            let probeY = CGFloat(py + ny * (cellF * 0.25))
            if outlinePointInsideEvenOdd(x: probeX, y: probeY, ring: ring) {
                nx = -nx
                ny = -ny
            }
            normalsX[index] = nx
            normalsY[index] = ny
        }
    }
}

private func fillOutwardNormals(
    distances: [Float],
    normalsX: inout [Float],
    normalsY: inout [Float],
    width: Int,
    height: Int
) {
    guard width > 0, height > 0 else { return }
    distances.withUnsafeBufferPointer { distBuf in
        normalsX.withUnsafeMutableBufferPointer { nxBuf in
            normalsY.withUnsafeMutableBufferPointer { nyBuf in
                guard let d = distBuf.baseAddress,
                      let nxOut = nxBuf.baseAddress,
                      let nyOut = nyBuf.baseAddress
                else { return }
                var y = 0
                while y < height {
                    let ym = y > 0 ? y - 1 : 0
                    let yp = y + 1 < height ? y + 1 : height - 1
                    let row = y * width
                    let rowM = ym * width
                    let rowP = yp * width
                    var x = 0
                    while x < width {
                        let xm = x > 0 ? x - 1 : 0
                        let xp = x + 1 < width ? x + 1 : width - 1
                        // Central differences on signed distance (∇ points outward).
                        let gx = d[row + xp] - d[row + xm]
                        let gy = d[rowP + x] - d[rowM + x]
                        var n = SIMD2<Float>(gx, gy)
                        let len = simd_length(n)
                        let i = row + x
                        if len > 1e-6 {
                            n /= len
                            nxOut[i] = n.x
                            nyOut[i] = n.y
                        } else {
                            nxOut[i] = 0
                            nyOut[i] = -1
                        }
                        x += 1
                    }
                    y += 1
                }
            }
        }
    }
}

// MARK: - APP sampling stand-in (tests / reference only)

/// Generates a SetupArc-**class** closed polyline from the same animatable
/// parameters APP drives (`top`/`depth`/`contactX`/`bend` + viewport).
/// This is **not** a shipping Worldbend Shape and must not replace APP
/// `SetupArc` / `CeilingArcGeometry`. APP should sample its own `path(in:)`
/// into ``WorldbendOutlineContour/polyline`` each dynamics change; this helper
/// exists so package tests can prove rebake under real parameter motion
/// without editing the APP index.
public enum WorldbendOutlineSetupArcSamplingStandIn {
    public enum ContourKind: String, Sendable {
        case rounded, straight, folded
    }

    public static func polyline(
        viewport: CGSize,
        top: CGFloat,
        depth: CGFloat = 32,
        contactX: CGFloat = 0.5,
        bend: CGFloat = 0,
        contour: ContourKind = .rounded,
        segments: Int = 96
    ) -> [CGPoint] {
        let width = max(0, viewport.width)
        let rise = min(max(0, depth), width * 0.12)
        var points: [CGPoint] = []
        let steps = max(8, segments)
        if width <= 0 {
            return [
                CGPoint(x: 0, y: top),
                CGPoint(x: 0, y: viewport.height),
                CGPoint(x: 0, y: viewport.height)
            ]
        }
        for i in 0...steps {
            let x = width * CGFloat(i) / CGFloat(steps)
            let base = edgeY(at: x, width: width, rise: rise, contour: contour)
            let u = x / width
            let distance = x - min(1, max(0, contactX)) * width
            let spread = width * 0.14
            let weight = exp(-distance * distance / (2 * spread * spread))
            let envelope = sin(.pi * u)
            let y = base + bend * weight * envelope
            points.append(CGPoint(x: x, y: top + y))
        }
        // Close like SetupArc filled body: down past bottom then left.
        points.append(CGPoint(x: width, y: viewport.height + 200))
        points.append(CGPoint(x: 0, y: viewport.height + 200))
        points.append(points[0])
        return points
    }

    public static func contour(
        viewport: CGSize,
        top: CGFloat,
        depth: CGFloat,
        contactX: CGFloat,
        bend: CGFloat,
        contourKind: ContourKind = .rounded,
        revision: UInt64,
        segments: Int = 96,
        fieldSpace: WorldbendOutlineFieldSpace = .paneLocal,
        origin: CGPoint = .zero
    ) -> WorldbendOutlineContour {
        let poly = polyline(
            viewport: viewport, top: top, depth: depth,
            contactX: contactX, bend: bend, contour: contourKind, segments: segments
        )
        let dynamics = WorldbendOutlineDynamics(
            top: Double(top),
            depth: Double(depth),
            contactX: Double(contactX),
            bend: Double(bend),
            viewportWidth: Double(viewport.width),
            viewportHeight: Double(viewport.height),
            contourKind: contourKind.rawValue,
            contourRevision: revision
        )
        return WorldbendOutlineContour(
            logicalSize: viewport,
            origin: origin,
            polyline: poly,
            dynamics: dynamics,
            closesImplicitly: true,
            fieldSpace: fieldSpace
        )
    }

    private static func edgeY(at x: CGFloat, width: CGFloat, rise: CGFloat, contour: ContourKind) -> CGFloat {
        guard width > 0, rise > 0 else { return 0 }
        let x = min(width, max(0, x))
        switch contour {
        case .straight: return 0
        case .folded: return rise * abs(x / width - 0.38) / 0.62
        case .rounded:
            let distance = min(x, width - x)
            return distance < rise ? rise * pow(1 - distance / rise, 3) : 0
        }
    }
}
