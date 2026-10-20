#if !canImport(UIKit)
  import Foundation
  import Metal
  import WorldbendAppearance

  @main
  struct GPUProofMain {
    @MainActor static func main() async throws {
      let args = CommandLine.arguments
      func flag(_ name: String) -> String? {
        guard let i = args.firstIndex(of: name), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
      }
      guard let outputPath = flag("--output"), let library = flag("--optical-library"),
        let device = MTLCreateSystemDefaultDevice()
      else { throw CocoaError(.fileReadNoSuchFile) }
      let output = URL(fileURLWithPath: outputPath)
      try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
      guard try FileManager.default.contentsOfDirectory(atPath: output.path).isEmpty else {
        throw CocoaError(.fileWriteFileExists)
      }
      let frames = Int(flag("--frames") ?? "240") ?? 240
      let fps = Double(flag("--fps") ?? "60") ?? 60
      let size = CGSize(width: 390, height: 520)
      let pixels = CGSize(width: 1170, height: 1560)
      let hub = WorldbendFrameHub()
      let program = try TideProgram(device: device)
      let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
      defer { producer.destroy() }
      let renderer = WorldbendMetalOpticalRenderer(
        device: device, libraryURL: URL(fileURLWithPath: library))
      guard renderer.isReady, frames > 0, frames <= 720, fps > 0, fps <= 120 else {
        throw CocoaError(.coderInvalidValue)
      }
      let parameter = TideParameters()
      let identity = try program.identity(parameter)
      var first: Data?
      var last: Data?
      var opticalDifference = 0
      let start = ContinuousClock.now
      try FileManager.default.createDirectory(
        at: output.appendingPathComponent("frames"), withIntermediateDirectories: true)
      for frame in 0..<frames {
        try await TideProof.submit(
          program: program, producer: producer, hub: hub, seconds: Double(frame) / fps, size: size,
          pixels: pixels, parameters: parameter)
        let binding = hub.metalOpticalBinding(device: device)
        let scene = try await TideProof.composite(
          program: program, renderer: renderer, binding: binding, size: size, pixels: pixels)
        if frame == 0 {
          first = try await TideProof.bytes(scene)
          let plain = try await TideProof.composite(
            program: program, renderer: renderer, binding: binding, size: size, pixels: pixels,
            optical: false)
          let plainBytes = try await TideProof.bytes(plain)
          opticalDifference = zip(first!, plainBytes).filter { $0 != $1 }.count
          try await TideProof.savePNG(plain, to: output.appendingPathComponent("source.png"))
        }
        if frame == frames - 1 { last = try await TideProof.bytes(scene) }
        try await TideProof.savePNG(
          scene,
          to: output.appendingPathComponent("frames/" + String(format: "%04d", frame) + ".png"))
      }
      guard first != last, opticalDifference > 1000 else { throw CocoaError(.coderInvalidValue) }
      let report: [String: Any] = [
        "schema": "worldbend.native-gpu-work-proof@0.1", "workID": identity.workID,
        "contentVersion": identity.contentVersion,
        "logicalSize": [390, 520], "pixels": [1170, 1560], "frames": frames, "fps": fps,
        "alpha": "opaque", "color": "srgb-encoded",
        "sourceCompileMilliseconds": program.coldCompileMilliseconds,
        "offlineDuration": String(describing: start.duration(to: ContinuousClock.now)),
        "actualOpticalChangedBytes": opticalDifference,
        "producerSubmitted": producer.metrics.submitted,
        "producerPublished": producer.metrics.published,
        "opticalEncodedBackdrops": renderer.metrics.encodedBackdrops,
        "opticalEncodedPanes": renderer.metrics.encodedPanes,
        "lastProducerCPUEncodeMilliseconds": producer.metrics.lastCPUEncodeMilliseconds,
        "lastProducerGPUMilliseconds": producer.metrics.lastGPUMilliseconds as Any? ?? NSNull(),
        "presentationMeasured": false,
        "limits": [
          "offline proof/export readback; no production PNG/UIImage loop",
          "not physical-device60fps", "SDR output; HDR presentation unproven",
          "analytic field, not particles or realtime3D",
        ],
      ]
      try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        .write(to: output.appendingPathComponent("proof.json"))
      print(
        String(
          decoding: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
          as: UTF8.self))
    }
  }
#endif
