import Foundation
import Metal
import Testing
@testable import WorldbendAppearance

private struct MaterialPreferenceFixture<Material: WorldbendProceduralMaterial>: Decodable {
    struct Item: Decodable {
        let name: String
        let source: WorldbendMaterialDelivery<Material>
        let policy: WorldbendMaterialExposurePolicy
        let preference: WorldbendMaterialPreferenceRecord
        let runtime: WorldbendMaterialPreferenceRuntime
        let expectedMaterial: Material
        struct Receipt: Decodable {let field,state:String}
        struct Control: Decodable {let field,state,unit,direction:String;let authoredRange,effectiveRange:[Double]?}
        let receipts:[Receipt]
        let controls:[Control]
    }
    let cases:[Item]
}
@MainActor
struct MaterialPreferenceTests {
    private func fixture<M:WorldbendProceduralMaterial>(_ material:M.Type) throws -> MaterialPreferenceFixture<M> {
        let url=try #require(Bundle.module.url(forResource:M.family,withExtension:"json",subdirectory:"Fixtures/material-preferences"))
        return try JSONDecoder().decode(MaterialPreferenceFixture<M>.self,from:Data(contentsOf:url))
    }
    private func parity<M:WorldbendProceduralMaterial>(_ material:M.Type) throws {
        for item in try fixture(M.self).cases {
            let session=try WorldbendMaterialPreferenceSession(item.source,policy:item.policy,scope:item.preference.scope,preference:item.preference,runtime:item.runtime)
            #expect(session.committedMaterial==item.expectedMaterial,Comment(rawValue:item.name))
            #expect(session.source==item.source)
            #expect(session.preference==item.preference)
            #expect(Dictionary(uniqueKeysWithValues:session.receipts.map {($0.field,$0.state)})==Dictionary(uniqueKeysWithValues:item.receipts.map {($0.field,$0.state)}))
            for control in item.controls {
                let actual=try #require(session.controls.first(where:{$0.field==control.field}))
                #expect(actual.state==control.state);#expect(actual.unit==control.unit);#expect(actual.direction==control.direction)
                #expect(actual.authoredRange==control.authoredRange);#expect(actual.effectiveRange==control.effectiveRange)
            }
        }
    }
    @Test func canonicalFoilParity() throws {try parity(WorldbendFoilMaterial.self)}
    @Test func canonicalMeshAndFrozenProfileParity() throws {try parity(WorldbendMeshGradientMaterial.self)}
    @Test func explicitDefaultAndComposedDraftRetainSourceAndRejectEarlierAgent() throws {
        let items=try fixture(WorldbendMeshGradientMaterial.self).cases
        let initial=items.first(where:{$0.name=="empty"})!,later=items.first(where:{$0.name=="later-design"})!
        let s=try WorldbendMeshGradientPreferenceSession(initial.source,policy:initial.policy,scope:initial.preference.scope)
        let old=s.guardToken;try s.preview(["softness":.number(initial.source.material.softness)],guard:old)
        #expect(s.preference.fields.isEmpty);#expect(s.previewing)
        #expect(throws:AppearanceError.staleUpdate){try s.commit(["softness":.number(0.1)],guard:old,actor:.agent)}
        try s.preview(["color-tl":.rgba(.init(0.1,0.2,0.3,0.4))],guard:s.guardToken)
        try s.applyPreview(guard:s.guardToken)
        #expect(s.preference.fields.count==2);#expect(s.committedMaterial.colorTl.a==0.4)
        try s.updateSource(later.source,policy:later.policy,guard:s.guardToken)
        #expect(s.committedMaterial.softness==initial.source.material.softness);#expect(s.source==later.source)
        try s.preview(["softness":.number(0.9)],guard:s.guardToken);s.cancelPreview()
        #expect(s.displayedMaterial==s.committedMaterial)
        let saved=try s.exportPreference()
        let restarted=try WorldbendMeshGradientPreferenceSession(later.source,policy:later.policy,scope:initial.preference.scope)
        try restarted.restorePreference(saved,guard:restarted.guardToken)
        #expect(restarted.committedMaterial==s.committedMaterial)
        try restarted.reset(guard:restarted.guardToken);#expect(restarted.committedMaterial==later.source.material)
        #expect(restarted.preference.fields.isEmpty)
    }
    @Test func runtimePolicyAndRemovalKeepIntentAndGuardCurrentState() throws {
        let items=try fixture(WorldbendFoilMaterial.self).cases
        let first=items.first(where:{$0.name=="explicit-default"})!,hidden=items.first(where:{$0.name=="hidden"})!,later=items.first(where:{$0.name=="later-design"})!
        let s=try WorldbendFoilPreferenceSession(first.source,policy:first.policy,scope:first.preference.scope,preference:first.preference)
        try s.updateSource(hidden.source,policy:hidden.policy,guard:s.guardToken)
        #expect(s.committedMaterial.roughness==hidden.source.material.roughness);#expect(s.preference.fields["roughness"] != nil)
        var restored=later.policy;restored.revision=3;try s.updateSource(later.source,policy:restored,guard:s.guardToken)
        #expect(s.committedMaterial.roughness==first.source.material.roughness)
        let before=s.guardToken;s.setSystemReducedMotion(true)
        #expect(throws:AppearanceError.staleUpdate){try s.commit(["roughness":.number(0.4)],guard:before)}
        #expect(s.controls.first(where:{$0.field=="flow-speed"})?.state=="adapted")
        #expect(s.preference==first.preference)
        try s.remove(guard:s.guardToken);try s.updateSource(later.source,policy:restored,guard:s.guardToken)
        #expect(s.displayedMaterial==nil);try s.reattach(guard:s.guardToken);#expect(s.displayedMaterial==s.committedMaterial)
        let clock=WorldbendMaterialClock(),start=Date(timeIntervalSinceReferenceDate:100)
        clock.setVisible(true,at:start);clock.setRuntimeMotionAllowed(false,at:start.addingTimeInterval(1))
        #expect(clock.milliseconds(at:start.addingTimeInterval(20))==1000)
        clock.setRuntimeMotionAllowed(true,at:start.addingTimeInterval(20));#expect(clock.milliseconds(at:start.addingTimeInterval(21))==2000)
    }
    @Test func failedPreferenceRestoreAndWrongScopePreserveLastValidState() throws {
        let first=try fixture(WorldbendFoilMaterial.self).cases[0]
        let s=try WorldbendFoilPreferenceSession(first.source,policy:first.policy,scope:first.preference.scope)
        try s.commit(["roughness":.number(0.8)],guard:s.guardToken)
        let before=s.preference,material=s.committedMaterial,token=s.guardToken
        #expect(throws:AppearanceError.self){try s.commit(["roughness":.toggle(true)],guard:s.guardToken)}
        #expect(throws:AppearanceError.self){try s.commit(["roughness":.number(.nan)],guard:s.guardToken)}
        #expect(throws:AppearanceError.self){try s.restorePreference(Data(repeating:32,count:16385),guard:s.guardToken)}
        var saved=try #require(JSONSerialization.jsonObject(with:s.exportPreference()) as? [String:Any])
        var record=try #require(saved["preference"] as? [String:Any]);record["scope"]="other";saved["preference"]=record
        #expect(throws:AppearanceError.self){try s.restorePreference(JSONSerialization.data(withJSONObject:saved),guard:s.guardToken)}
        #expect(s.preference==before);#expect(s.committedMaterial==material);#expect(s.guardToken==token)
        var extra=try #require(JSONSerialization.jsonObject(with:s.exportPreference()) as? [String:Any])
        var extraRecord=try #require(extra["preference"] as? [String:Any]),extraFields=try #require(extraRecord["fields"] as? [String:Any])
        var extraValue=try #require(extraFields["roughness"] as? [String:Any]);extraValue["unexpected"]="not part of the record";extraFields["roughness"]=extraValue;extraRecord["fields"]=extraFields;extra["preference"]=extraRecord
        #expect(throws:AppearanceError.self){try s.restorePreference(JSONSerialization.data(withJSONObject:extra),guard:s.guardToken)}
        #expect(s.preference==before);#expect(s.guardToken==token)
    }
    @Test func localNativePreferenceChangesActualMetalPixels() throws {
        let first=try fixture(WorldbendFoilMaterial.self).cases[0]
        let s=try WorldbendFoilPreferenceSession(first.source,policy:first.policy,scope:first.preference.scope)
        let renderer=try WorldbendMaterialRenderer(first.source)
        func pixels(_ material:WorldbendFoilMaterial) throws -> [UInt8] {
            let texture=try renderer.makeTexture(width:80,height:60);let command=try renderer.draw(material,milliseconds:0,into:texture);command.waitUntilCompleted()
            #expect(command.status == .completed);#expect(command.error==nil)
            var data=[UInt8](repeating:0,count:80*60*4);data.withUnsafeMutableBytes{texture.getBytes($0.baseAddress!,bytesPerRow:80*4,from:MTLRegionMake2D(0,0,80,60),mipmapLevel:0)};return data
        }
        let before=try pixels(s.committedMaterial)
        try s.commit(["base-color":.rgba(.init(0.1,0.3,0.7,0.6))],guard:s.guardToken)
        #expect(try pixels(s.committedMaterial) != before)
        #expect(s.source==first.source) // Local evaluation never forges a new core delivery fingerprint.
    }
}
