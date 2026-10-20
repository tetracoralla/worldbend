import Foundation
import Metal
import Testing
import WorldbendAppearance

@testable import WorldbendGPUReceiving

@MainActor
struct GPUReceivingTests {
  @Test(.enabled(if: ProcessInfo.processInfo.environment["WORLDBEND_OPTICAL_LIBRARY"] != nil))
  func actualDynamicSourceAndOpticalPixels() async throws {
    let device = try #require(MTLCreateSystemDefaultDevice())
    let hub = WorldbendFrameHub()
    let program = try TideProgram(device: device)
    let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
    defer { producer.destroy() }
    let renderer = WorldbendMetalOpticalRenderer(
      device: device,
      libraryURL: URL(
        fileURLWithPath: try #require(
          ProcessInfo.processInfo.environment["WORLDBEND_OPTICAL_LIBRARY"])))
    #expect(renderer.isReady)
    let size = CGSize(width: 390, height: 520)
    let pixels = CGSize(width: 390, height: 520)
    let parameters = TideParameters()
    try await TideProof.submit(
      program: program, producer: producer, hub: hub, seconds: 0, size: size, pixels: pixels,
      parameters: parameters)
    var binding: WorldbendMetalOpticalBinding? = hub.metalOpticalBinding(device: device)
    let firstScene = try await TideProof.composite(
      program: program, renderer: renderer, binding: try #require(binding), size: size,
      pixels: pixels)
    let first = try await TideProof.bytes(firstScene)
    let plain = try await TideProof.composite(
      program: program, renderer: renderer, binding: try #require(binding), size: size,
      pixels: pixels, optical: false)
    let original = try await TideProof.bytes(plain)
    #expect(first != original)
    // Outside both panes the source remains exact; within the top pane it
    // must differ through the actual compiled optical shader, not a label.
    let outside = (20 * 390 + 20) * 4
    let inside = (90 * 390 + 50) * 4
    #expect(first[outside..<outside + 4] == original[outside..<outside + 4])
    #expect(
      zip(first[inside..<inside + 120], original[inside..<inside + 120]).contains { $0 != $1 })
    binding = nil
    try await TideProof.submit(
      program: program, producer: producer, hub: hub, seconds: 1.4, size: size, pixels: pixels,
      parameters: parameters)
    let later = try await TideProof.composite(
      program: program, renderer: renderer, binding: hub.metalOpticalBinding(device: device),
      size: size, pixels: pixels)
    #expect(try await TideProof.bytes(later) != first)
    try await TideProof.submit(
      program: program, producer: producer, hub: hub, seconds: 0, size: size, pixels: pixels,
      parameters: parameters)
    let repeated = try await TideProof.composite(
      program: program, renderer: renderer, binding: hub.metalOpticalBinding(device: device),
      size: size, pixels: pixels)
    #expect(try await TideProof.bytes(repeated) == first)
    var transparent = parameters
    transparent.transparent = true
    try await TideProof.submit(
      program: program, producer: producer, hub: hub, seconds: 0, size: size, pixels: pixels,
      parameters: transparent)
    let alphaScene = try await TideProof.composite(
      program: program, renderer: renderer, binding: hub.metalOpticalBinding(device: device),
      size: size, pixels: pixels)
    let alpha = try await TideProof.bytes(alphaScene)
    #expect(alpha[outside + 3] > 0 && alpha[outside + 3] < 255)
    #expect(alpha[outside] <= alpha[outside + 3])
    #expect(renderer.metrics.encodedPanes >= 8)
  }
}
