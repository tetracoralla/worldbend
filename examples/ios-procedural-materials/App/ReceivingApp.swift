import SwiftUI
import WorldbendAppearance

@MainActor @Observable
final class ReceivingModel {
    let foil: WorldbendFoilSession
    let mesh: WorldbendMeshGradientSession
    let foilClock = WorldbendMaterialClock(), meshClock = WorldbendMaterialClock()
    let foilNext: WorldbendFoilDelivery, foilLocal: WorldbendFoilDelivery
    let meshNext: WorldbendMeshGradientDelivery, meshLocal: WorldbendMeshGradientDelivery
    let foilUpdates: [WorldbendMaterialUpdate<WorldbendFoilMaterial>]
    let meshUpdates: [WorldbendMaterialUpdate<WorldbendMeshGradientMaterial>]
    var title = "FIELD NOTES"
    var selected = 0
    var newer = false
    var paused = false
    var status = ""
    var error: String?
    static func load<T: Decodable>(_ name: String, _ type: T.Type) throws -> T {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource:"procedural-\(name)",withExtension:"json",subdirectory:"Receipts")
            ?? bundle.url(forResource:"procedural-\(name)",withExtension:"json") else { throw AppearanceError.invalidReceipt }
        return try AppearanceReceipt.decode(type,from:Data(contentsOf:url))
    }
    init() throws {
        foil = try WorldbendFoilSession(Self.load("foil-initial",WorldbendFoilDelivery.self))
        let legacyMesh=ProcessInfo.processInfo.arguments.contains("--legacy-mesh") || (Bundle.main.object(forInfoDictionaryKey:"WorldbendLegacyMeshFixture") as? Bool == true)
        mesh = try WorldbendMeshGradientSession(Self.load(legacyMesh ? "mesh-v1-initial" : "mesh-initial",WorldbendMeshGradientDelivery.self))
        foilNext = try Self.load("foil-source",WorldbendFoilDelivery.self); foilLocal = try Self.load("foil-local",WorldbendFoilDelivery.self)
        meshNext = try Self.load("mesh-source",WorldbendMeshGradientDelivery.self); meshLocal = try Self.load(legacyMesh ? "mesh-v1-local" : "mesh-local",WorldbendMeshGradientDelivery.self)
        foilUpdates = try ["foil-pristine-update","foil-update","foil-removed-update"].map { try Self.load($0,WorldbendMaterialUpdate<WorldbendFoilMaterial>.self) }
        meshUpdates = try (legacyMesh ? ["mesh-profile-pristine-upgrade","mesh-profile-upgrade","mesh-profile-removed-upgrade"] : ["mesh-pristine-update","mesh-update","mesh-removed-update"]).map { try Self.load($0,WorldbendMaterialUpdate<WorldbendMeshGradientMaterial>.self) }
    }
    var removed: Bool { selected == 0 ? foil.delivery == nil : mesh.delivery == nil }
    func action(_ body: () throws -> Void) { do { try body(); error = nil } catch { self.error = error.localizedDescription } }
    func localColor() {
        action {
            if selected == 0 { try foil.updateLocal(newer ? foilUpdates[1].delivery! : foilLocal) }
            else { try mesh.updateLocal(newer ? meshUpdates[1].delivery! : meshLocal) }
            status = "本地颜色"
        }
    }
    func nextDesign() {
        action {
            let f = foil.delivery == nil ? 2 : (foil.delivery?.fingerprint == foil.source.fingerprint ? 0 : 1)
            let m = mesh.delivery == nil ? 2 : (mesh.delivery?.fingerprint == mesh.source.fingerprint ? 0 : 1)
            try foil.update(foilUpdates[f],source:foilNext); try mesh.update(meshUpdates[m],source:meshNext)
            newer = true; status = f == 1 || m == 1 ? "新版设计 · 保留本地颜色" : "新版设计"
        }
    }
    func toggleRemoval() {
        action {
            if selected == 0 { if removed { try foil.reattach(foil.source) } else { foil.remove() } }
            else { if removed { try mesh.reattach(mesh.source) } else { mesh.remove() } }
            status = removed ? "材质已移除" : "材质已恢复"
        }
    }
    func togglePause() { paused.toggle(); foilClock.setPaused(paused); meshClock.setPaused(paused) }
}

@MainActor
struct ReceivingView: View {
    @State private var model: ReceivingModel?
    @State private var startupError: String?
    var body: some View {
        Group {
            if let model { work(model) }
            else if let startupError { Text(startupError).padding() }
            else { ProgressView() }
        }
        .task { if model == nil { do { model = try ReceivingModel() } catch { startupError = error.localizedDescription } } }
        .frame(minWidth:340,minHeight:660)
        .preferredColorScheme(.light)
    }
    func work(_ model: ReceivingModel) -> some View {
        @Bindable var model = model
        return VStack(spacing:18) {
            HStack {
                Text("材质续接").font(.system(size:25,weight:.semibold,design:.serif))
                Spacer()
                Picker("表面",selection:$model.selected) {
                    Text("金属箔").tag(0); Text("流光").tag(1)
                }.pickerStyle(.segmented).frame(maxWidth:180)
            }
            ZStack {
                Color(red:0.06,green:0.1,blue:0.12)
                Ellipse().fill(.black.opacity(0.5)).frame(width:280,height:25).blur(radius:16).offset(y:165)
                ZStack(alignment:.trailing) {
                    RoundedRectangle(cornerRadius:7).fill(Color(red:0.9,green:0.88,blue:0.8)).frame(width:252,height:330).offset(x:12,y:4)
                    ZStack {
                        Color(red:0.08,green:0.16,blue:0.19)
                        if model.selected == 0 {
                            WorldbendMaterialSurface(model.foil,clock:model.foilClock,onError:{ model.error = $0 })
                        } else {
                            WorldbendMaterialSurface(model.mesh,clock:model.meshClock,onError:{ model.error = $0 })
                        }
                        VStack(alignment:.leading,spacing:0) {
                            Text(model.newer ? "2027 / 02" : "2026 / 01").font(.system(size:11,weight:.semibold,design:.monospaced)).tracking(3)
                            Spacer()
                            Text(model.title.replacingOccurrences(of:" ",with:"\n"))
                                .font(.system(size:49,weight:.semibold,design:.serif)).lineSpacing(-6).minimumScaleFactor(0.55)
                            Spacer()
                            Rectangle().fill(.white.opacity(0.7)).frame(width:42,height:2)
                        }.padding(28).foregroundStyle(.white)
                    }.frame(width:252,height:330).clipShape(RoundedRectangle(cornerRadius:7))
                }
                .rotation3DEffect(.degrees(-16),axis:(x:0,y:1,z:0),perspective:0.65)
                .rotationEffect(.degrees(-6)).shadow(color:.black.opacity(0.3),radius:24,x:16,y:18)
            }.frame(height:410).clipShape(RoundedRectangle(cornerRadius:18))
            HStack {
                Text("封面标题").foregroundStyle(.secondary)
                TextField("封面标题",text:$model.title).textFieldStyle(.roundedBorder)
            }
            ViewThatFits(in:.horizontal) {
                HStack { actions(model) }
                VStack(spacing:10) { actions(model) }
            }.buttonStyle(.bordered)
            HStack {
                if let error = model.error { Text(error).foregroundStyle(.red).font(.caption) }
                else { Text(model.status).foregroundStyle(.secondary).font(.caption) }
                Spacer()
            }.frame(minHeight:18)
        }.padding(24).background(Color(red:0.94,green:0.93,blue:0.89))
    }
    @ViewBuilder func actions(_ model: ReceivingModel) -> some View {
        Button(model.paused ? "继续动态" : "暂停动态",action:model.togglePause)
        Button("本地改色",action:model.localColor).disabled(model.removed)
        Button("新版设计",action:model.nextDesign).disabled(model.newer)
        Button(model.removed ? "恢复材质" : "移除材质",action:model.toggleRemoval)
    }
}

@main
struct WorldbendMaterialReceivingApp: App {
    var body: some Scene {
        WindowGroup("Worldbend 材质续接") {
            if ProcessInfo.processInfo.arguments.contains("--personal-preferences") || Bundle.main.object(forInfoDictionaryKey:"WorldbendPersonalPreferences") as? Bool == true {PersonalReceivingView()}
            else{ReceivingView()}
        }
    }
}
