import Foundation
import Testing
@testable import WorldbendAppearance

struct AppearanceTests {
    struct Revision: Decodable { let updates: [AppearanceUpdate] }
    func data(_ name: String) throws -> Data {
        try Data(contentsOf: Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Receipts")!)
    }
    func load<T: Decodable>(_ name: String, _ type: T.Type) throws -> T {
        try AppearanceReceipt.decode(type, from: data(name))
    }
    @Test @MainActor func opticalRevisionPreservesLocalFrostAndRemoval() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        let next = try load("optical-source", AppearanceDelivery.self)
        let local = try load("optical-local", AppearanceDelivery.self)
        let plans = try load("optical-revision", Revision.self).updates
        let session = AppearanceSession(first)
        #expect(session.opticalConfiguration?.refractionScale == 20.8)
        try session.updateLocal(local)
        try session.update(plans[1], source: next)
        #expect(session.opticalConfiguration?.frostRadius == 7)
        #expect(session.opticalConfiguration?.refractionScale == 12.8)
        #expect(session.preserved == ["radius"])
        #expect(throws: AppearanceError.self) { try session.update(plans[1], source: next) }
        session.setVisible(false)
        #expect(session.opticalConfiguration == nil)
        session.setVisible(nil)
        #expect(session.opticalConfiguration != nil)
        let removed = AppearanceSession(first)
        removed.remove()
        try removed.update(plans[2], source: next)
        #expect(removed.opticalConfiguration == nil)
        removed.reattach()
        #expect(removed.opticalConfiguration == next.swiftui.optical)
        let system = try load("initial", AppearanceDelivery.self)
        #expect(throws: AppearanceError.self) { try session.updateLocal(system) }
    }

    @Test func rejectsOpticalProfileMismatchAndInvalidKernelInputs() throws {
        let first = try load("optical-initial", AppearanceDelivery.self)
        #expect(first.swiftui.fidelity.filter { $0.mapping == "approximated" }.count == 6)
        let raw = try JSONSerialization.jsonObject(with: data("optical-initial")) as! [String: Any]
        for field in ["profile", "backdrop", "edgeWidth", "refractionScale", "chromaticOffset", "frostRadius", "lightDirection", "highlightStrength"] {
            var malformed = raw
            var native = malformed["swiftui"] as! [String: Any]
            var optical = native["optical"] as! [String: Any]
            optical[field] = field == "lightDirection" ? [0, 0] : -1
            native["optical"] = optical; malformed["swiftui"] = native
            #expect(throws: (any Error).self) {
                _ = try AppearanceReceipt.decode(AppearanceDelivery.self, from: JSONSerialization.data(withJSONObject: malformed))
            }
        }
        var wrongTarget = raw; wrongTarget["target"] = "swiftui"
        #expect(throws: (any Error).self) {
            _ = try AppearanceReceipt.decode(AppearanceDelivery.self, from: JSONSerialization.data(withJSONObject: wrongTarget))
        }
    }
    @Test @MainActor func localStateRemovalAndRevisionOrdering() throws {
        let first = try load("initial", AppearanceDelivery.self)
        let next = try load("source", AppearanceDelivery.self)
        let local = try load("local", AppearanceDelivery.self)
        let updates = try load("revision", Revision.self).updates
        let session = AppearanceSession(first)
        try session.updateLocal(local)
        #expect(throws: AppearanceError.self) { try session.update(updates[0], source: next) }
        #expect(session.delivery == local)
        try session.update(updates[1], source: next)
        #expect(session.delivery?.material.radius == 12)
        #expect(session.sourceFingerprint == next.fingerprint)
        #expect(session.preserved == ["radius"])
        session.setVisible(true)
        #expect(!session.isVisible)
        session.remove()
        let back = try load("restoration", Revision.self).updates
        try session.update(back[2], source: first)
        #expect(session.delivery == nil)
        session.reattach()
        #expect(session.delivery == first && session.isVisible)
    }
    @Test @MainActor func malformedReceiptCannotMutateState() throws {
        let first = try load("initial", AppearanceDelivery.self)
        let session = AppearanceSession(first)
        let raw = try JSONSerialization.jsonObject(with: data("revision")) as! [String: Any]
        let plans = raw["updates"] as! [[String: Any]]
        for key in ["delivery", "previousDeliveryFingerprint"] {
            var malformed = plans[2]; malformed.removeValue(forKey: key)
            #expect(throws: (any Error).self) {
                _ = try AppearanceReceipt.decode(AppearanceUpdate.self, from: JSONSerialization.data(withJSONObject: malformed))
            }
        }
        #expect(session.delivery == first)
        #expect(throws: (any Error).self) { _ = try AppearanceReceipt.decode(AppearanceDelivery.self, from: Data(repeating: 32, count: 65_537)) }
        var malformed = try JSONSerialization.jsonObject(with: data("initial")) as! [String: Any]
        var material = malformed["material"] as! [String: Any]; material["radius"] = -1; malformed["material"] = material
        #expect(throws: (any Error).self) {
            _ = try AppearanceReceipt.decode(AppearanceDelivery.self, from: JSONSerialization.data(withJSONObject: malformed))
        }
    }
}
