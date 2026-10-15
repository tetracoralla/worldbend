import CoreGraphics
import CoreVideo
import Foundation

public enum WorldbendBackdropError: Error, Equatable, Sendable {
    case invalidPixels, invalidRecipe
}

/// Measurements of an explicit, completed background, before foreground UI.
/// Linear-light luminance, not a guessed semantic color or an accessibility
/// contrast guarantee. Transparent/unavailable carriers return no measurement.
public struct WorldbendBackdropStatistics: Equatable, Sendable {
    public let meanLuminance: Double
    public let upperLuminance: Double
    public let variation: Double
    public let chroma: Double
    public let sampleCount: Int
    /// Mean linear-light sRGB after color-managed conversion from the frame tag.
    /// Extended values retain wide-gamut source energy; this is illumination,
    /// not a guessed object color or an accessibility contrast guarantee.
    public let meanLinearRGB: SIMD3<Double>?
    public init(meanLuminance: Double, upperLuminance: Double, variation: Double, chroma: Double,
                sampleCount: Int, meanLinearRGB: SIMD3<Double>? = nil) {
        self.meanLuminance = meanLuminance; self.upperLuminance = upperLuminance; self.variation = variation
        self.chroma = chroma; self.sampleCount = sampleCount; self.meanLinearRGB = meanLinearRGB
    }
}

/// Bounded thumbnail statistics shared by every pane. Reading a completed BGRA
/// buffer is a disclosed CPU measurement, not GPU-only/zero-readback analysis.
/// Coordinates are the frame's top-left logical content rect, including any
/// host-composited frost. Never feed the adapted controls back into this grid.
public struct WorldbendBackdropGrid: Sendable {
    public let contentRect: CGRect
    public let columns: Int
    public let rows: Int
    private let cells: [SIMD3<Double>] // luminance, chroma, coverage
    private let colors: [SIMD3<Double>] // linear frame-space RGB
    private let colorSpace: WorldbendColorSpaceTag
    private static let linear: [Double] = (0...255).map {
        let v = Double($0) / 255
        return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }

    public init(bgra: UnsafeRawBufferPointer, width: Int, height: Int, bytesPerRow: Int,
                contentRect: CGRect, colorSpace: WorldbendColorSpaceTag = .sRGB,
                columns: Int = 48, rows: Int = 96) throws {
        guard width > 0, height > 0, width <= 16384, height <= 16384,
              bytesPerRow >= width * 4, bytesPerRow <= 65536,
              bgra.count >= bytesPerRow * height,
              (1...96).contains(columns), (1...192).contains(rows),
              [contentRect.minX, contentRect.minY, contentRect.width, contentRect.height].allSatisfy(\.isFinite),
              contentRect.width > 0, contentRect.height > 0 else { throw WorldbendBackdropError.invalidPixels }
        self.colorSpace = colorSpace
        self.contentRect = contentRect; self.columns = min(columns, width); self.rows = min(rows, height)
        let weights = colorSpace == .displayP3 ? SIMD3(0.22897456, 0.69173852, 0.07928691) : SIMD3(0.2126, 0.7152, 0.0722)
        var values: [SIMD3<Double>] = []; values.reserveCapacity(self.columns * self.rows)
        var colorValues: [SIMD3<Double>] = []; colorValues.reserveCapacity(self.columns * self.rows)
        for y in 0..<self.rows {
            for x in 0..<self.columns {
                var sum = SIMD3<Double>.zero, rgb = SIMD3<Double>.zero
                // Four sub-cell samples resist thin-edge aliasing without
                // allocating another full-resolution image per control.
                for dy in [0.25, 0.75] { for dx in [0.25, 0.75] {
                    let px = min(width - 1, Int((Double(x) + dx) * Double(width) / Double(self.columns)))
                    let py = min(height - 1, Int((Double(y) + dy) * Double(height) / Double(self.rows)))
                    let offset = py * bytesPerRow + px * 4
                    guard bgra[offset + 3] >= 250 else { continue }
                    let r = Self.linear[Int(bgra[offset + 2])], g = Self.linear[Int(bgra[offset + 1])], b = Self.linear[Int(bgra[offset])]
                    rgb += SIMD3(r, g, b)
                    sum += SIMD3(r * weights.x + g * weights.y + b * weights.z, max(r, g, b) - min(r, g, b), 1)
                } }
                colorValues.append(sum.z > 0 ? rgb / sum.z : .zero)
                values.append(sum.z > 0 ? SIMD3(sum.x / sum.z, sum.y / sum.z, sum.z / 4) : .zero)
            }
        }
        cells = values; colors = colorValues
    }

    @MainActor public static func measure(_ frame: WorldbendCompletedFrame) throws -> Self? {
        guard frame.pixelFormat == .bgra8Unorm else { return nil }
        func read(_ bytes: UnsafeRawBufferPointer, _ stride: Int) throws -> Self {
            try Self(bgra: bytes, width: frame.pixelWidth, height: frame.pixelHeight, bytesPerRow: stride,
                     contentRect: frame.contentRect, colorSpace: frame.colorSpace)
        }
        if let buffer = frame.pixelBuffer {
            guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA,
                  CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
            defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
            guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
            return try read(UnsafeRawBufferPointer(start: base, count: CVPixelBufferGetDataSize(buffer)), CVPixelBufferGetBytesPerRow(buffer))
        }
        return try frame.withCPUBytesIfAvailable(read)
    }

    public func statistics(in rect: CGRect) -> WorldbendBackdropStatistics? {
        guard [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite),
              rect.width > 0, rect.height > 0 else { return nil }
        let roi = rect.intersection(contentRect)
        guard !roi.isNull, roi.width * roi.height >= rect.width * rect.height * 0.75 else { return nil }
        func index(_ value: CGFloat, origin: CGFloat, span: CGFloat, count: Int) -> Int {
            min(count - 1, max(0, Int(floor((value - origin) / span * CGFloat(count)))))
        }
        let x0 = index(roi.minX, origin: contentRect.minX, span: contentRect.width, count: columns)
        let x1 = index(roi.maxX.nextDown, origin: contentRect.minX, span: contentRect.width, count: columns)
        let y0 = index(roi.minY, origin: contentRect.minY, span: contentRect.height, count: rows)
        let y1 = index(roi.maxY.nextDown, origin: contentRect.minY, span: contentRect.height, count: rows)
        var samples: [Double] = [], chroma = 0.0, coverage = 0.0
        var rgb = SIMD3<Double>.zero
        for y in y0...y1 { for x in x0...x1 {
            let cell = cells[y * columns + x]; coverage += cell.z
            if cell.z >= 0.75 { samples.append(cell.x); chroma += cell.y; rgb += colors[y * columns + x] }
        } }
        let count = (x1 - x0 + 1) * (y1 - y0 + 1)
        guard !samples.isEmpty, coverage / Double(count) >= 0.75 else { return nil }
        samples.sort()
        let mean = samples.reduce(0, +) / Double(samples.count)
        let upper = samples[min(samples.count - 1, Int(Double(samples.count - 1) * 0.9))]
        let lower = samples[Int(Double(samples.count - 1) * 0.1)]
        rgb /= Double(samples.count)
        // Convert the region aggregate once, not every pixel. Both source
        // transfer functions were linearized before accumulation above.
        if colorSpace == .displayP3 {
            guard let source = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3),
                  let target = CGColorSpace(name: CGColorSpace.extendedLinearSRGB),
                  let color = CGColor(colorSpace: source, components: [CGFloat(rgb.x), CGFloat(rgb.y), CGFloat(rgb.z), 1]),
                  let converted = color.converted(to: target, intent: .relativeColorimetric, options: nil)?.components,
                  converted.count == 4 else { return nil }
            rgb = SIMD3(Double(converted[0]), Double(converted[1]), Double(converted[2]))
        }
        return .init(meanLuminance: mean, upperLuminance: upper, variation: upper - lower,
                     chroma: chroma / Double(samples.count), sampleCount: samples.count, meanLinearRGB: rgb)
    }
}

/// Runtime adaptation is separate from an authored optical receipt. These
/// controls remain adjustable instead of switching between OS material presets.
/// Figma's static material does not execute this temporal sampling profile.
public struct WorldbendGlassAdaptationRecipe: Codable, Equatable, Sendable {
    public var brightStart = 0.18
    public var brightEnd = 0.78
    public var maximumShade = 0.16
    public var maximumFrostAddition = 1.2
    public var maximumHighlightAddition = 0.07
    public var responseSeconds = 0.65
    public var deadband = 0.025
    public init() {}
    public func validate() throws {
        guard [brightStart, brightEnd, maximumShade, maximumFrostAddition, maximumHighlightAddition, responseSeconds, deadband].allSatisfy(\.isFinite),
              (0...1).contains(brightStart), (brightStart...1).contains(brightEnd), brightEnd > brightStart,
              (0...0.35).contains(maximumShade), (0...8).contains(maximumFrostAddition),
              (0...0.2).contains(maximumHighlightAddition), (0.1...4).contains(responseSeconds),
              (0...0.1).contains(deadband) else { throw WorldbendBackdropError.invalidRecipe }
    }
}

public struct WorldbendGlassAdaptation: Equatable, Sendable {
    public var shadeOpacity: Double = 0
    public var frostAddition: Double = 0
    public var highlightAddition: Double = 0
    public var environmentLinearRGB: SIMD3<Double>? = nil
    public init() {}
    public func applying(to base: OpticalGlassConfiguration) throws -> OpticalGlassConfiguration {
        try base.validate()
        guard [shadeOpacity, frostAddition, highlightAddition].allSatisfy(\.isFinite),
              (0...0.35).contains(shadeOpacity), (0...8).contains(frostAddition),
              (0...0.2).contains(highlightAddition) else { throw WorldbendBackdropError.invalidRecipe }
        return OpticalGlassConfiguration(profile: base.profile, backdrop: base.backdrop,
            edgeWidth: base.edgeWidth, refractionScale: base.refractionScale, chromaticOffset: base.chromaticOffset,
            frostRadius: min(1000, base.frostRadius + frostAddition), lightDirection: base.lightDirection,
            highlightStrength: min(0.6, base.highlightStrength + highlightAddition))
    }
}

/// Caller supplies monotonic elapsed seconds and owns state lifetime. Exponential
/// smoothing is cadence-independent; a deadband rejects small pixel flicker.
public struct WorldbendGlassAdaptationState: Sendable {
    public private(set) var value = WorldbendGlassAdaptation()
    private var initialized = false
    public init() {}
    public mutating func update(statistics: WorldbendBackdropStatistics?, elapsed: Double,
                                recipe: WorldbendGlassAdaptationRecipe) throws -> WorldbendGlassAdaptation {
        try recipe.validate()
        guard elapsed.isFinite, elapsed >= 0 else { throw WorldbendBackdropError.invalidRecipe }
        var target = WorldbendGlassAdaptation()
        if let stats = statistics {
            if let rgb = stats.meanLinearRGB {
                guard [rgb.x, rgb.y, rgb.z].allSatisfy({ $0.isFinite && (-1...2).contains($0) }) else { throw WorldbendBackdropError.invalidPixels }
                target.environmentLinearRGB = rgb
            }
            let brightness = max(0, min(1, (stats.upperLuminance - recipe.brightStart) / (recipe.brightEnd - recipe.brightStart)))
            target.shadeOpacity = recipe.maximumShade * brightness
            target.frostAddition = recipe.maximumFrostAddition * min(1, stats.variation / 0.65)
            // A clear edge on dark art; a less dazzling edge on white art.
            target.highlightAddition = recipe.maximumHighlightAddition * (1 - brightness)
        }
        let alpha = initialized ? 1 - exp(-min(2, elapsed) / recipe.responseSeconds) : 1
        func step(_ old: Double, _ next: Double, scale: Double) -> Double {
            abs(next - old) <= recipe.deadband * scale ? old : old + (next - old) * alpha
        }
        value.shadeOpacity = step(value.shadeOpacity, target.shadeOpacity, scale: recipe.maximumShade)
        value.frostAddition = step(value.frostAddition, target.frostAddition, scale: recipe.maximumFrostAddition)
        value.highlightAddition = step(value.highlightAddition, target.highlightAddition, scale: recipe.maximumHighlightAddition)
        if let rgb = target.environmentLinearRGB {
            let previous = value.environmentLinearRGB ?? rgb
            value.environmentLinearRGB = SIMD3(step(previous.x, rgb.x, scale: 1), step(previous.y, rgb.y, scale: 1), step(previous.z, rgb.z, scale: 1))
        } else { value.environmentLinearRGB = nil }
        initialized = true; return value
    }
}
