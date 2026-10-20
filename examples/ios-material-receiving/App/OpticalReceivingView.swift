import SwiftUI
import UIKit
import WorldbendAppearance

private struct OpticalRevisions: Decodable { let updates: [AppearanceUpdate] }

@MainActor @Observable
private final class OpticalModel {
    let photo: UIImage
    let session: AppearanceSession
    let first, next: AppearanceDelivery
    let updates: OpticalRevisions
    var status = "Initial look"
    var revised = false
    init() throws {
        guard let file = Bundle.main.path(forResource: "fronalpstock", ofType: "jpg"), let photo = UIImage(contentsOfFile: file)
        else { throw AppearanceError.invalidReceipt }
        self.photo = photo
        let args = ProcessInfo.processInfo.arguments
        let variant = args.firstIndex(of: "-optical-variant").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        first = try Self.load(variant.map { "optical-\($0)" } ?? "optical-initial")
        next = try Self.load("optical-source")
        updates = try Self.load("optical-revision")
        session = AppearanceSession(first)
    }
    static func load<T: Decodable>(_ name: String) throws -> T {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json") else { throw AppearanceError.invalidReceipt }
        return try AppearanceReceipt.decode(T.self, from: Data(contentsOf: url))
    }
    func receive() {
        do {
            guard let update = updates.updates.first(where: { $0.previousDeliveryFingerprint == session.delivery?.fingerprint }) else { throw AppearanceError.staleUpdate }
            try session.update(update, source: next)
            revised = true; status = "Updated look"
        } catch { status = "Update rejected; current look kept" }
    }
}

struct OpticalReceivingView: View {
    @State private var model: OpticalModel?
    @State private var failure: String?
    var body: some View {
        Group {
            if let model { OpticalSceneView(model: model) }
            else if let failure { Text(failure) }
            else { ProgressView().task {
                do { model = try OpticalModel() } catch { failure = error.localizedDescription }
            } }
        }
    }
}

private struct OpticalSceneView: View {
    let model: OpticalModel
    @State private var note = ""
    @State private var submitted = false
    @State private var shift = 0.0
    @State private var diagnostic = ProcessInfo.processInfo.arguments.contains("-optical-chart")
    @FocusState private var focused: Bool
    var body: some View {
        WorldbendOpticalScene {
            OpticalBackdropView(photo: model.photo, diagnostic: diagnostic, shift: shift)
        } content: { backdrop in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ABOVE THE LAKE").font(.caption.weight(.bold))
                        Text("Make it your morning").font(.largeTitle.bold())
                    }.foregroundStyle(.white).shadow(radius: 2).padding(.top, 60)
                    Spacer(minLength: 50)
                    // No glyphs exist in the supplied backdrop. Both roles use one optical session.
                    HStack(spacing: 12) {
                        TextField("A note for your trip", text: $note)
                            .font(.body.weight(.semibold)).foregroundStyle(.white).tint(.white)
                            .focused($focused).accessibilityIdentifier("optical-note")
                            .padding(18).frame(height: 60)
                            .background {
                                WorldbendOpticalPane(backdrop: backdrop, optics: model.session.opticalConfiguration,
                                    cornerRadius: 24, tint: .black.opacity(0.05), opaqueFill: Color(white: 0.2))
                            }
                            .contentShape(.rect(cornerRadius: 24))
                        Button { submitted.toggle(); focused = false } label: {
                            Image(systemName: submitted ? "checkmark" : "arrow.right").font(.title2.bold())
                                .foregroundStyle(.white).frame(width: 60, height: 60)
                        }.buttonStyle(.plain).accessibilityLabel("Save note").accessibilityIdentifier("optical-save")
                            .background {
                                WorldbendOpticalPane(backdrop: backdrop, optics: model.session.opticalConfiguration,
                                    cornerRadius: 30, tint: .green.opacity(0.28), opaqueFill: .green)
                            }
                    }
                    RoundedRectangle(cornerRadius: 32).fill(.clear).frame(height: 148)
                        .background {
                            WorldbendOpticalPane(backdrop: backdrop, optics: model.session.opticalConfiguration,
                                cornerRadius: 32, tint: .clear)
                        }.clipped().contentShape(Rectangle())
                        .accessibilityElement(children: .ignore).accessibilityLabel("Optical sample")
                        .accessibilityIdentifier("optical-sample")
                        .environment(\.colorScheme, .dark)
                    VStack(alignment: .leading, spacing: 14) {
                        Text(model.status).font(.headline).accessibilityIdentifier("optical-status")
                        HStack {
                            Button("Receive edit") { model.receive() }.disabled(model.revised).accessibilityIdentifier("optical-receive")
                            Button("Remove") { model.session.remove() }.accessibilityIdentifier("optical-remove")
                            Button("Restore") { model.session.reattach() }.accessibilityIdentifier("optical-restore")
                        }.buttonStyle(.bordered)
                        Toggle("Calibration grid", isOn: $diagnostic)
                        Slider(value: $shift, in: 0...70) { Text("Move background") }.accessibilityIdentifier("optical-background")
                        Text("One shared material. The input and action keep their own layout and behavior.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }.padding(20).background(Color(.systemBackground), in: .rect(cornerRadius: 24))
                }.padding(24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .ignoresSafeArea().preferredColorScheme(.light)
    }
}

private struct OpticalBackdropView: View {
    let photo: UIImage
    let diagnostic: Bool
    let shift: Double
    @Environment(\.colorScheme) private var scheme
    var body: some View {
            GeometryReader { geometry in
                if diagnostic {
                    Canvas { context, size in
                        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color((scheme == .dark ? Color(red: 0.32, green: 0.12, blue: 0.18) : Color(red: 0.12, green: 0.22, blue: 0.32))))
                        for x in stride(from: -40.0, through: Double(size.width) + 40, by: 16) {
                            context.fill(Path(CGRect(x: x + shift, y: 0, width: 5, height: size.height)), with: .color(.white.opacity(0.9)))
                        }
                        // Use authored colors for optical calibration. Semantic
                        // system orange resolves differently in an offscreen layer.
                        for y in stride(from: 0.0, through: Double(size.height), by: 28) {
                            context.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 5)), with: .color(Color(.sRGB, red: 1, green: 0.55, blue: 0.16)))
                        }
                        context.fill(Path(CGRect(x: 180 + shift, y: 0, width: 8, height: size.height)),
                                     with: .color(Color(.displayP3, red: 0.9, green: 0.2, blue: 0.1)))
                    }
                } else {
                    Image(uiImage: photo).resizable().scaledToFill()
                        .frame(width: geometry.size.width + 80, height: geometry.size.height)
                        .offset(x: shift - 40).clipped()
                    LinearGradient(colors: [.black.opacity(0.05), .clear, .black.opacity(0.18)], startPoint: .top, endPoint: .bottom)
                }
            }
    }
}
