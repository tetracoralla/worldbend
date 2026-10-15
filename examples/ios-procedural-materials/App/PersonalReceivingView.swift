import Foundation
import SwiftUI
import WorldbendAppearance

@MainActor @Observable
final class PersonalReceivingModel {
    var foil:WorldbendFoilPreferenceSession
    var mesh:WorldbendMeshGradientPreferenceSession
    let foilInitial:WorldbendFoilDelivery,meshInitial:WorldbendMeshGradientDelivery
    let foilNext:WorldbendFoilDelivery,meshNext:WorldbendMeshGradientDelivery
    let foilClock=WorldbendMaterialClock(),meshClock=WorldbendMaterialClock()
    var selected=0
    var title="FIELD NOTES"
    var newer=false
    var status=""
    var error:String?
    var foilRenderError:String?
    var meshRenderError:String?
    var renderLimitValid=true
    private let store:PersonalPreferenceFileStore?
    @ObservationIgnored private var saveGeneration=0
    struct Saved:Codable {let schema:String;let foil,mesh:Data;let selected:Int;let title:String;let newer,foilRemoved,meshRemoved:Bool}
    init() throws {
        let firstFoil=try ReceivingModel.load("foil-initial",WorldbendFoilDelivery.self)
        let firstMesh=try ReceivingModel.load("mesh-initial",WorldbendMeshGradientDelivery.self)
        foilInitial=firstFoil;meshInitial=firstMesh
        foilNext=try ReceivingModel.load("personal-foil-source",WorldbendFoilDelivery.self)
        meshNext=try ReceivingModel.load("personal-mesh-source",WorldbendMeshGradientDelivery.self)
        foil=try WorldbendFoilPreferenceSession(firstFoil,policy:.init(policyId:"native-book",scopes:["book-cover"],exposed:[.init("roughness",min:0,max:1),.init("base-color"),.init("visible"),.init("flow-speed",min:0,max:1)]),scope:"book-cover")
        mesh=try WorldbendMeshGradientPreferenceSession(firstMesh,policy:.init(policyId:"native-book",scopes:["book-cover"],exposed:[.init("softness",min:0,max:1),.init("color-tl"),.init("visible"),.init("flow-speed",min:0,max:1)]),scope:"book-cover")
        let explicit=ProcessInfo.processInfo.environment["WORLDBEND_MATERIAL_PREFERENCE_STORE"] ?? (Bundle.main.object(forInfoDictionaryKey:"WorldbendPreferenceStore") as? String)
        store=explicit.map {PersonalPreferenceFileStore(URL(fileURLWithPath:$0))}
        renderLimitValid=Bundle.main.object(forInfoDictionaryKey:"WorldbendInvalidMaterialSize") as? Bool != true
        status=store==nil ? "本次会话 · 未配置保存位置" : "设计默认值"
    }
    func readSaved()async{
        guard let store else{return}
        let firstFoil=foil.guardToken,firstMesh=mesh.guardToken,firstTitle=title,firstSelected=selected,firstSave=saveGeneration
        status="正在读取个人选择"
        do{
            guard let data=try await store.read() else{status="设计默认值";return}
            let saved=try JSONDecoder().decode(Saved.self,from:data);guard saved.schema=="worldbend.native-material-study@0.1",(0...1).contains(saved.selected),saved.title.utf8.count<=4096 else {throw AppearanceError.invalidReceipt}
            let nextFoil=try WorldbendFoilPreferenceSession(saved.newer ? foilNext:foilInitial,policy:foil.policy,scope:foil.preference.scope)
            let nextMesh=try WorldbendMeshGradientPreferenceSession(saved.newer ? meshNext:meshInitial,policy:mesh.policy,scope:mesh.preference.scope)
            try nextFoil.restorePreference(saved.foil,guard:nextFoil.guardToken);try nextMesh.restorePreference(saved.mesh,guard:nextMesh.guardToken)
            if saved.foilRemoved {try nextFoil.remove(guard:nextFoil.guardToken)}
            if saved.meshRemoved {try nextMesh.remove(guard:nextMesh.guardToken)}
            guard foil.guardToken==firstFoil,mesh.guardToken==firstMesh,title==firstTitle,selected==firstSelected,saveGeneration==firstSave else{status="当前修改已保留 · 可重新读取保存内容";return}
            foil=nextFoil;mesh=nextMesh;newer=saved.newer;selected=saved.selected;title=saved.title;status="个人材质已恢复";error=nil;foilRenderError=nil;meshRenderError=nil
        }catch{status="保存记录无法恢复 · 文件已保留";self.error="保存记录无法恢复 · 当前内容和文件已保留"}
    }
    var currentValue:Double {selected==0 ? foil.displayedMaterial?.roughness ?? foil.committedMaterial.roughness : mesh.displayedMaterial?.softness ?? mesh.committedMaterial.softness}
    var previewing:Bool {selected==0 ? foil.previewing : mesh.previewing}
    var removed:Bool {selected==0 ? foil.isRemoved : mesh.isRemoved}
    var paused:Bool {selected==0 ? !foil.runtime.motionAllowed : !mesh.runtime.motionAllowed}
    var displayedError:String?{(selected==0 ? foilRenderError:meshRenderError) ?? error}
    func action(_ block:()throws->Void){do{try block();error=nil}catch{self.error=error.localizedDescription}}
    func preview(_ value:Double){action{if selected==0 {try foil.preview(["roughness":.number(value)],guard:foil.guardToken)}else{try mesh.preview(["softness":.number(value)],guard:mesh.guardToken)};status="预览 · 应用后保留"}}
    func tint(){action{if selected==0{try foil.preview(["base-color":.rgba(.init(0.08,0.31,0.52))],guard:foil.guardToken)}else{try mesh.preview(["color-tl":.rgba(.init(0.12,0.66,0.54))],guard:mesh.guardToken)};status="预览 · 应用后保留"}}
    func apply(){action{if selected==0{try foil.applyPreview(guard:foil.guardToken)}else{try mesh.applyPreview(guard:mesh.guardToken)};try save()}}
    func cancel(){if selected==0{foil.cancelPreview()}else{mesh.cancelPreview()};status="预览已取消";error=nil}
    func keepCurrent(){action{if selected==0{try foil.commit(["roughness":.number(currentValue)],guard:foil.guardToken)}else{try mesh.commit(["softness":.number(currentValue)],guard:mesh.guardToken)};try save()}}
    func reset(){action{if selected==0{try foil.reset(guard:foil.guardToken)}else{try mesh.reset(guard:mesh.guardToken)};try save()}}
    func nextDesign(save shouldSave:Bool=true)throws{
        try foil.updateSource(foilNext,policy:foil.policy,guard:foil.guardToken)
        try mesh.updateSource(meshNext,policy:mesh.policy,guard:mesh.guardToken)
        newer=true;status="新版设计 · 保留个人选择";if shouldSave{try save()}
    }
    func changeDesign(){action{try nextDesign()}}
    func togglePause(){action{if selected==0{var runtime=foil.runtime;runtime.motionAllowed.toggle();try foil.setRuntime(runtime,guard:foil.guardToken)}else{var runtime=mesh.runtime;runtime.motionAllowed.toggle();try mesh.setRuntime(runtime,guard:mesh.guardToken)}}}
    func toggleRemoval(){action{if selected==0{if removed{try foil.reattach(guard:foil.guardToken)}else{try foil.remove(guard:foil.guardToken)}}else{if removed{try mesh.reattach(guard:mesh.guardToken)}else{try mesh.remove(guard:mesh.guardToken)}};try save()}}
    func retry(){action{renderLimitValid=true;if selected==0{try foil.retryRenderer(guard:foil.guardToken);foilRenderError=nil}else{try mesh.retryRenderer(guard:mesh.guardToken);meshRenderError=nil};status="重试材质"}}
    func save()throws{
        guard let store else {status="选择已应用 · 本次会话";return}
        let saved=Saved(schema:"worldbend.native-material-study@0.1",foil:try foil.exportPreference(),mesh:try mesh.exportPreference(),selected:selected,title:title,newer:newer,foilRemoved:foil.isRemoved,meshRemoved:mesh.isRemoved)
        let data=try JSONEncoder().encode(saved);guard data.count<=65536 else{throw AppearanceError.invalidReceipt}
        saveGeneration+=1;let current=saveGeneration;status="选择已应用 · 正在保存"
        Task{[weak self] in
            do{try await store.write(data,generation:current);guard let self,current==self.saveGeneration else{return};self.status="个人选择已保存";self.error=nil}
            catch{guard let self,current==self.saveGeneration else{return};self.status="材质已应用 · 保存失败，请重试";self.error="保存失败 · 当前修改仍可用，请重试"}
        }
    }
    func saveAgain(){action{try save()}}
}

@MainActor
struct PersonalReceivingView:View {
    @State private var model:PersonalReceivingModel?
    @State private var startupError:String?
    var body:some View{
        Group{if let model{work(model)}else if let startupError{Text(startupError).padding()}else{ProgressView()}}
            .task{if model==nil{do{let loaded=try PersonalReceivingModel();model=loaded;await loaded.readSaved()}catch{startupError=error.localizedDescription}}}
            .frame(minWidth:360,minHeight:760).preferredColorScheme(.light)
    }
    func work(_ model:PersonalReceivingModel)->some View{
        @Bindable var model=model
        let renderedFoil=model.foil,renderedMesh=model.mesh
        return ScrollView{
            VStack(spacing:16){
                HStack{Text("个人材质").font(.system(size:25,weight:.semibold,design:.serif));Spacer();Picker("材质",selection:$model.selected){Text("金属箔").tag(0);Text("流光").tag(1)}.pickerStyle(.segmented).frame(maxWidth:180)}
                ZStack{
                    Color(red:0.06,green:0.1,blue:0.12)
                    ZStack{
                        Color(red:0.08,green:0.16,blue:0.19)
                        if model.selected==0{WorldbendMaterialSurface(renderedFoil,clock:model.foilClock,maxPixels:model.renderLimitValid ? 16_777_216:0,onError:{_ in if model.foil===renderedFoil && !renderedFoil.isRemoved{model.foilRenderError="材质暂时无法显示 · 可以重试"}})}
                        else{WorldbendMaterialSurface(renderedMesh,clock:model.meshClock,maxPixels:model.renderLimitValid ? 16_777_216:0,onError:{_ in if model.mesh===renderedMesh && !renderedMesh.isRemoved{model.meshRenderError="材质暂时无法显示 · 可以重试"}})}
                        VStack(alignment:.leading){Text(model.newer ? "2027 / 02":"2026 / 01").font(.system(size:11,weight:.semibold,design:.monospaced)).tracking(3);Spacer();Text(model.title.replacingOccurrences(of:" ",with:"\n")).font(.system(size:49,weight:.semibold,design:.serif)).minimumScaleFactor(0.55);Spacer();Rectangle().fill(.white.opacity(0.7)).frame(width:42,height:2)}.padding(28).foregroundStyle(.white)
                    }.frame(width:252,height:330).clipShape(RoundedRectangle(cornerRadius:7)).rotation3DEffect(.degrees(-16),axis:(x:0,y:1,z:0),perspective:0.65).rotationEffect(.degrees(-6)).shadow(color:.black.opacity(0.3),radius:24,x:16,y:18)
                }.frame(height:390).clipShape(RoundedRectangle(cornerRadius:18))
                HStack{Text("封面标题").foregroundStyle(.secondary);TextField("封面标题",text:$model.title).textFieldStyle(.roundedBorder).onSubmit{model.saveAgain()}}
                HStack{Text(model.selected==0 ? "柔和度":"融合度");Slider(value:Binding(get:{model.currentValue},set:{model.preview($0)}),in:0...1).disabled(model.removed);Text(model.currentValue,format:.number.precision(.fractionLength(2))).monospacedDigit().frame(width:44)}
                HStack{Button("应用",action:model.apply).disabled(!model.previewing);Button("取消",action:model.cancel).disabled(!model.previewing);Button("预览改色",action:model.tint).disabled(model.removed)}
                ViewThatFits(in:.horizontal){HStack{actions(model)};VStack{actions(model)}}
                HStack{Button(model.paused ? "继续动态":"暂停动态",action:model.togglePause);Button(model.removed ? "恢复材质":"移除材质",action:model.toggleRemoval);Button("保存",action:model.saveAgain)}
                if !(model.selected==0 ? model.foil.runtime.rendererAvailable:model.mesh.runtime.rendererAvailable){Button("重试材质",action:model.retry)}
                Button("读取保存内容"){Task{await model.readSaved()}}
                HStack{Text(model.displayedError ?? model.status).font(.caption).foregroundStyle(model.displayedError == nil ? Color.secondary:Color.red);Spacer()}.frame(minHeight:18)
            }.padding(24).buttonStyle(.bordered)
        }.background(Color(red:0.94,green:0.93,blue:0.89))
    }
    @ViewBuilder func actions(_ model:PersonalReceivingModel)->some View{
        Button("保留当前值",action:model.keepCurrent).disabled(model.removed)
        Button("设计默认值",action:model.reset).disabled(model.removed)
        Button("新版设计",action:model.changeDesign).disabled(model.newer)
    }
}
