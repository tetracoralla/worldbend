// swift-tools-version: 6.0
import Foundation
import PackageDescription

let appearancePath =
  ProcessInfo.processInfo.environment["WORLDBEND_APPEARANCE_PACKAGE"] ?? "../../packages/swiftui"
let package = Package(
  name: "WorldbendGPUReceiving", platforms: [.macOS(.v14), .iOS(.v17)],
  products: [.executable(name: "WorldbendGPUReceiving", targets: ["WorldbendGPUReceiving"])],
  dependencies: [.package(path: appearancePath)],
  targets: [
    .executableTarget(
      name: "WorldbendGPUReceiving",
      dependencies: [
        .product(
          name: "WorldbendAppearance",
          package: URL(fileURLWithPath: appearancePath).lastPathComponent)
      ], path: ".", exclude: ["Package.swift", "README.md", "Tests"], sources: ["App"],
      resources: [.copy("WorkAssets")]),
    .testTarget(name: "GPUReceivingTests", dependencies: ["WorldbendGPUReceiving"], path: "Tests"),
  ])
