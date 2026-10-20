import CoreGraphics
import Foundation
import Metal
import Testing
@testable import WorldbendAppearance

@Suite("Outline glass — dynamic SetupArc normals")
@MainActor
struct OutlineGlassTests {

    private let viewport = CGSize(width: 390, height: 844)

    @Test func profileRejectsRoundedGlassId() {
        let bad = OutlineOpticalGlassConfiguration(
            profile: "worldbend.rounded-glass-metal@0.1",
            edgeWidth: 14,
            refractionScale: 4,
            chromaticOffset: 1,
            frostRadius: 0,
            lightDirection: [0, -1],
            highlightStrength: 0.2
        )
        #expect(throws: WorldbendOutlineError.self) { try bad.validate() }
    }

    @Test func opticsValidateCanonicalProfile() throws {
        let optics = OutlineOpticalGlassConfiguration(
            edgeWidth: 14,
            refractionScale: 4,
            chromaticOffset: 1.2,
            frostRadius: 2,
            lightDirection: [0.6, -0.8],
            highlightStrength: 0.18
        )
        try optics.validate()
        #expect(optics.profile == worldbendOutlineGlassMetalProfile)
        #expect(optics.backdrop == "explicit-swiftui-layer")
    }

    @Test func dynamicsRejectInvalidViewportButAllowContactOvershoot() throws {
        // contactX may leave [0,1] during SetupArc animatable interpolation.
        try WorldbendOutlineDynamics(
            top: 120, depth: 32, contactX: 1.5, bend: 0,
            viewportWidth: 390, viewportHeight: 844, contourRevision: 1
        ).validate()
        try WorldbendOutlineDynamics(
            top: 120, depth: 32, contactX: -0.2, bend: 0,
            viewportWidth: 390, viewportHeight: 844, contourRevision: 2
        ).validate()
        #expect(throws: WorldbendOutlineError.self) {
            try WorldbendOutlineDynamics(
                top: 120, depth: 32, contactX: 0.5, bend: 0,
                viewportWidth: 0, viewportHeight: 844, contourRevision: 1
            ).validate()
        }
        #expect(throws: WorldbendOutlineError.self) {
            try WorldbendOutlineDynamics(
                top: .nan, depth: 32, contactX: 0.5, bend: 0,
                viewportWidth: 390, viewportHeight: 844, contourRevision: 1
            ).validate()
        }
    }

    @Test func fieldTextureUVMatchesBakeCentersWithoutHalfTexelBias() throws {
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: CGSize(width: 120, height: 160),
            top: 40, depth: 16, contactX: 0.5, bend: 0,
            revision: 1, segments: 24
        )
        let cell: CGFloat = 4
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: cell)
        // Texel (0,0) authored at field.origin + (0.5*cell, 0.5*cell) after
        // coverage expansion (pad / protruding SetupArc close).
        let firstCenter = CGPoint(
            x: field.origin.x + 0.5 * field.cellSize,
            y: field.origin.y + 0.5 * field.cellSize
        )
        let uv00 = WorldbendOutlineFieldBaker.fieldTextureUV(
            logical: firstCenter,
            origin: field.origin,
            cellSize: field.cellSize,
            texelWidth: field.width,
            texelHeight: field.height
        )
        #expect(abs(uv00.x - Float(0.5 / Double(field.width))) < 1e-5)
        #expect(abs(uv00.y - Float(0.5 / Double(field.height))) < 1e-5)
        // A naive (texel+0.5)/size after dividing by cell would land on 1.5/size.
        let biased = Float((0.5 + 0.5) / Double(field.width))
        #expect(abs(uv00.x - biased) > 1e-5)
        // Last texel center maps just under 1.
        let last = CGPoint(
            x: field.origin.x + (CGFloat(field.width) - 0.5) * field.cellSize,
            y: field.origin.y + (CGFloat(field.height) - 0.5) * field.cellSize
        )
        let uvLast = WorldbendOutlineFieldBaker.fieldTextureUV(
            logical: last,
            origin: field.origin,
            cellSize: field.cellSize,
            texelWidth: field.width,
            texelHeight: field.height
        )
        #expect(abs(uvLast.x - Float((Double(field.width) - 0.5) / Double(field.width))) < 1e-5)
        #expect(uvLast.x < 1)
        #expect(uvLast.y < 1)
    }

    @Test func bakeMarksInteriorNegativeAndProducesUnitNormals() throws {
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 160, depth: 32, contactX: 0.5, bend: 0,
            revision: 1, segments: 48
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        try field.validate()
        #expect(field.profile == worldbendOutlineGlassMetalProfile)
        // Center of filled body should be inside (negative distance).
        let mid = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: viewport.width / 2, y: (160 + viewport.height) / 2)
        )
        #expect(mid.distance < 0)
        let nLen = (mid.normal.x * mid.normal.x + mid.normal.y * mid.normal.y).squareRoot()
        #expect(abs(nLen - 1) < 0.05)
        // Above the arc shoulder should be outside.
        let above = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: viewport.width / 2, y: 20)
        )
        #expect(above.distance > 0)
    }

    @Test func topDepthContactBendAndViewportForceRebake() throws {
        var revision: UInt64 = 1
        func make(
            top: CGFloat = 160,
            depth: CGFloat = 32,
            contactX: CGFloat = 0.5,
            bend: CGFloat = 0,
            size: CGSize = CGSize(width: 390, height: 844)
        ) -> WorldbendOutlineContour {
            defer { revision += 1 }
            return WorldbendOutlineSetupArcSamplingStandIn.contour(
                viewport: size, top: top, depth: depth,
                contactX: contactX, bend: bend, revision: revision, segments: 40
            )
        }

        let base = make()
        let field = try WorldbendOutlineFieldBaker.bake(contour: base, cellSize: 6)
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: base) == false)

        let movedTop = make(top: 220)
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: movedTop))
        let topField = try WorldbendOutlineFieldBaker.bake(contour: movedTop, cellSize: 6)
        #expect(topField.dynamicsFingerprint != field.dynamicsFingerprint)
        #expect(topField.sampleFingerprint != field.sampleFingerprint)

        let deeper = make(depth: 48)
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: deeper))
        let deepField = try WorldbendOutlineFieldBaker.bake(contour: deeper, cellSize: 6)
        // Shoulder sample near left edge moves with depth.
        let nearShoulder = CGPoint(x: 12, y: 160 + 8)
        let baseD = WorldbendOutlineFieldBaker.sample(field, at: nearShoulder).distance
        let deepD = WorldbendOutlineFieldBaker.sample(deepField, at: nearShoulder).distance
        #expect(abs(baseD - deepD) > 0.2)

        let slid = make(contactX: 0.2, bend: 28)
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: slid))
        let bendField = try WorldbendOutlineFieldBaker.bake(contour: slid, cellSize: 6)
        let touchX = viewport.width * 0.2
        let bendSample = WorldbendOutlineFieldBaker.sample(
            bendField, at: CGPoint(x: touchX, y: 160 + 10)
        )
        let flatSample = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: touchX, y: 160 + 10)
        )
        #expect(abs(bendSample.distance - flatSample.distance) > 0.5
                || abs(bendSample.normal.x - flatSample.normal.x) > 0.05)

        let resized = make(size: CGSize(width: 430, height: 900))
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: resized))
        let resizedField = try WorldbendOutlineFieldBaker.bake(contour: resized, cellSize: 6)
        #expect(resizedField.logicalSize.width == 430)
        #expect(resizedField.width != field.width || resizedField.height != field.height
                || resizedField.dynamicsFingerprint != field.dynamicsFingerprint)
    }

    @Test func contourRejectsViewportMismatch() {
        let dynamics = WorldbendOutlineDynamics(
            top: 100, depth: 24, contactX: 0.4, bend: 8,
            viewportWidth: 390, viewportHeight: 844, contourRevision: 3
        )
        let bad = WorldbendOutlineContour(
            logicalSize: CGSize(width: 200, height: 400),
            polyline: [
                CGPoint(x: 0, y: 0), CGPoint(x: 200, y: 0),
                CGPoint(x: 200, y: 400), CGPoint(x: 0, y: 400)
            ],
            dynamics: dynamics
        )
        #expect(throws: WorldbendOutlineError.self) { try bad.validate() }
    }

    @Test func edgeLightRespondsToNormalAlignment() {
        let n = SIMD2<Float>(0, -1)
        let toward = WorldbendOutlineFieldBaker.edgeLightResponse(
            normal: n, lightDirection: SIMD2(0, -1), rim: 1, highlightStrength: 0.3
        )
        let away = WorldbendOutlineFieldBaker.edgeLightResponse(
            normal: n, lightDirection: SIMD2(0, 1), rim: 1, highlightStrength: 0.3
        )
        #expect(toward > away)
        #expect(toward > 0)
    }

    @Test func fieldTextureUploadsWhenMetalAvailable() throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            return // Simulator / CI without Metal: skip GPU upload evidence.
        }
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: CGSize(width: 120, height: 160),
            top: 40, depth: 16, contactX: 0.5, bend: 4,
            revision: 9, segments: 24
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        let texture = try WorldbendOutlineFieldTexture(device: device, field: field)
        #expect(texture.texture != nil)
        #expect(texture.texture?.width == field.width)
        #expect(texture.texture?.height == field.height)
        // Dynamics change → rebake → update keeps texture alive.
        let next = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: CGSize(width: 120, height: 160),
            top: 48, depth: 20, contactX: 0.35, bend: 12,
            revision: 10, segments: 24
        )
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: next))
        let nextField = try WorldbendOutlineFieldBaker.bake(contour: next, cellSize: 4)
        try texture.update(nextField)
        #expect(texture.field.dynamicsFingerprint == nextField.dynamicsFingerprint)
    }

    @Test func outlineRendererStatusDisclosesMissingMetallib() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { return }
        let renderer = WorldbendOutlineMetalRenderer(device: device)
        // Plain `swift test` typically has no default.metallib — status must
        // disclose that rather than pretending ready.
        if WorldbendOutlineGlassRuntime.hasCompiledShader {
            #expect(renderer.status == .ready || renderer.status == .pipelineFailure)
        } else {
            #expect(renderer.status == .missingMetallib || renderer.status == .pipelineFailure)
            #expect(renderer.isReady == false)
        }
    }

    @Test func standInPolylineTracksContactAndBend() {
        let flat = WorldbendOutlineSetupArcSamplingStandIn.polyline(
            viewport: viewport, top: 100, depth: 32, contactX: 0.5, bend: 0
        )
        let bent = WorldbendOutlineSetupArcSamplingStandIn.polyline(
            viewport: viewport, top: 100, depth: 32, contactX: 0.25, bend: 40
        )
        #expect(flat.count == bent.count)
        // Near contactX=0.25 the bent arc must diverge from the flat shoulder.
        let idx = Int(0.25 * Double(flat.count - 4))
        #expect(abs(bent[idx].y - flat[idx].y) > 1)
    }

    @Test func resolvedGridCoversLargeViewportWithoutAxisClip() throws {
        let logical = CGSize(width: 3000, height: 4000)
        let grid = try WorldbendOutlineFieldBaker.resolvedGrid(
            logicalSize: logical,
            requestedCellSize: 2
        )
        #expect(grid.width <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
        #expect(grid.height <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
        #expect(grid.texelCount <= WorldbendOutlineFieldBaker.maxTotalTexels)
        #expect(grid.cellSize > 2) // must grow rather than truncate
        #expect(CGFloat(grid.width) * grid.cellSize >= logical.width - 1e-3)
        #expect(CGFloat(grid.height) * grid.cellSize >= logical.height - 1e-3)

        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: logical, top: 200, depth: 40, contactX: 0.4, bend: 12,
            revision: 77, segments: 64
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 2)
        // Bake expands coverage for SetupArc height+200 close — field grid may
        // be larger/coarser than viewport-only resolvedGrid, but must still
        // cover the authored viewport without dropping right/bottom.
        #expect(field.width <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
        #expect(field.height <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
        #expect(field.texelCount <= WorldbendOutlineFieldBaker.maxTotalTexels)
        #expect(abs(field.logicalSize.width - logical.width) < 0.01)
        #expect(abs(field.logicalSize.height - logical.height) < 0.01)
        let coverageMaxX = field.origin.x + CGFloat(field.width) * field.cellSize
        let coverageMaxY = field.origin.y + CGFloat(field.height) * field.cellSize
        #expect(coverageMaxX >= logical.width - 1e-3)
        #expect(coverageMaxY >= logical.height - 1e-3)
        // Bottom-right logical extent still samples (not dropped by axis truncation).
        let corner = WorldbendOutlineFieldBaker.sample(
            field,
            at: CGPoint(x: logical.width - 1, y: logical.height - 1)
        )
        #expect(corner.distance.isFinite)
        #expect(corner.normal.x.isFinite && corner.normal.y.isFinite)
        // Clear interior of the filled body (away from the arc shoulder).
        let mid = WorldbendOutlineFieldBaker.sample(
            field,
            at: CGPoint(x: logical.width * 0.5, y: (200 + logical.height) * 0.5)
        )
        #expect(mid.distance < 0)
    }

    @Test func resolvedGridRejectsNonFiniteAndHostileHugeExtentsSafely() {
        #expect(throws: WorldbendOutlineError.self) {
            try WorldbendOutlineFieldBaker.resolvedGrid(
                logicalSize: CGSize(width: CGFloat.infinity, height: 100)
            )
        }
        #expect(throws: WorldbendOutlineError.self) {
            try WorldbendOutlineFieldBaker.resolvedGrid(
                logicalSize: CGSize(width: CGFloat.nan, height: 100)
            )
        }
        // Finite but huge: must not trap on Double→Int; either fit via cell growth
        // or throw bakeFailed — never crash.
        let huge = CGSize(width: 1e9, height: 1e9)
        do {
            let grid = try WorldbendOutlineFieldBaker.resolvedGrid(logicalSize: huge)
            #expect(grid.width <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
            #expect(grid.height <= WorldbendOutlineFieldBaker.maxTexelsPerAxis)
            #expect(grid.texelCount <= WorldbendOutlineFieldBaker.maxTotalTexels)
            #expect(grid.cellSize.isFinite && grid.cellSize > 0)
        } catch let error as WorldbendOutlineError {
            #expect(error == .bakeFailed || error == .invalidGeometry)
        } catch {
            Issue.record("Unexpected error \(error)")
        }
    }

    @Test func bakeSetupArcClassStaysWithinSustainableCostEnvelope() throws {
        // Evidence (not a Debug-host acceptance bar): DT/scanline path should stay
        // far below naive W·H·N tens-of-millions ops. Structural budget:
        // texelCount≤maxTotal and segments≪texels so O(N·H+W·H) ≪ O(W·H·N).
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 160, depth: 32, contactX: 0.35, bend: 18,
            revision: 3, segments: 96
        )
        let started = ContinuousClock.now
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 2)
        let elapsed = ContinuousClock.now - started
        #expect(field.texelCount <= WorldbendOutlineFieldBaker.maxTotalTexels)
        #expect(field.width * field.height == field.texelCount)
        // Local Apple Silicon review gate — generous vs Debug rain host load.
        #expect(elapsed < .milliseconds(250))
        // Rebake under drag-like dynamics must also stay bounded.
        let moved = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 180, depth: 40, contactX: 0.55, bend: 24,
            revision: 4, segments: 96
        )
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: moved))
        let started2 = ContinuousClock.now
        _ = try WorldbendOutlineFieldBaker.bake(contour: moved, cellSize: 2)
        #expect(ContinuousClock.now - started2 < .milliseconds(250))
    }

    @Test func paneLocalTranslationDoesNotRequireRebakeButSizeDoes() throws {
        // Shape.path is pane-local. Moving the pane (scene origin) must NOT
        // force rebake when the pane-local polyline / size / dynamics match.
        let paneSize = CGSize(width: 200, height: 120)
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: paneSize, top: 24, depth: 16, contactX: 0.45, bend: 6,
            revision: 1, segments: 32, fieldSpace: .paneLocal
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        #expect(field.fieldSpace == .paneLocal)

        // Same pane-local contour after a "move" — APP keeps polyline in path space.
        let afterMove = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: paneSize, top: 24, depth: 16, contactX: 0.45, bend: 6,
            revision: 1, segments: 32, fieldSpace: .paneLocal
        )
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: afterMove) == false)

        // Scene-space helper: translating paneFrame keeps field sample UV stable.
        let paneA = CGRect(x: 40, y: 80, width: paneSize.width, height: paneSize.height)
        let paneB = CGRect(x: 120, y: 160, width: paneSize.width, height: paneSize.height)
        let scenePointOnA = CGPoint(x: paneA.minX + 30, y: paneA.minY + 50)
        let scenePointOnB = CGPoint(x: paneB.minX + 30, y: paneB.minY + 50)
        let localA = WorldbendOutlineFieldBaker.fieldSamplePoint(
            sceneLogical: scenePointOnA, paneFrame: paneA, fieldSpace: .paneLocal
        )
        let localB = WorldbendOutlineFieldBaker.fieldSamplePoint(
            sceneLogical: scenePointOnB, paneFrame: paneB, fieldSpace: .paneLocal
        )
        #expect(abs(localA.x - localB.x) < 1e-9)
        #expect(abs(localA.y - localB.y) < 1e-9)
        #expect(abs(localA.x - 30) < 1e-9)
        #expect(abs(localA.y - 50) < 1e-9)

        // Size / shape change still rebakes.
        let resized = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: CGSize(width: 220, height: 140),
            top: 24, depth: 16, contactX: 0.45, bend: 6,
            revision: 2, segments: 32, fieldSpace: .paneLocal
        )
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: resized))
        let reshaped = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: paneSize, top: 24, depth: 28, contactX: 0.2, bend: 18,
            revision: 3, segments: 32, fieldSpace: .paneLocal
        )
        #expect(WorldbendOutlineFieldBaker.needsRebake(previous: field, contour: reshaped))
    }

    @Test func nonZeroPaneOriginPaneLocalSamplesAlign() throws {
        // Full-screen origin examples must not hide misalignment: field is
        // pane-local while the pane sits at a non-zero scene origin.
        let paneSize = CGSize(width: 180, height: 100)
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: paneSize, top: 20, depth: 14, contactX: 0.5, bend: 0,
            revision: 5, segments: 28, fieldSpace: .paneLocal
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        let paneFrame = CGRect(x: 96, y: 140, width: paneSize.width, height: paneSize.height)

        // Interior point in pane-local space.
        let paneLocal = CGPoint(x: paneSize.width * 0.5, y: (20 + paneSize.height) * 0.5)
        let sceneLogical = CGPoint(x: paneFrame.minX + paneLocal.x, y: paneFrame.minY + paneLocal.y)
        let mapped = WorldbendOutlineFieldBaker.fieldSamplePoint(
            sceneLogical: sceneLogical, paneFrame: paneFrame, fieldSpace: .paneLocal
        )
        #expect(abs(mapped.x - paneLocal.x) < 1e-9)
        #expect(abs(mapped.y - paneLocal.y) < 1e-9)

        let direct = WorldbendOutlineFieldBaker.sample(field, at: paneLocal)
        let viaMapped = WorldbendOutlineFieldBaker.sample(field, at: mapped)
        #expect(abs(direct.distance - viaMapped.distance) < 1e-5)
        #expect(direct.distance < 0)

        // Scene mode would treat sceneLogical as field coords and miss the interior.
        let sceneMapped = WorldbendOutlineFieldBaker.fieldSamplePoint(
            sceneLogical: sceneLogical, paneFrame: paneFrame, fieldSpace: .scene
        )
        #expect(abs(sceneMapped.x - sceneLogical.x) < 1e-9)
        let wrongSpace = WorldbendOutlineFieldBaker.sample(field, at: sceneMapped)
        // sceneMapped is far outside the pane-local field coverage → exterior.
        #expect(wrongSpace.distance > 0 || abs(wrongSpace.distance - direct.distance) > 1)
    }

    @Test func protrudingSetupArcDoesNotCreateFalseBottomEdge() throws {
        // Stand-in closes at height+200 (mirrors SetupArc). Viewport-clipped
        // chamfer previously treated the grid rim as exterior → false bottom
        // edge light. Expanded coverage must keep viewport bottom deeply inside.
        let size = CGSize(width: 200, height: 160)
        let top: CGFloat = 40
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: size, top: top, depth: 20, contactX: 0.5, bend: 0,
            revision: 8, segments: 48, fieldSpace: .paneLocal
        )
        // Prove the polyline actually protrudes past the viewport.
        let maxY = contour.polyline.map(\.y).max() ?? 0
        #expect(maxY >= size.height + 150)

        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        // Coverage must extend past the viewport bottom (pad + close y).
        let coverageHeight = CGFloat(field.height) * field.cellSize
        #expect(coverageHeight + abs(field.origin.y) > size.height + 100)

        let nearBottom = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: size.width * 0.5, y: size.height - 2)
        )
        // Deep interior — not a ~0 false boundary at the viewport rim.
        #expect(nearBottom.distance < -8)

        // True exterior below the closed contour.
        let belowClose = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: size.width * 0.5, y: size.height + 200 + 12)
        )
        #expect(belowClose.distance > 0)

        // Above the arc shoulder still exterior.
        let above = WorldbendOutlineFieldBaker.sample(
            field, at: CGPoint(x: size.width * 0.5, y: 8)
        )
        #expect(above.distance > 0)
    }

    @Test func sceneFieldSpaceStillAvailableForExplicitGlobalPolylines() throws {
        let size = CGSize(width: 120, height: 80)
        let sceneOrigin = CGPoint(x: 50, y: 60)
        // Author polyline already in scene space (path + origin).
        let local = WorldbendOutlineSetupArcSamplingStandIn.polyline(
            viewport: size, top: 16, depth: 12, contactX: 0.5, bend: 0, segments: 24
        )
        let scenePoly = local.map { CGPoint(x: $0.x + sceneOrigin.x, y: $0.y + sceneOrigin.y) }
        let dynamics = WorldbendOutlineDynamics(
            top: 16, depth: 12, contactX: 0.5, bend: 0,
            viewportWidth: Double(size.width), viewportHeight: Double(size.height),
            contourRevision: 9
        )
        let contour = WorldbendOutlineContour(
            logicalSize: size,
            origin: sceneOrigin,
            polyline: scenePoly,
            dynamics: dynamics,
            fieldSpace: .scene
        )
        let field = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 4)
        #expect(field.fieldSpace == .scene)
        let interior = WorldbendOutlineFieldBaker.sample(
            field,
            at: CGPoint(x: sceneOrigin.x + size.width * 0.5, y: sceneOrigin.y + (16 + size.height) * 0.5)
        )
        #expect(interior.distance < 0)
    }

    @Test func roundedCornerSubpixelMoveDistanceIsContinuousAtDefaultCell() throws {
        // APP FloatingTaskShape evidence: 2pt binary chamfer seeds stair-step
        // curved highlights (~6px @3x). Exact segment refine must keep distance
        // continuous under ≤0.25pt moves without raising full-viewport density.
        let size = CGSize(width: 180, height: 100)
        // Rounded-rect polyline (panel class), 8pts/corner ≈ APP ≤0.25pt sampling.
        let polyline = Self.roundedRectPolyline(
            in: CGRect(x: 12, y: 16, width: 156, height: 68),
            cornerRadius: 18,
            samplesPerCorner: 12
        )
        let dynamics = WorldbendOutlineDynamics(
            top: 16, depth: 18, contactX: 0.5, bend: 0,
            viewportWidth: Double(size.width), viewportHeight: Double(size.height),
            contourKind: "floating-task-panel",
            contourRevision: 1
        )
        let contour = WorldbendOutlineContour(
            logicalSize: size, polyline: polyline, dynamics: dynamics
        )
        let baked = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, cellSize: WorldbendOutlineFieldBaker.defaultCellSize
        )
        #expect(baked.field.cellSize == WorldbendOutlineFieldBaker.defaultCellSize)
        #expect(baked.diagnostics.refinedTexels > 0)
        #expect(baked.diagnostics.refinedTexels < baked.diagnostics.texelCount)
        #expect(
            baked.diagnostics.segmentDistanceQueries
                <= baked.diagnostics.refinedTexels * max(baked.diagnostics.segmentCount, 1)
        )
        #expect(baked.diagnostics.segmentDistanceQueries <= WorldbendOutlineFieldBaker.maxRefineQueries)

        // Walk 0.25pt steps diagonally across the top-left rounded shoulder.
        let start = CGPoint(x: 12 + 18 * 0.3, y: 16 + 18 * 0.3)
        var previous = WorldbendOutlineFieldBaker.sample(baked.field, at: start).distance
        var maxJump: Float = 0
        for step in 1...48 {
            let t = CGFloat(step) * 0.25
            let point = CGPoint(x: start.x + t * 0.7, y: start.y + t * 0.7)
            let distance = WorldbendOutlineFieldBaker.sample(baked.field, at: point).distance
            maxJump = max(maxJump, abs(distance - previous))
            previous = distance
        }
        // Bilinear of exact centers: step ≈0.25pt along path; jumps must stay
        // well below binary-seed cell quantization (~2pt).
        #expect(maxJump < 0.85)

        // Pure-chamfer (refineBand=0) shows the defect class: larger jumps.
        let coarse = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, cellSize: WorldbendOutlineFieldBaker.defaultCellSize,
            refineBandCells: 0.0001
        )
        var coarsePrev = WorldbendOutlineFieldBaker.sample(coarse.field, at: start).distance
        var coarseJump: Float = 0
        for step in 1...48 {
            let t = CGFloat(step) * 0.25
            let point = CGPoint(x: start.x + t * 0.7, y: start.y + t * 0.7)
            let distance = WorldbendOutlineFieldBaker.sample(coarse.field, at: point).distance
            coarseJump = max(coarseJump, abs(distance - coarsePrev))
            coarsePrev = distance
        }
        #expect(maxJump <= coarseJump + 0.05)
        #expect(maxJump < 1.0)
    }

    @Test func diagonalSetupArcSubpixelContinuityAndBoundedRefineCost() throws {
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 160, depth: 32, contactX: 0.4, bend: 12,
            revision: 11, segments: 96
        )
        let started = ContinuousClock.now
        let baked = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, cellSize: 2
        )
        let elapsed = ContinuousClock.now - started
        #expect(elapsed < .milliseconds(250))
        #expect(baked.field.cellSize == 2)
        // Band refine must not scan the full viewport × N (that was the r0 cost).
        #expect(baked.diagnostics.refinedTexels * 2 < baked.diagnostics.texelCount)
        #expect(baked.diagnostics.segmentDistanceQueries < 2_000_000)
        let denseQueries = baked.diagnostics.refinedTexels * baked.diagnostics.segmentCount
        #expect(baked.diagnostics.segmentDistanceQueries <= denseQueries)
        // Spatial segment index must cull well below brute-force band×N (not merely ≤).
        #expect(baked.diagnostics.segmentDistanceQueries * 4 <= denseQueries)


        // Diagonal move near left rounded shoulder (SetupArc rise region).
        let start = CGPoint(x: 10, y: 160 + 10)
        var previous = WorldbendOutlineFieldBaker.sample(baked.field, at: start).distance
        var maxJump: Float = 0
        for step in 1...32 {
            let t = CGFloat(step) * 0.25
            let point = CGPoint(x: start.x + t, y: start.y + t * 0.35)
            let distance = WorldbendOutlineFieldBaker.sample(baked.field, at: point).distance
            maxJump = max(maxJump, abs(distance - previous))
            previous = distance
        }
        #expect(maxJump < 0.9)

        // Drag-like rebake stays in the same cost envelope.
        let moved = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 172, depth: 36, contactX: 0.55, bend: 20,
            revision: 12, segments: 96
        )
        let started2 = ContinuousClock.now
        let rebaked = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: moved, cellSize: 2
        )
        #expect(ContinuousClock.now - started2 < .milliseconds(250))
        #expect(rebaked.diagnostics.segmentDistanceQueries < 2_000_000)
    }

    @Test func overBudgetRefineFailsEarlyWithoutCompletingExactWork() throws {
        // Hostile case: whole-field refine band × dense polyline. Preflight /
        // in-loop must fail BEFORE finishing the exact-segment pass (r5 only
        // checked after the full pass completed).
        let viewport = CGSize(width: 390, height: 844)
        let contour = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 160, depth: 40, contactX: 0.45, bend: 18,
            revision: 99, segments: 96
        )
        // Baseline with an explicit high cap so we can observe the true query
        // count (whole-field × 96 segs can exceed the production 5M ceiling).
        let highLimit = 50_000_000
        let fullStarted = ContinuousClock.now
        let full = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour,
            cellSize: 2,
            refineBandCells: 10_000,
            maxRefineQueries: highLimit
        )
        let fullElapsed = ContinuousClock.now - fullStarted
        let fullQueries = full.diagnostics.segmentDistanceQueries
        #expect(fullQueries > 50_000)
        #expect(full.diagnostics.refinedTexels > 0)

        let tightLimit = max(fullQueries / 4, 1_000)
        #expect(tightLimit < fullQueries)

        let started = ContinuousClock.now
        var thrown: WorldbendOutlineError?
        do {
            _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour,
                cellSize: 2,
                refineBandCells: 10_000,
                maxRefineQueries: tightLimit
            )
        } catch let error as WorldbendOutlineError {
            thrown = error
        }
        let elapsed = ContinuousClock.now - started
        guard case let .refineBudgetExceeded(estimated, limit)? = thrown else {
            Issue.record("expected refineBudgetExceeded, got \(String(describing: thrown))")
            return
        }
        #expect(limit == tightLimit)
        #expect(estimated > tightLimit)
        // Early fail must not pay the full exact-segment bill. Chamfer + band
        // counting only; allow headroom but stay well under the successful
        // full-refine duration when that path is measurably slower.
        #expect(elapsed < .milliseconds(250))
        if fullElapsed > .milliseconds(80) {
            #expect(elapsed < fullElapsed)
        }

        // Tiny limit: preflight refuses before any segment×texel exact work.
        let startedTiny = ContinuousClock.now
        var tinyThrown: WorldbendOutlineError?
        do {
            _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour,
                cellSize: 2,
                refineBandCells: 10_000,
                maxRefineQueries: 1
            )
        } catch let error as WorldbendOutlineError {
            tinyThrown = error
        }
        let tinyElapsed = ContinuousClock.now - startedTiny
        guard case .refineBudgetExceeded(_, let tinyLimit)? = tinyThrown else {
            Issue.record("expected refineBudgetExceeded for limit=1")
            return
        }
        #expect(tinyLimit == 1)
        #expect(tinyElapsed < .milliseconds(250))
        if fullElapsed > .milliseconds(80) {
            #expect(tinyElapsed < fullElapsed)
        }
    }

    /// Rounded-rect stand-in for FloatingTaskShape panel corners (tests only).
    @Test func frostSamplingBudgetIsBoundedAndDocumentsLegacyCutoff() {
        #expect(WorldbendFrostSamplingBudget.legacyMaxPoints == 2)
        #expect(WorldbendFrostSamplingBudget.largeGaussianTapsPerCall == 49)
        #expect(WorldbendFrostSamplingBudget.mipResidualTapsPerCall == 49)
        #expect(WorldbendFrostSamplingBudget.worstCaseTapsPerFragment == 147)
        #expect(WorldbendFrostSamplingBudget.legacyWorstCaseTapsPerFragment == 27)
        #expect(WorldbendFrostSamplingBudget.pyramidTexelCostFactor == 4.0 / 3.0)
        #expect(WorldbendFrostSamplingBudget.lodHeadroom == 1.5)
        // 1.2pt buttons stay on legacy path; 12–40pt menus use mip+Gaussian.
        #expect(1.2 <= WorldbendFrostSamplingBudget.legacyMaxPoints)
        #expect(12 > WorldbendFrostSamplingBudget.legacyMaxPoints)
        #expect(18 > WorldbendFrostSamplingBudget.legacyMaxPoints)
        #expect(40 > WorldbendFrostSamplingBudget.legacyMaxPoints)
    }

    @Test func frostPyramidLodScalesWithPointsAndContentResolution() {
        // 14pt / 400pt @1x → σ_texels=14 → log2≈3.81 → headroom 1.5 → ≈2.31
        let lod = WorldbendFrostPyramid.lod(
            frostRadiusPoints: 14,
            contentSizePoints: SIMD2(400, 400),
            sourceSizeTexels: SIMD2(400, 400)
        )
        #expect(lod > 2.0 && lod < 2.7)
        #expect(WorldbendFrostPyramid.lodHeadroom == 1.5)
        let lod2x = WorldbendFrostPyramid.lod(
            frostRadiusPoints: 14,
            contentSizePoints: SIMD2(400, 400),
            sourceSizeTexels: SIMD2(800, 800)
        )
        #expect(lod2x > lod) // denser texels → higher LOD for same point radius
        let tiny = WorldbendFrostPyramid.lod(
            frostRadiusPoints: 1.2,
            contentSizePoints: SIMD2(400, 400),
            sourceSizeTexels: SIMD2(400, 400)
        )
        #expect(tiny < 0.5) // log2(1.2)-2 clamped near 0
        // 28pt / 40pt keep headroom vs raw log2(σ).
        let lod28 = WorldbendFrostPyramid.lod(
            frostRadiusPoints: 28,
            contentSizePoints: SIMD2(400, 400),
            sourceSizeTexels: SIMD2(400, 400)
        )
        let lod40 = WorldbendFrostPyramid.lod(
            frostRadiusPoints: 40,
            contentSizePoints: SIMD2(400, 400),
            sourceSizeTexels: SIMD2(400, 400)
        )
        #expect(lod28 > lod && lod40 > lod28)
        #expect(lod40 < log2(40.0) - 1.0) // headroom kept
    }

    /// Two same-size different-color frames: consecutive revisions must refresh
    /// mip pixels (no freeze on first-frame cache).
    @Test func frostPyramidRefreshesPixelsOnConsecutiveRevisions() throws {
        let device = try #require(MTLCreateSystemDefaultDevice())
        let queue = try #require(device.makeCommandQueue())
        let cache = WorldbendFrostPyramidCache(queue: queue)

        let red = try Self.makeSolidBGRATexture(device: device, width: 32, height: 32, bgra: (0, 0, 255, 255))
        let blue = try Self.makeSolidBGRATexture(device: device, width: 32, height: 32, bgra: (255, 0, 0, 255))

        let buf1 = try #require(queue.makeCommandBuffer())
        let pyramid1 = cache.sampleTexture(
            device: device, source: red, frameRevision: 1, commandBuffer: buf1
        )
        #expect(pyramid1.mipmapLevelCount > 1)
        #expect(cache.hasEncodedPyramid)
        // Staging readback encoded after mip gen in the same buffer.
        let read1 = try #require(Self.encodeReadbackBGRA(device: device, commandBuffer: buf1, from: pyramid1))
        buf1.commit()
        buf1.waitUntilCompleted() // test-only; production path never waits on MainActor
        #expect(buf1.status == .completed)
        let px1 = Self.centerPixelBGRA(read1)
        #expect(px1.r > 200 && px1.b < 40) // red → R high in BGRA layout

        let buf2 = try #require(queue.makeCommandBuffer())
        let pyramid2 = cache.sampleTexture(
            device: device, source: blue, frameRevision: 2, commandBuffer: buf2
        )
        #expect(pyramid2.mipmapLevelCount > 1)
        let read2 = try #require(Self.encodeReadbackBGRA(device: device, commandBuffer: buf2, from: pyramid2))
        buf2.commit()
        buf2.waitUntilCompleted()
        #expect(buf2.status == .completed)
        let px2 = Self.centerPixelBGRA(read2)
        #expect(px2.b > 200 && px2.r < 40) // blue → B high in BGRA layout
        #expect(px2.r != px1.r || px2.b != px1.b)
    }

    /// Same revision with a different source identity must also refresh pixels.
    @Test func frostPyramidRefreshesPixelsWhenSourceSwapsAtSameRevision() throws {
        let device = try #require(MTLCreateSystemDefaultDevice())
        let queue = try #require(device.makeCommandQueue())
        let cache = WorldbendFrostPyramidCache(queue: queue)

        let green = try Self.makeSolidBGRATexture(device: device, width: 32, height: 32, bgra: (0, 255, 0, 255))
        let magenta = try Self.makeSolidBGRATexture(device: device, width: 32, height: 32, bgra: (255, 0, 255, 255))

        let buf1 = try #require(queue.makeCommandBuffer())
        let p1 = cache.sampleTexture(
            device: device, source: green, frameRevision: 7, commandBuffer: buf1
        )
        let read1 = try #require(Self.encodeReadbackBGRA(device: device, commandBuffer: buf1, from: p1))
        buf1.commit()
        buf1.waitUntilCompleted() // test-only; production path never waits on MainActor
        #expect(buf1.status == .completed)
        let px1 = Self.centerPixelBGRA(read1)
        #expect(px1.g > 200)

        // Same revision, different source object → must rebuild, not freeze green.
        let buf2 = try #require(queue.makeCommandBuffer())
        let p2 = cache.sampleTexture(
            device: device, source: magenta, frameRevision: 7, commandBuffer: buf2
        )
        #expect(p2 !== green)
        let read2 = try #require(Self.encodeReadbackBGRA(device: device, commandBuffer: buf2, from: p2))
        buf2.commit()
        buf2.waitUntilCompleted()
        #expect(buf2.status == .completed)
        let px2 = Self.centerPixelBGRA(read2)
        #expect(px2.r > 200 && px2.b > 200 && px2.g < 40)
    }

    /// clear() must drop ready publication; a later sample with a new buffer rebuilds.
    @Test func frostPyramidClearDropsReadyPublication() throws {
        let device = try #require(MTLCreateSystemDefaultDevice())
        let queue = try #require(device.makeCommandQueue())
        let cache = WorldbendFrostPyramidCache(queue: queue)
        let source = try Self.makeSolidBGRATexture(device: device, width: 8, height: 8, bgra: (10, 20, 30, 255))
        let buffer = try #require(queue.makeCommandBuffer())
        let pyramid = cache.sampleTexture(
            device: device, source: source, frameRevision: 1, commandBuffer: buffer
        )
        #expect(pyramid.mipmapLevelCount > 1)
        #expect(cache.hasEncodedPyramid)
        buffer.commit()
        buffer.waitUntilCompleted()
        cache.clear()
        #expect(!cache.hasEncodedPyramid)
        #expect(!cache.isGPUReady)
        // Rebuild after clear must encode again (not serve a cleared ready flag).
        let buffer2 = try #require(queue.makeCommandBuffer())
        let again = cache.sampleTexture(
            device: device, source: source, frameRevision: 1, commandBuffer: buffer2
        )
        #expect(again.mipmapLevelCount > 1)
        #expect(cache.hasEncodedPyramid)
        buffer2.commit()
        buffer2.waitUntilCompleted()
        #expect(buffer2.status == .completed)
    }

    private static func makeSolidBGRATexture(
        device: any MTLDevice,
        width: Int,
        height: Int,
        bgra: (UInt8, UInt8, UInt8, UInt8)
    ) throws -> any MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false
        )
        descriptor.usage = [.shaderRead]
        descriptor.storageMode = .shared
        let texture = try #require(device.makeTexture(descriptor: descriptor))
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        for i in stride(from: 0, to: bytes.count, by: 4) {
            bytes[i] = bgra.0
            bytes[i + 1] = bgra.1
            bytes[i + 2] = bgra.2
            bytes[i + 3] = bgra.3
        }
        bytes.withUnsafeBytes { raw in
            texture.replace(
                region: MTLRegionMake2D(0, 0, width, height),
                mipmapLevel: 0,
                withBytes: raw.baseAddress!,
                bytesPerRow: width * 4
            )
        }
        return texture
    }

    /// Blit mip0 into a shared BGRA texture for CPU readback (private pyramid safe).
    private static func encodeReadbackBGRA(
        device: any MTLDevice,
        commandBuffer: any MTLCommandBuffer,
        from source: any MTLTexture
    ) -> (any MTLTexture)? {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: source.width, height: source.height, mipmapped: false
        )
        descriptor.usage = [.shaderRead]
        descriptor.storageMode = .shared
        guard let staging = device.makeTexture(descriptor: descriptor),
              let blit = commandBuffer.makeBlitCommandEncoder()
        else { return nil }
        blit.copy(
            from: source,
            sourceSlice: 0,
            sourceLevel: 0,
            sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
            sourceSize: MTLSize(width: source.width, height: source.height, depth: 1),
            to: staging,
            destinationSlice: 0,
            destinationLevel: 0,
            destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()
        return staging
    }

    private static func centerPixelBGRA(_ texture: any MTLTexture) -> (b: UInt8, g: UInt8, r: UInt8, a: UInt8) {
        var pixel = [UInt8](repeating: 0, count: 4)
        let x = texture.width / 2
        let y = texture.height / 2
        texture.getBytes(
            &pixel,
            bytesPerRow: 4,
            from: MTLRegionMake2D(x, y, 1, 1),
            mipmapLevel: 0
        )
        return (pixel[0], pixel[1], pixel[2], pixel[3])
    }

    private static func roundedRectPolyline(
        in rect: CGRect,
        cornerRadius: CGFloat,
        samplesPerCorner: Int
    ) -> [CGPoint] {
        let r = min(cornerRadius, min(rect.width, rect.height) * 0.5)
        let samples = max(4, samplesPerCorner)
        func corner(_ cx: CGFloat, _ cy: CGFloat, _ start: CGFloat, _ end: CGFloat) -> [CGPoint] {
            (0...samples).map { i in
                let t = start + (end - start) * CGFloat(i) / CGFloat(samples)
                return CGPoint(x: cx + r * cos(t), y: cy + r * sin(t))
            }
        }
        var points: [CGPoint] = []
        // Clockwise in +y-down: top edge L→R starting after TL corner.
        points += corner(rect.minX + r, rect.minY + r, .pi, .pi * 1.5) // TL
        points += corner(rect.maxX - r, rect.minY + r, .pi * 1.5, .pi * 2) // TR
        points += corner(rect.maxX - r, rect.maxY - r, 0, .pi * 0.5) // BR
        points += corner(rect.minX + r, rect.maxY - r, .pi * 0.5, .pi) // BL
        if let first = points.first { points.append(first) }
        return points
    }


    @Test func menuSizedMorphContourBakeStaysInteractiveAndCullsRefineQueries() throws {
        // APP liquid-menu: ~334×302 field union, morphSamples 128, default cell 2pt.
        // Continuity failure was Debug p95 ~251ms / 7 frames per open — spatial
        // refine must cut segment×band queries well below the dense N product
        // without widening the 250ms SetupArc gates or coarsening cells.
        let contour = Self.menuMorphContour()
        let poly = contour.polyline
        let started = ContinuousClock.now
        let baked = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, cellSize: WorldbendOutlineFieldBaker.defaultCellSize
        )
        let elapsed = ContinuousClock.now - started
        let elapsedMS = Double(elapsed.components.seconds) * 1000
            + Double(elapsed.components.attoseconds) / 1e15
        var repeatMS: [Double] = [elapsedMS]
        for _ in 0..<4 {
            let tick = ContinuousClock.now
            _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour, cellSize: WorldbendOutlineFieldBaker.defaultCellSize
            )
            let step = ContinuousClock.now - tick
            repeatMS.append(
                Double(step.components.seconds) * 1000
                    + Double(step.components.attoseconds) / 1e15
            )
        }
        let sortedMS = repeatMS.sorted()
        print("MENU_BAKE_REPEAT_MS=\(repeatMS) median=\(sortedMS[sortedMS.count / 2])")
        var distBits: UInt64 = 1469598103934665603
        var normalBits: UInt64 = 1469598103934665603
        let distances = baked.field.distances
        let normalsX = baked.field.normalsX
        let normalsY = baked.field.normalsY
        for i in 0..<distances.count {
            distBits = (distBits ^ UInt64(distances[i].bitPattern)) &* 1099511628211
            normalBits = (normalBits ^ UInt64(normalsX[i].bitPattern) ^ (UInt64(normalsY[i].bitPattern) << 1)) &* 1099511628211
        }
        print("MENU_BAKE_BITS dist=\(distBits) normal=\(normalBits) wh=\(baked.field.width)x\(baked.field.height)")
        // Fingerprint of the pre-kernel menu field on this contour (r6 must stay bit-identical).
        #expect(distBits == 2_411_285_218_994_884_096)
        #expect(normalBits == 7_610_451_798_197_929_059)
        let dense = baked.diagnostics.refinedTexels * baked.diagnostics.segmentCount
        print("MENU_BAKE_ONLY_MS=\(elapsedMS) queries=\(baked.diagnostics.segmentDistanceQueries) refined=\(baked.diagnostics.refinedTexels) segments=\(baked.diagnostics.segmentCount) dense=\(dense) cull=\(Double(baked.diagnostics.segmentDistanceQueries)/Double(max(dense,1)))")
        #expect(baked.diagnostics.segmentCount >= 120)
        #expect(baked.diagnostics.refinedTexels > 0)
        // Spatial cull must beat brute-force band×N on this closed morph contour.
        #expect(baked.diagnostics.segmentDistanceQueries < dense)
        #expect(baked.diagnostics.segmentDistanceQueries * 2 <= dense)
        // Keep the same 250ms envelope as SetupArc gates (do not widen).
        #expect(elapsed < .milliseconds(250))
        // Subpixel: band sample distance matches exact closest-segment within <0.5pt.
        let fieldData = baked.field
        var checked = 0
        let band = Float(WorldbendOutlineFieldBaker.defaultRefineBandCells * fieldData.cellSize)
        for y in stride(from: 2, to: fieldData.height - 2, by: 5) {
            for x in stride(from: 2, to: fieldData.width - 2, by: 5) {
                let d = fieldData.distances[y * fieldData.width + x]
                if abs(d) > band { continue }
                let logical = CGPoint(
                    x: fieldData.origin.x + (CGFloat(x) + 0.5) * fieldData.cellSize,
                    y: fieldData.origin.y + (CGFloat(y) + 0.5) * fieldData.cellSize
                )
                var best = CGFloat.greatestFiniteMagnitude
                for s in 0..<(poly.count - 1) {
                    let a = poly[s], b = poly[s + 1]
                    let abx = b.x - a.x, aby = b.y - a.y
                    let apx = logical.x - a.x, apy = logical.y - a.y
                    let ab2 = abx * abx + aby * aby
                    let t = ab2 < 1e-12 ? 0 : max(0, min(1, (apx * abx + apy * aby) / ab2))
                    let cx = a.x + abx * t, cy = a.y + aby * t
                    best = min(best, hypot(logical.x - cx, logical.y - cy))
                }
                #expect(abs(CGFloat(abs(d)) - best) < 0.5)
                checked += 1
                if checked >= 40 { break }
            }
            if checked >= 40 { break }
        }
        #expect(checked >= 10)
    }

    private static func menuMorphContour() -> WorldbendOutlineContour {
        let field = CGSize(width: 334, height: 302)
        let target = CGRect(x: 12, y: 60, width: 310, height: 220)
        let closed = roundedRectPolyline(
            in: target, cornerRadius: 28, samplesPerCorner: 16
        )
        let resampled = WorldbendGlassPressGeometry.resample(closed, count: 128)
        var poly = resampled
        if let first = poly.first, let last = poly.last {
            let dx = first.x - last.x, dy = first.y - last.y
            if dx * dx + dy * dy > 0.01 { poly.append(first) }
        }
        let dynamics = WorldbendOutlineDynamics(
            top: 16, depth: 18, contactX: 0.5, bend: 0,
            viewportWidth: Double(field.width), viewportHeight: Double(field.height),
            contourKind: "menu-morph",
            contourRevision: 1
        )
        return WorldbendOutlineContour(
            logicalSize: field, polyline: poly, dynamics: dynamics
        )
    }

    private static func milliseconds(since start: ContinuousClock.Instant) -> Double {
        let elapsed = ContinuousClock.now - start
        return Double(elapsed.components.seconds) * 1000
            + Double(elapsed.components.attoseconds) / 1e15
    }

    private static func fieldBits(
        _ field: WorldbendOutlineNormalField
    ) -> (dist: UInt64, normal: UInt64, mismatches: Int) {
        var distBits: UInt64 = 1469598103934665603
        var normalBits: UInt64 = 1469598103934665603
        for i in 0..<field.distances.count {
            distBits = (distBits ^ UInt64(field.distances[i].bitPattern)) &* 1099511628211
            normalBits = (normalBits ^ UInt64(field.normalsX[i].bitPattern) ^ (UInt64(field.normalsY[i].bitPattern) << 1)) &* 1099511628211
        }
        return (distBits, normalBits, field.distances.count)
    }

    private static func mismatchCount(
        _ cpu: WorldbendOutlineNormalField,
        _ gpu: WorldbendOutlineNormalField
    ) -> (count: Int, first: Int, maxAbsD: Float, maxAbsN: Float) {
        guard cpu.distances.count == gpu.distances.count else {
            return (-1, -1, .greatestFiniteMagnitude, .greatestFiniteMagnitude)
        }
        var count = 0
        var first = -1
        var maxAbsD: Float = 0
        var maxAbsN: Float = 0
        for i in 0..<cpu.distances.count {
            let dd = abs(cpu.distances[i] - gpu.distances[i])
            let dn = max(abs(cpu.normalsX[i] - gpu.normalsX[i]), abs(cpu.normalsY[i] - gpu.normalsY[i]))
            maxAbsD = max(maxAbsD, dd)
            maxAbsN = max(maxAbsN, dn)
            if cpu.distances[i].bitPattern != gpu.distances[i].bitPattern
                || cpu.normalsX[i].bitPattern != gpu.normalsX[i].bitPattern
                || cpu.normalsY[i].bitPattern != gpu.normalsY[i].bitPattern {
                if first < 0 { first = i }
                count += 1
            }
        }
        return (count, first, maxAbsD, maxAbsN)
    }

    @Test func gpuMenuFieldMatchesCPUFingerprintAndStaysInsideBudget() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { return }
        let contour = Self.menuMorphContour()
        let cpu = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(contour: contour)
        var cpuRepeat: [Double] = []
        for _ in 0..<5 {
            let tick = ContinuousClock.now
            _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(contour: contour)
            cpuRepeat.append(Self.milliseconds(since: tick))
        }
        let warmupStart = ContinuousClock.now
        _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, processor: .gpu
        )
        let warmupMS = Self.milliseconds(since: warmupStart)
        var gpuRepeat: [Double] = []
        var gpuBaked: (field: WorldbendOutlineNormalField, diagnostics: WorldbendOutlineFieldBaker.BakeDiagnostics)?
        for _ in 0..<5 {
            let tick = ContinuousClock.now
            gpuBaked = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour, processor: .gpu
            )
            gpuRepeat.append(Self.milliseconds(since: tick))
        }
        let gpu = try #require(gpuBaked)
        let bits = Self.fieldBits(gpu.field)
        let delta = Self.mismatchCount(cpu.field, gpu.field)
        let cpuSorted = cpuRepeat.sorted()
        let gpuSorted = gpuRepeat.sorted()
        #if DEBUG
        let config = "debug"
        #else
        let config = "release"
        #endif
        print(
            "GPU_FIELD_BAKE config=\(config) warmup_ms=\(warmupMS) compile_ms=\(WorldbendOutlineFieldGPU.lastShaderCompileMilliseconds) cpu_ms=\(cpuRepeat) cpu_median=\(cpuSorted[cpuSorted.count / 2]) gpu_ms=\(gpuRepeat) gpu_median=\(gpuSorted[gpuSorted.count / 2]) dist=\(bits.dist) normal=\(bits.normal) queries=\(gpu.diagnostics.segmentDistanceQueries) refined=\(gpu.diagnostics.refinedTexels) mismatches=\(delta.count) first=\(delta.first) maxAbsD=\(delta.maxAbsD) maxAbsN=\(delta.maxAbsN) automatic=\(WorldbendOutlineFieldGPU.automaticPrefersGPU) waitOffMain=\(WorldbendOutlineFieldGPUProbe.lastWaitOffMainThread)"
        )
        #expect(bits.dist == 2_411_285_218_994_884_096)
        #expect(bits.normal == 7_610_451_798_197_929_059)
        #expect(gpu.diagnostics.segmentDistanceQueries == cpu.diagnostics.segmentDistanceQueries)
        #expect(gpu.diagnostics.refinedTexels == cpu.diagnostics.refinedTexels)
        #expect(delta.count == 0)
        #expect(WorldbendOutlineFieldGPUProbe.lastWaitOffMainThread)
        let slowest = gpuRepeat.max() ?? 0
        #expect(slowest < 250)
        let poly = contour.polyline
        let fieldData = gpu.field
        var checked = 0
        let band = Float(WorldbendOutlineFieldBaker.defaultRefineBandCells * fieldData.cellSize)
        for y in stride(from: 2, to: fieldData.height - 2, by: 5) {
            for x in stride(from: 2, to: fieldData.width - 2, by: 5) {
                let d = fieldData.distances[y * fieldData.width + x]
                if abs(d) > band { continue }
                let logical = CGPoint(
                    x: fieldData.origin.x + (CGFloat(x) + 0.5) * fieldData.cellSize,
                    y: fieldData.origin.y + (CGFloat(y) + 0.5) * fieldData.cellSize
                )
                var best = CGFloat.greatestFiniteMagnitude
                for s in 0..<(poly.count - 1) {
                    let a = poly[s], b = poly[s + 1]
                    let abx = b.x - a.x, aby = b.y - a.y
                    let apx = logical.x - a.x, apy = logical.y - a.y
                    let ab2 = abx * abx + aby * aby
                    let t = ab2 < 1e-12 ? 0 : max(0, min(1, (apx * abx + apy * aby) / ab2))
                    let cx = a.x + abx * t, cy = a.y + aby * t
                    best = min(best, hypot(logical.x - cx, logical.y - cy))
                }
                #expect(abs(CGFloat(abs(d)) - best) < 0.5)
                checked += 1
                if checked >= 40 { break }
            }
            if checked >= 40 { break }
        }
        #expect(checked >= 10)

        let automatic = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
            contour: contour, processor: .automatic
        )
        #expect(Self.mismatchCount(cpu.field, automatic.field).count == 0)
    }

    @Test func gpuEncodeDoesNotWaitAndPacksTheResolvedField() throws {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let commandBuffer = queue.makeCommandBuffer()
        else { return }
        let contour = Self.menuMorphContour()
        let cpu = try WorldbendOutlineFieldBaker.bake(contour: contour)
        let pending = try WorldbendOutlineFieldBaker.encodeGPUField(
            contour: contour, commandBuffer: commandBuffer, device: device
        )
        #expect(commandBuffer.status == .notEnqueued)
        #expect(pending.performedSynchronousGPUWait == false)
        #expect(throws: WorldbendOutlineError.bakeFailed) {
            try pending.resolve(commandBuffer: commandBuffer)
        }
        commandBuffer.commit()
        try WorldbendOutlineFieldGPU.waitUntilCompletedOffMain(commandBuffer)
        let resolved = try pending.resolve(commandBuffer: commandBuffer)
        #expect(Self.mismatchCount(cpu, resolved.field).count == 0)
        #expect(WorldbendOutlineFieldGPUProbe.lastWaitOffMainThread)

        let cpuTexture = try WorldbendOutlineFieldTexture(device: device, field: cpu)
        guard let packed = device.makeTexture(descriptor: {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .rgba16Float, width: cpu.width, height: cpu.height, mipmapped: false
            )
            descriptor.usage = [.shaderRead, .shaderWrite]
            descriptor.storageMode = .shared
            return descriptor
        }()) else {
            Issue.record("pack texture allocation failed")
            return
        }
        guard let packBuffer = queue.makeCommandBuffer() else { return }
        try pending.encodeResolvedPack(into: packed, commandBuffer: packBuffer)
        #expect(packBuffer.status == .notEnqueued)
        packBuffer.commit()
        try WorldbendOutlineFieldGPU.waitUntilCompletedOffMain(packBuffer)
        #expect(packBuffer.status == .completed)
        guard let cpuTex = cpuTexture.texture else {
            Issue.record("cpu field texture missing")
            return
        }
        let cpuBytes = Self.textureBytes(cpuTex)
        let gpuBytes = Self.textureBytes(packed)
        #expect(cpuBytes == gpuBytes)
    }

    @Test func gpuSetupArcAndSmallPanelMatchCPUBits() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { return }
        let arc = WorldbendOutlineSetupArcSamplingStandIn.contour(
            viewport: viewport, top: 160, depth: 32, contactX: 0.4, bend: 12,
            revision: 11, segments: 96
        )
        let panel = WorldbendOutlineContour(
            logicalSize: CGSize(width: 180, height: 100),
            polyline: Self.roundedRectPolyline(
                in: CGRect(x: 12, y: 16, width: 156, height: 68),
                cornerRadius: 18, samplesPerCorner: 12
            ),
            dynamics: WorldbendOutlineDynamics(
                top: 16, depth: 18, contactX: 0.5, bend: 0,
                viewportWidth: 180, viewportHeight: 100,
                contourKind: "floating-task-panel", contourRevision: 1
            )
        )
        for contour in [arc, panel] {
            let cpu = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(contour: contour, cellSize: 2)
            let gpu = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour, cellSize: 2, processor: .gpu
            )
            let delta = Self.mismatchCount(cpu.field, gpu.field)
            #expect(delta.count == 0)
            #expect(gpu.diagnostics.segmentDistanceQueries == cpu.diagnostics.segmentDistanceQueries)
            #expect(gpu.diagnostics.refinedTexels == cpu.diagnostics.refinedTexels)
        }
    }

    @Test func gpuDegenerateTexelTextureMatchesResolvedField() throws {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let commandBuffer = queue.makeCommandBuffer()
        else { return }
        // Right edge of this diamond passes through a texel center after the
        // coverage pad, so refine takes the even-odd normal on the CPU.
        let contour = WorldbendOutlineContour(
            logicalSize: CGSize(width: 20, height: 20),
            polyline: [
                CGPoint(x: 10, y: 0), CGPoint(x: 20, y: 10),
                CGPoint(x: 10, y: 20), CGPoint(x: 0, y: 10),
                CGPoint(x: 10, y: 0)
            ],
            dynamics: WorldbendOutlineDynamics(
                top: 8, depth: 8, contactX: 0.5, bend: 0,
                viewportWidth: 20, viewportHeight: 20,
                contourKind: "degenerate-diagonal", contourRevision: 1
            ),
            closesImplicitly: false
        )
        let cpu = try WorldbendOutlineFieldBaker.bake(contour: contour, cellSize: 2)
        let cpuTexture = try WorldbendOutlineFieldTexture(device: device, field: cpu)
        let live = try WorldbendOutlineFieldTexture(device: device, field: cpu)
        let pending = try live.encodeGPUField(
            contour: contour, commandBuffer: commandBuffer, cellSize: 2
        )
        #expect(commandBuffer.status == .notEnqueued)
        commandBuffer.commit()
        try WorldbendOutlineFieldGPU.waitUntilCompletedOffMain(commandBuffer)
        let resolved = try pending.resolve(commandBuffer: commandBuffer)
        #expect(Self.mismatchCount(cpu, resolved.field).count == 0)
        #expect(pending.repairedTexels > 0)
        guard let cpuTex = cpuTexture.texture, let packed = live.texture else {
            Issue.record("field texture missing")
            return
        }
        let cpuBytes = Self.textureBytes(cpuTex)
        #expect(Self.textureBytes(packed) != cpuBytes)
        try live.applyResolvedGPUField(resolved.field)
        #expect(Self.textureBytes(packed) == cpuBytes)
        #expect(live.field.distances == resolved.field.distances)
    }

    @Test func gpuRefineBudgetFailsClosed() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { return }
        let contour = Self.menuMorphContour()
        // Warm the Metal library so the timed fail-closed path is not the compile.
        _ = try? WorldbendOutlineFieldBaker.bakeWithDiagnostics(contour: contour, processor: .gpu)
        let started = ContinuousClock.now
        var thrown: WorldbendOutlineError?
        do {
            _ = try WorldbendOutlineFieldBaker.bakeWithDiagnostics(
                contour: contour, maxRefineQueries: 1, processor: .gpu
            )
        } catch let error as WorldbendOutlineError {
            thrown = error
        }
        let elapsed = ContinuousClock.now - started
        guard case let .refineBudgetExceeded(estimated, limit)? = thrown else {
            Issue.record("expected refineBudgetExceeded, got \(String(describing: thrown))")
            return
        }
        #expect(limit == 1)
        #expect(estimated > limit)
        #expect(elapsed < .milliseconds(250))
    }

    private static func textureBytes(_ texture: any MTLTexture) -> [UInt8] {
        let row = texture.width * 8
        var bytes = [UInt8](repeating: 0, count: row * texture.height)
        bytes.withUnsafeMutableBytes { raw in
            texture.getBytes(
                raw.baseAddress!,
                bytesPerRow: row,
                from: MTLRegionMake2D(0, 0, texture.width, texture.height),
                mipmapLevel: 0
            )
        }
        return bytes
    }
}
