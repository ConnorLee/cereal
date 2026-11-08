// Cereal for Mac: the Cereal server and interface in one app, with no Terminal and no Node install.
//
// The app starts the bundled Node runtime on Cereal's server, shows the interface in a native window, and
// lets you give Cereal a project by dragging its folder onto the window or the Dock icon, or by choosing it
// in a standard folder dialog. Because the server runs inside the app, macOS asks once whether Cereal may
// read a protected folder and remembers the answer. Closing the window keeps Cereal in the menu bar, so the
// morning briefing still goes out; Quit stops everything.
import AppKit
import WebKit
import ServiceManagement

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"

// ---------- the window's web view, which also accepts folders dropped on it ----------

final class DropWebView: WKWebView {
    var onFolders: (([URL]) -> Void)?
    var onDragState: ((Bool) -> Void)?

    private func folders(_ info: NSDraggingInfo) -> [URL] {
        let urls = info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        return urls.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if !folders(sender).isEmpty { onDragState?(true); return .copy }
        return super.draggingEntered(sender)
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        if !folders(sender).isEmpty { return .copy }
        return super.draggingUpdated(sender)
    }
    override func draggingExited(_ sender: NSDraggingInfo?) {
        onDragState?(false)
        super.draggingExited(sender)
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let dirs = folders(sender)
        guard !dirs.isEmpty else { return super.performDragOperation(sender) }
        onDragState?(false)
        onFolders?(dirs)
        return true
    }
}

// ---------- the app ----------

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: DropWebView!
    var statusItem: NSStatusItem!
    var server: Process?
    var port = 4320
    var dataDir: String?
    var ready = false
    var quitting = false
    var queuedFolders: [URL] = []
    var pendingHash: String?
    var portFixed = false
    var restarts = 0
    var serverStartedAt = Date()
    var lockFD: Int32 = -1
    var lockDir = ""
    var logPath = "~/Library/Logs/Cereal/server.log"
    var picking: NSOpenPanel?
    var briefingLine = "Morning briefing: checking…"
    weak var briefingItem: NSMenuItem?
    var briefingTimer: Timer?
    var base: String { "http://127.0.0.1:\(port)" }

    func applicationDidFinishLaunching(_ note: Notification) {
        parseArguments()
        guard claimSingleInstance() else { return }
        buildMainMenu()
        buildStatusItem()
        buildWindow()
        startServer()
    }

    // `--data-dir PATH` and `--port N` let a second copy run against separate data, e.g. for testing.
    func parseArguments() {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--data-dir"), i + 1 < args.count { dataDir = args[i + 1] }
        if let i = args.firstIndex(of: "--port"), i + 1 < args.count, let p = Int(args[i + 1]) { port = p; portFixed = true }
        else { port = Self.freePort(from: 4320) }
    }

    // One Cereal per data folder. A second copy (say, one opened from the disk image while another runs from
    // Applications) would write the same files, so it asks the running one to show its window, then quits.
    // It only sends a message: launching anything here could start a third copy.
    func claimSingleInstance() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let dir = dataDir.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) } ?? home.appendingPathComponent("Library/Application Support/Cereal")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fd = open(dir.appendingPathComponent("desktop.lock").path, O_RDWR | O_CREAT, 0o644)
        lockDir = dir.standardizedFileURL.path
        if fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 {
            lockFD = fd
            DistributedNotificationCenter.default().addObserver(forName: Self.showNote, object: lockDir, queue: .main) { [weak self] _ in self?.showWindow() }
            return true
        }
        if fd >= 0 { Darwin.close(fd) }
        DistributedNotificationCenter.default().postNotificationName(Self.showNote, object: lockDir, userInfo: nil, deliverImmediately: true)
        NSApp.terminate(nil)
        return false
    }

    static let showNote = Notification.Name("app.cereal.desktop.show")

    static func freePort(from start: Int) -> Int {
        for p in start..<(start + 40) {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            defer { Darwin.close(fd) }
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = in_port_t(UInt16(p).bigEndian)
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
            if ok == 0 { return p }
        }
        return start
    }

    // ---------- server ----------

    func startServer() {
        let res = Bundle.main.resourceURL!
        let node = res.appendingPathComponent("node/node")
        let app = res.appendingPathComponent("app")
        // A copy with its own data folder (--data-dir) keeps its log there too, apart from everyday Cereal's.
        let logDir = dataDir.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Cereal")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("server.log")
        logPath = (logURL.path as NSString).abbreviatingWithTildeInPath
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try? FileHandle(forWritingTo: logURL)

        let p = Process()
        p.executableURL = node
        p.arguments = [app.appendingPathComponent("server.mjs").path]
        p.currentDirectoryURL = app
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["CEREAL_APP_URL"] = base
        env["CEREAL_DESKTOP"] = appVersion
        if let dataDir { env["CEREAL_DATA_DIR"] = dataDir }
        p.environment = env
        p.standardOutput = log
        p.standardError = log
        // If the engine stops on its own, start it again (a few times, on a free port), keeping the page you were on.
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.ready = false
                if Date().timeIntervalSince(self.serverStartedAt) > 60 { self.restarts = 0 }
                NSLog("Cereal engine exited (%d); restarts so far: %d", proc.terminationStatus, self.restarts)
                if self.restarts < 3 {
                    self.restarts += 1
                    if let url = self.web.url, url.host == "127.0.0.1", let f = url.fragment, self.pendingHash == nil { self.pendingHash = "#" + f }
                    if !self.portFixed { self.port = Self.freePort(from: 4320) }
                    self.startServer()
                } else {
                    self.showProblem("Cereal’s engine stopped (exit \(proc.terminationStatus)). The log is in \(self.logPath).")
                }
            }
        }
        do { try p.run() } catch { showProblem("Cereal couldn’t start its engine: \(error.localizedDescription)"); return }
        server = p
        serverStartedAt = Date()
        waitForServer(attempt: 0)
    }

    func waitForServer(attempt: Int) {
        var req = URLRequest(url: URL(string: "\(base)/api/state")!)
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if (resp as? HTTPURLResponse)?.statusCode == 200 {
                    self.ready = true
                    self.web.load(URLRequest(url: URL(string: self.base + "/" + (self.pendingHash ?? ""))!))
                    self.pendingHash = nil
                    self.refreshBriefingLine()
                    if self.briefingTimer == nil {
                        self.briefingTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.refreshBriefingLine() }
                    }
                    let queued = self.queuedFolders
                    self.queuedFolders = []
                    if !queued.isEmpty { self.addFolders(queued) }
                } else if attempt < 60 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(attempt: attempt + 1) }
                } else {
                    self.showProblem("Cereal’s engine didn’t answer. The log is in \(self.logPath).")
                }
            }
        }.resume()
    }

    func showProblem(_ message: String) {
        let html = "<body style='font:17px -apple-system;padding:64px;color:#17161B;background:#FBFBFC'><p style='font-size:24px;font-weight:600'>cereal<span style='color:#6E5FE8'>.</span></p><p>\(message)</p><p><button onclick=\"window.webkit.messageHandlers.cereal.postMessage({type:'retry'})\" style='font:15px -apple-system;padding:8px 16px;border-radius:8px;border:1px solid #D9D8DE;background:#fff'>Try again</button></p></body>"
        web.loadHTMLString(html, baseURL: nil)
        showWindow()
    }

    // ---------- giving Cereal a project ----------

    func application(_ sender: NSApplication, open urls: [URL]) {
        let dirs = urls.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
        guard !dirs.isEmpty, window != nil else { return }
        showWindow()
        if ready { addFolders(dirs) } else { queuedFolders += dirs }
    }

    /// Each folder becomes a project named after it; Cereal then shows what it found and reads nothing until you approve.
    func addFolders(_ urls: [URL]) {
        guard let url = urls.first else { return }
        let rest = Array(urls.dropFirst())
        let name = url.lastPathComponent.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ").capitalized
        post("/api/projects", ["name": name, "path": url.path]) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let json):
                if let id = json["id"] as? String, rest.isEmpty { self.go("#/p/\(id)/sources") }
                if !rest.isEmpty { self.addFolders(rest) } else if json["id"] == nil { self.go("#/") }
            case .failure(let message):
                let alert = NSAlert()
                alert.messageText = "Cereal couldn’t add “\(url.lastPathComponent)”"
                alert.informativeText = message
                alert.runModal()
                if !rest.isEmpty { self.addFolders(rest) }
            }
        }
    }

    enum PostResult { case success([String: Any]), failure(String) }
    func post(_ path: String, _ body: [String: Any], done: @escaping (PostResult) -> Void) {
        var req = URLRequest(url: URL(string: base + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, resp, err in
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok ? .success(json) : .failure((json["error"] as? String) ?? err?.localizedDescription ?? "Something went wrong.")) }
        }.resume()
    }

    func go(_ hash: String) {
        showWindow()
        guard ready else { pendingHash = hash; return }
        web.evaluateJavaScript("location.hash = \(jsString(hash))")
    }

    func chooseFolders(multiple: Bool, then: @escaping ([URL]) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = multiple
        panel.prompt = "Give Cereal Access"
        panel.message = "Choose a project folder. Cereal shows you what it finds and reads nothing until you approve it."
        NSApp.activate(ignoringOtherApps: true)
        picking = panel
        panel.begin { [weak self] in self?.picking = nil; then($0 == .OK ? panel.urls : []) }
    }

    @objc func addProjectFromMenu() {
        chooseFolders(multiple: true) { [weak self] urls in if !urls.isEmpty { self?.application(NSApp, open: urls) } }
    }

    // The page asks for the native folder dialog through this bridge (window.cerealNative.pickFolder()).
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "retry", server?.isRunning != true {
            restarts = 0
            if !portFixed { port = Self.freePort(from: 4320) }
            web.loadHTMLString("<body style='background:#FBFBFC;font:15px -apple-system;color:#8B8993;display:grid;place-items:center;height:100vh;margin:0'>Waking Cereal up…</body>", baseURL: nil)
            return startServer()
        }
        guard body["type"] as? String == "pickFolder" else { return }
        if let open = picking { open.makeKeyAndOrderFront(nil); return }
        chooseFolders(multiple: false) { [weak self] urls in
            let result: [String: Any] = urls.first.map { ["path": $0.path] } ?? ["cancelled": true]
            let json = String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!
            self?.web.evaluateJavaScript("window.__cerealPicked && window.__cerealPicked(\(json))")
        }
    }

    // ---------- window ----------

    func buildWindow() {
        let config = WKWebViewConfiguration()
        let bridge = """
        window.cerealNative = {
          version: \(jsString(appVersion)),
          pickFolder() { if (window.__cerealPicked) window.__cerealPicked({ cancelled: true }); return new Promise((resolve) => { window.__cerealPicked = (r) => { window.__cerealPicked = null; resolve(r); }; window.webkit.messageHandlers.cereal.postMessage({ type: 'pickFolder' }); }); }
        };
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "cereal")
        web = DropWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.onFolders = { [weak self] urls in self?.application(NSApp, open: urls) }
        web.onDragState = { [weak self] on in self?.web.evaluateJavaScript("document.documentElement.classList.toggle('drop-ready', \(on))") }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Cereal"
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 720, height: 520)
        window.backgroundColor = NSColor(red: 0.984, green: 0.984, blue: 0.988, alpha: 1)
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("CerealMain")
        if !window.setFrameUsingName("CerealMain") { window.center() }
        web.loadHTMLString("<body style='background:#FBFBFC;font:15px -apple-system;color:#8B8993;display:grid;place-items:center;height:100vh;margin:0'>Waking Cereal up…</body>", baseURL: nil)
        showWindow()
    }

    @objc func showWindow() {
        guard window != nil else { return }
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Closing the window keeps Cereal running in the menu bar, without a Dock icon, so the briefing still sends.
    func windowWillClose(_ notification: Notification) { NSApp.setActivationPolicy(.accessory) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }

    // Quit stops the engine; if it hasn't stopped after three seconds, it's stopped for good.
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        guard let server, server.isRunning else { return }
        server.terminate()
        let deadline = Date().addingTimeInterval(3)
        while server.isRunning && Date() < deadline { usleep(50_000) }
        if server.isRunning { kill(server.processIdentifier, SIGKILL) }
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(withTitle: "Add a Project Folder…", action: #selector(addProjectFromMenu), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Morning Briefing", action: #selector(openBriefing), keyEquivalent: "").target = self
        return menu
    }

    // Pages anywhere but Cereal itself (news, docs, mail) open in the default browser, never in Cereal's window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        if let url = action.request.url, let scheme = url.scheme, ["http", "https", "mailto"].contains(scheme), !["127.0.0.1", "localhost"].contains(url.host ?? ""), mainFrame || action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
    // If the page's process dies (memory pressure, a WebKit crash), bring it back instead of leaving a blank window.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if ready { web.load(URLRequest(url: URL(string: base + "/" + (web.url?.fragment.map { "#" + $0 } ?? ""))!)) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // ---------- menus ----------

    func buildMainMenu() {
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) { let m = NSMenu(title: title); items.forEach(m.addItem); let i = NSMenuItem(); i.submenu = m; main.addItem(i) }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
        }
        submenu("Cereal", [
            item("About Cereal", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Add a Project Folder…", #selector(addProjectFromMenu), "o"),
            item("Morning Briefing", #selector(openBriefing), ","),
            .separator(),
            item("Hide Cereal", #selector(NSApplication.hide(_:)), "h"),
            item("Quit Cereal", #selector(NSApplication.terminate(_:)), "q"),
        ])
        submenu("Edit", [
            item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        submenu("View", [item("Reload", #selector(reload), "r"), item("Home", #selector(goHome), "1")])
        submenu("Window", [item("Cereal", #selector(showWindow), "0"), .separator(), item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Close", #selector(NSWindow.performClose(_:)), "w")])
        NSApp.mainMenu = main
    }

    func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let img = NSImage(systemSymbolName: "sun.horizon", accessibilityDescription: "Cereal") { img.isTemplate = true; statusItem.button?.image = img }
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        func add(_ title: String, _ action: Selector?) -> NSMenuItem { let i = menu.addItem(withTitle: title, action: action, keyEquivalent: ""); i.target = self; return i }
        _ = add("Open Cereal", #selector(showWindow))
        _ = add("Add a Project Folder…", #selector(addProjectFromMenu))
        menu.addItem(.separator())
        let info = menu.addItem(withTitle: briefingLine, action: nil, keyEquivalent: "")
        info.isEnabled = false
        briefingItem = info
        _ = add("Morning Briefing Settings…", #selector(openBriefing))
        let login = add("Open at Login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Quit Cereal", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        refreshBriefingLine()
    }

    // The menu shows when the next briefing goes out, read from Cereal's own settings.
    func refreshBriefingLine() {
        guard ready, let url = URL(string: "\(base)/api/briefing") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let s = j["settings"] as? [String: Any] else { return }
            var line = "Morning briefing: off"
            if s["unsubscribed"] as? Bool == true { line = "Morning briefing: unsubscribed" }
            else if s["enabled"] as? Bool == true {
                if s["paused"] as? Bool == true { line = "Morning briefing: paused" }
                else if let next = j["next"] as? String, let date = ISO8601DateFormatter.withFractions.date(from: next) ?? ISO8601DateFormatter().date(from: next) {
                    let f = DateFormatter(); f.dateFormat = "EEE h:mm a"; line = "Next briefing: \(f.string(from: date))"
                }
            }
            DispatchQueue.main.async { self.briefingLine = line; self.briefingItem?.title = line }
        }.resume()
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert(); alert.messageText = "Couldn’t change Open at Login"; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }
    @objc func openBriefing() { go("#/briefing") }
    @objc func goHome() { go("#/") }
    @objc func reload() { if ready { web.load(URLRequest(url: URL(string: base)!)) } }

    func jsString(_ s: String) -> String { String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast().description }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}

// A plain kill (SIGTERM) quits like ⌘Q, so the server stops with the app.
signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSource.setEventHandler { NSApp.terminate(nil) }
termSource.resume()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
