// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name:"WorldbendMaterialReceiving",
    platforms:[.macOS(.v14),.iOS(.v17)],
    products:[.executable(name:"WorldbendMaterialReceiving",targets:["WorldbendMaterialReceiving"])],
    dependencies:[.package(path:"../../packages/swiftui")],
    targets:[.executableTarget(name:"WorldbendMaterialReceiving",
        dependencies:[.product(name:"WorldbendAppearance",package:"swiftui")],path:".",
        exclude:["Package.swift","README.md","project.yml","Tests"],sources:["App"],resources:[.copy("Receipts")]),
        .testTarget(name:"ReceivingPersistenceTests",dependencies:["WorldbendMaterialReceiving"],path:"Tests")]
)
