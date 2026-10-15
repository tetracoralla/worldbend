import SwiftUI
import UIKit
import WorldbendAppearance

private struct Revision: Decodable { let updates: [AppearanceUpdate] }

@MainActor @Observable
final class ReceivingModel {
    let photo: UIImage
    let material: AppearanceSession
    let initial, latest, local: AppearanceDelivery
    private let forward, backward: Revision
    var revision = 1
    var busy = false
    var message = "The current look is ready."
    var failNext = false
    private var request: Task<Void, Never>?
    init() throws {
        guard let file = Bundle.main.path(forResource: "fronalpstock", ofType: "jpg"), let image = UIImage(contentsOfFile: file)
        else { throw AppearanceError.invalidReceipt }
        photo = image
        initial = try Self.load("initial", as: AppearanceDelivery.self)
        latest = try Self.load("source", as: AppearanceDelivery.self)
        local = try Self.load("local", as: AppearanceDelivery.self)
        forward = try Self.load("revision", as: Revision.self)
        backward = try Self.load("restoration", as: Revision.self)
        material = AppearanceSession(initial)
    }
    private static func load<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json") else { throw AppearanceError.invalidReceipt }
        return try AppearanceReceipt.decode(type, from: Data(contentsOf: url))
    }
    func receive() {
        guard !busy else { return }
        busy = true; message = "Receiving the new look…"
        request = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(1))
                try Task.checkCancellation()
                guard let self else { return }
                defer { self.busy = false; self.request = nil }
                if self.failNext { self.failNext = false; throw URLError(.cannotDecodeContentData) }
                let variants = self.revision == 1 ? self.forward.updates : self.backward.updates
                guard let plan = variants.first(where: { $0.previousDeliveryFingerprint == self.material.delivery?.fingerprint })
                else { throw AppearanceError.staleUpdate }
                try self.material.update(plan, source: self.revision == 1 ? self.latest : self.initial)
                self.revision = self.revision == 1 ? 2 : 1
                self.message = self.material.delivery == nil ? "Look updated. Your local removal is kept." : "Look updated. Your trip stays as it was."
            } catch is CancellationError {
                self?.busy = false; self?.message = "Update cancelled. The current look is kept."; self?.request = nil
            } catch {
                self?.busy = false; self?.message = "Update unavailable. Your current look is kept. Retry when ready."; self?.request = nil
            }
        }
    }
    func cancel() { request?.cancel() }
    func changeLocally() {
        do { try material.updateLocal(local); message = "Local material preference kept for the next update." }
        catch { message = error.localizedDescription }
    }
    func rejectOldReceipt() {
        do { try material.update(forward.updates[0], source: latest); message = "Look updated." }
        catch { message = "Old update rejected. Your current look is kept." }
    }
}

@main
struct ReceivingApp: App {
    @State private var model: ReceivingModel?
    @State private var failure: String?
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-reset-example") {
            UserDefaults.standard.removeObject(forKey: "saved")
            UserDefaults.standard.removeObject(forKey: "reserved")
        }
        #endif
    }
    var body: some Scene {
        WindowGroup {
            Group {
                if ProcessInfo.processInfo.arguments.contains("-optical-example") { OpticalReceivingView() }
                else if let model { TripView(model: model) }
                else if let failure {
                    ContentUnavailableView("Look unavailable", systemImage: "exclamationmark.circle", description: Text(failure))
                } else { ProgressView().task {
                    do { model = try ReceivingModel() } catch { failure = error.localizedDescription }
                } }
            }
        }
    }
}

private struct TripView: View {
    let model: ReceivingModel
    @AppStorage("saved") private var saved = false
    @AppStorage("reserved") private var reserved = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.dynamicTypeSize) private var dynamicType
    @Environment(\.scenePhase) private var scenePhase
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SWITZERLAND · WEEKEND").font(.caption.weight(.semibold))
            Text("Above the lake").font(.largeTitle.bold())
            Text("Fronalpstock · 2 hours · 4.5 km · Easy").font(.subheadline)
        }
        .foregroundStyle(.white)
        // The glass panel below overlaps the photo's dark gradient so the
        // material refracts real content, not the flat page background.
        .padding(.top, dynamicType.isAccessibilitySize ? 140 : 64)
        .padding(EdgeInsets(top: 0, leading: 24, bottom: 124, trailing: 24))
        .frame(maxWidth: .infinity, minHeight: 330, alignment: .bottomLeading)
        .background {
            GeometryReader { geometry in
                ZStack {
                    Image(uiImage: model.photo).resizable().scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                }
            }.accessibilityHidden(true)
        }
        .overlay(alignment: .topTrailing) {
            Button { saved.toggle() } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark").padding(14)
            }
            .buttonStyle(.plain).accessibilityLabel(saved ? "Saved trip" : "Save trip")
            .accessibilityIdentifier("save")
            .background(reduceTransparency ? Color(.secondarySystemBackground) : .clear, in: Capsule())
            .worldbendGlass(model.material, in: Capsule(), interactive: true)
            .padding(24).padding(.top, 20)
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                VStack(alignment: .leading, spacing: 20) {
                    // The glass card leads the content and overlaps the photo's
                    // dark gradient so the material refracts real content.
                    GlassEffectContainer(spacing: 20) {
                        TripControls(material: model.material, reserved: $reserved, reduceTransparency: reduceTransparency)
                    }
                    .padding(.top, -100)
                    Text("Take the first lift, follow the lake path, and stop for coffee before the return.")
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 12) {
                        if dynamicType.isAccessibilitySize {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Design updates").font(.headline)
                                Text("Revision \(model.revision)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("revision")
                            }
                        } else {
                            HStack {
                                Text("Design updates").font(.headline)
                                Spacer()
                                Text("Revision \(model.revision)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("revision")
                            }
                        }
                        Text(model.message).font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("receipt-status")
                        VStack(alignment: .leading, spacing: 12) {
                            Button("Receive update", action: model.receive).disabled(model.busy).accessibilityIdentifier("receive").frame(minHeight: 44)
                            if model.busy { Button("Cancel", action: model.cancel).accessibilityIdentifier("cancel") }
                            Menu("More") {
                                Button("Keep local preference", action: model.changeLocally).disabled(model.revision != 1)
                                Button("Remove material") { model.material.remove(); model.message = "Material removed locally." }
                                Button("Restore latest look") { model.material.reattach(); model.message = "Latest look restored." }
                                Button("Try old update", action: model.rejectOldReceipt)
                                Button("Simulate failed receipt") { model.failNext = true; model.message = "The next receipt will fail; the current look stays usable." }
                            }.accessibilityIdentifier("more").frame(minHeight: 44)
                        }.buttonStyle(.bordered)
                    }
                Text("iOS uses native Liquid Glass. Figma’s six optical values and Splay are retained in the receipt; they do not tune the system material.")
                    .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 24).padding(.bottom, 28)
            }
        }
        .background(Color(.systemBackground))
        .ignoresSafeArea(edges: .top)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.material.isVisible)
        .onChange(of: scenePhase) { _, phase in if phase != .active { model.cancel() } }
    }
}

private struct TripControls: View {
    let material: AppearanceSession
    @Binding var reserved: Bool
    let reduceTransparency: Bool
    @State private var guests = 1
    @State private var note = ""
    @FocusState private var editing: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your morning").font(.headline)
            Stepper("Guests: \(guests)", value: $guests, in: 1...6).accessibilityIdentifier("guests")
            TextField("Trip note", text: $note).textFieldStyle(.roundedBorder)
                .focused($editing).accessibilityIdentifier("note")
            // The saved state stays quiet; the pending action stays prominent.
            Group {
                if reserved {
                    Button("Reservation saved") { reserved = false }.buttonStyle(.bordered)
                } else {
                    Button("Reserve morning") { reserved = true }.buttonStyle(.borderedProminent)
                }
            }.accessibilityIdentifier("reserve")
            if editing { Button("Done") { editing = false }.accessibilityIdentifier("done") }
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground).opacity(reduceTransparency || !material.isVisible ? 1 : 0.35), in: .rect(cornerRadius: 24))
        .worldbendGlass(material, in: .rect(cornerRadius: 24))
    }
}
