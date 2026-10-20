import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

/// Immutable after CPU drawing completes. Publication retains this buffer;
/// receivers must not mutate borrowed frame carriers.
struct RasterWorkDecodedFrame: @unchecked Sendable {
  let index: Int
  let pixelBuffer: CVPixelBuffer
}

enum RasterWorkDecoder {
  static func decode(_ package: WorldbendRasterWorkPackage, index: Int) throws
    -> RasterWorkDecodedFrame
  {
    let bytes = try package.frameBytes(index)
    try Task.checkCancellation()
    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
      CGImageSourceGetType(source) as String? == "public.png",
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width == package.manifest.receipt.canvas.width,
      height == package.manifest.receipt.canvas.height
    else { throw WorldbendRasterWorkError.invalidPackage("PNG dimensions disagree with receipt") }
    guard
      let image = CGImageSourceCreateImageAtIndex(
        source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    else {
      throw WorldbendRasterWorkError.invalidPackage("PNG decoding failed")
    }
    var value: CVPixelBuffer?
    let attributes =
      [kCVPixelBufferMetalCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:]]
      as CFDictionary
    guard
      CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes, &value)
        == kCVReturnSuccess, let buffer = value
    else {
      throw WorldbendRasterWorkError.invalidPackage("pixel-buffer allocation failed")
    }
    guard CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess else {
      throw WorldbendRasterWorkError.invalidPackage("pixel-buffer lock failed")
    }
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let color = CGColorSpace(name: CGColorSpace.sRGB)!
    let bitmap =
      CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    guard
      let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: color, bitmapInfo: bitmap)
    else {
      throw WorldbendRasterWorkError.invalidPackage("BGRA context creation failed")
    }
    context.clear(CGRect(x: 0, y: 0, width: width, height: height))
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    try Task.checkCancellation()
    return RasterWorkDecodedFrame(index: index, pixelBuffer: buffer)
  }
}
