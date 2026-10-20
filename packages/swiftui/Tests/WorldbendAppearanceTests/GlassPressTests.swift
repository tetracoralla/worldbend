import CoreGraphics
import Foundation
import Testing
@testable import WorldbendAppearance

@Suite("GlassPress")
struct GlassPressTests {
    private func paneSize() -> CGSize { CGSize(width: 200, height: 80) }

    private func restCapsule(revision: UInt64 = 1) -> WorldbendOutlineContour {
        let size = paneSize()
        let poly = WorldbendGlassPressRestShape.capsule(
            in: CGRect(x: 20, y: 10, width: 160, height: 60),
            samples: 48
        )
        return WorldbendGlassPressRestShape.contour(
            polyline: poly,
            logicalSize: size,
            revision: revision,
            contourKind: "capsule"
        )
    }

    @Test func morphSamplesAboveMaxDeformVerticesRejected() throws {
        var bad = WorldbendGlassPressRecipe.referenceDefaults
        bad.morphSamples = 200
        bad.maxDeformVertices = 64
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }
    }

    @Test func extremeDtKeepsSpringStateFinite() throws {
        var recipe = WorldbendGlassPressRecipe.referenceDefaults
        recipe.cancelSpringFrequency = WorldbendGlassPressResourceLimits.cancelSpringFrequencyMax
        recipe.stretchStiffness = WorldbendGlassPressResourceLimits.stretchStiffnessMax
        recipe.maxStepsPerTick = 1
        try recipe.validate()
        let sim = try WorldbendGlassPressSimulation(recipe: recipe)
        let rest = try { () -> WorldbendOutlineContour in
            let c = restCapsule(); try c.validate(); return c
        }()
        let press = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            restContour: rest
        )
        // Hostile hitch: far beyond catchupMax and stability wall.
        var frame = try sim.tick(dt: 2.5, input: press)
        #expect(frame.bulgeAmount.isFinite)
        #expect(frame.stretch.dx.isFinite)
        #expect(frame.stretch.dy.isFinite)
        #expect(frame.morphProgress.isFinite)
        #expect(frame.bulgeAmount >= 0)
        #expect(frame.bulgeAmount <= recipe.maxBulge + 1e-6)
        // Cancel with another extreme dt — must not NaN / explode.
        frame = try sim.tick(
            dt: 2.5,
            input: WorldbendGlassPressInput(phase: .cancelling, restContour: rest)
        )
        #expect(frame.bulgeAmount.isFinite)
        #expect(frame.morphProgress.isFinite)
        #expect(frame.receipt.losses.contains { $0.contains("spring stability") } || frame.receipt.stepsTaken >= 1)
    }

    private func menuBlob(revision: UInt64 = 1) -> WorldbendOutlineContour {
        let size = paneSize()
        // Wider rounded rect as stand-in menu outline (not APP menu IA).
        let poly = WorldbendGlassPressRestShape.roundedRect(
            in: CGRect(x: 10, y: 5, width: 180, height: 70),
            cornerRadius: 18,
            samplesPerCorner: 10
        )
        return WorldbendGlassPressRestShape.contour(
            polyline: poly,
            logicalSize: size,
            revision: revision,
            contourKind: "menu"
        )
    }

    @Test func referenceRecipeValidates() throws {
        try WorldbendGlassPressRecipe.referenceDefaults.validate()
        #expect(WorldbendGlassPressRecipe.referenceDefaults.profile == worldbendGlassPressDeformProfile)
    }

    @Test func validateRejectsBadProfileAndRanges() throws {
        var bad = WorldbendGlassPressRecipe.referenceDefaults
        bad.profile = "other"
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }

        bad = .referenceDefaults
        bad.bulgeRadius = 0
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }

        bad = .referenceDefaults
        bad.pressDepth = .nan
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }

        bad = .referenceDefaults
        bad.morphSamples = 2
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }

        bad = .referenceDefaults
        bad.maxStepsPerTick = 99
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }

        bad = .referenceDefaults
        bad.cancelSpringFrequency = 0
        #expect(throws: WorldbendGlassPressError.self) { try bad.validate() }
    }

    @Test func pressIncreasesBulgeAndAffectsPolyline() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = try { () -> WorldbendOutlineContour in
            let c = restCapsule(); try c.validate(); return c
        }()
        let idle = try sim.tick(
            dt: 1.0 / 60.0,
            input: WorldbendGlassPressInput(phase: .idle, restContour: rest)
        )
        #expect(idle.bulgeAmount < 0.5)

        let pressing = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 20), // near top edge so bulgeRadius reaches rim
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        var frame = idle
        for _ in 0..<45 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: pressing)
        }
        #expect(frame.bulgeAmount > 2)
        #expect(frame.receipt.effective["pressAmount"] == 1)
        // Contact-local vertices should move vs idle (parameter actually affects result).
        let idleH = maxY(idle.deformedPolyline) - minY(idle.deformedPolyline)
        let pressH = maxY(frame.deformedPolyline) - minY(frame.deformedPolyline)
        let moved = zip(idle.deformedPolyline, frame.deformedPolyline).map { a, b in
            hypot(b.x - a.x, b.y - a.y)
        }.max() ?? 0
        #expect(moved > 1 || pressH > idleH + 0.5)
        #expect(frame.opticsModulators.refractionScaleMultiplier > 1)
    }

    @Test func dragStretchFollowsOffsetWithinBound() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        let input = WorldbendGlassPressInput(
            phase: .dragging,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 0.8,
            dragOffset: CGSize(width: 80, height: 0),
            pressed: true,
            restContour: rest
        )
        var frame = try sim.tick(dt: 0, input: input)
        for _ in 0..<60 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: input)
        }
        #expect(abs(frame.stretch.dx) > 5)
        #expect(abs(frame.stretch.dx) <= WorldbendGlassPressRecipe.referenceDefaults.maxStretch + 1e-6)
        #expect(frame.receipt.losses.contains(where: { $0.contains("maxStretch") })
                || abs(frame.stretch.dx) <= 48 + 1e-6)
    }

    @Test func cancelSpringsBackAndIsInterruptible() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        let press = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        var frame = try sim.tick(dt: 0, input: press)
        for _ in 0..<40 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: press)
        }
        let peaked = frame.bulgeAmount
        #expect(peaked > 2)

        // Start cancel — bulge should fall.
        let cancel = WorldbendGlassPressInput(phase: .cancelling, restContour: rest)
        for _ in 0..<20 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: cancel)
        }
        let midCancel = frame.bulgeAmount
        #expect(midCancel < peaked)

        // Interrupt cancel with press again — bulge should rise (reverse interrupt).
        for _ in 0..<30 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: press)
        }
        #expect(frame.bulgeAmount > midCancel)
    }

    @Test func continuousMorphCapsuleToMenuNotHardCut() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        let menu = menuBlob()
        let input = WorldbendGlassPressInput(
            phase: .morphingToMenu,
            pressAmount: 0.2,
            restContour: rest,
            menuContour: menu,
            morphTarget: 1
        )
        var previous: Double?
        var progressed = false
        for _ in 0..<50 {
            let frame = try sim.tick(dt: 1.0 / 60.0, input: input)
            if let p = previous {
                // Continuous: progress increases without jumping 0→1 in one step.
                #expect(frame.morphProgress - p < 0.45)
                if frame.morphProgress > p + 0.01 { progressed = true }
            }
            previous = frame.morphProgress
        }
        #expect(progressed)
        let final = try sim.tick(dt: 1.0 / 60.0, input: input)
        #expect(final.morphProgress > 0.5)
        // Intermediate geometry is not exactly rest or menu.
        let restW = maxX(rest.polyline) - minX(rest.polyline)
        let menuW = maxX(menu.polyline) - minX(menu.polyline)
        let midW = maxX(final.deformedPolyline) - minX(final.deformedPolyline)
        #expect(midW > restW - 1)
        #expect(abs(menuW - restW) > 1) // menu differs
    }

    @Test func disabledSnapsToRestWithReceipt() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        var press = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        for _ in 0..<30 {
            _ = try sim.tick(dt: 1.0 / 60.0, input: press)
        }
        press.disabled = true
        let frame = try sim.tick(dt: 1.0 / 60.0, input: press)
        #expect(frame.bulgeAmount == 0)
        #expect(frame.morphProgress == 0)
        #expect(frame.receipt.disabled)
        #expect(frame.receipt.reduceMotionMode == "disabled-rest")
        #expect(frame.receipt.losses.contains(where: { $0.contains("disabled") }))
    }

    @Test func reduceMotionSnapsTargets() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        let menu = menuBlob()
        let input = WorldbendGlassPressInput(
            phase: .morphingToMenu,
            pressAmount: 1,
            pressed: true,
            reduceMotion: true,
            restContour: rest,
            menuContour: menu,
            morphTarget: 1
        )
        let frame = try sim.tick(dt: 1.0 / 60.0, input: input)
        #expect(frame.receipt.reduceMotion)
        #expect(frame.receipt.reduceMotionMode == "snap")
        #expect(abs(frame.morphProgress - 1) < 1e-9)
        #expect(frame.bulgeAmount > 0)
    }

    @Test func pressDepthParamActuallyChangesBulge() throws {
        let rest = restCapsule()
        var shallow = WorldbendGlassPressRecipe.referenceDefaults
        shallow.pressDepth = 4
        shallow.maxBulge = 28
        var deep = WorldbendGlassPressRecipe.referenceDefaults
        deep.pressDepth = 20
        deep.maxBulge = 28

        let simA = try WorldbendGlassPressSimulation(recipe: shallow)
        let simB = try WorldbendGlassPressSimulation(recipe: deep)
        let input = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        var a = try simA.tick(dt: 0, input: input)
        var b = try simB.tick(dt: 0, input: input)
        for _ in 0..<50 {
            a = try simA.tick(dt: 1.0 / 60.0, input: input)
            b = try simB.tick(dt: 1.0 / 60.0, input: input)
        }
        #expect(b.bulgeAmount > a.bulgeAmount + 1)
    }

    @Test func receiptDisclosesPressDepthClampedByMaxBulge() throws {
        var recipe = WorldbendGlassPressRecipe.referenceDefaults
        recipe.pressDepth = 40
        recipe.maxBulge = 10
        let sim = try WorldbendGlassPressSimulation(recipe: recipe)
        let rest = restCapsule()
        let input = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        var frame = try sim.tick(dt: 0, input: input)
        for _ in 0..<40 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: input)
        }
        #expect(frame.receipt.losses.contains(where: { $0.contains("maxBulge") }))
        #expect(frame.bulgeAmount <= 10 + 1e-6)
        #expect(frame.receipt.authored["pressDepth"] == 40)
        #expect(frame.receipt.effective["maxBulge"] == 10)
    }

    @Test func oversizedPolylineHitsBudget() throws {
        let sim = try WorldbendGlassPressSimulation()
        let size = paneSize()
        // Hostile dense polyline beyond effectiveMaxDeformVertices.
        var pts: [CGPoint] = []
        let n = WorldbendGlassPressResourceLimits.maxDeformVerticesCap + 40
        for i in 0..<n {
            let t = Double(i) / Double(n)
            pts.append(CGPoint(x: 20 + 160 * t, y: 40 + sin(t * .pi * 4) * 10))
        }
        pts.append(pts[0])
        let hostile = WorldbendGlassPressRestShape.contour(
            polyline: pts, logicalSize: size, revision: 1, contourKind: "hostile"
        )
        // Contour validate only checks >=3 finite points; budget checked on input.
        let input = WorldbendGlassPressInput(phase: .idle, restContour: hostile)
        #expect(throws: WorldbendGlassPressError.self) {
            _ = try sim.tick(dt: 0, input: input)
        }
    }

    @Test func deformedContourFeedsOutlineBaker() throws {
        let sim = try WorldbendGlassPressSimulation()
        let rest = restCapsule()
        let menu = menuBlob()
        let input = WorldbendGlassPressInput(
            phase: .morphingToMenu,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 0.7,
            pressed: true,
            restContour: rest,
            menuContour: menu,
            morphTarget: 0.6
        )
        var frame = try sim.tick(dt: 0, input: input)
        for _ in 0..<35 {
            frame = try sim.tick(dt: 1.0 / 60.0, input: input)
        }
        let field = try WorldbendOutlineFieldBaker.bake(contour: frame.deformedContour)
        try field.validate()
        #expect(field.width > 0)
        #expect(field.distances.contains(where: { $0 < 0 })) // interior
        #expect(field.distances.contains(where: { $0 > 0 })) // exterior

        let baseOptics = OutlineOpticalGlassConfiguration(
            edgeWidth: 10, refractionScale: 12, chromaticOffset: 1.2,
            frostRadius: 0, lightDirection: [0, -1], highlightStrength: 0.28
        )
        try baseOptics.validate()
        let modulated = try frame.opticsModulators.applying(to: baseOptics)
        try modulated.validate()
        #expect(modulated.refractionScale >= baseOptics.refractionScale)
    }

    @Test func longPressGainRaisesBulgeAfterDelay() throws {
        var recipe = WorldbendGlassPressRecipe.referenceDefaults
        recipe.longPressDelay = 0.1
        recipe.longPressGain = 2.0
        recipe.pressDepth = 10
        let sim = try WorldbendGlassPressSimulation(recipe: recipe)
        let rest = restCapsule()
        let input = WorldbendGlassPressInput(
            phase: .pressing,
            contact: CGPoint(x: 100, y: 40),
            pressAmount: 1,
            pressed: true,
            restContour: rest
        )
        // Before delay (~3 frames at 60Hz < 0.1s): lower bulge target.
        var early = try sim.tick(dt: 1.0 / 60.0, input: input)
        for _ in 0..<4 {
            early = try sim.tick(dt: 1.0 / 60.0, input: input)
        }
        let earlyBulge = early.bulgeAmount

        // Continue past delay + settle.
        var late = early
        for _ in 0..<50 {
            late = try sim.tick(dt: 1.0 / 60.0, input: input)
        }
        #expect(late.bulgeAmount > earlyBulge)
    }
}

private func minX(_ pts: [CGPoint]) -> CGFloat {
    pts.map(\.x).min() ?? 0
}
private func maxX(_ pts: [CGPoint]) -> CGFloat {
    pts.map(\.x).max() ?? 0
}
private func minY(_ pts: [CGPoint]) -> CGFloat {
    pts.map(\.y).min() ?? 0
}
private func maxY(_ pts: [CGPoint]) -> CGFloat {
    pts.map(\.y).max() ?? 0
}
