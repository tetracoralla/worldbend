import CryptoKit
import Foundation
import Observation
import simd

/// Encoded sRGB color and coverage, matching the canonical material receipts.
public struct WorldbendMaterialColor: Codable, Equatable, Sendable {
    public var r, g, b, a: Double
    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
    func validate() throws {
        guard [r,g,b,a].allSatisfy({ $0.isFinite && (0...1).contains($0) }) else { throw AppearanceError.invalidReceipt }
    }
    var vector: SIMD4<Float> { .init(Float(r),Float(g),Float(b),Float(a)) }
}

public protocol WorldbendProceduralMaterial: Codable, Equatable, Sendable {
    static var family: String { get }
    static var sourceSHA256: String { get }
    static var vertexFunction: String { get }
    static var fragmentFunction: String { get }
    static var uniformBytes: Int { get }
    static var fieldIds: Set<String> { get }
    var visible: Bool { get }
    var animates: Bool { get }
    func validate() throws
    func uniforms(milliseconds: Double, width: Int, height: Int) -> [SIMD4<Float>]
}

public struct WorldbendFoilMaterial: WorldbendProceduralMaterial {
    public var visible: Bool
    public var baseColor, highlightColor: WorldbendMaterialColor
    public var lightAngle, intensity, roughness, flowSpeed: Double
    public init(visible: Bool = true, baseColor: WorldbendMaterialColor,
                highlightColor: WorldbendMaterialColor, lightAngle: Double = 45,
                intensity: Double = 0.6, roughness: Double = 0.4, flowSpeed: Double = 0.3) {
        self.visible = visible; self.baseColor = baseColor; self.highlightColor = highlightColor
        self.lightAngle = lightAngle; self.intensity = intensity; self.roughness = roughness; self.flowSpeed = flowSpeed
    }
    public static let family = "foil"
    public static var sourceSHA256: String { WorldbendMaterialKernels.foilSourceSHA256 }
    public static var vertexFunction: String { WorldbendMaterialKernels.foilVertex }
    public static var fragmentFunction: String { WorldbendMaterialKernels.foilFragment }
    public static let uniformBytes = 96
    public static let fieldIds: Set<String> = ["visible","base-color","highlight-color","light-angle","intensity","roughness","flow-speed"]
    public var animates: Bool { visible && flowSpeed > 0 && intensity > 0 }
    public func validate() throws {
        try baseColor.validate(); try highlightColor.validate()
        guard [lightAngle,intensity,roughness,flowSpeed].allSatisfy(\.isFinite),
              (0...360).contains(lightAngle), (0...1).contains(intensity),
              (0...1).contains(roughness), (0...2).contains(flowSpeed) else { throw AppearanceError.invalidReceipt }
    }
    public func uniforms(milliseconds: Double, width: Int, height: Int) -> [SIMD4<Float>] {
        [.init(Float(milliseconds / 1000),0,0,0), .init(Float(width),Float(height),0,0),
         baseColor.vector, highlightColor.vector,
         .init(Float(lightAngle * .pi / 180),Float(intensity),Float(roughness),Float(flowSpeed)),
         .init(visible ? 1 : 0,1,0,0)]
    }
}

public struct WorldbendMeshGradientMaterial: WorldbendProceduralMaterial {
    public var visible: Bool
    public var colorTl, colorTr, colorBl, colorBr: WorldbendMaterialColor
    public var warp, softness, durationMs, phaseMs, flowSpeed: Double
    public init(visible: Bool = true, colorTl: WorldbendMaterialColor, colorTr: WorldbendMaterialColor,
                colorBl: WorldbendMaterialColor, colorBr: WorldbendMaterialColor, warp: Double = 0.5,
                softness: Double = 0.5, durationMs: Double = 5000, phaseMs: Double = 0, flowSpeed: Double = 1) {
        self.visible = visible; self.colorTl = colorTl; self.colorTr = colorTr; self.colorBl = colorBl; self.colorBr = colorBr
        self.warp = warp; self.softness = softness; self.durationMs = durationMs; self.phaseMs = phaseMs; self.flowSpeed = flowSpeed
    }
    public static let family = "mesh-gradient"
    public static var sourceSHA256: String { WorldbendMaterialKernels.meshGradientSourceSHA256 }
    public static var vertexFunction: String { WorldbendMaterialKernels.meshGradientVertex }
    public static var fragmentFunction: String { WorldbendMaterialKernels.meshGradientFragment }
    public static let uniformBytes = 128
    public static let fieldIds: Set<String> = ["visible","color-tl","color-tr","color-bl","color-br","warp","softness","duration-ms","phase-ms","flow-speed"]
    public var animates: Bool { visible && warp > 0 && flowSpeed > 0 }
    public func validate() throws {
        for color in [colorTl,colorTr,colorBl,colorBr] { try color.validate() }
        guard [warp,softness,durationMs,phaseMs,flowSpeed].allSatisfy(\.isFinite),
              (0...1).contains(warp), (0...1).contains(softness), (100...60000).contains(durationMs),
              (0...60000).contains(phaseMs), (0...2).contains(flowSpeed) else { throw AppearanceError.invalidReceipt }
    }
    public func uniforms(milliseconds: Double, width: Int, height: Int) -> [SIMD4<Float>] {
        [.init(Float(milliseconds / 1000),Float(durationMs / 1000),Float(phaseMs / 1000),Float(flowSpeed)),
         .init(Float(width),Float(height),0,0), colorTl.vector,colorTr.vector,colorBl.vector,colorBr.vector,
         .init(Float(warp),Float(softness),0,0), .init(visible ? 1 : 0,1,0,0)]
    }
}

public struct WorldbendMaterialKernel: Codable, Equatable, Sendable {
    public let id, sha256, source: String
    public let uniformBytes: Int
}

/// Fingerprints order trusted core receipts; the kernel is additionally checked
/// against this package's immutable source pin before any Metal compilation.
public struct WorldbendMaterialDelivery<Material: WorldbendProceduralMaterial>: Codable, Equatable, Sendable {
    public let schema, version, fingerprint, recipeId, recipeFingerprint, target: String
    public let recipeVersion: Int
    public let material: Material
    public let kernel: WorldbendMaterialKernel
    var expectedKernelID: String { Material.family == "mesh-gradient" ? "worldbend.mesh-gradient.rgba@0.2" : "worldbend.\(Material.family).rgba@0.1" }
    var isMeshV1: Bool { Material.family == "mesh-gradient" && kernel.id == "worldbend.mesh-gradient.rgba@0.1" }
    var kernelSourcePin: String { isMeshV1 ? WorldbendMaterialKernels.meshGradientV1SourceSHA256 : Material.sourceSHA256 }
    var vertexFunction: String { isMeshV1 ? WorldbendMaterialKernels.meshGradientV1Vertex : Material.vertexFunction }
    var fragmentFunction: String { isMeshV1 ? WorldbendMaterialKernels.meshGradientV1Fragment : Material.fragmentFunction }
    public func validate() throws {
        let controls = recipeId.unicodeScalars.contains { $0.value < 32 || (127...159).contains($0.value) }
        guard schema == "worldbend.\(Material.family)-delivery@0.1", version == "0.1", target == "swiftui",
              validFingerprint(fingerprint), validFingerprint(recipeFingerprint),
              recipeVersion > 0, recipeVersion <= Int(UInt32.max), !recipeId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              recipeId.unicodeScalars.count <= 64, !controls,
              kernel.id == expectedKernelID || isMeshV1, kernel.uniformBytes == Material.uniformBytes,
              kernel.sha256 == kernelSourcePin, kernel.source.utf8.count <= 32768,
              "sha256:" + SHA256.hash(data: Data(kernel.source.utf8)).map({ String(format:"%02x",$0) }).joined() == kernel.sha256
        else { throw AppearanceError.invalidReceipt }
        try material.validate()
    }
}

public struct WorldbendMaterialUpdate<Material: WorldbendProceduralMaterial>: Codable, Equatable, Sendable {
    public let schema, version, previousFingerprint, sourceFingerprint: String
    public let previousDeliveryFingerprint: String?
    public let delivery: WorldbendMaterialDelivery<Material>?
    public let preserved: [String]
    enum CodingKeys: String, CodingKey {
        case schema,version,previousFingerprint,sourceFingerprint,previousDeliveryFingerprint,delivery,preserved
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard c.contains(.delivery), c.contains(.previousDeliveryFingerprint) else { throw AppearanceError.invalidReceipt }
        schema = try c.decode(String.self,forKey:.schema); version = try c.decode(String.self,forKey:.version)
        previousFingerprint = try c.decode(String.self,forKey:.previousFingerprint)
        sourceFingerprint = try c.decode(String.self,forKey:.sourceFingerprint)
        previousDeliveryFingerprint = try c.decodeIfPresent(String.self,forKey:.previousDeliveryFingerprint)
        delivery = try c.decodeIfPresent(WorldbendMaterialDelivery<Material>.self,forKey:.delivery)
        preserved = try c.decode([String].self,forKey:.preserved)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy:CodingKeys.self)
        try c.encode(schema,forKey:.schema); try c.encode(version,forKey:.version)
        try c.encode(previousFingerprint,forKey:.previousFingerprint); try c.encode(sourceFingerprint,forKey:.sourceFingerprint)
        try c.encode(previousDeliveryFingerprint,forKey:.previousDeliveryFingerprint)
        try c.encode(delivery,forKey:.delivery); try c.encode(preserved,forKey:.preserved)
    }
}

public typealias WorldbendFoilDelivery = WorldbendMaterialDelivery<WorldbendFoilMaterial>
public typealias WorldbendMeshGradientDelivery = WorldbendMaterialDelivery<WorldbendMeshGradientMaterial>
public typealias WorldbendFoilSession = WorldbendMaterialSession<WorldbendFoilMaterial>
public typealias WorldbendMeshGradientSession = WorldbendMaterialSession<WorldbendMeshGradientMaterial>

@MainActor @Observable
public final class WorldbendMaterialSession<Material: WorldbendProceduralMaterial> {
    public private(set) var source: WorldbendMaterialDelivery<Material>
    public private(set) var delivery: WorldbendMaterialDelivery<Material>?
    public private(set) var previewMaterial: Material?
    public private(set) var preserved: [String] = []
    public var displayedMaterial: Material? { delivery == nil ? nil : previewMaterial ?? delivery?.material }
    public init(_ initial: WorldbendMaterialDelivery<Material>) throws {
        try initial.validate(); source = initial; delivery = initial
    }
    public func preview(_ material: Material) throws {
        guard delivery != nil else { throw AppearanceError.removed }
        try material.validate(); previewMaterial = material
    }
    public func cancelPreview() { previewMaterial = nil }
    public func updateLocal(_ local: WorldbendMaterialDelivery<Material>) throws {
        try local.validate()
        guard let current = delivery else { throw AppearanceError.removed }
        guard local.recipeId == source.recipeId, local.recipeVersion == current.recipeVersion,
              local.recipeFingerprint == current.recipeFingerprint, local.kernel.id == current.kernel.id else { throw AppearanceError.staleUpdate }
        delivery = local; previewMaterial = nil
    }
    public func update(_ plan: WorldbendMaterialUpdate<Material>, source next: WorldbendMaterialDelivery<Material>) throws {
        try next.validate()
        guard previewMaterial == nil, plan.schema == "worldbend.\(Material.family)-update@0.1", plan.version == "0.1",
              plan.previousFingerprint == source.fingerprint, plan.previousDeliveryFingerprint == delivery?.fingerprint,
              plan.sourceFingerprint == next.fingerprint else { throw AppearanceError.staleUpdate }
        guard next.recipeId == source.recipeId, next.recipeVersion >= source.recipeVersion,
              next.recipeVersion != source.recipeVersion || next.recipeFingerprint == source.recipeFingerprint,
              Set(plan.preserved).count == plan.preserved.count, Set(plan.preserved).isSubset(of: Material.fieldIds)
        else { throw AppearanceError.invalidReceipt }
        if let local = plan.delivery {
            try local.validate()
            guard delivery != nil else { throw AppearanceError.removed }
            guard local.recipeId == next.recipeId, local.recipeVersion == next.recipeVersion,
                  local.recipeFingerprint == next.recipeFingerprint, local.kernel.id == next.kernel.id else { throw AppearanceError.invalidReceipt }
        }
        source = next; delivery = plan.delivery; preserved = plan.preserved
    }
    public func remove() { delivery = nil; previewMaterial = nil }
    /// An explicit reattachment, separate from an ordinary source revision.
    public func reattach(_ next: WorldbendMaterialDelivery<Material>) throws {
        try next.validate(); source = next; delivery = next; previewMaterial = nil; preserved = []
    }
}

/// One surface's clock. Host pause, visibility and reduced motion never alter
/// authored material and resume without adding the suspended interval.
@MainActor @Observable
public final class WorldbendMaterialClock {
    public private(set) var paused = false
    public private(set) var visible = false
    public private(set) var reducedMotion = false
    public private(set) var runtimeMotionAllowed = true
    private var elapsed = 0.0
    private var started: Date?
    public var running: Bool { !paused && visible && !reducedMotion && runtimeMotionAllowed }
    public init() {}
    public func milliseconds(at date: Date = .now) -> Double {
        elapsed + (started.map { max(0,date.timeIntervalSince($0) * 1000) } ?? 0)
    }
    private func change(at date: Date, _ change: () -> Void) {
        elapsed = milliseconds(at:date); started = nil; change(); if running { started = date }
    }
    public func setPaused(_ value: Bool, at date: Date = .now) { change(at:date) { paused = value } }
    public func setVisible(_ value: Bool, at date: Date = .now) { change(at:date) { visible = value } }
    public func setReducedMotion(_ value: Bool, at date: Date = .now) { change(at:date) { reducedMotion = value } }
    public func setRuntimeMotionAllowed(_ value: Bool, at date: Date = .now) { change(at:date) { runtimeMotionAllowed = value } }
    public func seek(milliseconds value: Double, at date: Date = .now) throws {
        guard value.isFinite, value >= 0, value <= Double(Float.greatestFiniteMagnitude) * 1000 else { throw AppearanceError.invalidReceipt }
        elapsed = value; started = running ? date : nil
    }
}
