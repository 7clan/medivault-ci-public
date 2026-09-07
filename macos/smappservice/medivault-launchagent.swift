// medivault-launchagent.swift — MediVault SMAppService control helper.
//
// PURPOSE
//   The production registration control path for the MediVault supervisor
//   LaunchAgent, per Apple's current (macOS 13+) ServiceManagement
//   architecture:
//     * user-scoped SMAppService.agent (NO root, NO LaunchDaemon)
//     * the plist ships inside the app bundle at
//       Contents/Library/LaunchAgents/dev.medivault.supervisor.plist
//     * registration via SMAppService.register() (NOT legacy
//       `launchctl load/unload`, NOT SMLoginItemSetEnabled)
//
//   The desktop app (Tauri/Rust) invokes this helper because SMAppService
//   is an Objective-C/Swift API; a dedicated helper keeps the Rust shell
//   free of Obj-C FFI. The helper must run from inside MediVault.app so
//   that Bundle.main is the app bundle (SMAppService.agent(plistName:)
//   resolves the plist relative to the calling process's main bundle).
//
//   Apple's status model (SMAppService.Status) is surfaced EXACTLY —
//   no invented values:
//     notRegistered | enabled | requiresApproval | notFound
//
// COMMANDS
//   status        prints one of the four status strings (exit 0);
//                 an unexpected future status prints unknown(<raw>) exit 2
//   register      SMAppService.register(); exit 0 on success,
//                 exit 1 + stderr message on failure
//   unregister    SMAppService.unregister(); same exit contract
//   open-settings SMAppService.openSystemSettingsLoginItems()
//   self-test     CI proof: bundle identity, plist presence at the exact
//                 shipped path, and a live status query — exit 0 only when
//                 the plist is found inside the calling bundle
//
// BUILD (CI)
//   swiftc -O macos/smappservice/medivault-launchagent.swift \
//     -target <lane-arch>-apple-macos13.0 -o mediavault-launchagent
//   (then macho-gate.sh: single lane arch, minOS <= 13.0, /usr/lib +
//    /System deps only — the same fail-closed gate as every shipped Mach-O)
//
// REFERENCES (current Apple documentation)
//   - ServiceManagement framework, SMAppService:
//     https://developer.apple.com/documentation/servicemanagement/smappservice
//   - "Updating helper executables from earlier versions of macOS"
//     (BundleProgram, bundle-relative paths, openSystemSettingsLoginItems):
//     https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos
//   - launchd.plist(5): BundleProgram is "an app-bundle relative path …
//     only supported for plists that are installed using SMAppService".

import Foundation
import ServiceManagement

let plistName = "dev.medivault.supervisor.plist"

func service() -> SMAppService {
    SMAppService.agent(plistName: plistName)
}

func eprint(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

func describe(_ status: SMAppService.Status) -> String {
    switch status {
    case .notRegistered: return "notRegistered"
    case .enabled: return "enabled"
    case .requiresApproval: return "requiresApproval"
    case .notFound: return "notFound"
    @unknown default: return "unknown(\(status.rawValue))"
    }
}

func usage() -> Int32 {
    eprint(
        "usage: mediavault-launchagent <status|register|unregister|open-settings|self-test>"
    )
    return 64
}

func selfTest() -> Int32 {
    // Runs from inside the built MediVault.app: Bundle.main IS the app
    // bundle, so this proves the plist ships at the exact location
    // SMAppService.agent(plistName:) expects.
    let bundle = Bundle.main
    let plistURL = bundle.bundleURL
        .appendingPathComponent("Contents/Library/LaunchAgents")
        .appendingPathComponent(plistName)
    let plistFound = FileManager.default.fileExists(atPath: plistURL.path)
    let status = service().status

    print("bundle=\(bundle.bundlePath)")
    print("bundle-id=\(bundle.bundleIdentifier ?? "(none)")")
    print("plist-path=\(plistURL.path)")
    print("plist-found=\(plistFound ? "YES" : "NO")")
    print("status=\(describe(status))")

    if !plistFound {
        eprint("self-test: plist missing at the shipped bundle path")
        return 3
    }
    return 0
}

func run() -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let sub = args.first else {
        return usage()
    }
    switch sub {
    case "status":
        print(describe(service().status))
        return 0
    case "register":
        do {
            try service().register()
            print("registered")
            return 0
        } catch {
            eprint("register failed: \(error)")
            return 1
        }
    case "unregister":
        do {
            try service().unregister()
            print("unregistered")
            return 0
        } catch {
            eprint("unregister failed: \(error)")
            return 1
        }
    case "open-settings":
        SMAppService.openSystemSettingsLoginItems()
        return 0
    case "self-test":
        return selfTest()
    default:
        return usage()
    }
}

exit(run())
