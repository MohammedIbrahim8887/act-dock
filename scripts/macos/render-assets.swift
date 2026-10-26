import AppKit
import Foundation

// Code-native Finder artwork. Every measurement is in logical points; export at 1x/2x.
func argument(_ name: String) throws -> String {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else {
        throw NSError(domain: "ActDockAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing \(name)"])
    }
    return CommandLine.arguments[index + 1]
}
let output = try argument("--output")
let markPath = try argument("--mark")
let iconPath = try argument("--app-icon")
let version = try argument("--version")
let channel = try argument("--channel")
let layoutData = try Data(contentsOf: URL(fileURLWithPath: argument("--layout")))
let layout = try JSONSerialization.jsonObject(with: layoutData) as! [String: Any]
let width = (layout["width"] as! NSNumber).doubleValue
let height = (layout["height"] as! NSNumber).doubleValue
let heroHeight = (layout["heroHeight"] as! NSNumber).doubleValue
let footerTop = (layout["footerTop"] as! NSNumber).doubleValue
let iconSize = (layout["iconSize"] as! NSNumber).doubleValue
let appPosition = (layout["appPosition"] as! [NSNumber]).map { $0.doubleValue }
let applicationsPosition = (layout["applicationsPosition"] as! [NSNumber]).map { $0.doubleValue }
guard let mark = NSImage(contentsOfFile: markPath), let appIcon = NSImage(contentsOfFile: iconPath) else {
    fatalError("Missing approved brand artwork")
}
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
func gray(_ value: Double) -> NSColor { NSColor(srgbRed: value, green: value, blue: value, alpha: 1) }
func rectangle(_ x: Double, _ y: Double, _ w: Double, _ h: Double, canvasHeight: Double = height) -> NSRect {
    NSRect(x: x, y: canvasHeight - y - h, width: w, height: h)
}
func text(_ string: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
          size: Double, weight: NSFont.Weight = .regular, color: NSColor = gray(0.13),
          alignment: NSTextAlignment = .left, canvasHeight: Double = height) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color, .paragraphStyle: paragraph,
        .kern: size >= 30 ? -0.8 : 0
    ]
    (string as NSString).draw(in: rectangle(x,y,w,h,canvasHeight:canvasHeight), withAttributes: attributes)
}
func tinted(_ image: NSImage, _ color: NSColor) -> NSImage {
    let copy = NSImage(size: image.size)
    copy.lockFocus()
    image.draw(in: NSRect(origin: .zero, size: image.size))
    color.setFill()
    NSRect(origin: .zero, size: image.size).fill(using: .sourceAtop)
    copy.unlockFocus()
    return copy
}
let lightMark = tinted(mark, gray(0.94))
func render(_ name: String, w: Double, h: Double, scale: Int, _ draw: () -> Void) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil, pixelsWide:Int(w)*scale, pixelsHigh:Int(h)*scale,
        bitsPerSample:8, samplesPerPixel:4, hasAlpha:true, isPlanar:false, colorSpaceName:.deviceRGB,
        bytesPerRow:0, bitsPerPixel:0), let context = NSGraphicsContext(bitmapImageRep:bitmap) else { fatalError("Cannot create renderer") }
    bitmap.size = NSSize(width:w,height:h)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x:CGFloat(scale), y:CGFloat(scale))
    draw()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using:.png,properties:[:]) else { fatalError("PNG export failed") }
    try png.write(to:URL(fileURLWithPath:output).appendingPathComponent(name))
}
func folder() {
    let H = 512.0
    gray(0.68).setFill()
    NSBezierPath(roundedRect:rectangle(55,120,185,106,canvasHeight:H),xRadius:22,yRadius:22).fill()
    NSBezierPath(roundedRect:rectangle(55,165,402,267,canvasHeight:H),xRadius:26,yRadius:26).fill()
    gray(0.82).setFill()
    NSBezierPath(roundedRect:rectangle(48,183,416,253,canvasHeight:H),xRadius:26,yRadius:26).fill()
    text("A",130,215,252,190,size:158,weight:.medium,color:gray(0.4),alignment:.center,canvasHeight:H)
}
try render("applications-folder.png",w:512,h:512,scale:2,folder)
let folderIcon = NSImage(contentsOfFile:output+"/applications-folder.png")!
func background() {
    gray(0.975).setFill(); rectangle(0,0,width,height).fill()
    gray(0.09).setFill(); rectangle(0,0,width,heroHeight).fill()
    lightMark.draw(in:rectangle(38,23,34,34))
    text("Act Dock",82,28,240,28,size:20,weight:.semibold,color:gray(0.95))
    text("Your pipelines.\nRight here.",44,80,490,112,size:42,weight:.semibold,color:gray(0.97))
    text("Run GitHub Actions on your machine.",46,199,450,24,size:14,color:gray(0.73))
    lightMark.draw(in:rectangle(590,38,182,182))
    // The connector is functional: it points from the draggable application to its destination.
    let y = appPosition[1]
    gray(0.68).setStroke()
    let line = NSBezierPath(); line.lineWidth=1.5
    line.move(to:NSPoint(x:354,y:height-y)); line.line(to:NSPoint(x:466,y:height-y)); line.stroke()
    let arrow=NSBezierPath(); arrow.lineWidth=1.5
    arrow.move(to:NSPoint(x:456,y:height-y+7)); arrow.line(to:NSPoint(x:466,y:height-y)); arrow.line(to:NSPoint(x:456,y:height-y-7)); arrow.stroke()
    text("DRAG TO INSTALL",320,y-30,180,20,size:10,weight:.medium,color:gray(0.42),alignment:.center)
    gray(0.86).setFill(); rectangle(44,footerTop,width-88,1).fill()
    text("Drag Act Dock to Applications.",44,footerTop+20,width-88,25,size:16,weight:.medium,alignment:.center)
    text("Then open it from Applications to get started.",44,footerTop+49,width-88,22,size:12,color:gray(0.43),alignment:.center)
    let suffix = channel == "stable" ? "" : " · Canary"
    text("macOS  ·  \(version)\(suffix)",44,footerTop+77,width-88,16,size:10,color:gray(0.46),alignment:.center)
}
try render("background.png",w:width,h:height,scale:1,background)
try render("background@2x.png",w:width,h:height,scale:2,background)
// A reproducible layout preview; Finder supplies the actual draggable icons and labels.
try render("installer-preview.png",w:width,h:height,scale:2) {
    background()
    appIcon.draw(in:rectangle(appPosition[0]-iconSize/2,appPosition[1]-iconSize/2,iconSize,iconSize))
    folderIcon.draw(in:rectangle(applicationsPosition[0]-iconSize/2,applicationsPosition[1]-iconSize/2,iconSize,iconSize))
    let appLabel = channel == "stable" ? "Act Dock" : "Act Dock Canary"
    text(appLabel,appPosition[0]-110,appPosition[1]+iconSize/2+7,220,24,size:13,alignment:.center)
    text("Applications",applicationsPosition[0]-110,applicationsPosition[1]+iconSize/2+7,220,24,size:13,alignment:.center)
}
// A real Finder alias, rather than a fake button or app that intercepts file drops.
let aliasPath=URL(fileURLWithPath:output).appendingPathComponent("Applications")
try? FileManager.default.removeItem(at:aliasPath)
let bookmark=try URL(fileURLWithPath:"/Applications",isDirectory:true).bookmarkData(options:.suitableForBookmarkFile,includingResourceValuesForKeys:nil,relativeTo:nil)
try URL.writeBookmarkData(bookmark,to:aliasPath)
print("Rendered macOS installer assets at \(output)")
