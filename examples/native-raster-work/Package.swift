// swift-tools-version: 6.0
import Foundation
import PackageDescription

let appearancePath =
  ProcessInfo.processInfo.environment["WORLDBEND_APPEARANCE_PACKAGE"] ?? "../../packages/swiftui"
let package = Package(
  name: "WorldbendRasterReceiving",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [.executable(name: "WorldbendRasterReceiving", targets: ["WorldbendRasterReceiving"])],
  dependencies: [.package(path: appearancePath)],
  targets: [
    .executableTarget(
      name: "WorldbendRasterReceiving",
      dependencies: [
        .product(
          name: "WorldbendAppearance",
          package: URL(fileURLWithPath: appearancePath).lastPathComponent)
      ], path: "App")
  ]
)
