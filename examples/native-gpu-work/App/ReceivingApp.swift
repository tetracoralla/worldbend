#if canImport(UIKit)
  import Foundation
  import Metal
  import Observation
  import SwiftUI
  import UIKit
  import WorldbendAppearance

  @MainActor private final class TideDisplayProxy: NSObject {
    weak var owner: TideModel?
    @objc func draw(_ link: CADisplayLink) { owner?.draw(timestamp: link.timestamp) }
  }

  @MainActor @Observable
  final class TideModel {
    let hub = WorldbendFrameHub()
    let program: TideProgram
    let producer: WorldbendMetalFrameProducer
    let renderer: WorldbendMetalOpticalRenderer
    var playing = false
    var stopped = false
    var parameters = TideParameters()
    var optical = true
    var error: String?
    var logicalSize = CGSize(width: 1, height: 1)
    var pixelSize = CGSize(width: 1, height: 1)
    @ObservationIgnored private var displayLink: CADisplayLink?
    @ObservationIgnored private let proxy = TideDisplayProxy()
    @ObservationIgnored private var sourceIdentity: WorldbendFrameResourceIdentity
    @ObservationIgnored private var anchor: Double?
    @ObservationIgnored private var heldSeconds = 0.0
    @ObservationIgnored private var lastSubmission: Double?
    @ObservationIgnored private var submissionIntervals: [Double] = []
    @ObservationIgnored private var producerGPUMilliseconds: [Double] = []
    @ObservationIgnored private var producerCPUMilliseconds: [Double] = []
    @ObservationIgnored private var producerCPUSubmitMilliseconds: [Double] = []
    @ObservationIgnored private var lastDisplayTimestamp: Double?
    @ObservationIgnored private var displayTimestampIntervals: [Double] = []
    @ObservationIgnored private var active = true
    @ObservationIgnored private var desiredPlayback = false
    var seconds: Double { heldSeconds + (anchor.map { max(0, CACurrentMediaTime() - $0) } ?? 0) }

    init() throws {
      guard let device = MTLCreateSystemDefaultDevice() else {
        throw CocoaError(.coderInvalidValue)
      }
      program = try TideProgram(device: device)
      producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
      renderer = WorldbendMetalOpticalRenderer(device: device, recordsPresentation: true)
      sourceIdentity = try program.identity(TideParameters())
      try producer.configure(source: sourceIdentity, expectedGuard: producer.guardValue)
      proxy.owner = self
    }
    func layout(_ size: CGSize, scale: CGFloat) {
      guard size.width > 0, size.height > 0, scale.isFinite, scale > 0 else { return }
      let pixels = CGSize(
        width: (size.width * scale).rounded(.up), height: (size.height * scale).rounded(.up))
      guard size != logicalSize || pixels != pixelSize else { return }
      logicalSize = size
      pixelSize = pixels
      do {
        try producer.configure(source: sourceIdentity, expectedGuard: producer.guardValue)
        draw(timestamp: CACurrentMediaTime())
      } catch { self.error = error.localizedDescription }
    }
    func play() {
      do {
        if producer.phase == .stopped {
          try producer.configure(source: sourceIdentity, expectedGuard: producer.guardValue)
        }
        desiredPlayback = true
        stopped = false
        guard active else { return }
        anchor = CACurrentMediaTime()
        playing = true
        let link = CADisplayLink(target: proxy, selector: #selector(TideDisplayProxy.draw(_:)))
        // Preference only. Actual submit/drawable presentation is recorded.
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 60)
        displayLink?.invalidate()
        displayLink = link
        link.add(to: .main, forMode: .common)
      } catch { self.error = error.localizedDescription }
    }
    func pause() {
      heldSeconds = seconds
      anchor = nil
      playing = false
      desiredPlayback = false
      lastSubmission = nil
      lastDisplayTimestamp = nil
      displayLink?.invalidate()
      displayLink = nil
      writeMeasurements()
    }
    func stop() {
      pause()
      heldSeconds = 0
      stopped = true
      producer.stop()
      writeMeasurements()
    }
    func setActive(_ value: Bool) {
      guard active != value else { return }
      let intent = desiredPlayback
      if !value { pause() }
      active = value
      desiredPlayback = intent
      if value, intent { play() }
    }
    func changeParameters(_ change: (inout TideParameters) -> Void) {
      change(&parameters)
      do {
        sourceIdentity = try program.identity(parameters)
        try producer.configure(source: sourceIdentity, expectedGuard: producer.guardValue)
        stopped = false
        draw(timestamp: CACurrentMediaTime())
      } catch { self.error = error.localizedDescription }
    }
    func draw(timestamp: Double) {
      guard active, logicalSize.width > 1, logicalSize.height > 1, !stopped else { return }
      if producer.phase == .superseded || producer.phase == .disposed {
        pause()
        return
      }
      let time = seconds
      let parameters = parameters
      let size = logicalSize
      let descriptor = WorldbendFrameDescriptor(
        frameID: hub.makeFrameID(), logicalSize: size,
        contentRect: CGRect(origin: .zero, size: size),
        pixelWidth: Int(pixelSize.width), pixelHeight: Int(pixelSize.height), colorSpace: .sRGB,
        pixelFormat: parameters.extendedRange ? .rgba16Float : .bgra8Unorm,
        presentationTime: .seconds(time),
        resourceIdentity: sourceIdentity,
        alphaMode: parameters.transparent ? .premultiplied : .opaque)
      do {
        let result = try producer.submit(descriptor: descriptor) {
          try program.encode(
            $0, target: $1, logicalSize: size, seconds: time, parameters: parameters)
        }
        if result == .submitted {
          let submittedAt = CACurrentMediaTime()
          if playing {
            if let lastSubmission {
              submissionIntervals.append((submittedAt - lastSubmission) * 1000)
            }
            if let lastDisplayTimestamp {
              displayTimestampIntervals.append((timestamp - lastDisplayTimestamp) * 1000)
            }
            lastSubmission = submittedAt
            lastDisplayTimestamp = timestamp
          }
          producerCPUMilliseconds.append(producer.metrics.lastCPUEncodeMilliseconds)
          producerCPUSubmitMilliseconds.append(producer.metrics.lastCPUSubmitMilliseconds)
          if let gpu = producer.metrics.lastGPUMilliseconds { producerGPUMilliseconds.append(gpu) }
          if submissionIntervals.count > 720 { submissionIntervals.removeFirst() }
          if producerCPUMilliseconds.count > 720 { producerCPUMilliseconds.removeFirst() }
          if producerGPUMilliseconds.count > 720 { producerGPUMilliseconds.removeFirst() }
          if producerCPUSubmitMilliseconds.count > 720 {
            producerCPUSubmitMilliseconds.removeFirst()
          }
          if displayTimestampIntervals.count > 720 { displayTimestampIntervals.removeFirst() }
        }
      } catch {
        self.error = error.localizedDescription
        pause()
      }
    }
    func writeMeasurements() {
      let shown = renderer.recentPresentations.filter { $0.role == .backdrop }
      let intervals = zip(shown, shown.dropFirst()).map { ($1.time - $0.time) * 1000 }
      let report: [String: Any] = [
        "schema": "worldbend.native-gpu-runtime@0.1", "workID": sourceIdentity.workID,
        "contentVersion": sourceIdentity.contentVersion,
        "logicalSize": [logicalSize.width, logicalSize.height],
        "pixelSize": [pixelSize.width, pixelSize.height], "timeSeconds": seconds,
        "sourceSubmitted": producer.metrics.submitted,
        "sourceGPUCompleted": producer.metrics.completed,
        "sourcePublished": producer.metrics.published,
        "sourceDroppedInFlight": producer.metrics.droppedInFlight,
        "sourceDroppedRetained": producer.metrics.droppedRetainedResources,
        "sourceCPUEncodeMilliseconds": producerCPUMilliseconds,
        "sourceCPUSubmitMilliseconds": producerCPUSubmitMilliseconds,
        "sourceGPUMilliseconds": producerGPUMilliseconds,
        "submitIntervalsMilliseconds": submissionIntervals,
        "displayLinkTimestampIntervalsMilliseconds": displayTimestampIntervals,
        "submitIntervalMethod":
          "CPU CACurrentMediaTime at actual successful submission; paused gaps excluded",
        "opticalGPUCompleted": renderer.metrics.gpuCompleted,
        "opticalGPUFailed": renderer.metrics.gpuFailed,
        "actualBackdropDrawablesPresented": renderer.metrics.presentedBackdrops,
        "drawablePresentationTelemetryAvailable": renderer.presentationTelemetryAvailable,
        "actualPaneDrawablesPresented": renderer.metrics.presentedPanes,
        "backdropPresentedIntervalsMilliseconds": intervals,
        "opticalTotalGPUMilliseconds": renderer.metrics.totalGPUMilliseconds,
        "opticalMeasuredGPUCommands": renderer.metrics.measuredGPUCommands,
        "retainedTextureBytes": producer.liveTextureBytes,
        "retainedTextureCount": producer.liveTextureCount,
        "opticalStatus": renderer.status.rawValue,
        "limits": [
          "Simulator, not physical-device60fps/thermal/power",
          "encoded-sRGB source; current optical outputs SDR8-bit",
          "no per-frameUIImage/PNG readback in production; proof export separate",
        ],
      ]
      if let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
        let data = try? JSONSerialization.data(
          withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
      {
        try? data.write(to: root.appendingPathComponent("gpu-runtime.json"))
      }
    }
  }

  @MainActor
  struct TideView: View {
    let model: TideModel
    @Environment(\.displayScale) private var displayScale
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
      VStack(spacing: 18) {
        HStack {
          Text("Chromatic Tide").font(.title2.weight(.semibold))
          Spacer()
          Button(model.playing ? "暂停" : "继续") {
            if model.playing { model.pause() } else { model.play() }
          }.accessibilityIdentifier("play-tide")
        }
        GeometryReader { geometry in
          WorldbendOpticalMetalFrameScene(frameHub: model.hub, renderer: model.renderer) {
            context in
            if model.optical {
              VStack(spacing: 12) {
                HStack {
                  Text("色彩").font(.headline)
                  Spacer()
                  Button("切换") { model.changeParameters { $0.variation = 1 - $0.variation } }
                    .accessibilityIdentifier("change-palette")
                }
              }
              .padding(16).frame(width: geometry.size.width * 0.78, height: 76)
              .background { pane(context) }
              .position(x: geometry.size.width * 0.5, y: geometry.size.height * 0.14 + 38)
              HStack {
                Button(model.parameters.transparent ? "实色" : "透明") {
                  model.changeParameters { $0.transparent.toggle() }
                }.accessibilityIdentifier("change-alpha")
                Spacer()
                Button("停止") { model.stop() }.accessibilityIdentifier("stop-tide")
              }
              .padding(20).frame(width: geometry.size.width * 0.64, height: 96)
              .background { pane(context) }
              .position(x: geometry.size.width * 0.5, y: geometry.size.height * 0.62 + 48)
            }
          }
          .background(Color(red: 0.10, green: 0.08, blue: 0.16))
          .clipShape(RoundedRectangle(cornerRadius: 28))
          .onAppear { model.layout(geometry.size, scale: displayScale) }
          .onChange(of: geometry.size) { _, size in model.layout(size, scale: displayScale) }
          .onChange(of: displayScale) { _, scale in model.layout(geometry.size, scale: scale) }
        }
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        HStack {
          Toggle("光学", isOn: Binding(get: { model.optical }, set: { model.optical = $0 }))
            .accessibilityIdentifier("show-optics")
          Spacer()
          Button(model.parameters.extendedRange ? "标准亮度" : "高亮") {
            model.changeParameters { $0.extendedRange.toggle() }
          }.accessibilityIdentifier("change-hdr")
        }
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
          Text(
            String(
              format: "%.1f 秒 · %.0f × %.0f", model.seconds, model.pixelSize.width,
              model.pixelSize.height)
          ).font(.caption).monospacedDigit().accessibilityIdentifier("tide-status")
        }
        if let error = model.error { Text(error).foregroundStyle(.red).font(.caption) }
        Spacer(minLength: 0)
      }
      .padding(20).background(Color(red: 0.035, green: 0.04, blue: 0.07).ignoresSafeArea())
      .preferredColorScheme(.dark)
      .buttonStyle(TideButtonStyle())
      .onAppear { if !reduceMotion { model.play() } }
      .onChange(of: scenePhase) { _, phase in model.setActive(phase == .active) }
      .onChange(of: reduceMotion) { _, reduced in if reduced { model.pause() } }
      .onDisappear { model.stop() }
    }
    private func pane(_ context: WorldbendMetalOpticalSceneContext) -> some View {
      WorldbendMetalOpticalPane(
        binding: context.binding, renderer: model.renderer, optics: model.program.optics,
        cornerRadius: 24, coordinateSpace: context.coordinateSpace,
        opaqueFill: Color(red: 0.15, green: 0.18, blue: 0.25))
    }
  }

  private struct TideButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label.font(.callout.weight(.medium)).foregroundStyle(.white)
        .padding(.horizontal, 12).frame(minWidth: 44, minHeight: 44)
        .background(
          RoundedRectangle(cornerRadius: 12).fill(
            Color(red: 0.035, green: 0.055, blue: 0.075).opacity(
              configuration.isPressed ? 0.6 : 0.88)))
    }
  }

  @main
  struct GPUReceivingApp: App {
    @State private var model: TideModel?
    @State private var error: String?
    var body: some Scene {
      WindowGroup {
        Group {
          if let model {
            TideView(model: model)
          } else if let error {
            Text(error).padding(24)
          } else {
            ProgressView().task {
              do { model = try TideModel() } catch { self.error = error.localizedDescription }
            }
          }
        }
      }
    }
  }
#endif
