import CoreGraphics
import Foundation
import Metal
import simd

/// Where ``WorldbendOutlineFieldBaker`` builds the distance/normal field.
///
/// The r6 unchecked pointer kernel (``.cpu``) is the default and the semantic
/// authority. ``.gpu`` is an optional Metal compute path with the same grid,
/// scanline mask, spatial index, and refine budget. ``.automatic`` uses the
/// GPU only when this build's measured policy says it is beneficial.
public enum WorldbendOutlineFieldProcessor: String, Sendable, Equatable {
    case cpu
    case gpu
    case automatic
}

/// Test probe for the GPU wait. Production encode does not wait.
private final class GPUBakeCall: @unchecked Sendable {
    let contour: WorldbendOutlineContour
    let cellSize: CGFloat
    let refineBandCells: CGFloat
    let maxRefineQueries: Int
    let device: any MTLDevice
    let honorAutomaticThreshold: Bool
    var result: Result<
        (field: WorldbendOutlineNormalField, diagnostics: WorldbendOutlineFieldBaker.BakeDiagnostics),
        Error
    >?
    init(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int,
        device: any MTLDevice,
        honorAutomaticThreshold: Bool
    ) {
        self.contour = contour
        self.cellSize = cellSize
        self.refineBandCells = refineBandCells
        self.maxRefineQueries = maxRefineQueries
        self.device = device
        self.honorAutomaticThreshold = honorAutomaticThreshold
    }
}

private final class CommandBufferBox: @unchecked Sendable {
    let commandBuffer: any MTLCommandBuffer
    var error: Result<Void, Error>?
    init(_ commandBuffer: any MTLCommandBuffer) { self.commandBuffer = commandBuffer }
}

enum WorldbendOutlineFieldGPUProbe {
    nonisolated(unsafe) static var lastWaitOffMainThread = false
}

/// GPU outline field generation. Scanline stays on the CPU (`CGFloat`
/// crossings). Chamfer, normals, and exact-segment refine run as Metal
/// compute. The synchronous bake waits on `worldbend.outline-field-gpu`,
/// never on the main thread. ``encode`` does not wait.
public enum WorldbendOutlineFieldGPU {
    /// Measured on the r7 menu contour: the GPU field is bit-identical and
    /// optional, but it did not beat the r6 CPU kernel (Debug ~8 ms vs ~5 ms).
    /// Automatic therefore stays on the CPU. Callers select `.gpu` explicitly.
    public static var automaticPrefersGPU: Bool { false }

    /// Below this, launch + readback is not worth leaving the CPU kernel.
    public static let automaticMinimumTexels = 8_192

    private static let threadgroupWidth = 1024
    private static let encodeQueue: DispatchQueue = {
        let queue = DispatchQueue(label: "worldbend.outline-field-gpu")
        queue.setSpecific(key: queueToken, value: 1)
        return queue
    }()
    private static let queueToken = DispatchSpecificKey<UInt8>()
    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var caches: [ObjectIdentifier: DeviceCache] = [:]
    nonisolated(unsafe) static var lastShaderCompileMilliseconds: Double = 0

    static func bake(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int,
        device: any MTLDevice,
        honorAutomaticThreshold: Bool
    ) throws -> (field: WorldbendOutlineNormalField, diagnostics: WorldbendOutlineFieldBaker.BakeDiagnostics) {
        if DispatchQueue.getSpecific(key: queueToken) == 1 {
            return try bakeOnEncodeQueue(
                contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
                maxRefineQueries: maxRefineQueries, device: device,
                honorAutomaticThreshold: honorAutomaticThreshold
            )
        }
        // `DispatchQueue.sync` can run on the caller thread. `async` forces the
        // GPU wait onto the field queue so `waitUntilCompleted` is not on main.
        let job = GPUBakeCall(
            contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries, device: device,
            honorAutomaticThreshold: honorAutomaticThreshold
        )
        let semaphore = DispatchSemaphore(value: 0)
        encodeQueue.async {
            job.result = Result {
                try bakeOnEncodeQueue(
                    contour: job.contour, cellSize: job.cellSize,
                    refineBandCells: job.refineBandCells, maxRefineQueries: job.maxRefineQueries,
                    device: job.device, honorAutomaticThreshold: job.honorAutomaticThreshold
                )
            }
            semaphore.signal()
        }
        semaphore.wait()
        guard let result = job.result else { throw WorldbendOutlineError.bakeFailed }
        return try result.get()
    }

    /// Encode chamfer, normals, and refine into `commandBuffer`. Does not
    /// commit or wait. When the full-grid refine budget does not fit, chamfer
    /// runs to completion on the encode queue (off the main thread) so the
    /// exact band can be counted; refine is then encoded on `commandBuffer`
    /// only if the budget fits. Nothing is published on failure.
    public static func encode(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int,
        device: any MTLDevice,
        commandBuffer: any MTLCommandBuffer,
        packInto texture: (any MTLTexture)?,
        honorAutomaticThreshold: Bool = false
    ) throws -> Pending {
        if commandBuffer.device.registryID != device.registryID {
            throw WorldbendOutlineError.bakeFailed
        }
        let prep = try WorldbendOutlineFieldBaker.prepareOutlineFieldBake(
            contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries
        )
        if honorAutomaticThreshold, prep.width * prep.height < automaticMinimumTexels {
            throw WorldbendOutlineError.metalUnavailable
        }
        let cache = try deviceCache(device)
        let refined = prepareOutlineRefine(
            ring: prep.shifted, width: prep.width, height: prep.height,
            cell: prep.cell, refineBandCells: prep.bandCells
        )
        let resources = try GPUResources(device: device, prep: prep, refined: refined)
        let segmentCount = refined?.segments.count ?? 0
        let conservativeFits = segmentCount == 0 || WorldbendOutlineFieldBaker.checkedRefineQueryCount(
            bandTexels: prep.width * prep.height,
            segmentCount: segmentCount,
            limit: prep.queryLimit
        ) != nil

        var waited = false
        if conservativeFits {
            try encodeChamfer(resources, cache: cache, commandBuffer: commandBuffer)
        } else {
            // Separate queue so this blocking chamfer cannot reorder the
            // caller's still-open command buffer. The wait finishes before
            // normals/refine are encoded.
            guard let sideQueue = device.makeCommandQueue(),
                  let side = sideQueue.makeCommandBuffer()
            else { throw WorldbendOutlineError.metalUnavailable }
            side.label = "worldbend.outline-field-chamfer"
            try encodeChamfer(resources, cache: cache, commandBuffer: side)
            side.commit()
            try waitOffMain(side)
            waited = true
            let distances = resources.floatArray(resources.distances)
            let bandTexels = countRefineBandTexels(
                distances: distances, width: prep.width, height: prep.height, band: resources.params.band
            )
            try WorldbendOutlineFieldBaker.enforceRefinePreflight(
                bandTexels: bandTexels, segmentCount: segmentCount, limit: prep.queryLimit
            )
        }

        try encodeNormals(resources, cache: cache, commandBuffer: commandBuffer)
        if segmentCount > 0 {
            try encodeRefine(resources, cache: cache, commandBuffer: commandBuffer)
        }
        if let texture {
            guard texture.pixelFormat == .rgba16Float,
                  texture.width == prep.width, texture.height == prep.height,
                  texture.device.registryID == device.registryID
            else { throw WorldbendOutlineError.bakeFailed }
            try encodePack(resources, cache: cache, commandBuffer: commandBuffer, texture: texture)
        }
        return Pending(
            prep: prep, refined: refined, resources: resources,
            performedSynchronousGPUWait: waited
        )
    }

    static func waitUntilCompletedOffMain(_ commandBuffer: any MTLCommandBuffer) throws {
        try waitOffMain(commandBuffer)
    }

    // MARK: - Encode queue

    private static func bakeOnEncodeQueue(
        contour: WorldbendOutlineContour,
        cellSize: CGFloat,
        refineBandCells: CGFloat,
        maxRefineQueries: Int,
        device: any MTLDevice,
        honorAutomaticThreshold: Bool
    ) throws -> (field: WorldbendOutlineNormalField, diagnostics: WorldbendOutlineFieldBaker.BakeDiagnostics) {
        let cache = try deviceCache(device)
        guard let commandBuffer = cache.queue.makeCommandBuffer() else {
            throw WorldbendOutlineError.metalUnavailable
        }
        commandBuffer.label = "worldbend.outline-field-bake"
        let pending = try encode(
            contour: contour, cellSize: cellSize, refineBandCells: refineBandCells,
            maxRefineQueries: maxRefineQueries, device: device,
            commandBuffer: commandBuffer, packInto: nil,
            honorAutomaticThreshold: honorAutomaticThreshold
        )
        commandBuffer.commit()
        try waitOffMain(commandBuffer)
        return try pending.resolve(commandBuffer: commandBuffer)
    }

    private static func waitOffMain(_ commandBuffer: any MTLCommandBuffer) throws {
        if DispatchQueue.getSpecific(key: queueToken) == 1 {
            try finish(commandBuffer)
            return
        }
        let box = CommandBufferBox(commandBuffer)
        let semaphore = DispatchSemaphore(value: 0)
        encodeQueue.async {
            box.error = Result { try finish(box.commandBuffer) }
            semaphore.signal()
        }
        semaphore.wait()
        if case let .failure(error)? = box.error { throw error }
    }

    private static func finish(_ commandBuffer: any MTLCommandBuffer) throws {
        if Thread.isMainThread {
            fputs("GPU_FIELD_WAIT_ON_MAIN\n", stderr)
            throw WorldbendOutlineError.bakeFailed
        }
        WorldbendOutlineFieldGPUProbe.lastWaitOffMainThread = !Thread.isMainThread
        commandBuffer.waitUntilCompleted()
        guard commandBuffer.status == .completed else {
            fputs("GPU_FIELD_BUFFER \(commandBuffer.status.rawValue) \(String(describing: commandBuffer.error))\n", stderr)
            throw WorldbendOutlineError.bakeFailed
        }
    }

    // MARK: - Resolution

    public final class Pending {
        public let performedSynchronousGPUWait: Bool
        /// Texels whose closest point landed on the sample, so the even-odd
        /// normal was repaired on the CPU after the GPU write.
        public private(set) var repairedTexels = 0
        fileprivate let prep: OutlineFieldBakePrep
        fileprivate let refined: OutlineRefinePrepared?
        fileprivate let resources: GPUResources

        fileprivate init(
            prep: OutlineFieldBakePrep,
            refined: OutlineRefinePrepared?,
            resources: GPUResources,
            performedSynchronousGPUWait: Bool
        ) {
            self.prep = prep
            self.refined = refined
            self.resources = resources
            self.performedSynchronousGPUWait = performedSynchronousGPUWait
        }

        public func resolve(
            commandBuffer: any MTLCommandBuffer
        ) throws -> (field: WorldbendOutlineNormalField, diagnostics: WorldbendOutlineFieldBaker.BakeDiagnostics) {
            guard commandBuffer.status == .completed else {
                throw WorldbendOutlineError.bakeFailed
            }
            let count = prep.width * prep.height
            var distances = resources.floatArray(resources.distances)
            var normalsX = resources.floatArray(resources.normalsX)
            var normalsY = resources.floatArray(resources.normalsY)
            guard distances.count == count, normalsX.count == count, normalsY.count == count else {
                throw WorldbendOutlineError.bakeFailed
            }
            let flags = resources.degenerate
            let flagBytes = flags.contents().assumingMemoryBound(to: UInt8.self)
            if let refined {
                var repaired = 0
                var index = 0
                while index < count {
                    if flagBytes[index] != 0 {
                        repaired += 1
                        outlineRepairDegenerateTexel(
                            index: index, width: prep.width, cellF: refined.cellF,
                            ring: prep.shifted, inside: prep.inside,
                            segments: refined.segments, spatial: refined.spatial,
                            distances: &distances, normalsX: &normalsX, normalsY: &normalsY
                        )
                    }
                    index += 1
                }
                repairedTexels = repaired
            }
            let statsPtr = resources.stats.contents().assumingMemoryBound(to: UInt32.self)
            let segmentCount = max(prep.shifted.count - 1, 0)
            let queries = segmentCount == 0 ? 0 : Int(statsPtr[0])
            let refinedTexels = segmentCount == 0 ? 0 : Int(statsPtr[1])
            let field = WorldbendOutlineNormalField(
                profile: worldbendOutlineGlassMetalProfile,
                width: prep.width,
                height: prep.height,
                logicalSize: prep.contour.logicalSize,
                origin: prep.fieldOrigin,
                cellSize: prep.cell,
                fieldSpace: prep.contour.fieldSpace,
                dynamicsFingerprint: prep.contour.dynamics.fingerprint,
                sampleFingerprint: prep.contour.sampleFingerprint,
                distances: distances,
                normalsX: normalsX,
                normalsY: normalsY
            )
            try field.validate()
            // Keep shared buffers aligned with the repaired CPU field so a
            // follow-up pack matches `field` (degenerate even-odd is CPU-only).
            resources.store(distances, into: resources.distances)
            resources.store(normalsX, into: resources.normalsX)
            resources.store(normalsY, into: resources.normalsY)
            let diagnostics = WorldbendOutlineFieldBaker.BakeDiagnostics(
                width: prep.width,
                height: prep.height,
                cellSize: prep.cell,
                segmentCount: segmentCount,
                refinedTexels: refinedTexels,
                segmentDistanceQueries: queries,
                refineBandCells: prep.bandCells
            )
            return (field, diagnostics)
        }

        /// Pack the resolved float field into `texture`. Call after ``resolve``.
        /// Does not wait. Use this when a same-buffer pack ran before the
        /// degenerate CPU repair and `degenerate` texels were rewritten.
        public func encodeResolvedPack(
            into texture: any MTLTexture,
            commandBuffer: any MTLCommandBuffer
        ) throws {
            guard texture.pixelFormat == .rgba16Float,
                  texture.width == prep.width, texture.height == prep.height
            else { throw WorldbendOutlineError.bakeFailed }
            let cache = try WorldbendOutlineFieldGPU.deviceCache(texture.device)
            try WorldbendOutlineFieldGPU.encodePack(
                resources, cache: cache, commandBuffer: commandBuffer, texture: texture
            )
        }
    }

    // MARK: - GPU resources

    fileprivate struct OutlineFieldGPUParams {
        var width: UInt32
        var height: UInt32
        var cell: Float
        var scale: Float
        var far: Float
        var inf: Float
        var infHalf: Float
        var band: Float
        var gridCell: Float
        var originX: Float
        var originY: Float
        var cols: UInt32
        var rows: UInt32
        var segmentCount: UInt32
        var texelCount: UInt32
        var bestInit: Float
    }

    fileprivate final class GPUResources {
        let distances: any MTLBuffer
        let normalsX: any MTLBuffer
        let normalsY: any MTLBuffer
        let inside: any MTLBuffer
        let segments: any MTLBuffer
        let offsets: any MTLBuffer
        let items: any MTLBuffer
        let stats: any MTLBuffer
        let degenerate: any MTLBuffer
        let params: OutlineFieldGPUParams

        init(device: any MTLDevice, prep: OutlineFieldBakePrep, refined: OutlineRefinePrepared?) throws {
            let count = prep.width * prep.height
            guard count > 0, prep.width <= WorldbendOutlineFieldGPU.threadgroupWidth else {
                throw WorldbendOutlineError.bakeFailed
            }
            let inf: Float = 1.0e20
            let cellF = Float(prep.cell)
            let band = Float(prep.bandCells * prep.cell)
            var cols: UInt32 = 1
            var rows: UInt32 = 1
            var gridCell: Float = 8
            var originX: Float = 0
            var originY: Float = 0
            var segmentCount: UInt32 = 0
            if let refined {
                guard refined.segments.count <= Int(Int32.max),
                      refined.spatial.offsets.count <= Int(Int32.max),
                      refined.spatial.items.count <= Int(Int32.max),
                      refined.spatial.cols <= Int(Int32.max),
                      refined.spatial.rows <= Int(Int32.max)
                else { throw WorldbendOutlineError.bakeFailed }
                cols = UInt32(refined.spatial.cols)
                rows = UInt32(refined.spatial.rows)
                gridCell = refined.spatial.cell
                originX = refined.spatial.originX
                originY = refined.spatial.originY
                segmentCount = UInt32(refined.segments.count)
            }
            params = OutlineFieldGPUParams(
                width: UInt32(prep.width),
                height: UInt32(prep.height),
                cell: cellF,
                scale: cellF / 3,
                far: cellF * 1e3,
                inf: inf,
                infHalf: inf / 2,
                band: band,
                gridCell: gridCell,
                originX: originX,
                originY: originY,
                cols: cols,
                rows: rows,
                segmentCount: segmentCount,
                texelCount: UInt32(count),
                bestInit: Float.greatestFiniteMagnitude
            )
            let stride = MemoryLayout<OutlineFieldGPUParams>.stride
            guard stride == 64 else {
                fputs("GPU_FIELD_STRIDE \(stride)\n", stderr)
                throw WorldbendOutlineError.bakeFailed
            }
            guard let distances = device.makeBuffer(length: count * MemoryLayout<Float>.stride, options: .storageModeShared),
                  let normalsX = device.makeBuffer(length: count * MemoryLayout<Float>.stride, options: .storageModeShared),
                  let normalsY = device.makeBuffer(length: count * MemoryLayout<Float>.stride, options: .storageModeShared),
                  let inside = device.makeBuffer(length: count, options: .storageModeShared),
                  let stats = device.makeBuffer(length: MemoryLayout<UInt32>.stride * 4, options: .storageModeShared),
                  let degenerate = device.makeBuffer(length: count, options: .storageModeShared)
            else { throw WorldbendOutlineError.metalUnavailable }
            memset(stats.contents(), 0, stats.length)
            memset(degenerate.contents(), 0, degenerate.length)
            let mask = inside.contents().assumingMemoryBound(to: UInt8.self)
            for i in 0..<count { mask[i] = prep.inside[i] ? 1 : 0 }

            var packed = [Float]()
            var offset32 = [Int32]()
            var item32 = [Int32]()
            if let refined, !refined.segments.isEmpty {
                packed.reserveCapacity(refined.segments.count * 9)
                for segment in refined.segments {
                    packed.append(contentsOf: [
                        segment.ax, segment.ay, segment.abx, segment.aby, segment.ab2,
                        segment.minX, segment.minY, segment.maxX, segment.maxY
                    ])
                }
                offset32 = try refined.spatial.offsets.map { value in
                    guard let exact = Int32(exactly: value) else { throw WorldbendOutlineError.bakeFailed }
                    return exact
                }
                item32 = try refined.spatial.items.map { value in
                    guard let exact = Int32(exactly: value) else { throw WorldbendOutlineError.bakeFailed }
                    return exact
                }
            }
            if offset32.isEmpty { offset32 = [0, 0] }
            if item32.isEmpty { item32 = [0] }
            let segments = try Self.upload(device, packed.isEmpty ? [Float(0)] : packed)
            let offsets = try Self.upload(device, offset32)
            let items = try Self.upload(device, item32)
            self.distances = distances
            self.normalsX = normalsX
            self.normalsY = normalsY
            self.inside = inside
            self.segments = segments
            self.offsets = offsets
            self.items = items
            self.stats = stats
            self.degenerate = degenerate
        }

        private static func upload<T>(_ device: any MTLDevice, _ values: [T]) throws -> any MTLBuffer {
            let length = max(values.count, 1) * MemoryLayout<T>.stride
            guard let buffer = device.makeBuffer(length: length, options: .storageModeShared) else {
                throw WorldbendOutlineError.metalUnavailable
            }
            values.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                memcpy(buffer.contents(), base, raw.count)
            }
            return buffer
        }

        func store(_ values: [Float], into buffer: any MTLBuffer) {
            values.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                memcpy(buffer.contents(), base, min(raw.count, buffer.length))
            }
        }

        func floatArray(_ buffer: any MTLBuffer) -> [Float] {
            let count = buffer.length / MemoryLayout<Float>.stride
            let pointer = buffer.contents().bindMemory(to: Float.self, capacity: count)
            return Array(UnsafeBufferPointer(start: pointer, count: count))
        }
    }

    // MARK: - Pipelines

    private final class DeviceCache {
        let queue: any MTLCommandQueue
        let chamfer: any MTLComputePipelineState
        let normals: any MTLComputePipelineState
        let refine: any MTLComputePipelineState
        let pack: any MTLComputePipelineState

        init(device: any MTLDevice) throws {
            guard device.maxThreadsPerThreadgroup.width >= threadgroupWidth,
                  let queue = device.makeCommandQueue()
            else { throw WorldbendOutlineError.metalUnavailable }
            let source = try loadMetalSource()
            let options = MTLCompileOptions()
            options.fastMathEnabled = false
            if #available(macOS 15.0, iOS 18.0, *) {
                options.mathMode = .safe
            }
            options.languageVersion = .version3_1
            let started = ContinuousClock.now
            let library: any MTLLibrary
            do {
                library = try device.makeLibrary(source: source, options: options)
            } catch {
                fputs("GPU_FIELD_COMPILE \(error)\n", stderr)
                throw WorldbendOutlineError.metalUnavailable
            }
            let elapsed = ContinuousClock.now - started
            WorldbendOutlineFieldGPU.lastShaderCompileMilliseconds =
                Double(elapsed.components.seconds) * 1000
                + Double(elapsed.components.attoseconds) / 1e15
            func pipeline(_ name: String) throws -> any MTLComputePipelineState {
                guard let function = library.makeFunction(name: name) else {
                    throw WorldbendOutlineError.metalUnavailable
                }
                return try device.makeComputePipelineState(function: function)
            }
            chamfer = try pipeline("outline_field_chamfer")
            normals = try pipeline("outline_field_normals")
            refine = try pipeline("outline_field_refine")
            pack = try pipeline("outline_field_pack")
            self.queue = queue
        }
    }

    private static func deviceCache(_ device: any MTLDevice) throws -> DeviceCache {
        let key = ObjectIdentifier(device as AnyObject)
        cacheLock.lock()
        if let cached = caches[key] {
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()
        let built = try DeviceCache(device: device)
        cacheLock.lock()
        if let cached = caches[key] {
            cacheLock.unlock()
            return cached
        }
        caches[key] = built
        cacheLock.unlock()
        return built
    }

    private static func loadMetalSource() throws -> String {
        let bundle = Bundle.module
        let urls = (bundle.urls(forResourcesWithExtension: "metal", subdirectory: nil) ?? [])
            + (bundle.urls(forResourcesWithExtension: "metal", subdirectory: "Shaders") ?? [])
        guard let url = urls.first(where: { $0.lastPathComponent == "OutlineFieldCompute.metal" }) else {
            throw WorldbendOutlineError.metalUnavailable
        }
        return try String(contentsOf: url, encoding: .utf8)
    }

    private static func encodeChamfer(
        _ resources: GPUResources,
        cache: DeviceCache,
        commandBuffer: any MTLCommandBuffer
    ) throws {
        guard let encoder = commandBuffer.makeComputeCommandEncoder() else {
            throw WorldbendOutlineError.bakeFailed
        }
        encoder.label = "worldbend.outline-field-chamfer"
        encoder.setComputePipelineState(cache.chamfer)
        encoder.setBuffer(resources.inside, offset: 0, index: 0)
        encoder.setBuffer(resources.distances, offset: 0, index: 1)
        var params = resources.params
        encoder.setBytes(&params, length: MemoryLayout<OutlineFieldGPUParams>.stride, index: 2)
        encoder.dispatchThreadgroups(
            MTLSize(width: 1, height: 1, depth: 1),
            threadsPerThreadgroup: MTLSize(width: threadgroupWidth, height: 1, depth: 1)
        )
        encoder.endEncoding()
    }

    private static func encodeNormals(
        _ resources: GPUResources,
        cache: DeviceCache,
        commandBuffer: any MTLCommandBuffer
    ) throws {
        guard let encoder = commandBuffer.makeComputeCommandEncoder() else {
            throw WorldbendOutlineError.bakeFailed
        }
        encoder.label = "worldbend.outline-field-normals"
        encoder.setComputePipelineState(cache.normals)
        encoder.setBuffer(resources.distances, offset: 0, index: 0)
        encoder.setBuffer(resources.normalsX, offset: 0, index: 1)
        encoder.setBuffer(resources.normalsY, offset: 0, index: 2)
        var params = resources.params
        encoder.setBytes(&params, length: MemoryLayout<OutlineFieldGPUParams>.stride, index: 3)
        let width = max(Int(resources.params.width), 1)
        let height = max(Int(resources.params.height), 1)
        encoder.dispatchThreads(
            MTLSize(width: width, height: height, depth: 1),
            threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1)
        )
        encoder.endEncoding()
    }

    private static func encodeRefine(
        _ resources: GPUResources,
        cache: DeviceCache,
        commandBuffer: any MTLCommandBuffer
    ) throws {
        guard let encoder = commandBuffer.makeComputeCommandEncoder() else {
            throw WorldbendOutlineError.bakeFailed
        }
        encoder.label = "worldbend.outline-field-refine"
        encoder.setComputePipelineState(cache.refine)
        encoder.setBuffer(resources.inside, offset: 0, index: 0)
        encoder.setBuffer(resources.distances, offset: 0, index: 1)
        encoder.setBuffer(resources.normalsX, offset: 0, index: 2)
        encoder.setBuffer(resources.normalsY, offset: 0, index: 3)
        encoder.setBuffer(resources.segments, offset: 0, index: 4)
        encoder.setBuffer(resources.offsets, offset: 0, index: 5)
        encoder.setBuffer(resources.items, offset: 0, index: 6)
        var params = resources.params
        encoder.setBytes(&params, length: MemoryLayout<OutlineFieldGPUParams>.stride, index: 7)
        encoder.setBuffer(resources.stats, offset: 0, index: 8)
        encoder.setBuffer(resources.degenerate, offset: 0, index: 9)
        encoder.dispatchThreads(
            MTLSize(width: Int(resources.params.texelCount), height: 1, depth: 1),
            threadsPerThreadgroup: MTLSize(width: 64, height: 1, depth: 1)
        )
        encoder.endEncoding()
    }

    private static func encodePack(
        _ resources: GPUResources,
        cache: DeviceCache,
        commandBuffer: any MTLCommandBuffer,
        texture: any MTLTexture
    ) throws {
        guard let encoder = commandBuffer.makeComputeCommandEncoder() else {
            throw WorldbendOutlineError.bakeFailed
        }
        encoder.label = "worldbend.outline-field-pack"
        encoder.setComputePipelineState(cache.pack)
        encoder.setBuffer(resources.distances, offset: 0, index: 0)
        encoder.setBuffer(resources.normalsX, offset: 0, index: 1)
        encoder.setBuffer(resources.normalsY, offset: 0, index: 2)
        var params = resources.params
        encoder.setBytes(&params, length: MemoryLayout<OutlineFieldGPUParams>.stride, index: 3)
        encoder.setTexture(texture, index: 0)
        encoder.dispatchThreads(
            MTLSize(width: texture.width, height: texture.height, depth: 1),
            threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1)
        )
        encoder.endEncoding()
    }
}
