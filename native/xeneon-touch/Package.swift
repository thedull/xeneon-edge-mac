// swift-tools-version:5.9
// xeneon-touch — user-space touch driver for the Corsair Xeneon Edge on macOS.
// Built with the Command Line Tools toolchain (no full Xcode required):
//   swift build -c release
import PackageDescription

let package = Package(
  name: "xeneon-touch",
  platforms: [.macOS(.v11)],
  targets: [
    .executableTarget(
      name: "xeneon-touch",
      path: "Sources/xeneon-touch",
      linkerSettings: [
        .linkedFramework("IOKit"),
        .linkedFramework("CoreGraphics"),
        .linkedFramework("ApplicationServices"),
        .linkedFramework("CoreFoundation"),
      ]
    )
  ]
)
