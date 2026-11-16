import Cocoa
import FlutterMacOS
import UniformTypeIdentifiers

private class VibrancyContainerView: NSVisualEffectView {
  var onLayout: (() -> Void)?

  override func layout() {
    super.layout()
    onLayout?()
  }
}

class MainFlutterWindow: NSWindow {
  private let windowCornerRadius: CGFloat = 32.0
  private var windowChannel: FlutterMethodChannel?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    // Critical: FlutterView defaults to solid black unless explicitly cleared
    flutterViewController.backgroundColor = NSColor.clear

    var windowFrame = self.frame
    windowFrame.size = CGSize(width: 1020, height: 660)
    self.setFrame(windowFrame, display: true)
    self.minSize = CGSize(width: 880, height: 580)
    self.center()

    // Force Aqua light mode so frosted glass stays luminous white
    self.appearance = NSAppearance(named: .aqua)

    // Frameless transparent styling while keeping native resize and traffic lights
    self.titleVisibility = .hidden
    self.titlebarAppearsTransparent = true
    self.styleMask.insert([.fullSizeContentView])
    self.isOpaque = false
    self.backgroundColor = NSColor.clear
    self.hasShadow = true
    self.isMovableByWindowBackground = true

    // Native macOS frosted glass container set as window contentView
    let visualEffect = VibrancyContainerView()
    visualEffect.appearance = NSAppearance(named: .aqua)
    visualEffect.blendingMode = .behindWindow
    visualEffect.state = .active
    visualEffect.material = .popover
    visualEffect.maskImage = Self.makeRoundedMask(cornerRadius: windowCornerRadius)
    visualEffect.wantsLayer = true
    visualEffect.layer?.cornerRadius = windowCornerRadius
    visualEffect.layer?.masksToBounds = true
    visualEffect.onLayout = { [weak self] in
      self?.repositionTrafficLights()
    }

    let hostController = NSViewController()
    hostController.view = visualEffect
    hostController.addChild(flutterViewController)

    flutterViewController.view.frame = visualEffect.bounds
    flutterViewController.view.autoresizingMask = [.width, .height]
    flutterViewController.view.wantsLayer = true
    flutterViewController.view.layer?.backgroundColor = NSColor.clear.cgColor
    flutterViewController.view.layer?.cornerRadius = windowCornerRadius
    flutterViewController.view.layer?.masksToBounds = true
    flutterViewController.backgroundColor = NSColor.clear
    visualEffect.addSubview(flutterViewController.view)

    self.contentViewController = hostController

    RegisterGeneratedPlugins(registry: flutterViewController)
    setupWindowChannel(flutterViewController: flutterViewController)

    super.awakeFromNib()

    DispatchQueue.main.async { [weak self] in
      self?.repositionTrafficLights()
      self?.invalidateShadow()
    }
  }

  private func repositionTrafficLights() {
    guard let close = standardWindowButton(.closeButton),
          let min = standardWindowButton(.miniaturizeButton),
          let zoom = standardWindowButton(.zoomButton),
          let titlebarView = close.superview else { return }

    let targetY = max(2.0, (titlebarView.bounds.height - close.frame.height) / 2.0 - 2.0)
    let positions: [(NSButton, CGFloat)] = [(close, 18.0), (min, 38.0), (zoom, 58.0)]
    for (btn, targetX) in positions {
      if abs(btn.frame.origin.x - targetX) > 0.5 || abs(btn.frame.origin.y - targetY) > 0.5 {
        btn.setFrameOrigin(NSPoint(x: targetX, y: targetY))
      }
    }
  }

  private func setupWindowChannel(flutterViewController: FlutterViewController) {
    let channel = FlutterMethodChannel(
      name: "com.fastminecraft/window",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    )
    windowChannel = channel

    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(nil)
        return
      }
      switch call.method {
      case "startDragging":
        if let event = NSApp.currentEvent {
          self.performDrag(with: event)
        }
        result(nil)
      case "zoomWindow":
        self.zoom(nil)
        result(nil)
      case "pickFile":
        let args = call.arguments as? [String: Any]
        let extensions = args?["extensions"] as? [String] ?? []
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if !extensions.isEmpty {
          panel.allowedContentTypes = extensions.compactMap { UTType(filenameExtension: $0) }
        }
        panel.beginSheetModal(for: self) { response in
          if response == .OK, let url = panel.url {
            result(url.path)
          } else {
            result(nil)
          }
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private static func makeRoundedMask(cornerRadius: CGFloat) -> NSImage {
    let size = NSSize(width: cornerRadius * 2 + 4, height: cornerRadius * 2 + 4)
    let image = NSImage(size: size, flipped: false) { rect in
      let path = NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius)
      NSColor.black.setFill()
      path.fill()
      return true
    }
    image.capInsets = NSEdgeInsets(
      top: cornerRadius,
      left: cornerRadius,
      bottom: cornerRadius,
      right: cornerRadius
    )
    image.resizingMode = .stretch
    return image
  }
}
