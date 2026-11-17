// Draws the 1024×1024 app icon: a script page with a magnifier.
// Usage: swift make_icon.swift out.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.dropFirst().first ?? "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Rounded-square background (macOS icon grid: ~824px body, centred).
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let bg = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
NSGradient(starting: NSColor(red: 0.18, green: 0.32, blue: 0.62, alpha: 1),
           ending: NSColor(red: 0.10, green: 0.16, blue: 0.33, alpha: 1))!.draw(in: bg, angle: -90)

// Page.
let page = NSRect(x: 260, y: 190, width: 440, height: 600)
NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow(); shadow.shadowBlurRadius = 30; shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35); shadow.set()
NSColor(white: 0.98, alpha: 1).setFill()
NSBezierPath(roundedRect: page, xRadius: 18, yRadius: 18).fill()
NSGraphicsContext.current?.restoreGraphicsState()

// Screenplay-shaped lines: heading, action, character, dialogue…
NSColor(white: 0.25, alpha: 1).setFill()
let lines: [(CGFloat, CGFloat, CGFloat)] = [
  (300, 720, 260), (300, 670, 360), (300, 640, 300),
  (440, 580, 110), (360, 550, 240), (360, 520, 200),
  (440, 460, 110), (360, 430, 260), (300, 370, 340), (300, 340, 220),
]
for (x, y, w) in lines { NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: 14), xRadius: 7, yRadius: 7).fill() }

// Magnifier.
let accent = NSColor(red: 1.0, green: 0.62, blue: 0.26, alpha: 1)
let lens = NSBezierPath(ovalIn: NSRect(x: 520, y: 250, width: 230, height: 230))
NSColor.white.withAlphaComponent(0.35).setFill(); lens.fill()
accent.setStroke(); lens.lineWidth = 40; lens.stroke()
let handle = NSBezierPath()
handle.move(to: NSPoint(x: 560, y: 285)); handle.line(to: NSPoint(x: 430, y: 155))
handle.lineWidth = 56; handle.lineCapStyle = .round; handle.stroke()

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
