// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorldbendAppearance",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "WorldbendAppearance", targets: ["WorldbendAppearance"])],
    targets: [
        .target(
            name: "WorldbendAppearance",
            resources: [
                .process("Shaders"),
                .process("Licenses")
            ],
            linkerSettings: [
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CoreGraphics")
            ]
        ),
        .testTarget(name: "WorldbendAppearanceTests", dependencies: ["WorldbendAppearance"],
                    resources: [
                        .copy("Receipts"),
                        .copy("Fixtures")
                    ])
    ]
)
