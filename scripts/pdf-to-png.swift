// Renders every page of a PDF to PNG files, for OMR engines that only read images (homr).
// Uses macOS's built-in PDFKit, so it needs nothing beyond the Swift toolchain.
//
// Usage: swift scripts/pdf-to-png.swift <input.pdf> <outDir> [dpi]
// Writes <outDir>/page-001.png, page-002.png, ... on white, honoring each page's /Rotate
// (phone scans saved from Preview are often stored sideways with a rotation flag).
// Prints "pages=N" first, then "page i/N" as each file is written.
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: pdf-to-png.swift <input.pdf> <outDir> [dpi]\n".data(using: .utf8)!)
    exit(2)
}
let inputURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let dpi = args.count > 3 ? (Double(args[3]) ?? 300) : 300
guard let doc = PDFDocument(url: inputURL) else {
    FileHandle.standardError.write("cannot open PDF\n".data(using: .utf8)!)
    exit(1)
}
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
print("pages=\(doc.pageCount)")
fflush(stdout)

// Caps the long side so a huge page size can't allocate an enormous bitmap.
let maxSide = 6000.0
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    // The media box is unrotated; swap sides for 90/270 so the output is upright.
    let box = page.bounds(for: .mediaBox)
    let rotated = page.rotation % 180 != 0
    let pts = rotated ? CGSize(width: box.height, height: box.width) : box.size
    let scale = min(dpi / 72.0, maxSide / max(pts.width, pts.height))
    let w = Int((pts.width * scale).rounded()), h = Int((pts.height * scale).rounded())
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.scaleBy(x: scale, y: scale)
    // draw(with:to:) applies the page's rotation and origin for us.
    page.draw(with: .mediaBox, to: ctx)
    guard let image = ctx.makeImage() else { exit(1) }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    let name = String(format: "page-%03d.png", i + 1)
    try png.write(to: outDir.appendingPathComponent(name))
    print("page \(i + 1)/\(doc.pageCount)")
    fflush(stdout)
}
