// Draws the macOS app icon from the square cereal-box art, on Apple's icon grid: an 824 pt rounded
// square centred on a 1024 pt canvas, with a soft shadow, so it sits at the same size as other Dock icons.
// Usage: swift icon.swift <art.png> <out-1024.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let art = NSImage(contentsOfFile: args[1]) else { fatalError("usage: icon.swift <art.png> <out.png>") }
let canvas = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4,
                              hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: canvas)
NSGraphicsContext.current?.imageInterpolation = .high
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.shadowBlurRadius = 18
NSGraphicsContext.saveGraphicsState()
shadow.set()
NSColor(red: 0.98, green: 0.72, blue: 0.05, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()
shape.addClip()
// The art has its own slightly rounded corners; drawing it a little larger keeps them outside the clip.
art.draw(in: body.insetBy(dx: -24, dy: -24), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! canvas.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
