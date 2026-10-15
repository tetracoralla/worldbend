import Foundation
import Observation

struct WorldbendMaterialFieldRule: Sendable {
    let property, kind: String
    let range: [Double]?
    let unit, direction: String
    let moving: Bool
}
public enum WorldbendMaterialPreferenceValue: Codable, Equatable, Sendable {
    case toggle(Bool), number(Double), rgba(WorldbendMaterialColor)
    enum CodingKeys: String, CodingKey { case kind, value }
    var kind: String { switch self { case .toggle: "toggle"; case .number: "number"; case .rgba: "rgba" } }
    var object: Any { switch self { case .toggle(let value): value; case .number(let value): value; case .rgba(let value): ["r":value.r,"g":value.g,"b":value.b,"a":value.a] } }
    public init(from decoder: Decoder) throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        switch try c.decode(String.self,forKey:.kind) {
        case "toggle": self = .toggle(try c.decode(Bool.self,forKey:.value))
        case "number": self = .number(try c.decode(Double.self,forKey:.value))
        case "rgba": self = .rgba(try c.decode(WorldbendMaterialColor.self,forKey:.value))
        default: throw AppearanceError.invalidReceipt
        }
    }
    public func encode(to encoder: Encoder) throws {
        var c=encoder.container(keyedBy:CodingKeys.self);try c.encode(kind,forKey:.kind)
        switch self { case .toggle(let v):try c.encode(v,forKey:.value);case .number(let v):try c.encode(v,forKey:.value);case .rgba(let v):try c.encode(v,forKey:.value) }
    }
}
public struct WorldbendMaterialFieldPreference: Codable, Equatable, Sendable {
    public let value: WorldbendMaterialPreferenceValue
    public let actor: AppearanceOverrideActor
    public init(value: WorldbendMaterialPreferenceValue, actor: AppearanceOverrideActor = .user) { self.value=value;self.actor=actor }
}
public struct WorldbendMaterialPreferenceRecord: Codable, Equatable, Sendable {
    public var schema: String
    public var revision: Int
    public var scope, recipeId: String
    public var fields: [String:WorldbendMaterialFieldPreference]
    public init(revision: Int=0, scope: String, recipeId: String, fields: [String:WorldbendMaterialFieldPreference]=[:]) {
        schema="worldbend.material-preference@0.1";self.revision=revision;self.scope=scope;self.recipeId=recipeId;self.fields=fields
    }
}
public struct WorldbendMaterialExposedControl: Codable, Equatable, Sendable {
    public let field: String
    public let min, max: Double?
    public init(_ field: String, min: Double?=nil, max: Double?=nil) {self.field=field;self.min=min;self.max=max}
}
public struct WorldbendMaterialExposurePolicy: Codable, Equatable, Sendable {
    public var schema, policyId: String
    public var revision: Int
    public var scopes: [String]
    public var exposed: [WorldbendMaterialExposedControl]
    public init(policyId: String, revision: Int=1, scopes: [String], exposed: [WorldbendMaterialExposedControl]) {
        schema="worldbend.material-policy@0.1";self.policyId=policyId;self.revision=revision;self.scopes=scopes;self.exposed=exposed
    }
}
public struct WorldbendMaterialPreferenceRuntime: Codable, Equatable, Sendable {
    public var rendererAvailable, motionAllowed: Bool
    public init(rendererAvailable: Bool=true, motionAllowed: Bool=true) {self.rendererAvailable=rendererAvailable;self.motionAllowed=motionAllowed}
}
public struct WorldbendMaterialPreferenceGuard: Codable, Equatable, Sendable {
    let instance: UUID
    let generation: Int
}
public struct WorldbendMaterialPreferenceControl: Sendable {
    public let field, state, unit, direction: String
    public let authoredRange, effectiveRange: [Double]?
}
public struct WorldbendMaterialPreferenceReceipt: Equatable, Sendable {
    public let field, state: String
}
private let maximumMaterialPreferenceRevision=9_007_199_254_740_991
private struct WorldbendSavedMaterialPreference: Encodable {
    let schema="worldbend.material-preference-save@0.1"
    let family: String
    let preference: WorldbendMaterialPreferenceRecord
}
private func validMaterialScope(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count<=128 && !value.unicodeScalars.contains { $0.value<32 || (127...159).contains($0.value) }
}

/// Native intent mirror over core-generated fields. This owns local product
/// actions, not another shader compiler or a fabricated canonical delivery.
@MainActor @Observable
public final class WorldbendMaterialPreferenceSession<Material: WorldbendProceduralMaterial> {
    public private(set) var source: WorldbendMaterialDelivery<Material>
    public private(set) var policy: WorldbendMaterialExposurePolicy
    public private(set) var preference: WorldbendMaterialPreferenceRecord
    public private(set) var runtime: WorldbendMaterialPreferenceRuntime
    public private(set) var isRemoved=false
    public private(set) var systemReducedMotion=false
    private var candidate: WorldbendMaterialPreferenceRecord?
    private var cachedCommitted: Material
    private var cachedPreview: Material?
    private var cachedReceipts: [WorldbendMaterialPreferenceReceipt]=[]
    private let instance=UUID()
    private var generation=0
    public var guardToken: WorldbendMaterialPreferenceGuard { .init(instance:instance,generation:generation) }
    public var previewing: Bool { candidate != nil }
    public var motionAllowed: Bool {runtime.motionAllowed && !systemReducedMotion}
    private var rules: [String:WorldbendMaterialFieldRule] {WorldbendMaterialPreferenceRules.families[Material.family] ?? [:]}
    public init(_ source: WorldbendMaterialDelivery<Material>, policy: WorldbendMaterialExposurePolicy,
                scope: String, preference: WorldbendMaterialPreferenceRecord?=nil,
                runtime: WorldbendMaterialPreferenceRuntime = .init()) throws {
        self.source=source;self.policy=policy;self.runtime=runtime;cachedCommitted=source.material
        self.preference=preference ?? .init(scope:scope,recipeId:source.recipeId)
        guard self.preference.scope==scope else {throw AppearanceError.invalidReceipt}
        try validate(source,policy,self.preference)
        let resolved=try resolve(self.preference,source:source,policy:policy);cachedCommitted=resolved.0;cachedReceipts=resolved.1
    }
    private func check(_ token: WorldbendMaterialPreferenceGuard) throws {
        guard token==guardToken else {throw AppearanceError.staleUpdate}
        guard generation<maximumMaterialPreferenceRevision else {throw AppearanceError.invalidReceipt}
    }
    private func range(_ control: WorldbendMaterialExposedControl, _ rule: WorldbendMaterialFieldRule) throws -> [Double]? {
        guard let authored=rule.range else {
            guard control.min==nil && control.max==nil else {throw AppearanceError.invalidReceipt};return nil
        }
        let min=control.min ?? authored[0],max=control.max ?? authored[1]
        guard min.isFinite,max.isFinite,min>=authored[0],max<=authored[1],min<=max else {throw AppearanceError.invalidReceipt}
        return [min,max]
    }
    private func validate(_ source: WorldbendMaterialDelivery<Material>, _ policy: WorldbendMaterialExposurePolicy,
                          _ record: WorldbendMaterialPreferenceRecord) throws {
        try source.validate()
        guard Set(rules.keys)==Material.fieldIds, policy.schema=="worldbend.material-policy@0.1",
              validMaterialScope(policy.policyId),policy.revision>0,policy.revision<=maximumMaterialPreferenceRevision,
              !policy.scopes.isEmpty,policy.scopes.count<=32,policy.scopes.allSatisfy(validMaterialScope),
              Set(policy.scopes).count==policy.scopes.count,policy.exposed.count<=rules.count,
              Set(policy.exposed.map(\.field)).count==policy.exposed.count,
              record.schema=="worldbend.material-preference@0.1",record.revision>=0,record.revision<=maximumMaterialPreferenceRevision,
              record.fields.isEmpty || record.revision>0,validMaterialScope(record.scope),policy.scopes.contains(record.scope),
              record.recipeId==source.recipeId,Set(record.fields.keys).isSubset(of:Material.fieldIds) else {throw AppearanceError.invalidReceipt}
        for control in policy.exposed {guard let rule=rules[control.field] else {throw AppearanceError.invalidReceipt};_ = try range(control,rule)}
        // Validate all saved values even when policy hides them.
        _ = try applying(record.fields.mapValues(\.value),over:source.material)
    }
    private func applying(_ fields: [String:WorldbendMaterialPreferenceValue], over base: Material) throws -> Material {
        guard var object=try JSONSerialization.jsonObject(with:JSONEncoder().encode(base)) as? [String:Any] else {throw AppearanceError.invalidReceipt}
        for (field,value) in fields {
            guard let rule=rules[field],value.kind==rule.kind else {throw AppearanceError.invalidReceipt}
            switch value {case .number(let number):guard number.isFinite else {throw AppearanceError.invalidReceipt};case .rgba(let color):try color.validate();case .toggle:break}
            object[rule.property]=value.object
        }
        let material=try JSONDecoder().decode(Material.self,from:JSONSerialization.data(withJSONObject:object))
        try material.validate();return material
    }
    private func resolve(_ record: WorldbendMaterialPreferenceRecord, source: WorldbendMaterialDelivery<Material>, policy: WorldbendMaterialExposurePolicy) throws -> (Material,[WorldbendMaterialPreferenceReceipt]) {
        try validate(source,policy,record);var values: [String:WorldbendMaterialPreferenceValue]=[:],receipts:[WorldbendMaterialPreferenceReceipt]=[]
        for field in record.fields.keys.sorted() {
            let value=record.fields[field]!.value
            guard let exposed=policy.exposed.first(where:{$0.field==field}) else {receipts.append(.init(field:field,state:"not-exposed"));continue}
            let limits=try range(exposed,rules[field]!)
            if case .number(let number)=value, let limits, !(limits[0]...limits[1]).contains(number) {receipts.append(.init(field:field,state:"out-of-range"));continue}
            values[field]=value;receipts.append(.init(field:field,state:"applied"))
        }
        return (try applying(values,over:source.material),receipts)
    }
    public var committedMaterial: Material {cachedCommitted}
    public var displayedMaterial: Material? {isRemoved || !runtime.rendererAvailable ? nil : cachedPreview ?? cachedCommitted}
    public var receipts: [WorldbendMaterialPreferenceReceipt] {cachedReceipts}
    public var controls: [WorldbendMaterialPreferenceControl] {
        rules.keys.sorted().map { field in
            let rule=rules[field]!,exposed=policy.exposed.first(where:{$0.field==field})
            return .init(field:field,state:exposed==nil ? "not-exposed" : (!runtime.rendererAvailable || (rule.moving && !motionAllowed) ? "adapted" : "exposed"),
                         unit:rule.unit,direction:rule.direction,authoredRange:rule.range,effectiveRange:exposed.flatMap {try? range($0,rule)} ?? rule.range)
        }
    }
    private func proposed(_ changes: [String:WorldbendMaterialPreferenceValue?], actor: AppearanceOverrideActor, base: WorldbendMaterialPreferenceRecord) throws -> WorldbendMaterialPreferenceRecord {
        guard !isRemoved else {throw AppearanceError.removed}
        guard preference.revision<maximumMaterialPreferenceRevision else {throw AppearanceError.invalidReceipt}
        var next=base;next.revision=preference.revision+1
        for (field,value) in changes {
            guard rules[field] != nil else {throw AppearanceError.invalidReceipt}
            if let value {
                guard let exposed=policy.exposed.first(where:{$0.field==field}) else {throw AppearanceError.notExposed(field)}
                if case .number(let number)=value,let limits=try range(exposed,rules[field]!),!(limits[0]...limits[1]).contains(number) {throw AppearanceError.invalidReceipt}
                next.fields[field] = .init(value:value,actor:actor)
            }else{next.fields[field]=nil}
        }
        _ = try resolve(next,source:source,policy:policy);return next
    }
    public func preview(_ changes: [String:WorldbendMaterialPreferenceValue?], guard token: WorldbendMaterialPreferenceGuard, actor: AppearanceOverrideActor = .user) throws {
        try check(token);let next=try proposed(changes,actor:actor,base:candidate ?? preference);let resolved=try resolve(next,source:source,policy:policy);candidate=next;cachedPreview=resolved.0;generation+=1
    }
    public func applyPreview(guard token: WorldbendMaterialPreferenceGuard) throws {
        try check(token);guard let candidate else {throw AppearanceError.invalidReceipt};let resolved=try resolve(candidate,source:source,policy:policy);preference=candidate;cachedCommitted=resolved.0;cachedReceipts=resolved.1;self.candidate=nil;cachedPreview=nil;generation+=1
    }
    public func cancelPreview() {if candidate != nil {candidate=nil;cachedPreview=nil;generation+=1}}
    public func commit(_ changes: [String:WorldbendMaterialPreferenceValue?], guard token: WorldbendMaterialPreferenceGuard, actor: AppearanceOverrideActor = .user) throws {
        try check(token);let next=try proposed(changes,actor:actor,base:preference);let resolved=try resolve(next,source:source,policy:policy);preference=next;cachedCommitted=resolved.0;cachedReceipts=resolved.1;candidate=nil;cachedPreview=nil;generation+=1
    }
    public func reset(guard token: WorldbendMaterialPreferenceGuard) throws {
        try commit(Dictionary(uniqueKeysWithValues:preference.fields.keys.map {($0,Optional<WorldbendMaterialPreferenceValue>.none)}),guard:token)
    }
    public func updateSource(_ next: WorldbendMaterialDelivery<Material>, policy nextPolicy: WorldbendMaterialExposurePolicy, guard token: WorldbendMaterialPreferenceGuard) throws {
        try check(token)
        guard next.recipeId==source.recipeId,next.target==source.target,nextPolicy.policyId==policy.policyId,
              nextPolicy.revision>=policy.revision,nextPolicy==policy || nextPolicy.revision>policy.revision else {throw AppearanceError.invalidReceipt}
        let resolved=try resolve(preference,source:next,policy:nextPolicy)
        source=next;policy=nextPolicy;cachedCommitted=resolved.0;cachedReceipts=resolved.1;candidate=nil;cachedPreview=nil;generation+=1
    }
    public func setRuntime(_ next: WorldbendMaterialPreferenceRuntime, guard token: WorldbendMaterialPreferenceGuard) throws {
        try check(token);runtime=next;candidate=nil;cachedPreview=nil;generation+=1
    }
    public func retryRenderer(guard token: WorldbendMaterialPreferenceGuard) throws {
        var next=runtime;next.rendererAvailable=true;try setRuntime(next,guard:token)
    }
    func setSystemReducedMotion(_ value: Bool) {if systemReducedMotion != value {systemReducedMotion=value;candidate=nil;cachedPreview=nil;generation+=1}}
    func setRendererUnavailable() {if runtime.rendererAvailable {runtime.rendererAvailable=false;candidate=nil;cachedPreview=nil;generation+=1}}
    public func remove(guard token: WorldbendMaterialPreferenceGuard) throws {try check(token);isRemoved=true;candidate=nil;cachedPreview=nil;generation+=1}
    public func reattach(guard token: WorldbendMaterialPreferenceGuard) throws {try check(token);isRemoved=false;candidate=nil;cachedPreview=nil;generation+=1}
    public func exportPreference() throws -> Data {
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys];let data=try encoder.encode(WorldbendSavedMaterialPreference(family:Material.family,preference:preference))
        guard data.count<=16384 else {throw AppearanceError.invalidReceipt};return data
    }
    public func restorePreference(_ data: Data, guard token: WorldbendMaterialPreferenceGuard) throws {
        try check(token);guard data.count<=16384, let saved=try JSONSerialization.jsonObject(with:data) as? [String:Any],
            Set(saved.keys)==["schema","family","preference"],saved["schema"] as? String=="worldbend.material-preference-save@0.1",
            saved["family"] as? String==Material.family,let body=saved["preference"] as? [String:Any],
            Set(body.keys)==["schema","revision","scope","recipeId","fields"] else {throw AppearanceError.invalidReceipt}
        var record=try JSONDecoder().decode(WorldbendMaterialPreferenceRecord.self,from:JSONSerialization.data(withJSONObject:body))
        guard let rawFields=body["fields"] as? [String:Any] else {throw AppearanceError.invalidReceipt}
        for raw in rawFields.values {
            guard let entry=raw as? [String:Any],Set(entry.keys)==["value","actor"],let value=entry["value"] as? [String:Any],Set(value.keys)==["kind","value"] else {throw AppearanceError.invalidReceipt}
            if value["kind"] as? String=="rgba" {guard let color=value["value"] as? [String:Any],Set(color.keys)==["r","g","b","a"] else {throw AppearanceError.invalidReceipt}}
        }
        guard record.scope==preference.scope,record.revision<maximumMaterialPreferenceRevision,preference.revision<maximumMaterialPreferenceRevision else {throw AppearanceError.invalidReceipt}
        let resolved=try resolve(record,source:source,policy:policy);record.revision=max(record.revision,preference.revision+1)
        preference=record;cachedCommitted=resolved.0;cachedReceipts=resolved.1;candidate=nil;cachedPreview=nil;generation+=1
    }
}
public typealias WorldbendFoilPreferenceSession=WorldbendMaterialPreferenceSession<WorldbendFoilMaterial>
public typealias WorldbendMeshGradientPreferenceSession=WorldbendMaterialPreferenceSession<WorldbendMeshGradientMaterial>
