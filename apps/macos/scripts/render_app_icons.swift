import AppKit
import Foundation
import QuickLookThumbnailing

enum RenderError: LocalizedError {
    case timedOut
    case missingThumbnail
    case invalidBitmap

    var errorDescription: String? {
        switch self {
        case .timedOut:
            return "Timed out while rendering the .icon asset."
        case .missingThumbnail:
            return "Quick Look did not return a thumbnail for the .icon asset."
        case .invalidBitmap:
            return "Failed to create PNG data for the rendered icon."
        }
    }
}

let scriptURL = URL(fileURLWithPath: #filePath)
let macOSRootURL = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let iconURL = macOSRootURL.appendingPathComponent("ImmoRadar/icon.icon", isDirectory: true)
let appIconSetURL = macOSRootURL.appendingPathComponent("ImmoRadar/Assets.xcassets/AppIcon.appiconset", isDirectory: true)

let outputSizes = [16, 32, 64, 128, 256, 512, 1024]

func renderIcon(at size: Int) throws -> NSImage {
    let request = QLThumbnailGenerator.Request(
        fileAt: iconURL,
        size: CGSize(width: size, height: size),
        scale: 1.0,
        representationTypes: .all
    )

    let semaphore = DispatchSemaphore(value: 0)
    var thumbnail: QLThumbnailRepresentation?
    var renderError: Error?

    QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, error in
        thumbnail = representation
        renderError = error
        semaphore.signal()
    }

    switch semaphore.wait(timeout: .now() + 20) {
    case .timedOut:
        throw RenderError.timedOut
    case .success:
        break
    }

    if let renderError {
        throw renderError
    }

    guard let thumbnail else {
        throw RenderError.missingThumbnail
    }

    return thumbnail.nsImage
}

func pngData(for image: NSImage, pixelSize: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw RenderError.invalidBitmap
    }

    bitmap.size = NSSize(width: pixelSize, height: pixelSize)

    NSGraphicsContext.saveGraphicsState()
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        NSGraphicsContext.restoreGraphicsState()
        throw RenderError.invalidBitmap
    }

    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    image.draw(
        in: NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize),
        from: .zero,
        operation: .copy,
        fraction: 1.0
    )
    NSGraphicsContext.restoreGraphicsState()

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw RenderError.invalidBitmap
    }

    return data
}

func writeAppIcon(named name: String, size: Int) throws {
    let image = try renderIcon(at: size)
    let data = try pngData(for: image, pixelSize: size)
    let destination = appIconSetURL.appendingPathComponent(name)
    try data.write(to: destination, options: .atomic)
    print("Updated \(destination.path)")
}

for size in outputSizes {
    try writeAppIcon(named: "AppIcon_\(size)x\(size).png", size: size)
}
