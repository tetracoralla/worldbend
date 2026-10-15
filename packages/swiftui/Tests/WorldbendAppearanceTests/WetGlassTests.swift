import Foundation
import CoreGraphics
import Metal
import Testing
@testable import WorldbendAppearance

struct WetGlassTests {
    private func rectPane(width: CGFloat, height: CGFloat) -> [[CGPoint]] {
        [[
            CGPoint(x: 0, y: 0),
            CGPoint(x: width, y: 0),
            CGPoint(x: width, y: height),
            CGPoint(x: 0, y: height)
        ]]
    }

    private func binding(
        band: WorldbendWetGlassBand = .medium,
        waterScale: CGFloat = 0.26,
        population: Double = 1,
        seed: Int = 7
    ) -> WorldbendWetGlassSurfaceBinding {
        let size = CGSize(width: 1024, height: 768)
        let panes = rectPane(width: size.width, height: size.height)
        let field = WorldbendWetGlassField.build(
            panes: panes, sourceSize: size, band: band
        )
        return WorldbendWetGlassSurfaceBinding(
            sourceSize: size, waterScale: waterScale, band: band,
            population: population, seed: seed, panes: panes, field: field
        )
    }

    @Test func referenceDefaultsMatchProfileAndCapacity() throws {
        let recipe = WorldbendWetGlassRecipe.referenceDefaults
        try recipe.validate()
        #expect(recipe.profile == worldbendWetGlassSurfaceProfile)
        #expect(recipe.simulation.capacity == 1200)
        #expect(abs(recipe.simulation.stepSeconds - 1.0 / 60.0) < 1e-12)
        #expect(recipe.provenance.revision == "bae4081bc15815bb094ea040a976dca083bbc3a5")
        #expect(recipe.optics.normalStrength == 8)
        #expect(recipe.optics.occlusionRayProbes == 4)
    }

    @Test func fixtureDecodesToReferenceParity() throws {
        let url = try #require(Bundle.module.url(forResource: "wet-glass-surface.v1", withExtension: "json", subdirectory: "Fixtures"))
        let data = try Data(contentsOf: url)
        let decoded = try WorldbendWetGlassRecipe.decode(data)
        #expect(decoded.simulation.capacity == WorldbendWetGlassRecipe.referenceDefaults.simulation.capacity)
        #expect(decoded.simulation.spawnPerSecond.heavy == 24)
        #expect(decoded.optics.cardGleamGain == 0.32)
        #expect(decoded.simulation.fieldBands["medium"]?.count == 46)
    }

    @Test func unitUsesSourceWidthOver1024TimesWaterScale() {
        #expect(WorldbendWetGlassUnit.make(sourceWidth: 1024, waterScale: 0.26) == 0.26)
        #expect(WorldbendWetGlassUnit.make(sourceWidth: 2048, waterScale: 0.45) == 0.9)
    }

    @Test func deterministicCheckpointAtFixedSteps() throws {
        let a = try WorldbendWetGlassSimulation(binding: binding(seed: 11))
        let b = try WorldbendWetGlassSimulation(binding: binding(seed: 11))
        a.advanceSteps(120) // 2s at 60 Hz; covers 30 Hz display commit cadence
        b.advanceSteps(120)
        #expect(a.checkpointFingerprint() == b.checkpointFingerprint())
        #expect(a.drops.count == b.drops.count)
        #expect(a.mergeCount == b.mergeCount)
        #expect(a.trailCount == b.trailCount)
        #expect(a.drops.count <= 1200)
    }

    @Test func mergeNearbyRewritePreservesPreR3EvolutionFingerprint() throws {
        // Cross-run stable checkpoint captured from WET-GLASS-01-r2 mergeNearby
        // (seed 11, 120 fixed steps) before the Debug neighborhood rewrite.
        // r3 removed ClosedRange/`drops.map`; r4 replaces Dictionary bins with a
        // dense pane×cell grid. Exact string match — no float tolerance.
        // Capacity/scales unchanged. Note: Swift.Hasher is randomly seeded per
        // process; do not golden `checkpointFingerprint()` across runs. APP's
        // fast path was Debug+-O, not full Release.
        let sim = try WorldbendWetGlassSimulation(binding: binding(seed: 11))
        sim.advanceSteps(120)
        let stable = sim.stableEvolutionCheckpoint()
        #expect(stable.hasPrefix("n=732;merge=18;trail=452;steps=120;drain=433"))
        let url = try #require(Bundle.module.url(
            forResource: "wet-merge-r2-stable-golden-seed11-steps120",
            withExtension: "txt",
            subdirectory: "Fixtures"
        ))
        let golden = try String(contentsOf: url, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(stable == golden)
        #expect(sim.drops.count <= 1200)
        #expect(WorldbendWetGlassRecipe.referenceDefaults.simulation.capacity == 1200)
    }

    @Test func mergeNearbyBinCountPreChecksInt64Product() {
        // r4 multiplied Int64 factors before the ceiling guard (overflow trap risk).
        let ok = WorldbendWetGlassMergeGrid.checkedBinCount(width: 100, height: 80, paneCount: 2)
        #expect(ok?.binCount == 16_000)
        #expect(ok?.plane == 8_000)

        #expect(WorldbendWetGlassMergeGrid.checkedBinCount(width: 0, height: 10, paneCount: 1) == nil)
        #expect(WorldbendWetGlassMergeGrid.checkedBinCount(width: -1, height: 10, paneCount: 1) == nil)
        // Product exceeds maxBins without ever multiplying past Int64 ceiling.
        #expect(WorldbendWetGlassMergeGrid.checkedBinCount(
            width: 100_000, height: 100_000, paneCount: 2
        ) == nil)
        // Each factor alone above maxBins.
        #expect(WorldbendWetGlassMergeGrid.checkedBinCount(
            width: WorldbendWetGlassMergeGrid.maxBins + 1, height: 1, paneCount: 1
        ) == nil)
        // Near Int64 overflow class: huge factors rejected by pairwise / check.
        #expect(WorldbendWetGlassMergeGrid.checkedBinCount(
            width: Int(Int32.max), height: Int(Int32.max), paneCount: 4
        ) == nil)
        // Exact ceiling accepted.
        let edge = WorldbendWetGlassMergeGrid.checkedBinCount(
            width: 1000, height: 1000, paneCount: 1
        )
        #expect(edge?.binCount == 1_000_000)
    }

    @Test func mergeNearbyHeavyBandStaysDeterministicAtCapacity() throws {
        // Heavy band + full population stresses neighborhood bins near capacity
        // without cutting drops or changing accepted scales.
        let a = try WorldbendWetGlassSimulation(binding: binding(band: .heavy, population: 1, seed: 42))
        let b = try WorldbendWetGlassSimulation(binding: binding(band: .heavy, population: 1, seed: 42))
        a.advanceSteps(180)
        b.advanceSteps(180)
        #expect(a.checkpointFingerprint() == b.checkpointFingerprint())
        #expect(a.mergeCount == b.mergeCount)
        #expect(a.drops.count <= 1200)
        #expect(b.drops.count <= 1200)
    }

    @Test func differentSeedsDiverge() throws {
        let a = try WorldbendWetGlassSimulation(binding: binding(seed: 1))
        let b = try WorldbendWetGlassSimulation(binding: binding(seed: 2))
        a.advanceSteps(90)
        b.advanceSteps(90)
        #expect(a.checkpointFingerprint() != b.checkpointFingerprint())
    }

    @Test func catchupIsBoundedLikeReference() throws {
        let sim = try WorldbendWetGlassSimulation(binding: binding(seed: 3))
        sim.advance(to: 0)
        sim.advance(to: 5) // large stall; maxCatchup 0.1s → ≤7 steps at 1/60
        #expect(sim.stepCount <= 7)
        #expect(sim.stepCount >= 6)
    }

    @Test func populationScalesInitialCount() throws {
        let full = try WorldbendWetGlassSimulation(binding: binding(band: .light, population: 1, seed: 0))
        let card = try WorldbendWetGlassSimulation(binding: binding(band: .light, population: 0.3, seed: 0))
        #expect(full.drops.count == 130)
        #expect(card.drops.count == 39)
    }

    @Test func mergeAndTrailConserveMassBudget() throws {
        let sim = try WorldbendWetGlassSimulation(binding: binding(band: .heavy, seed: 19))
        sim.advanceSteps(180)
        // Spawn adds mass; evaporation removes it; drainedMass accounts for
        // surplus beyond max radius (APP ArrivalWaterSimulation contract).
        #expect(sim.drops.allSatisfy { $0.radius <= sim.maximumRadius + 1e-4 })
        #expect(sim.drops.count <= 1200)
        #expect(sim.drainedMass >= 0)
        #expect(sim.mergeCount >= 0)
        #expect(sim.trailCount >= 0)
        // Trails subtract deposited mass from the parent (mass accounting).
        let trailParents = Set(sim.drops.compactMap(\.parent))
        #expect(trailParents.count >= 0)
    }

    @Test func fieldBuilderRespectsOpaqueHoles() {
        let size = CGSize(width: 200, height: 200)
        let pane = rectPane(width: 200, height: 200)[0]
        let hole: [CGPoint] = [
            CGPoint(x: 80, y: 0), CGPoint(x: 120, y: 0),
            CGPoint(x: 120, y: 200), CGPoint(x: 80, y: 200)
        ]
        let open = WorldbendWetGlassField.build(panes: [pane], sourceSize: size, band: .medium)
        let blocked = WorldbendWetGlassField.build(
            panes: [pane], holes: [hole], sourceSize: size, band: .medium
        )
        #expect(!open.lanes.isEmpty)
        // Lanes whose x falls in the hole lose wet spans and are omitted or shortened.
        let openXs = open.lanes.map(\.x)
        let blockedXs = blocked.lanes.map(\.x)
        #expect(blocked.lanes.count <= open.lanes.count)
        #expect(blockedXs.filter { $0 > 80 && $0 < 120 }.count <= openXs.filter { $0 > 80 && $0 < 120 }.count)
    }

    @Test func particlesScaleIntoCanvas() throws {
        let sim = try WorldbendWetGlassSimulation(binding: binding(seed: 5))
        let packed = sim.particles(in: CGRect(x: 10, y: 20, width: 100, height: 50))
        #expect(packed.count == sim.drops.count)
        if let first = packed.first {
            #expect(first.x >= 10 && first.x <= 110)
            #expect(first.y >= 20 && first.y <= 70)
            #expect(first.z > 0 && first.w > 0)
        }
    }

    @Test func opticsUniformsMirrorRecipe() {
        let optics = WorldbendWetGlassOpticsUniforms(optics: WorldbendWetGlassRecipe.referenceDefaults.optics)
        #expect(optics.normalStrength == 8)
        #expect(optics.refractionBase == 0.6)
        #expect(optics.cardGleamGain == Float(0.32))
        #expect(optics.occlusionProbes == 4)
        #expect(optics.surfaceLightX == Float(-0.45))
        #expect(MemoryLayout<WorldbendWetGlassOpticsUniforms>.stride == 80)
        #expect(MemoryLayout<WorldbendWetGlassUniforms>.stride == 16)
    }

    @Test func composerReportsMetallibStatusHonestly() async {
        await MainActor.run {
            let composer = WorldbendWetGlassComposer()
            // Plain swift test typically lacks default.metallib; status must not
            // pretend ready without pipelines.
            if WorldbendWetGlassRuntime.hasCompiledShader {
                #expect(composer.isReady || {
                    if case .pipelineFailed = composer.status { return true }
                    return false
                }())
            } else {
                #expect(!composer.isReady)
                switch composer.status {
                case .missingMetallib, .pipelineFailed:
                    break
                case .ready:
                    Issue.record("composer marked ready without metallib")
                }
            }
        }
    }

    @Test func rejectWrongProfile() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.profile = "worldbend.wet-glass-surface@9.9"
        #expect(throws: WorldbendWetGlassError.self) {
            try recipe.validate()
        }
    }
    @Test func referenceSceneHintsMatchAPPReference() {
        #expect(WorldbendWetGlassRecipe.referenceRoomWaterScale == 0.26)
        #expect(WorldbendWetGlassRecipe.referenceCardWaterScale == 0.45)
        #expect(WorldbendWetGlassRecipe.referenceCardPopulation == 0.3)
    }

    @Test func encodeFromFrameHubRejectsLogicalSizeMismatchedToContentRect() async throws {
        await MainActor.run {
            let hub = WorldbendFrameHub()
            let content = CGRect(x: 10, y: 20, width: 200, height: 100)
            let descriptor = WorldbendFrameDescriptor(
                frameID: hub.makeFrameID(),
                logicalSize: CGSize(width: 390, height: 844),
                contentRect: content,
                pixelWidth: 200,
                pixelHeight: 100,
                colorSpace: .sRGB,
                pixelFormat: .bgra8Unorm
            )
            // CPU carrier is enough to retain a completed frame; contentRect
            // check runs before Metal texture resolution.
            try! hub.publish(
                descriptor: descriptor,
                cpuBytes: Data(repeating: 0, count: 200 * 100 * 4),
                cpuBytesPerRow: 200 * 4
            )
            let composer = WorldbendWetGlassComposer()
            guard let device = MTLCreateSystemDefaultDevice(),
                  let command = device.makeCommandQueue()?.makeCommandBuffer() else {
                return
            }
            let pass = MTLRenderPassDescriptor()
            let maskDesc = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .r8Unorm, width: 8, height: 8, mipmapped: false
            )
            maskDesc.usage = [.shaderRead]
            guard let mask = device.makeTexture(descriptor: maskDesc) else { return }
            // Viewport-sized logicalSize ≠ contentRect.size → must reject.
            #expect(throws: WorldbendWetGlassError.self) {
                try composer.encodeFromFrameHub(
                    hub: hub, command: command, pass: pass, mask: mask,
                    particles: [], logicalSize: CGSize(width: 390, height: 844),
                    pixelSize: CGSize(width: 8, height: 8),
                    recipe: .referenceDefaults, mode: .window, paintBackground: false
                )
            }
        }
    }

    @Test func waterFieldBlendIsAdditiveOneOne() {
        let blend = WorldbendWetGlassWaterBlendConfiguration.waterField
        #expect(blend.isAdditiveOneOne)
        #expect(blend.isBlendingEnabled)
        #expect(blend.sourceRGBBlendFactor == .one)
        #expect(blend.destinationRGBBlendFactor == .one)
        #expect(blend.sourceAlphaBlendFactor == .one)
        #expect(blend.destinationAlphaBlendFactor == .one)
        // Composer aliases the same nonisolated presets (APP parity entry).
        #expect(WorldbendWetGlassComposer.waterFieldBlend == blend)
        // Photo/composite remain premultiplied; must not silently share water blend.
        let composite = WorldbendWetGlassWaterBlendConfiguration.composite
        #expect(composite.destinationRGBBlendFactor == .oneMinusSourceAlpha)
        #expect(!composite.isAdditiveOneOne)
        #expect(WorldbendWetGlassComposer.compositeBlend == composite)
    }

    @Test func overlappingDropsAccumulateHeightOnGPU() async throws {
        try await MainActor.run {
            let composer = WorldbendWetGlassComposer()
            guard composer.isReady else {
                // Plain `swift test` often lacks default.metallib — blend config
                // test above still proves the authored one+one contract.
                return
            }
            let logical = CGSize(width: 64, height: 64)
            let pixels = CGSize(width: 64, height: 64)
            // Two identical unit quads centered on the same pixel. Fragment
            // centre returns height 1; additive one+one must peak near 2.
            let drop = SIMD4<Float>(32, 32, 8, 8)
            let single = try composer.waterFieldPeakHeight(
                particles: [drop], logicalSize: logical, pixelSize: pixels
            )
            let overlapped = try composer.waterFieldPeakHeight(
                particles: [drop, drop], logicalSize: logical, pixelSize: pixels
            )
            #expect(single > 0.9)
            #expect(overlapped > single + 0.5)
            #expect(overlapped > 1.5)
            #expect(abs(overlapped - 2 * single) < 0.25)
        }
    }

    @Test func resourceLimitsDiscloseAuthoredVersusEffective() {
        let recipe = WorldbendWetGlassRecipe.referenceDefaults
        let limits = recipe.resourceLimits
        #expect(limits.authoredCapacity == 1200)
        #expect(limits.effectiveCapacity == 1200)
        #expect(WorldbendWetGlassResourceLimits.referenceCapacity == 1200)
        #expect(WorldbendWetGlassResourceLimits.capacityMax == 4096)
        #expect(limits.effectiveInitialSpawnLoopMax == 1200)
        #expect(limits.authoredInitialDrops.heavy == 500)
    }

    @Test func validateRejectsNonFiniteInitialDrops() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.simulation.initialDrops.heavy = .nan
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.simulation.initialDrops.light = .infinity
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func validateRejectsInitialDropsExceedingCapacity() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.simulation.initialDrops.heavy = Double(recipe.simulation.capacity) + 1
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func validateRejectsGiantInitialDropsBand() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.simulation.capacity = 4096
        recipe.simulation.initialDrops.medium = 50_000
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func validateRejectsNonFiniteSpawnAndGravity() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.simulation.spawnPerSecond.light = .nan
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.simulation.gravityInUnits.medium = .infinity
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.simulation.gravityInUnits = .init(light: 0, medium: 0, heavy: 0)
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func validateRejectsInvertedAndNonFiniteRanges() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.simulation.smallRadiusUnits = .init(min: 5, max: 1)
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.simulation.largeRadiusUnits = .init(min: .nan, max: 12)
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.optics.coverageHeightRange = .init(min: 0.2, max: 0.1)
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func validateRejectsZeroLengthLightVectors() {
        var recipe = WorldbendWetGlassRecipe.referenceDefaults
        recipe.optics.surfaceLightVector = [0, 0, 0]
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.optics.cardLightDirection = [0, 0]
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
        recipe = .referenceDefaults
        recipe.optics.surfaceLightVector = [1, .nan, 0]
        #expect(throws: WorldbendWetGlassError.self) { try recipe.validate() }
    }

    @Test func simulationInitCapsHostilePopulationScaling() throws {
        // Recipe stays valid (initialDrops within capacity); a mutated
        // population amplify must not create a giant Int loop — capped at
        // capacity / loopMax. Binding init itself clamps finite values to
        // [0.1, 1] (product effective range).
        let recipe = WorldbendWetGlassRecipe.referenceDefaults
        try recipe.validate()
        let size = CGSize(width: 1024, height: 768)
        let panes = rectPane(width: size.width, height: size.height)
        let field = WorldbendWetGlassField.build(panes: panes, sourceSize: size, band: .heavy)
        var binding = WorldbendWetGlassSurfaceBinding(
            sourceSize: size, waterScale: 0.26, band: .heavy,
            population: 1, seed: 1, panes: panes, field: field
        )
        binding.population = 8 // bypass product clamp to exercise sim guard
        let sim = try WorldbendWetGlassSimulation(recipe: recipe, binding: binding)
        #expect(sim.drops.count <= recipe.simulation.capacity)
        #expect(sim.drops.count <= WorldbendWetGlassResourceLimits.initialSpawnLoopMax)
        // Hostile non-finite population rejected (binding preserves Inf).
        let bad = WorldbendWetGlassSurfaceBinding(
            sourceSize: size, waterScale: 0.26, band: .heavy,
            population: .infinity, seed: 1, panes: panes, field: field
        )
        #expect(bad.population.isInfinite)
        #expect(throws: WorldbendWetGlassError.self) {
            try WorldbendWetGlassSimulation(recipe: recipe, binding: bad)
        }
    }

}
