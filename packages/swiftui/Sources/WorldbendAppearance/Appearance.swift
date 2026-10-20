import Foundation
import Observation
import SwiftUI

public enum AppearanceError: Error, LocalizedError, Equatable {
    case invalidReceipt, staleUpdate, removed, notExposed(String)
    public var errorDescription: String? {
        switch self {
        case .invalidReceipt: "Invalid or incompatible material receipt."
        case .staleUpdate: "The material changed while this update was prepared. Read current state and retry."
        case .removed: "Explicitly reattach the latest source to restore a removed material."
        case .notExposed(let field): "Field \(field) is not exposed by the current product policy."
        }
    }
}

/// Who authored one override. User and Agent changes go through the same
/// product action and revision checks; neither can bypass the other.
public enum AppearanceOverrideActor: String, Codable, Sendable {
    case user, agent
}

/// Typed override value: toggles only for `visible`, numbers elsewhere.
public enum AppearanceOverrideValue: Equatable, Sendable {
    case toggle(Bool)
    case number(Double)
}

extension AppearanceOverrideValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let flag = try? container.decode(Bool.self) { self = .toggle(flag) }
        else if let number = try? container.decode(Double.self) { self = .number(number) }
        else { throw AppearanceError.invalidReceipt }
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .toggle(let flag): try container.encode(flag)
        case .number(let number): try container.encode(number)
        }
    }
}

public struct AppearanceFieldOverride: Codable, Equatable, Sendable {
    public let value: AppearanceOverrideValue
    public let actor: AppearanceOverrideActor
    public init(value: AppearanceOverrideValue, actor: AppearanceOverrideActor) {
        self.value = value
        self.actor = actor
    }
}

/// Explicit personal overrides over one appearance source, mirroring the
/// canonical `worldbend.appearance-preference@0.1` record. Overrides equal to
/// current defaults stay representable and survive later design updates.
public struct AppearancePreference: Codable, Equatable, Sendable {
    public let revision: Int
    public let fields: [String: AppearanceFieldOverride]
    public static let empty = AppearancePreference(revision: 0, fields: [:])
    public init(revision: Int, fields: [String: AppearanceFieldOverride]) {
        self.revision = revision
        self.fields = fields
    }
    enum CodingKeys: String, CodingKey { case schema, version, revision, fields }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(String.self, forKey: .schema) == "worldbend.appearance-preference@0.1",
              try c.decode(String.self, forKey: .version) == "0.1" else { throw AppearanceError.invalidReceipt }
        let revision = try c.decode(Int.self, forKey: .revision)
        let fields = try c.decodeIfPresent([String: AppearanceFieldOverride].self, forKey: .fields) ?? [:]
        self.init(revision: revision, fields: fields)
        try validate()
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("worldbend.appearance-preference@0.1", forKey: .schema)
        try c.encode("0.1", forKey: .version)
        try c.encode(revision, forKey: .revision)
        try c.encode(fields, forKey: .fields)
    }
    static let fieldIds: Set<String> = ["visible", "light-intensity", "light-angle", "refraction", "depth", "dispersion", "radius"]
    public func validate() throws {
        guard revision >= 0, revision != 0 || fields.isEmpty else { throw AppearanceError.invalidReceipt }
        for (field, override) in fields {
            guard Self.fieldIds.contains(field) else { throw AppearanceError.invalidReceipt }
            switch (field, override.value) {
            case ("visible", .toggle): break
            case ("visible", _): throw AppearanceError.invalidReceipt
            case (_, .toggle): throw AppearanceError.invalidReceipt
            case (_, .number(let value)):
                let valid: Bool
                switch field {
                case "light-intensity", "refraction", "dispersion": valid = (0...1).contains(value)
                case "light-angle": valid = (0..<360).contains(value)
                case "depth": valid = (1...1000).contains(value)
                case "radius": valid = (0...1000).contains(value)
                default: valid = false
                }
                guard valid, value.isFinite else { throw AppearanceError.invalidReceipt }
            }
        }
    }
    /// Apply saved overrides to a base material. Fields the product policy
    /// currently hides are filtered by the caller before this runs.
    public func effectiveMaterial(over base: GlassMaterial) throws -> GlassMaterial {
        var visible = base.visible, lightIntensity = base.lightIntensity, lightAngle = base.lightAngle
        var refraction = base.refraction, depth = base.depth, dispersion = base.dispersion, radius = base.radius
        for (field, override) in fields {
            switch (field, override.value) {
            case ("visible", .toggle(let flag)): visible = flag
            case ("light-intensity", .number(let value)): lightIntensity = value
            case ("light-angle", .number(let value)): lightAngle = value
            case ("refraction", .number(let value)): refraction = value
            case ("depth", .number(let value)): depth = value
            case ("dispersion", .number(let value)): dispersion = value
            case ("radius", .number(let value)): radius = value
            default: throw AppearanceError.invalidReceipt
            }
        }
        let material = GlassMaterial(visible: visible, lightIntensity: lightIntensity, lightAngle: lightAngle,
                                     refraction: refraction, depth: depth, dispersion: dispersion, radius: radius)
        try material.validate()
        return material
    }
}

/// One proposed override change on its way through preview to commit.
public struct AppearanceOverrideChange: Sendable {
    public let field: String
    public let value: AppearanceOverrideValue
    public let actor: AppearanceOverrideActor
    public init(field: String, value: AppearanceOverrideValue, actor: AppearanceOverrideActor) {
        self.field = field
        self.value = value
        self.actor = actor
    }
}

/// Local mirror of the core optical kernel inputs for one material. Parity
/// with canonical receipts is pinned by AppearanceTests; do not change the
/// formulas on one side only.
func evaluateOpticalConfiguration(from material: GlassMaterial) throws -> OpticalGlassConfiguration {
    let radians = material.lightAngle * (Double.pi / 180)
    let configuration = OpticalGlassConfiguration(
        profile: "worldbend.rounded-glass-metal@0.1",
        backdrop: "explicit-swiftui-layer",
        edgeWidth: material.depth,
        refractionScale: 32.0 * material.refraction,
        chromaticOffset: 8.0 * material.dispersion,
        frostRadius: material.radius,
        lightDirection: [-sin(radians), cos(radians)],
        highlightStrength: 0.6 * material.lightIntensity
    )
    try configuration.validate()
    return configuration
}

/// Canonical Figma values. System glass retains them as metadata; the optical
/// profile supplies executable kernel inputs derived from them by the core.
public struct GlassMaterial: Codable, Equatable, Sendable {
    public let visible: Bool
    public let lightIntensity, lightAngle, refraction, depth, dispersion, radius: Double
    func validate() throws {
        guard [lightIntensity, lightAngle, refraction, depth, dispersion, radius].allSatisfy(\.isFinite),
              (0...1).contains(lightIntensity), (0..<360).contains(lightAngle),
              (0...1).contains(refraction), (1...1000).contains(depth),
              (0...1).contains(dispersion), (0...1000).contains(radius) else {
            throw AppearanceError.invalidReceipt
        }
    }
}

public struct FieldFidelity: Codable, Equatable, Sendable {
    public let field, mapping, note: String
}

public struct NativeDelivery: Codable, Equatable, Sendable {
    public let usesNativeLiquidGlass: Bool
    public let snippet: String
    public let fidelity: [FieldFidelity]
    public let optical: OpticalGlassConfiguration?
}

public struct AppearanceDelivery: Decodable, Equatable, Sendable {
    public let schema, version, fingerprint, recipeId, recipeFingerprint, target: String
    public let recipeVersion: UInt32
    public let material: GlassMaterial
    public let swiftui: NativeDelivery
    enum CodingKeys: String, CodingKey {
        case schema, version, fingerprint, recipeId, recipeFingerprint, target, recipeVersion, material, swiftui, web
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decode(String.self, forKey: .schema)
        version = try c.decode(String.self, forKey: .version)
        fingerprint = try c.decode(String.self, forKey: .fingerprint)
        recipeId = try c.decode(String.self, forKey: .recipeId)
        recipeFingerprint = try c.decode(String.self, forKey: .recipeFingerprint)
        target = try c.decode(String.self, forKey: .target)
        recipeVersion = try c.decode(UInt32.self, forKey: .recipeVersion)
        material = try c.decode(GlassMaterial.self, forKey: .material)
        swiftui = try c.decode(NativeDelivery.self, forKey: .swiftui)
        guard c.contains(.web), try c.decodeNil(forKey: .web) else { throw AppearanceError.invalidReceipt }
        try validate()
    }
    func validate() throws {
        let fields = Set(["visible", "light-intensity", "light-angle", "refraction", "depth", "dispersion", "radius"])
        let isOptical = target == "swiftui-optical"
        guard schema == "worldbend.appearance-delivery@0.1", version == "0.1", target == "swiftui" || isOptical,
              validFingerprint(fingerprint), validFingerprint(recipeFingerprint), recipeVersion > 0,
              !recipeId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, recipeId.unicodeScalars.count <= 64,
              !recipeId.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              swiftui.usesNativeLiquidGlass == !isOptical, swiftui.fidelity.count == 7,
              Set(swiftui.fidelity.map(\.field)) == fields,
              swiftui.fidelity.allSatisfy({ $0.mapping == ($0.field == "visible" ? "native" : (isOptical ? "approximated" : "unavailable")) }),
              (swiftui.optical != nil) == isOptical
        else { throw AppearanceError.invalidReceipt }
        try material.validate()
        try swiftui.optical?.validate()
    }
}

public struct AppearanceUpdate: Decodable, Sendable {
    public let schema, version, previousFingerprint, sourceFingerprint: String
    public let previousDeliveryFingerprint: String?
    public let delivery: AppearanceDelivery?
    public let preserved: [String]
    /// Preference revision this plan was prepared against; nil means the
    /// value-diff designer path. A session rejects plans prepared against a
    /// different revision than its committed preference.
    public let preferenceRevision: Int?
    enum CodingKeys: String, CodingKey {
        case schema, version, previousFingerprint, sourceFingerprint, previousDeliveryFingerprint, delivery, preserved, preferenceRevision
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decode(String.self, forKey: .schema)
        version = try c.decode(String.self, forKey: .version)
        previousFingerprint = try c.decode(String.self, forKey: .previousFingerprint)
        sourceFingerprint = try c.decode(String.self, forKey: .sourceFingerprint)
        // Omission must never become a local removal or weaken destination CAS.
        guard c.contains(.previousDeliveryFingerprint), c.contains(.delivery) else { throw AppearanceError.invalidReceipt }
        previousDeliveryFingerprint = try c.decodeIfPresent(String.self, forKey: .previousDeliveryFingerprint)
        delivery = try c.decodeIfPresent(AppearanceDelivery.self, forKey: .delivery)
        preserved = try c.decode([String].self, forKey: .preserved)
        preferenceRevision = try c.decodeIfPresent(Int.self, forKey: .preferenceRevision)
        guard schema == "worldbend.appearance-update@0.1", version == "0.1",
              validFingerprint(previousFingerprint), validFingerprint(sourceFingerprint),
              previousDeliveryFingerprint.map(validFingerprint) ?? true,
              Set(preserved).count == preserved.count,
              preserved.allSatisfy({ ["visible", "light-intensity", "light-angle", "refraction", "depth", "dispersion", "radius"].contains($0) }),
              preferenceRevision.map({ $0 >= 0 }) ?? true
        else { throw AppearanceError.invalidReceipt }
    }
}

func validFingerprint(_ value: String) -> Bool {
    value.hasPrefix("sha256:") && value.count == 71 && value.dropFirst(7).allSatisfy { "0123456789abcdef".contains($0) }
}

/// Bounded decoding of trusted canonical core receipts. Fingerprints are ordering tokens,
/// not authentication; verify remote artifact provenance in the application's transport.
public enum AppearanceReceipt {
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        guard data.count <= 65_536 else { throw AppearanceError.invalidReceipt }
        return try JSONDecoder().decode(type, from: data)
    }
}

@MainActor @Observable
public final class AppearanceSession {
    public private(set) var sourceFingerprint: String
    public private(set) var delivery: AppearanceDelivery?
    public private(set) var preserved: [String] = []
    /// Committed personal overrides; the record is the durable product state.
    public private(set) var preference: AppearancePreference
    /// Revision currently previewed, if any.
    public private(set) var candidateRevision: Int?
    private var source: AppearanceDelivery
    private var candidate: AppearancePreference?
    private var hostVisible: Bool?
    public var isVisible: Bool { displayMaterial?.visible == true && hostVisible != false }
    /// The effective material after committed (and any previewed) overrides.
    public var displayMaterial: GlassMaterial? {
        guard let base = try? evaluationBase() else { return nil }
        let active = candidate ?? preference
        return try? active.effectiveMaterial(over: base)
    }
    /// Nil hides only the optical pane, never the receiving controls.
    public var opticalConfiguration: OpticalGlassConfiguration? {
        guard isVisible, let displayMaterial else { return nil }
        guard delivery?.target == "swiftui-optical" else { return delivery?.swiftui.optical }
        // The system target keeps its receipt; the optical target evaluates
        // locally so live tuning never needs a per-frame canonical receipt.
        return try? evaluateOpticalConfiguration(from: displayMaterial)
    }

    public init(_ initial: AppearanceDelivery, preference restored: AppearancePreference = .empty) {
        try? restored.validate()
        source = initial; sourceFingerprint = initial.fingerprint; delivery = initial
        preference = restored
    }
    public func update(_ plan: AppearanceUpdate, source next: AppearanceDelivery) throws {
        // Source plans contain only the committed preference revision. They
        // cannot authorize discarding a newer, unsaved consumer edit.
        guard candidate == nil else { throw AppearanceError.staleUpdate }
        guard plan.previousFingerprint == sourceFingerprint else { throw AppearanceError.staleUpdate }
        if let planRevision = plan.preferenceRevision {
            // Consumer path: display is source + committed preference by
            // construction (updateLocal is rejected while a preference is
            // active), so the revision is the ordering token. A plan prepared
            // against another revision cannot overwrite a newer human edit.
            guard planRevision == preference.revision else { throw AppearanceError.staleUpdate }
        } else {
            // Designer path: the literal delivery CAS stays the guard, and a
            // preference-tuned session never accepts preference-less plans.
            guard preference.revision == 0, plan.previousDeliveryFingerprint == delivery?.fingerprint
            else { throw AppearanceError.staleUpdate }
        }
        try compatible(next)
        guard plan.sourceFingerprint == next.fingerprint else { throw AppearanceError.invalidReceipt }
        if let merged = plan.delivery {
            guard delivery != nil else { throw AppearanceError.removed }
            try compatible(merged)
            guard merged.recipeFingerprint == next.recipeFingerprint, merged.recipeVersion == next.recipeVersion
            else { throw AppearanceError.invalidReceipt }
        }
        source = next; sourceFingerprint = next.fingerprint; delivery = plan.delivery; preserved = plan.preserved
        // The plan merged the committed preference; a preview it was not
        // prepared against was rejected by the revision guard above.
        candidate = nil; candidateRevision = nil
    }
    public func updateLocal(_ plan: AppearanceDelivery) throws {
        guard let delivery else { throw AppearanceError.removed }
        guard preference == .empty, candidate == nil else { throw AppearanceError.invalidReceipt }
        try compatible(plan)
        guard plan.recipeFingerprint == delivery.recipeFingerprint, plan.recipeVersion == delivery.recipeVersion
        else { throw AppearanceError.invalidReceipt }
        self.delivery = plan
    }
    /// Overrides are absolute values over the accepted source. Once a
    /// preference exists, evaluate against `source`, not the merged delivery:
    /// a reset must reveal the new source default, not the previous override
    /// the last merged plan baked into the display.
    private func evaluationBase() throws -> GlassMaterial {
        guard let delivery else { throw AppearanceError.removed }
        return preference.revision > 0 ? source.material : delivery.material
    }
    /// Preview explicit overrides locally against the current delivery.
    /// Replaces any pending candidate. `exposedFields` optionally guards a
    /// product policy: hidden fields throw instead of silently no-oping.
    @discardableResult
    public func propose(_ changes: [AppearanceOverrideChange], exposedFields: Set<String>? = nil) throws -> AppearancePreference {
        guard delivery != nil else { throw AppearanceError.removed }
        guard !changes.isEmpty else { throw AppearanceError.invalidReceipt }
        var fields = (candidate ?? preference).fields
        for change in changes {
            if let exposedFields, !exposedFields.contains(change.field) { throw AppearanceError.notExposed(change.field) }
            fields[change.field] = AppearanceFieldOverride(value: change.value, actor: change.actor)
        }
        let record = AppearancePreference(revision: (candidate ?? preference).revision + 1, fields: fields)
        try record.validate()
        _ = try record.effectiveMaterial(over: try evaluationBase())
        candidate = record; candidateRevision = record.revision
        return record
    }
    /// Persist the pending candidate as the committed preference.
    @discardableResult
    public func commitCandidate() throws -> AppearancePreference {
        guard let pending = candidate else { throw AppearanceError.invalidReceipt }
        preference = pending; candidate = nil; candidateRevision = nil
        return preference
    }
    /// Drop the preview and restore the committed evaluation, not an older
    /// snapshot: someone else's committed edit stays in effect.
    public func cancelPreview() {
        candidate = nil; candidateRevision = nil
    }
    /// Remove overrides (all when nil): reveals current source defaults and
    /// keeps every other override intact.
    @discardableResult
    public func resetOverrides(_ fields: [String]? = nil) throws -> AppearancePreference {
        guard delivery != nil else { throw AppearanceError.removed }
        var next = preference
        var updated = preference.fields
        if let fields {
            for field in fields {
                guard updated[field] != nil else { throw AppearanceError.invalidReceipt }
                updated[field] = nil
            }
        } else { updated = [:] }
        next = AppearancePreference(revision: preference.revision + 1, fields: updated)
        try next.validate()
        _ = try next.effectiveMaterial(over: try evaluationBase())
        preference = next; candidate = nil; candidateRevision = nil
        return preference
    }
    public func remove() { delivery = nil; preserved = []; candidate = nil; candidateRevision = nil }
    /// Explicit restoration uses the latest accepted source, including revisions received while removed.
    public func reattach() { delivery = source; preserved = []; hostVisible = nil; candidate = nil; candidateRevision = nil }
    public func setVisible(_ visible: Bool?) { hostVisible = visible }
    private func compatible(_ plan: AppearanceDelivery) throws {
        guard plan.target == source.target, plan.recipeId == source.recipeId, plan.recipeVersion >= source.recipeVersion,
              plan.recipeVersion != source.recipeVersion || plan.recipeFingerprint == source.recipeFingerprint else {
            throw AppearanceError.invalidReceipt
        }
    }
}

extension View {
    /// Apply to existing content after sizing/styling it. Keep its identity, state and handlers.
    /// Layout, shape and accessibility policy remain owned by the receiving application.
    @available(iOS 26, macOS 26, *)
    @MainActor public func worldbendGlass<S: Shape>(_ session: AppearanceSession, in shape: S, interactive: Bool = false) -> some View {
        precondition(session.delivery?.target != "swiftui-optical", "Use WorldbendOpticalPane with an explicit backdrop for swiftui-optical receipts")
        return worldbendSystemGlass(session, in: shape, variant: .regular, interactive: interactive)
    }

    /// Explicit system backend. Variant/tint belong to the host; Figma optical
    /// numbers do not configure Apple's adaptive renderer.
    @available(iOS 26, macOS 26, *)
    @MainActor public func worldbendSystemGlass<S: Shape>(_ session: AppearanceSession, in shape: S, variant: Glass = .regular, interactive: Bool = false) -> some View {
        precondition(session.delivery?.target != "swiftui-optical", "System glass cannot render an optical receipt")
        return glassEffect(session.isVisible ? variant.interactive(interactive) : .identity, in: shape)
    }
}
