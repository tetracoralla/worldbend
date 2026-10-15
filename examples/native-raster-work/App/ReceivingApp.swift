import Foundation
import SwiftUI
import WorldbendAppearance

@MainActor @Observable
final class RasterReceivingModel {
  let hub = WorldbendFrameHub()
  let receiver: WorldbendRasterWorkSession
  private let root: URL
  private let pins: [String: String]
  var selected = "work-initial"
  var error: String?

  init() throws {
    let arguments = ProcessInfo.processInfo.arguments
    if let index = arguments.firstIndex(of: "--candidate-root"),
      arguments.indices.contains(index + 1)
    {
      root = URL(fileURLWithPath: arguments[index + 1])
    } else if let bundled = Bundle.main.resourceURL?.appendingPathComponent("WorkPackages"),
      FileManager.default.fileExists(atPath: bundled.path)
    {
      root = bundled
    } else if let bundled = Bundle.main.resourceURL,
      FileManager.default.fileExists(
        atPath: bundled.appendingPathComponent("work-initial/candidate-receipt.json").path)
    {
      root = bundled
    } else {
      throw CocoaError(
        .fileReadNoSuchFile,
        userInfo: [NSLocalizedDescriptionKey: "启动时指定 --candidate-root <固定作品目录>。"])
    }
    var pinned: [String: String] = [:]
    for name in ["work-initial", "work-revised"] {
      let data = try Data(contentsOf: root.appendingPathComponent(name + "/candidate-receipt.json"))
      guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let pin = object["manifestSHA256"] as? String
      else { throw CocoaError(.fileReadCorruptFile) }
      pinned[name] = pin
    }
    pins = pinned
    receiver = .init(
      hub: hub, logicalSize: CGSize(width: 960, height: 720),
      contentRect: CGRect(x: 0, y: 0, width: 960, height: 720))
  }

  func receive(_ name: String) async {
    guard let pin = pins[name] else { return }
    do {
      try await receiver.receive(
        root: root.appendingPathComponent(name), expectedManifestSHA256: pin,
        expectedGuard: receiver.guardValue)
      selected = name
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func perform(_ action: () throws -> Void) {
    do {
      try action()
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func reset() async {
    do {
      try await receiver.reset()
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func seek(_ value: Double) async {
    do {
      try await receiver.seek(milliseconds: value)
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}

@MainActor
struct RasterReceivingView: View {
  let model: RasterReceivingModel
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var scrub = 0.0
  @State private var editing = false
  @State private var seekTask: Task<Void, Never>?

  var body: some View {
    VStack(spacing: 20) {
      HStack {
        Text("FIELD NOTES").font(.headline)
        Spacer()
        Button("初版 · 4 秒") { Task { await model.receive("work-initial") } }
          .accessibilityIdentifier("revision-initial")
        Button("修订版 · 6 秒") { Task { await model.receive("work-revised") } }
          .accessibilityIdentifier("revision-revised")
      }
      .disabled(model.receiver.busy)

      GeometryReader { geometry in
        WorldbendOpticalFrameScene(frameHub: model.hub) { _ in EmptyView() }
          .onAppear { layout(geometry.size) }
          .onChange(of: geometry.size) { _, size in layout(size) }
      }
      .aspectRatio(4.0 / 3.0, contentMode: .fit)
      .background(Color(red: 209.0 / 255, green: 204.0 / 255, blue: 180.0 / 255))
      .accessibilityLabel("Field Notes 纸艺场景")

      Slider(value: $scrub, in: 0...max(1, model.receiver.durationMilliseconds)) { isEditing in
        editing = isEditing
        if isEditing {
          model.receiver.pause()
        } else {
          seekTask?.cancel()
          seekTask = Task { await model.seek(scrub) }
        }
      }
      .accessibilityLabel("观看进度")
      .accessibilityIdentifier("work-progress-slider")
      .accessibilityValue(String(format: "%.1f 秒", scrub / 1000))
      .disabled(model.receiver.manifest == nil || model.receiver.busy)

      HStack {
        Button(model.receiver.phase == .playing ? "暂停" : "播放") {
          if model.receiver.phase == .playing {
            model.receiver.pause()
          } else {
            model.perform { try model.receiver.play() }
          }
        }
        .accessibilityIdentifier("toggle-play")
        .disabled(model.receiver.manifest == nil || model.receiver.busy)
        Button("回到开头") { Task { await model.reset() } }
          .accessibilityIdentifier("reset-work")
          .disabled(model.receiver.manifest == nil || model.receiver.busy)
        Button("停止") { model.receiver.stop() }
          .accessibilityIdentifier("stop-work")
        Spacer()
        if model.receiver.busy { ProgressView().controlSize(.small) }
        Text(
          String(
            format: "%.1f / %.1f 秒", model.receiver.timeMilliseconds / 1000,
            model.receiver.durationMilliseconds / 1000)
        )
        .accessibilityIdentifier("work-progress")
        .monospacedDigit().font(.caption)
      }
      if let error = model.error {
        Text(error).font(.callout).foregroundStyle(.red).textSelection(.enabled)
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(red: 0.95, green: 0.94, blue: 0.90))
    .task { await model.receive("work-initial") }
    .onChange(of: model.receiver.timeMilliseconds) { _, value in if !editing { scrub = value } }
    .onChange(of: scenePhase) { _, phase in model.receiver.setActive(phase == .active) }
    .onChange(of: reduceMotion) { _, reduced in if reduced { model.receiver.pause() } }
    .onDisappear {
      seekTask?.cancel()
      model.receiver.stop()
    }
  }

  private func layout(_ size: CGSize) {
    guard size.width > 0, size.height > 0 else { return }
    model.perform {
      try model.receiver.setLayout(
        logicalSize: size, contentRect: CGRect(origin: .zero, size: size))
    }
  }
}

@main
struct RasterReceivingApp: App {
  @State private var model: RasterReceivingModel?
  @State private var startupError: String?
  var body: some Scene {
    WindowGroup {
      Group {
        if let model {
          RasterReceivingView(model: model)
        } else if let startupError {
          Text(startupError).padding(24).textSelection(.enabled)
        } else {
          ProgressView().task {
            do { model = try RasterReceivingModel() } catch {
              startupError = error.localizedDescription
            }
          }
        }
      }
      .frame(minWidth: 340, idealWidth: 800, minHeight: 440, idealHeight: 780)
    }
  }
}
