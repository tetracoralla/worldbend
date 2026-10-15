import Foundation
import Metal
import MetalKit
import simd

public enum WorldbendMaterialRenderError: Error, LocalizedError {
    case unavailable, invalidSize, compilation(String), submission(String)
    public var errorDescription: String? {
        switch self {
        case .unavailable: "Metal is unavailable."
        case .invalidSize: "Use finite material dimensions within the receiving pixel budget."
        case .compilation(let message): "Material compilation failed: \(message)"
        case .submission(let message): "Material rendering failed: \(message)"
        }
    }
}

/// An owned queue/pipeline over a caller-owned Metal device. Compile the pinned
/// delivered source once; live values are ordinary uniforms, never shader edits.
@MainActor
public final class WorldbendMaterialRenderer<Material: WorldbendProceduralMaterial> {
    public let device: any MTLDevice
    public let kernelID: String
    private let vertexFunction, fragmentFunction: String
    private let queue: any MTLCommandQueue
    private let library: any MTLLibrary
    private let vertices: any MTLBuffer
    private var pipelines: [MTLPixelFormat:any MTLRenderPipelineState] = [:]
    public init(_ delivery: WorldbendMaterialDelivery<Material>, device supplied: (any MTLDevice)? = nil) throws {
        try delivery.validate()
        kernelID = delivery.kernel.id; vertexFunction = delivery.vertexFunction; fragmentFunction = delivery.fragmentFunction
        guard let device = supplied ?? MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
            throw WorldbendMaterialRenderError.unavailable
        }
        self.device = device; self.queue = queue
        let options = MTLCompileOptions(); options.fastMathEnabled = false
        do { library = try device.makeLibrary(source:delivery.kernel.source,options:options) }
        catch { throw WorldbendMaterialRenderError.compilation(String(error.localizedDescription.prefix(512))) }
        let values: [SIMD4<Float>] = [.init(-1,-1,0,1),.init(1,-1,1,1),.init(-1,1,0,0),.init(1,1,1,0)]
        guard let buffer = values.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }) else {
            throw WorldbendMaterialRenderError.unavailable
        }
        vertices = buffer
    }
    private func pipeline(format: MTLPixelFormat) throws -> any MTLRenderPipelineState {
        if let cached = pipelines[format] { return cached }
        guard let vertex = library.makeFunction(name:vertexFunction), let fragment = library.makeFunction(name:fragmentFunction) else {
            throw WorldbendMaterialRenderError.compilation("Missing material entry points.")
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex; descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = format
        descriptor.colorAttachments[0].isBlendingEnabled = false
        let layout = MTLVertexDescriptor()
        layout.attributes[0].format = .float2; layout.attributes[0].offset = 0; layout.attributes[0].bufferIndex = 0
        layout.attributes[1].format = .float2; layout.attributes[1].offset = 8; layout.attributes[1].bufferIndex = 0
        layout.layouts[0].stride = 16; descriptor.vertexDescriptor = layout
        do {
            let value = try device.makeRenderPipelineState(descriptor:descriptor); pipelines[format] = value; return value
        } catch { throw WorldbendMaterialRenderError.compilation(String(error.localizedDescription.prefix(512))) }
    }
    /// Premultiplied encoded-sRGB output. The host owns clipping/compositing.
    /// Register completion here before submission; the returned command is
    /// already committed and must not receive a new Metal completion handler.
    @discardableResult
    public func draw(_ material: Material, milliseconds: Double, into texture: any MTLTexture,
                     present drawable: (any MTLDrawable)? = nil,
                     completion: (@Sendable (any MTLCommandBuffer) -> Void)? = nil) throws -> any MTLCommandBuffer {
        try material.validate()
        guard milliseconds.isFinite, milliseconds >= 0, Float(milliseconds / 1000).isFinite,
              texture.device.registryID == device.registryID, texture.width > 0, texture.height > 0,
              texture.textureType == .type2D, texture.sampleCount == 1, texture.usage.contains(.renderTarget),
              texture.pixelFormat == .rgba8Unorm || texture.pixelFormat == .bgra8Unorm else {
            throw WorldbendMaterialRenderError.invalidSize
        }
        let state = try pipeline(format:texture.pixelFormat)
        guard let command = queue.makeCommandBuffer() else { throw WorldbendMaterialRenderError.unavailable }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture; pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store; pass.colorAttachments[0].clearColor = MTLClearColorMake(0,0,0,0)
        guard let encoder = command.makeRenderCommandEncoder(descriptor:pass) else { throw WorldbendMaterialRenderError.unavailable }
        encoder.setRenderPipelineState(state); encoder.setVertexBuffer(vertices,offset:0,index:0)
        let uniforms = material.uniforms(milliseconds:milliseconds,width:texture.width,height:texture.height)
        guard uniforms.count * MemoryLayout<SIMD4<Float>>.stride == Material.uniformBytes else {
            encoder.endEncoding(); throw AppearanceError.invalidReceipt
        }
        uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!,length:$0.count,index:0) }
        encoder.drawPrimitives(type:.triangleStrip,vertexStart:0,vertexCount:4); encoder.endEncoding()
        if let drawable { command.present(drawable) }
        if let completion { command.addCompletedHandler(completion) }
        command.commit(); return command
    }
    public func makeTexture(width: Int, height: Int, maxPixels: Int = 16_777_216) throws -> any MTLTexture {
        guard width > 0, height > 0, maxPixels > 0, width <= 16384, height <= 16384,
              width <= maxPixels / height else { throw WorldbendMaterialRenderError.invalidSize }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:width,height:height,mipmapped:false)
        descriptor.usage = [.renderTarget,.shaderRead]; descriptor.storageMode = .shared
        guard let texture = device.makeTexture(descriptor:descriptor) else { throw WorldbendMaterialRenderError.unavailable }
        return texture
    }
}
