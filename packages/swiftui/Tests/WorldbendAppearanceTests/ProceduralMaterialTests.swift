import CoreGraphics
import Foundation
import ImageIO
import Metal
import Testing
@testable import WorldbendAppearance

@MainActor
struct ProceduralMaterialTests {
    func data(_ name: String) throws -> Data {
        try Data(contentsOf: #require(Bundle.module.url(forResource:"procedural-\(name)",withExtension:"json",subdirectory:"Receipts")))
    }
    func load<T: Decodable>(_ name: String, _ type: T.Type) throws -> T {
        try AppearanceReceipt.decode(type,from:data(name))
    }
    @Test func foilRevisionKeepsLocalTintAndRejectsStalePreview() throws {
        let first = try load("foil-initial",WorldbendFoilDelivery.self)
        let next = try load("foil-source",WorldbendFoilDelivery.self)
        let local = try load("foil-local",WorldbendFoilDelivery.self)
        let update = try load("foil-update",WorldbendMaterialUpdate<WorldbendFoilMaterial>.self)
        let session = try WorldbendFoilSession(first)
        try session.updateLocal(local)
        var preview = local.material; preview.roughness = 0.9
        try session.preview(preview)
        #expect(session.displayedMaterial?.roughness == 0.9)
        #expect(session.delivery == local)
        #expect(throws: AppearanceError.self) { try session.update(update,source:next) }
        session.cancelPreview(); try session.update(update,source:next)
        #expect(session.delivery?.material.highlightColor.a == 0.2)
        #expect(session.delivery?.material.intensity == 0.35)
        #expect(session.preserved == ["highlight-color"])
        #expect(throws: AppearanceError.self) { try session.update(update,source:next) }
        #expect(throws: AppearanceError.self) { try session.updateLocal(local) }
    }
    @Test func meshRevisionKeepsIndependentPhaseAndLocalAlpha() throws {
        let first = try load("mesh-initial",WorldbendMeshGradientDelivery.self)
        let next = try load("mesh-source",WorldbendMeshGradientDelivery.self)
        let local = try load("mesh-local",WorldbendMeshGradientDelivery.self)
        let update = try load("mesh-update",WorldbendMaterialUpdate<WorldbendMeshGradientMaterial>.self)
        let session = try WorldbendMeshGradientSession(first)
        try session.updateLocal(local); try session.update(update,source:next)
        #expect(session.delivery?.material.phaseMs == 3400)
        #expect(session.delivery?.material.colorTr.a == 0.4)
        #expect(session.delivery?.material.warp == 0.8)
        #expect(session.preserved == ["color-tr","phase-ms"])
    }
    @Test func explicitRemovalSurvivesSourceRevisionAndNullRoundtrip() throws {
        let first = try load("foil-initial",WorldbendFoilDelivery.self)
        let next = try load("foil-source",WorldbendFoilDelivery.self)
        let update = try load("foil-removed-update",WorldbendMaterialUpdate<WorldbendFoilMaterial>.self)
        let roundtrip = try JSONDecoder().decode(WorldbendMaterialUpdate<WorldbendFoilMaterial>.self,from:JSONEncoder().encode(update))
        #expect(roundtrip == update)
        let session = try WorldbendFoilSession(first); session.remove()
        try session.update(roundtrip,source:next)
        #expect(session.delivery == nil); #expect(session.source == next)
        #expect(throws: AppearanceError.self) { try session.preview(next.material) }
        #expect(throws: AppearanceError.self) { try session.updateLocal(next) }
        try session.reattach(next); #expect(session.displayedMaterial == next.material)
    }
    @Test func refusedReceiptsPreserveExistingSession() throws {
        let first = try load("foil-initial",WorldbendFoilDelivery.self), session = try WorldbendFoilSession(first)
        var object = try #require(JSONSerialization.jsonObject(with:data("foil-initial")) as? [String:Any])
        object["target"] = "web"
        let wrongTarget = try JSONDecoder().decode(WorldbendFoilDelivery.self,from:JSONSerialization.data(withJSONObject:object))
        #expect(throws: AppearanceError.self) { try session.updateLocal(wrongTarget) }
        object["target"] = "swiftui"
        var kernel = try #require(object["kernel"] as? [String:Any]); kernel["source"] = first.kernel.source + "\n"
        object["kernel"] = kernel
        let corrupted = try JSONDecoder().decode(WorldbendFoilDelivery.self,from:JSONSerialization.data(withJSONObject:object))
        #expect(throws: AppearanceError.self) { try WorldbendMaterialRenderer(corrupted) }
        #expect(session.delivery == first)
        var bad = first.material; bad.intensity = .nan
        #expect(throws: AppearanceError.self) { try session.preview(bad) }
        #expect(session.previewMaterial == nil)
        var partial = try #require(JSONSerialization.jsonObject(with:data("foil-removed-update")) as? [String:Any])
        partial.removeValue(forKey:"delivery")
        #expect(throws: AppearanceError.self) { try JSONDecoder().decode(WorldbendMaterialUpdate<WorldbendFoilMaterial>.self,from:JSONSerialization.data(withJSONObject:partial)) }
    }
    @Test func perSurfaceClocksPauseAndResumeWithoutSuspendedTime() throws {
        let start = Date(timeIntervalSinceReferenceDate:100), a = WorldbendMaterialClock(), b = WorldbendMaterialClock()
        a.setVisible(true,at:start); b.setVisible(true,at:start)
        a.setPaused(true,at:start.addingTimeInterval(1.5))
        #expect(a.milliseconds(at:start.addingTimeInterval(10)) == 1500)
        #expect(b.milliseconds(at:start.addingTimeInterval(10)) == 10000)
        a.setPaused(false,at:start.addingTimeInterval(10)); #expect(a.milliseconds(at:start.addingTimeInterval(11)) == 2500)
        a.setReducedMotion(true,at:start.addingTimeInterval(11)); a.setVisible(false,at:start.addingTimeInterval(20))
        a.setReducedMotion(false,at:start.addingTimeInterval(21)); #expect(!a.running)
        a.setVisible(true,at:start.addingTimeInterval(30)); #expect(a.milliseconds(at:start.addingTimeInterval(31)) == 3500)
        try a.seek(milliseconds:250,at:start.addingTimeInterval(31)); #expect(a.milliseconds(at:start.addingTimeInterval(32)) == 1250)
        #expect(throws: AppearanceError.self) { try a.seek(milliseconds:.infinity) }
    }
    func pixels<M: WorldbendProceduralMaterial>(_ renderer: WorldbendMaterialRenderer<M>, _ material: M,
                time: Double = 0, width: Int = 160, height: Int = 100, evidence: String? = nil) throws -> [UInt8] {
        let texture = try renderer.makeTexture(width:width,height:height)
        let command = try renderer.draw(material,milliseconds:time,into:texture); command.waitUntilCompleted()
        #expect(command.status == .completed); #expect(command.error == nil)
        var bytes = [UInt8](repeating:0,count:width * height * 4)
        bytes.withUnsafeMutableBytes { texture.getBytes($0.baseAddress!,bytesPerRow:width * 4,from:MTLRegionMake2D(0,0,width,height),mipmapLevel:0) }
        if let evidence, let folder = ProcessInfo.processInfo.environment["WORLDBEND_MATERIAL_EVIDENCE"] {
            let directory = URL(fileURLWithPath:folder); try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            let provider = try #require(CGDataProvider(data:Data(bytes) as CFData))
            let image = try #require(CGImage(width:width,height:height,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:width * 4,
                space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.premultipliedLast.rawValue),
                provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent))
            let destination = try #require(CGImageDestinationCreateWithURL(directory.appendingPathComponent(evidence + ".png") as CFURL,"public.png" as CFString,1,nil))
            CGImageDestinationAddImage(destination,image,nil); #expect(CGImageDestinationFinalize(destination))
        }
        return bytes
    }
    @Test func realFoilGPURespectsCoverageMotionAndInvisibleState() throws {
        let delivery = try load("foil-initial",WorldbendFoilDelivery.self)
        let renderer = try WorldbendMaterialRenderer(delivery)
        var base = delivery.material; base.intensity = 0
        let neutral = try pixels(renderer,base)
        for (channel,value) in [base.baseColor.r * base.baseColor.a,base.baseColor.g * base.baseColor.a,base.baseColor.b * base.baseColor.a,base.baseColor.a].enumerated() {
            #expect(abs(Int(neutral[channel]) - Int((value * 255).rounded())) <= 1)
        }
        let first = try pixels(renderer,delivery.material,evidence:"foil-0")
        let next = try pixels(renderer,delivery.material,time:2300,evidence:"foil-2300")
        #expect(first != next)
        var transparent = delivery.material; transparent.highlightColor.a = 0
        let hiddenA = try pixels(renderer,transparent)
        transparent.highlightColor = .init(0,1,0,0)
        #expect(try pixels(renderer,transparent) == hiddenA)
        base.visible = false; #expect(try pixels(renderer,base).allSatisfy { $0 == 0 })
        #expect(throws: WorldbendMaterialRenderError.self) { try renderer.makeTexture(width:Int.max,height:2) }
        let readOnly = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:16,height:16,mipmapped:false)
        readOnly.usage = .shaderRead
        let invalidTarget = try #require(renderer.device.makeTexture(descriptor:readOnly))
        #expect(throws: WorldbendMaterialRenderError.self) { try renderer.draw(base,milliseconds:0,into:invalidTarget) }
    }
    @Test func completionRegistersBeforeGPUCommitAndObservesActualCompletion() throws {
        let delivery = try load("foil-initial",WorldbendFoilDelivery.self)
        let renderer = try WorldbendMaterialRenderer(delivery), texture = try renderer.makeTexture(width:16,height:16)
        let signal = DispatchSemaphore(value:0)
        let command = try renderer.draw(delivery.material,milliseconds:0,into:texture) { command in
            if command.status == .completed { signal.signal() }
        }
        command.waitUntilCompleted()
        #expect(signal.wait(timeout:.now() + 1) == .success)
    }
    @Test func realMeshGPUKeepsStaticBilinearCoverageAndMovesTheFluidField() throws {
        let delivery = try load("mesh-initial",WorldbendMeshGradientDelivery.self)
        let renderer = try WorldbendMaterialRenderer(delivery)
        var material = delivery.material; material.warp = 0
        let first = try pixels(renderer,material,width:16,height:16)
        #expect(try pixels(renderer,material,time:3000,width:16,height:16) == first)
        let s = pow(8.5 / 16,1.35 + (0.55 - 1.35) * material.softness)
        let colors = [material.colorTl,material.colorTr,material.colorBl,material.colorBr]
        let weights = [(1-s)*(1-s),s*(1-s),(1-s)*s,s*s]
        for channel in 0..<4 {
            let value = zip(colors,weights).reduce(0.0) { sum,pair in
                let c = pair.0, values = [c.r*c.a,c.g*c.a,c.b*c.a,c.a]
                return sum + values[channel] * pair.1
            }
            #expect(abs(Int(first[(8*16+8)*4+channel]) - Int((value * 255).rounded())) <= 2)
        }
        let moving = try pixels(renderer,delivery.material,evidence:"mesh-0")
        #expect(try pixels(renderer,delivery.material,time:2300,evidence:"mesh-2300") != moving)
        material.visible = false; #expect(try pixels(renderer,material).allSatisfy { $0 == 0 })
    }
    @Test func realMeshLoopHasNoVisibleResetAtItsPhaseBoundary() throws {
        let delivery = try load("mesh-initial",WorldbendMeshGradientDelivery.self)
        let renderer = try WorldbendMaterialRenderer(delivery)
        let edge = delivery.material.durationMs - delivery.material.phaseMs
        let before = try pixels(renderer,delivery.material,time:edge - 0.01)
        let after = try pixels(renderer,delivery.material,time:edge + 0.01)
        let maximum = zip(before,after).map { abs(Int($0)-Int($1)) }.max()!
        print("MESH_LOOP_BOUNDARY_MAX_DELTA=\(maximum)")
        #expect(maximum <= 1)
        for (duration,phase,speed) in [(100.0,0.0,0.0),(100.0,60000.0,2.0),(8000.0,3400.0,0.45),(60000.0,60000.0,1.3)] {
            var material=delivery.material;material.durationMs=duration;material.phaseMs=phase;material.flowSpeed=speed;material.warp=1
            let boundary=duration-phase.truncatingRemainder(dividingBy:duration), epsilon=duration * 0.000001
            let a=try pixels(renderer,material,time:boundary-epsilon),b=try pixels(renderer,material,time:boundary+epsilon)
            #expect(zip(a,b).map { abs(Int($0)-Int($1)) }.max()! <= 1)
        }
    }
    @Test func legacyRendererAndExplicitProfileUpgradeKeepIdentityAndLocalValues() throws {
        let old = try load("mesh-v1-initial",WorldbendMeshGradientDelivery.self)
        let local = try load("mesh-v1-local",WorldbendMeshGradientDelivery.self)
        let next = try load("mesh-source",WorldbendMeshGradientDelivery.self)
        let update = try load("mesh-profile-upgrade",WorldbendMaterialUpdate<WorldbendMeshGradientMaterial>.self)
        #expect(old.kernel.id == "worldbend.mesh-gradient.rgba@0.1")
        #expect(old.kernel.sha256 == "sha256:0d05e7dde510e0a93b50ec2a8b64fda317d3c0f3713297b8fa924ce1086ca926")
        let renderer = try WorldbendMaterialRenderer(old)
        let edge = old.material.durationMs - old.material.phaseMs
        let before = try pixels(renderer,old.material,time:edge - 0.01)
        let after = try pixels(renderer,old.material,time:edge + 0.01)
        #expect(zip(before,after).map { abs(Int($0)-Int($1)) }.max()! > 1)
        let session = try WorldbendMeshGradientSession(old); try session.updateLocal(local)
        #expect(throws: AppearanceError.self) { try session.updateLocal(next) }
        try session.update(update,source:next)
        #expect(session.delivery?.kernel.id == "worldbend.mesh-gradient.rgba@0.2")
        #expect(session.delivery?.material.colorTr == local.material.colorTr)
        #expect(session.delivery?.material.phaseMs == local.material.phaseMs)
        #expect(throws: AppearanceError.self) { try session.update(update,source:next) }
    }
}
