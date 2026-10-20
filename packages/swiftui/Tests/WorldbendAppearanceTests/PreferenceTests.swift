import Foundation
import Testing
@testable import WorldbendAppearance

/// Consumer-stream semantics: explicit preference overrides, guarded
/// candidate/apply/reset, revision-checked design updates and the local
/// optical evaluation mirror.
struct PreferenceTests {
    struct PreferenceRevision: Decodable { let current, stale: AppearanceUpdate }
    func data(_ name: String) throws -> Data {
        try Data(contentsOf: Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Receipts")!)
    }
    func load<T: Decodable>(_ name: String, _ type: T.Type) throws -> T {
        try AppearanceReceipt.decode(type, from: data(name))
    }

    @Test @MainActor func preferenceDrivesDisplayAndSurvivesEqualDefaultUpdate() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let next = try load("optical-source", AppearanceDelivery.self)
        let preference = try load("optical-preference", AppearancePreference.self)
        let plans = try load("optical-preference-revision", PreferenceRevision.self)
        let session = AppearanceSession(first, preference: preference)
        #expect(session.displayMaterial?.radius == first.material.radius)
        #expect(session.displayMaterial?.lightIntensity == 0.9)
        #expect(session.opticalConfiguration?.frostRadius == first.material.radius)
        #expect(session.opticalConfiguration?.highlightStrength == 0.54)
        // The v2 source raises radius to 4; the explicit equal-to-default
        // override keeps the user's fixed value.
        try session.update(plans.current, source: next)
        #expect(session.displayMaterial?.radius == first.material.radius)
        #expect(session.displayMaterial?.depth == next.material.depth, "untouched fields take the new source values")
        #expect(session.preference.revision == 3)
        #expect(session.preserved == ["light-intensity", "radius"])
    }

    @Test @MainActor func resetAfterConsumerUpdateRevealsTheNewSourceDefault() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let next = try load("optical-source", AppearanceDelivery.self)
        let preference = try load("optical-preference", AppearancePreference.self)
        let plans = try load("optical-preference-revision", PreferenceRevision.self)
        let session = AppearanceSession(first, preference: preference)
        try session.update(plans.current, source: next)
        // The merged display keeps the override, but evaluation runs over the
        // pure new source: removing the override must reveal the new default.
        try session.resetOverrides(["radius"])
        #expect(session.displayMaterial?.radius == next.material.radius,
                "reset must reveal the new source default, not the previous override")
        #expect(session.displayMaterial?.lightIntensity == 0.9, "unrelated overrides stay")
        try session.resetOverrides(nil)
        #expect(session.displayMaterial == next.material, "full reset reveals the pure new source")
        // A later preview still evaluates over the pure source.
        try session.propose([AppearanceOverrideChange(field: "light-angle", value: .number(270), actor: .user)])
        #expect(session.displayMaterial?.lightAngle == 270)
        #expect(session.displayMaterial?.radius == next.material.radius)
        session.cancelPreview()
        #expect(session.displayMaterial == next.material)
    }

    @Test @MainActor func staleAndForeignProposalsCannotOverwriteNewerEdits() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let next = try load("optical-source", AppearanceDelivery.self)
        let preference = try load("optical-preference", AppearancePreference.self)
        let plans = try load("optical-preference-revision", PreferenceRevision.self)
        let session = AppearanceSession(first, preference: preference)
        // Prepared against revision 2 while the session commits 3: rejected.
        #expect(throws: AppearanceError.staleUpdate) { try session.update(plans.stale, source: next) }
        #expect(session.sourceFingerprint == first.fingerprint)
        // A newer human edit advances the revision; the once-current plan
        // becomes stale too, and the display keeps the human's value.
        try session.propose([AppearanceOverrideChange(field: "radius", value: .number(9), actor: .user)])
        try session.commitCandidate()
        #expect(session.preference.revision == 4)
        #expect(session.displayMaterial?.radius == 9)
        #expect(throws: AppearanceError.staleUpdate) { try session.update(plans.current, source: next) }
        #expect(session.displayMaterial?.radius == 9)
        // Designer-path plans never apply to a preference-tuned session.
        let designer = try load("optical-revision", PreferenceTests.RevisionList.self).updates
        #expect(throws: AppearanceError.self) { try session.update(designer[0], source: next) }
        #expect(throws: AppearanceError.self) { try session.updateLocal(next) }
    }
    struct RevisionList: Decodable { let updates: [AppearanceUpdate] }
    @Test @MainActor func visibilityUsesEffectivePreferenceThroughoutItsLifecycle() throws {
        // Cover both rendering routes and both authored visibility values.
        for name in ["initial", "source", "optical-initial"] {
            let source = try load(name, AppearanceDelivery.self)
            let chosen = !source.material.visible
            let restored = AppearancePreference(revision: 1, fields: [
                "visible": .init(value: .toggle(chosen), actor: .user)
            ])
            let session = AppearanceSession(source, preference: restored)
            func expectVisibility(_ visible: Bool) {
                #expect(session.isVisible == visible)
                if source.target == "swiftui-optical" {
                    #expect((session.opticalConfiguration != nil) == visible)
                }
            }
            expectVisibility(chosen)
            session.setVisible(false); expectVisibility(false)
            session.setVisible(true); expectVisibility(chosen)
            session.setVisible(nil); expectVisibility(chosen)
            try session.propose([.init(field: "visible", value: .toggle(!chosen), actor: .agent)])
            expectVisibility(!chosen)
            session.cancelPreview(); expectVisibility(chosen)
            try session.propose([.init(field: "visible", value: .toggle(!chosen), actor: .user)])
            try session.commitCandidate(); expectVisibility(!chosen)
            let reopened = AppearanceSession(source, preference: session.preference)
            #expect(reopened.isVisible == !chosen)
            try session.resetOverrides(["visible"]); expectVisibility(source.material.visible)
            try session.propose([.init(field: "visible", value: .toggle(true), actor: .user)])
            try session.commitCandidate(); expectVisibility(true)
            session.remove(); expectVisibility(false)
            session.setVisible(true); expectVisibility(false)
            session.reattach(); expectVisibility(true)
        }
    }
    @Test @MainActor func sourceUpdateCannotDiscardAnUnsavedConsumerPreview() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let next = try load("optical-source", AppearanceDelivery.self)
        let preference = try load("optical-preference", AppearancePreference.self)
        let plans = try load("optical-preference-revision", PreferenceRevision.self)
        let session = AppearanceSession(first, preference: preference)
        try session.propose([AppearanceOverrideChange(field: "radius", value: .number(9), actor: .user)])
        #expect(throws: AppearanceError.staleUpdate) { try session.update(plans.current, source: next) }
        #expect(session.displayMaterial?.radius == 9)
        #expect(session.candidateRevision == 4)
        #expect(session.sourceFingerprint == first.fingerprint)
        session.cancelPreview()
        try session.update(plans.current, source: next)
        #expect(session.displayMaterial?.radius == first.material.radius)
        #expect(session.sourceFingerprint == next.fingerprint)
    }

    @Test @MainActor func previewCommitCancelAndResetSemantics() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let session = AppearanceSession(first)
        #expect(throws: AppearanceError.self) { try session.commitCandidate() }
        // Chained proposals accumulate in one candidate.
        try session.propose([AppearanceOverrideChange(field: "radius", value: .number(6), actor: .user)])
        try session.propose([AppearanceOverrideChange(field: "light-intensity", value: .number(0.2), actor: .agent)])
        #expect(session.candidateRevision == 2)
        #expect(session.displayMaterial?.radius == 6 && session.displayMaterial?.lightIntensity == 0.2)
        session.cancelPreview()
        #expect(session.candidateRevision == nil && session.preference.revision == 0)
        #expect(session.displayMaterial == first.material, "cancel restores the committed evaluation, not an older snapshot")
        try session.propose([AppearanceOverrideChange(field: "radius", value: .number(6), actor: .user)])
        try session.commitCandidate()
        try session.propose([AppearanceOverrideChange(field: "light-intensity", value: .number(0.2), actor: .agent)])
        session.cancelPreview()
        #expect(session.displayMaterial?.radius == 6 && session.displayMaterial?.lightIntensity == first.material.lightIntensity)
        // Reset removes only the selected override; the cancelled preview
        // never became a committed override, so the record is empty now.
        try session.resetOverrides(["radius"])
        #expect(session.preference.revision == 2 && session.preference.fields.isEmpty)
        #expect(session.displayMaterial?.radius == first.material.radius && session.displayMaterial?.lightIntensity == first.material.lightIntensity)
        // Policy-hidden fields throw instead of silently no-oping.
        #expect(throws: AppearanceError.notExposed("splay")) {
            try session.propose([AppearanceOverrideChange(field: "splay", value: .number(1), actor: .user)], exposedFields: ["radius"])
        }
        // Typed validation: wrong type and out-of-range values reject.
        #expect(throws: AppearanceError.self) {
            try session.propose([AppearanceOverrideChange(field: "visible", value: .number(1), actor: .user)])
        }
        #expect(throws: AppearanceError.self) {
            try session.propose([AppearanceOverrideChange(field: "depth", value: .number(0.5), actor: .user)])
        }
    }

    @Test @MainActor func localOpticalEvaluationMatchesCanonicalReceipts() throws {
        for name in ["optical-initial", "optical-source", "optical-local", "optical-neutral",
                     "optical-depth", "optical-dispersion", "optical-radius",
                     "optical-lightIntensity", "optical-lightAngle", "optical-refraction"] {
            let receipt = try load(name, AppearanceDelivery.self)
            let evaluated = try evaluateOpticalConfiguration(from: receipt.material)
            #expect(evaluated == receipt.swiftui.optical, "local optical evaluation diverged from \(name)")
        }
    }

    @Test func preferenceRecordRoundTripsAndValidates() throws {
        let preference = try load("optical-preference", AppearancePreference.self)
        let roundTrip = try AppearanceReceipt.decode(AppearancePreference.self, from: JSONEncoder().encode(preference))
        #expect(roundTrip == preference)
        let invalid = AppearancePreference(revision: 0, fields: preference.fields)
        #expect(throws: AppearanceError.self) { try invalid.validate() }
        let json = try JSONSerialization.jsonObject(with: data("optical-preference")) as! [String: Any]
        var wrongSchema = json; wrongSchema["schema"] = "worldbend.other@0.1"
        #expect(throws: (any Error).self) {
            _ = try AppearanceReceipt.decode(AppearancePreference.self, from: JSONSerialization.data(withJSONObject: wrongSchema))
        }
    }
}
