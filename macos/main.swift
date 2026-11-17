// Librescript — macOS app shell.
// A native window + menu bar around the web editor (bundled in Resources/web),
// served through a custom URL scheme so ES modules and localStorage work.

import AppKit
import PDFKit
import UniformTypeIdentifiers
import WebKit

let fileExtension = "librescript"
let prefsKey = "AppearancePrefs"
let appearanceKey = "AppearanceMode"

// MARK: - Serve bundled web files at librescript://app/...

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        let mime: String
        switch file.pathExtension {
        case "html": mime = "text/html"
        case "js": mime = "text/javascript"
        case "css": mime = "text/css"
        case "svg": mime = "image/svg+xml"
        case "png": mime = "image/png"
        case "json": mime = "application/json"
        default: mime = "application/octet-stream"
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "\(mime); charset=utf-8",
                                                      "Content-Length": "\(data.count)"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - App

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var currentFile: URL? { didSet { updateTitle() } }
    var webReady = false
    var pendingOpen: URL?
    var closingAfterSave = false
    var afterPDF: (() -> Void)?
    var onHome = true
    var dirtyGen = 0          // bumped on every edit
    var savedGen = 0          // generation last written to disk
    var autosaveWork: DispatchWorkItem?
    var suggestedName: String?

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        ensureLibrary()

        let config = WKWebViewConfiguration()
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
        config.setURLSchemeHandler(BundleSchemeHandler(root: webRoot), forURLScheme: "librescript")
        config.userContentController.add(self, name: "librescript")
        // Appearance preferences are injected before the page loads, so the theme never flickers.
        let prefs = UserDefaults.standard.string(forKey: prefsKey) ?? "{}"
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__librescriptPrefs = \(prefs);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        applyAppearance(UserDefaults.standard.string(forKey: appearanceKey) ?? "auto")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.uiDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = webView
        window.delegate = self
        window.setFrameAutosaveName("LibrescriptMain")
        if window.frame.origin == .zero { window.center() }
        window.tabbingMode = .disallowed
        updateTitle()
        window.makeKeyAndOrderFront(nil)

        webView.load(URLRequest(url: URL(string: "librescript://app/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Double-click a .librescript file in Finder, or drop it on the Dock icon.
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first else { return }
        confirmDiscard { self.open(url) }
    }

    // MARK: JS → native

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "dirty":
            window.isDocumentEdited = true
            dirtyGen += 1
            scheduleAutosave()
        case "ready":
            webReady = true
            if let url = pendingOpen {
                pendingOpen = nil
                open(url)
            } else {
                showHome()
            }
            if let dir = ProcessInfo.processInfo.environment["LIBRESCRIPT_SELFTEST"] {
                runSelfTest(outputDir: URL(fileURLWithPath: dir))
            }
        case "export":
            guard let text = body["text"] as? String, let name = body["filename"] as? String else { return }
            askSaveURL(name) { url in
                do { try text.write(to: url, atomically: true, encoding: .utf8) }
                catch { self.showError("Impossible d'exporter « \(url.lastPathComponent) ».", error) }
            }
        case "createProject":
            let name = (body["name"] as? String) ?? ""
            let description = (body["description"] as? String) ?? ""
            confirmDiscard { self.createProject(name: name, description: description) }
        case "importPdf":
            importPDF(nil)
        case "openDialog":
            openDocument(nil)
        case "openProject":
            guard let path = body["path"] as? String else { return }
            let url = URL(fileURLWithPath: path)
            if FileManager.default.fileExists(atPath: path) { confirmDiscard { self.open(url) } }
            else { showError("« \(url.lastPathComponent) » est introuvable. Il a peut-être été déplacé ou supprimé.", nil) }
        case "deleteProject":
            if let path = body["path"] as? String { deleteProject(URL(fileURLWithPath: path)) }
        case "revealLibrary":
            revealLibrary(nil)
        case "removeRecent":
            if let path = body["path"] as? String { removeRecent(path); showHome() }
        case "revealProject":
            if let path = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
        case "closeProject":
            closeProject(nil)
        case "exportPDF":
            let kind = body["kind"] as? String ?? "script"
            askSaveURL(body["filename"] as? String ?? "Scénario.pdf") { url in self.writePDF(to: url, kind: kind, then: nil) }
        case "prefs":
            if let p = body["prefs"], let data = try? JSONSerialization.data(withJSONObject: p),
               let json = String(data: data, encoding: .utf8) {
                UserDefaults.standard.set(json, forKey: prefsKey)
            }
            let appearance = body["appearance"] as? String ?? "auto"
            UserDefaults.standard.set(appearance, forKey: appearanceKey)
            applyAppearance(appearance)
        default:
            break
        }
    }

    func js(_ code: String) {
        webView.evaluateJavaScript(code, completionHandler: nil)
    }

    // MARK: File commands

    // ⌘N: back to the home screen with the "Nouvelle histoire" dialog open.
    @objc func newDocument(_ sender: Any?) {
        confirmDiscard {
            self.showHome()
            self.js("librescript.createDialog()")
        }
    }

    func createProject(name: String, description: String) {
        webView.callAsyncJavaScript("librescript.newProject({ name, description })",
                                    arguments: ["name": name, "description": description], in: nil, in: .page) { _ in
            self.onHome = false
            self.currentFile = self.uniqueLibraryURL(for: name)
            self.markDirty()
            self.save(as: false, then: nil)
        }
    }

    func markDirty() {
        window.isDocumentEdited = true
        dirtyGen += 1
    }

    // MARK: PDF import

    @objc func importPDF(_ sender: Any?) {
        confirmDiscard {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.pdf]
            panel.allowsMultipleSelection = false
            panel.message = "Choisis un scénario au format PDF"
            panel.beginSheetModal(for: self.window) { response in
                guard response == .OK, let url = panel.url else { return }
                self.importPDF(url: url) { ok in
                    guard ok else { return }
                    self.currentFile = self.uniqueLibraryURL(for: url.deletingPathExtension().lastPathComponent)
                    self.markDirty()
                    self.save(as: false, then: nil)
                }
            }
        }
    }

    // Text lines with their position on the page; the screenplay structure is rebuilt in JS (importPdf.js).
    static func pdfLines(_ url: URL) -> [[String: Any]]? {
        guard let doc = PDFDocument(url: url) else { return nil }
        if doc.isLocked && !doc.unlock(withPassword: "") { return nil }
        return (0..<doc.pageCount).compactMap { i in
            guard let page = doc.page(at: i) else { return nil }
            let box = page.bounds(for: .mediaBox)
            let lines: [[String: Any]] = (page.selection(for: box)?.selectionsByLine() ?? []).compactMap { sel in
                guard let text = sel.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                let b = sel.bounds(for: page)
                return ["x": b.minX - box.minX, "y": box.maxY - b.maxY, "w": b.width, "h": b.height, "text": text]
            }
            return ["width": box.width, "height": box.height, "lines": lines]
        }
    }

    func importPDF(url: URL, done: @escaping (Bool) -> Void) {
        guard let pages = Self.pdfLines(url) else {
            showError("Impossible de lire « \(url.lastPathComponent) ».", nil)
            done(false); return
        }
        let name = url.deletingPathExtension().lastPathComponent
        webView.callAsyncJavaScript("return librescript.importPdf(pages, name)", arguments: ["pages": pages, "name": name],
                                    in: nil, in: .page) { result in
            if case .failure(let error) = result {
                let msg = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
                self.showError("Import de « \(url.lastPathComponent) » impossible.", NSError(domain: "Librescript", code: 1,
                               userInfo: [NSLocalizedDescriptionKey: msg.replacingOccurrences(of: "Error: ", with: "")]))
                done(false); return
            }
            self.onHome = false
            done(true)
        }
    }

    // MARK: Projects folder (Documents/Librescript), autosave, delete

    lazy var libraryURL: URL = {
        if let p = ProcessInfo.processInfo.environment["LIBRESCRIPT_LIBRARY"] { return URL(fileURLWithPath: p, isDirectory: true) }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("Librescript", isDirectory: true)
    }()

    func ensureLibrary() {
        try? FileManager.default.createDirectory(at: libraryURL, withIntermediateDirectories: true)
    }

    func isInLibrary(_ url: URL) -> Bool {
        url.deletingLastPathComponent().standardizedFileURL.path == libraryURL.standardizedFileURL.path
    }

    static func safeFileName(_ name: String) -> String {
        let cleaned = name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t")).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        return cleaned.isEmpty ? "Sans titre" : String(cleaned.prefix(120))
    }

    // "Nom.librescript", or "Nom 2.librescript"… if taken.
    func uniqueLibraryURL(for name: String, excluding: URL? = nil) -> URL {
        ensureLibrary()
        let base = Self.safeFileName(name)
        var n = 1
        while true {
            let candidate = libraryURL.appendingPathComponent(n == 1 ? "\(base).\(fileExtension)" : "\(base) \(n).\(fileExtension)")
            if candidate.standardizedFileURL == excluding?.standardizedFileURL || !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            n += 1
        }
    }

    // Save ~1 s after the last edit.
    func scheduleAutosave() {
        autosaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.autosaveNow() }
        autosaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }

    func autosaveNow() {
        guard !onHome, currentFile != nil, savedGen != dirtyGen else { return }
        save(as: false, then: nil)
    }

    @objc func revealLibrary(_ sender: Any?) {
        ensureLibrary()
        NSWorkspace.shared.activateFileViewerSelecting([libraryURL])
    }

    @objc func deleteCurrentProject(_ sender: Any?) {
        if let url = currentFile, !onHome { deleteProject(url) }
    }

    // Asks, then moves the file to the Trash (recoverable) and returns to the home screen.
    func deleteProject(_ url: URL, confirm: Bool = true, done: ((URL?) -> Void)? = nil) {
        let name = url.deletingPathExtension().lastPathComponent
        let perform = {
            self.autosaveWork?.cancel()
            if url.standardizedFileURL == self.currentFile?.standardizedFileURL {
                self.currentFile = nil
                self.window.isDocumentEdited = false
                self.savedGen = self.dirtyGen
            }
            var trashed: NSURL?
            do {
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.trashItem(at: url, resultingItemURL: &trashed)
                }
            } catch {
                self.showError("Impossible de supprimer « \(name) ».", error)
            }
            self.removeRecent(url.path)
            self.showHome()
            done?(trashed as URL?)
        }
        guard confirm else { perform(); return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Supprimer « \(name) » ?"
        alert.informativeText = "Le fichier « \(url.lastPathComponent) » sera placé dans la Corbeille. Tu pourras encore le récupérer tant que la Corbeille n'est pas vidée."
        let del = alert.addButton(withTitle: "Supprimer")
        del.hasDestructiveAction = true
        alert.addButton(withTitle: "Annuler")
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn { perform() }
        }
    }

    // ⌘W / logo: close the story and go back to the home screen (on the home screen, close the window).
    @objc func closeProjectOrWindow(_ sender: Any?) {
        if onHome { window.performClose(sender) } else { closeProject(sender) }
    }

    @objc func closeProject(_ sender: Any?) {
        confirmDiscard {
            self.currentFile = nil
            self.window.isDocumentEdited = false
            self.showHome()
        }
    }

    // MARK: Recent projects (home screen)

    let recentsKey = "RecentProjects"

    var recentPaths: [String] { UserDefaults.standard.stringArray(forKey: recentsKey) ?? [] }

    func addRecent(_ url: URL) {
        var list = recentPaths.filter { $0 != url.path }
        list.insert(url.path, at: 0)
        UserDefaults.standard.set(Array(list.prefix(30)), forKey: recentsKey)
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
    }

    func removeRecent(_ path: String) {
        UserDefaults.standard.set(recentPaths.filter { $0 != path }, forKey: recentsKey)
    }

    func showHome() {
        let fm = FileManager.default
        ensureLibrary()
        let libraryFiles = ((try? fm.contentsOfDirectory(at: libraryURL, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == fileExtension }.map(\.path)
        let external = recentPaths.filter { !isInLibrary(URL(fileURLWithPath: $0)) }
        let projects: [[String: Any]] = (libraryFiles + external).map { path in
            let url = URL(fileURLWithPath: path)
            var p: [String: Any] = ["path": path, "name": url.deletingPathExtension().lastPathComponent]
            guard fm.fileExists(atPath: path) else { p["missing"] = true; return p }
            if let date = (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date {
                p["modified"] = date.timeIntervalSince1970 * 1000
            }
            if let data = try? Data(contentsOf: url),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let meta = json["meta"] as? [String: Any] {
                let project = meta["project"] as? [String: Any] ?? [:]
                let title = (meta["titlePage"] as? [String: Any])?["title"] as? String
                if let n = project["name"] as? String, !n.isEmpty { p["name"] = n }
                else if let t = title, !t.isEmpty { p["name"] = t }
                if let d = project["description"] as? String { p["description"] = d }
                if let c = project["cover"] as? String, c.hasPrefix("data:image/") { p["cover"] = c }
            }
            p["library"] = isInLibrary(url)
            return p
        }.sorted { ($0["modified"] as? Double ?? 0) > ($1["modified"] as? Double ?? 0) }
        onHome = true
        updateTitle()
        webView.callAsyncJavaScript("librescript.showHome(projects, folder)", arguments: ["projects": projects, "folder": libraryURL.path],
                                    in: nil, in: .page, completionHandler: nil)
    }

    // <input type="file"> (cover image) needs a native open panel in WKWebView.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image]
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    @objc func openDocument(_ sender: Any?) {
        confirmDiscard {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [self.documentType, .json]
            panel.allowsMultipleSelection = false
            panel.beginSheetModal(for: self.window) { response in
                if response == .OK, let url = panel.url { self.open(url) }
            }
        }
    }

    func open(_ url: URL) {
        guard webReady else { pendingOpen = url; return }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            webView.callAsyncJavaScript("librescript.load(json)", arguments: ["json": text],
                                        in: nil, in: .page) { result in
                if case .failure(let error) = result {
                    self.showError("Impossible d'ouvrir « \(url.lastPathComponent) ».", error)
                    return
                }
                self.onHome = false
                self.currentFile = url
                self.window.isDocumentEdited = false
                self.addRecent(url)
            }
        } catch {
            showError("Impossible de lire « \(url.lastPathComponent) ».", error)
        }
    }

    @objc func saveDocument(_ sender: Any?) { save(as: false, then: nil) }
    @objc func saveDocumentAs(_ sender: Any?) { save(as: true, then: nil) }

    func save(as forceAsk: Bool, then done: (() -> Void)?, failed: (() -> Void)? = nil) {
        let gen = dirtyGen
        let write: (URL) -> Void = { target in
            self.webView.evaluateJavaScript("JSON.stringify({ text: librescript.serialize(), name: librescript.projectName })") { result, error in
                guard let json = result as? String, let data = json.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let text = obj["text"] as? String else {
                    self.js("librescript.setSaveState('error')")
                    self.showError("Impossible d'enregistrer.", error); failed?(); return
                }
                var url = target
                // Files in the projects folder follow the story's name.
                if self.isInLibrary(url), let name = obj["name"] as? String, !name.isEmpty,
                   Self.safeFileName(name) != url.deletingPathExtension().lastPathComponent,
                   FileManager.default.fileExists(atPath: url.path) {
                    let renamed = self.uniqueLibraryURL(for: name, excluding: url)
                    if (try? FileManager.default.moveItem(at: url, to: renamed)) != nil {
                        self.removeRecent(url.path)
                        url = renamed
                    }
                }
                do {
                    try text.write(to: url, atomically: true, encoding: .utf8)
                    self.currentFile = url
                    self.savedGen = gen
                    self.window.isDocumentEdited = self.dirtyGen != gen // edits made while saving stay pending
                    if self.dirtyGen != gen { self.scheduleAutosave() }
                    self.addRecent(url)
                    self.js("librescript.setSaveState('\(self.dirtyGen != gen ? "pending" : "saved")')")
                    done?()
                } catch {
                    self.js("librescript.setSaveState('error')")
                    self.showError("Impossible d'enregistrer « \(url.lastPathComponent) ».", error)
                    failed?()
                }
            }
        }
        if let url = currentFile, !forceAsk { write(url); return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [documentType]
        panel.nameFieldStringValue = currentFile?.lastPathComponent ?? suggestedName ?? "Sans titre.\(fileExtension)"
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url { write(url) }
        }
    }

    // US Letter, no margins: the page layout (margins, page numbers) comes from print CSS.
    func letterPrintInfo() -> NSPrintInfo {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.paperSize = NSSize(width: 612, height: 792)
        info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        return info
    }

    @objc func printDocument(_ sender: Any?) {
        webView.evaluateJavaScript("librescript.preparePrint('script')") { _, _ in
            let op = self.webView.printOperation(with: self.letterPrintInfo())
            op.view?.frame = self.webView.bounds
            op.runModal(for: self.window, delegate: nil, didRun: nil, contextInfo: nil)
        }
    }

    func applyAppearance(_ name: String) {
        NSApp.appearance = name == "dark" ? NSAppearance(named: .darkAqua) : name == "light" ? NSAppearance(named: .aqua) : nil
    }

    @objc func openSettings(_ sender: Any?) { js("librescript.openSettings()") }

    func writePDF(to url: URL, kind: String = "script", then done: (() -> Void)?) {
        webView.evaluateJavaScript("librescript.preparePrint('\(kind == "synopsis" ? "synopsis" : "script")')") { _, _ in
            let info = self.letterPrintInfo()
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
            let op = self.webView.printOperation(with: info)
            op.view?.frame = self.webView.bounds
            op.showsPrintPanel = false
            op.showsProgressPanel = false
            self.afterPDF = done
            op.runModal(for: self.window, delegate: self,
                        didRun: #selector(self.printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
    }
    @objc nonisolated func printOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        // AppKit may call this off the main thread; WebKit must only be used from the main thread.
        DispatchQueue.main.async {
            let done = self.afterPDF
            self.afterPDF = nil
            done?()
        }
    }

    func askSaveURL(_ filename: String, _ then: @escaping (URL) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.canCreateDirectories = true
        let ext = (filename as NSString).pathExtension
        if let type = UTType(filenameExtension: ext) { panel.allowedContentTypes = [type] }
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url { then(url) }
        }
    }

    @objc func openGuide(_ sender: Any?) { js("librescript.guide()") }
    @objc func exportPDF(_ sender: Any?) { js("librescript.exportAs('pdf')") }
    @objc func exportFDX(_ sender: Any?) { js("librescript.exportAs('fdx')") }
    @objc func exportFountain(_ sender: Any?) { js("librescript.exportAs('fountain')") }
    @objc func exportSynopsis(_ sender: Any?) { js("librescript.exportAs('synopsis')") }
    @objc func showView(_ sender: NSMenuItem) {
        guard let v = sender.representedObject as? String else { return }
        js("librescript.showView('\(v)')")
    }

    // MARK: Edit / Find / Format commands (forwarded to the editor)

    @objc func undoEdit(_ sender: Any?) { js("librescript.undo()") }
    @objc func redoEdit(_ sender: Any?) { js("librescript.redo()") }
    @objc func find(_ sender: Any?) { js("librescript.find()") }
    @objc func findNext(_ sender: Any?) { js("librescript.findNext()") }
    @objc func findPrevious(_ sender: Any?) { js("librescript.findPrevious()") }
    @objc func setBlockType(_ sender: NSMenuItem) {
        guard let type = sender.representedObject as? String else { return }
        js("librescript.editor.setBlockType(librescript.editor.currentBlockIndex(), '\(type)')")
    }

    // MARK: Unsaved changes

    // Autosave: before leaving a story (close, open another, quit) pending changes are written, no question asked.
    func confirmDiscard(cancel: (() -> Void)? = nil, _ proceed: @escaping () -> Void) {
        autosaveWork?.cancel()
        guard !onHome, window?.isDocumentEdited == true else { proceed(); return }
        if currentFile == nil { currentFile = uniqueLibraryURL(for: "Sans titre") }
        save(as: false, then: proceed, failed: cancel)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closingAfterSave || !sender.isDocumentEdited { return true }
        confirmDiscard {
            self.closingAfterSave = true
            sender.close()
        }
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard window?.isDocumentEdited == true, !closingAfterSave else { return .terminateNow }
        confirmDiscard(cancel: { NSApp.reply(toApplicationShouldTerminate: false) }) {
            self.closingAfterSave = true
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: Helpers

    var documentType: UTType { UTType(filenameExtension: fileExtension) ?? .json }
    var displayName: String { currentFile?.deletingPathExtension().lastPathComponent ?? "Sans titre" }

    func updateTitle() {
        guard let window else { return }
        window.title = onHome ? "Librescript" : displayName
        window.representedURL = onHome ? nil : currentFile
    }

    func showError(_ message: String, _ error: Error?) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = error?.localizedDescription ?? ""
        alert.alertStyle = .warning
        alert.beginSheetModal(for: window, completionHandler: nil)
    }

    // MARK: Menu bar

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "",
                  _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            let host = NSMenuItem(); host.submenu = m
            main.addItem(host)
            return m
        }

        _ = submenu("Librescript", [
            item("À propos de Librescript", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Réglages…", #selector(openSettings(_:)), ",", target: self),
            .separator(),
            item("Masquer Librescript", #selector(NSApplication.hide(_:)), "h"),
            item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Tout afficher", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quitter Librescript", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recent = NSMenuItem(title: "Ouvrir l'élément récent", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Ouvrir l'élément récent")
        recentMenu.delegate = self
        recent.submenu = recentMenu

        _ = submenu("Fichier", [
            item("Nouveau", #selector(newDocument(_:)), "n", target: self),
            item("Ouvrir…", #selector(openDocument(_:)), "o", target: self),
            item("Importer un PDF…", #selector(importPDF(_:)), "i", [.command, .shift], target: self),
            item("Afficher le dossier des projets", #selector(revealLibrary(_:)), target: self),
            recent,
            .separator(),
            item("Fermer l'histoire", #selector(closeProjectOrWindow(_:)), "w", target: self),
            item("Supprimer l'histoire…", #selector(deleteCurrentProject(_:)), "\u{8}", target: self),
            item("Enregistrer maintenant", #selector(saveDocument(_:)), "s", target: self),
            item("Enregistrer sous…", #selector(saveDocumentAs(_:)), "s", [.command, .shift], target: self),
            .separator(),
            {
                let exp = NSMenuItem(title: "Exporter", action: nil, keyEquivalent: "")
                let m = NSMenu(title: "Exporter")
                m.addItem(item("PDF…", #selector(exportPDF(_:)), "e", [.command, .shift], target: self))
                m.addItem(item("Final Draft (.fdx)…", #selector(exportFDX(_:)), target: self))
                m.addItem(item("Fountain (.fountain)…", #selector(exportFountain(_:)), target: self))
                m.addItem(item("Synopsis (PDF)…", #selector(exportSynopsis(_:)), target: self))
                exp.submenu = m
                return exp
            }(),
            .separator(),
            item("Imprimer…", #selector(printDocument(_:)), "p", target: self),
        ])

        _ = submenu("Édition", [
            item("Annuler", #selector(undoEdit(_:)), "z", target: self),
            item("Rétablir", #selector(redoEdit(_:)), "z", [.command, .shift], target: self),
            .separator(),
            item("Couper", #selector(NSText.cut(_:)), "x"),
            item("Copier", #selector(NSText.copy(_:)), "c"),
            item("Coller", #selector(NSText.paste(_:)), "v"),
            item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            item("Rechercher…", #selector(find(_:)), "f", target: self),
            item("Résultat suivant", #selector(findNext(_:)), "g", target: self),
            item("Résultat précédent", #selector(findPrevious(_:)), "g", [.command, .shift], target: self),
        ])

        let types = [("Titre de scène", "scene_heading"), ("Action", "action"), ("Personnage", "character"),
                     ("Didascalie", "parenthetical"), ("Dialogue", "dialogue"), ("Transition", "transition")]
        _ = submenu("Format", types.enumerated().map { i, t in
            let mi = item(t.0, #selector(setBlockType(_:)), "\(i + 1)", target: self)
            mi.representedObject = t.1
            return mi
        })

        let views = [("Projet", "project"), ("Scénario", "script"), ("Fiches", "cards"), ("Personnages", "characters"),
                     ("Lieux", "locations"), ("Statistiques", "stats"), ("Page de titre", "title"), ("Synopsis", "synopsis")]
        _ = submenu("Présentation", views.enumerated().map { i, v in
            let mi = item(v.0, #selector(showView(_:)), "\(i)", [.command, .option], target: self)
            mi.representedObject = v.1
            return mi
        })

        let windowMenu = submenu("Fenêtre", [
            item("Réduire", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.windowsMenu = windowMenu
        let help = submenu("Aide", [item("Guide de l'utilisateur", #selector(openGuide(_:)), "?", target: self)])
        NSApp.helpMenu = help
        NSApp.mainMenu = main
    }
}

// Recent files menu, rebuilt each time it opens.
extension AppDelegate: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let urls = NSDocumentController.shared.recentDocumentURLs
        for url in urls {
            let i = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            i.target = self
            i.representedObject = url
            i.image = NSWorkspace.shared.icon(forFile: url.path)
            i.image?.size = NSSize(width: 16, height: 16)
            menu.addItem(i)
        }
        if !urls.isEmpty { menu.addItem(.separator()) }
        let clear = NSMenuItem(title: "Effacer le menu", action: #selector(clearRecents(_:)), keyEquivalent: "")
        clear.target = self
        clear.isEnabled = !urls.isEmpty
        menu.addItem(clear)
    }

    @objc func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        confirmDiscard { self.open(url) }
    }

    @objc func clearRecents(_ sender: Any?) {
        NSDocumentController.shared.clearRecentDocuments(nil)
    }
}

// MARK: - Self-test (LIBRESCRIPT_SELFTEST=<dir>): drives the real app — search, every view,
// PDF/FDX export, save + reopen — writes results.json and one PNG per view, then quits.
extension AppDelegate {
    func runSelfTest(outputDir: URL) {
        var report: [String: Any] = [:]
        let doc = outputDir.appendingPathComponent("selftest.\(fileExtension)")

        func step(_ js: String, _ key: String, then next: @escaping () -> Void) {
            webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let v):
                    report[key] = (v as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } ?? v ?? NSNull()
                case .failure(let e):
                    report[key] = "ERREUR: \(e)"
                }
                next()
            }
        }
        func snapshot(_ name: String, then next: @escaping () -> Void) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                self.webView.takeSnapshot(with: nil) { image, _ in
                    if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: outputDir.appendingPathComponent("\(name).png"))
                    }
                    next()
                }
            }
        }
        func finish() {
            let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            try? data.write(to: outputDir.appendingPathComponent("results.json"))
            removeRecent(doc.path)
            window.isDocumentEdited = false
            NSApp.terminate(nil)
        }

        let searchJS = """
        window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
        librescript.loadSample();
        const { editor } = librescript; const $ = (s) => document.querySelector('#search ' + s);
        const r = {};
        librescript.find();
        $('.q').value = 'vent'; $('.q').dispatchEvent(new Event('input'));
        r.count = $('.count').textContent;
        librescript.findNext(); r.afterNext = $('.count').textContent;
        const sc = $('.scope'); sc.value = 'dialogue'; sc.dispatchEvent(new Event('change')); r.dialogueOnly = $('.count').textContent;
        sc.value = ''; sc.dispatchEvent(new Event('change'));
        $('.q').value = '#3'; $('.q').dispatchEvent(new Event('input')); r.jumpTo = editor.model[editor.selection().start.block].text;
        $('.q').value = 'vent'; $('.q').dispatchEvent(new Event('input'));
        $('.r').value = 'mistral'; $('.r').dispatchEvent(new Event('input')); $('.all').click();
        r.replaced = $('.count').textContent;
        librescript.undo(); r.undoRestored = editor.model.some((b) => b.text.includes('vent'));
        librescript.search.hide();
        return JSON.stringify(r);
        """
        let viewsJS = """
        const out = {};
        for (const v of ['project','synopsis','cards','characters','locations','stats','title']) {
          librescript.showView(v);
          await new Promise((r) => setTimeout(r, 50));
          const el = document.getElementById('view-' + v);
          out[v] = { visible: getComputedStyle(el).display !== 'none', text: el.innerText.length,
                     items: el.querySelectorAll('.card, .entity-list li[data-name], .tile, .scene-table tbody tr, .tp-form input').length };
        }
        // Reorder: move scene 1 to the end, check, then undo.
        const before = librescript.editor.model.find((b) => b.type === 'scene_heading').text;
        librescript.showView('script');
        await new Promise((r) => setTimeout(r, 50));
        const items = document.querySelectorAll('.nav-item').length;
        out.navigatorItems = items;
        out.pageMarks = document.querySelectorAll('#editor .block[data-page]').length;
        out.docStats = document.querySelector('.doc-stats').textContent;
        out.errors = window.__errors;
        out.firstSceneBefore = before;
        return JSON.stringify(out);
        """
        step(searchJS, "search") {
            snapshot("1-scenario") {
                step(viewsJS, "views") {
                    let shots = ["project": "1b-projet", "synopsis": "7-synopsis", "cards": "2-fiches", "characters": "3-personnages", "locations": "4-lieux", "stats": "5-stats", "title": "6-titre"]
                    var queue = ["project", "synopsis", "cards", "characters", "locations", "stats", "title"]
                    @MainActor func nextShot() {
                        guard !queue.isEmpty else { exports(); return }
                        let v = queue.removeFirst()
                        self.js("librescript.showView('\(v)')")
                        snapshot(shots[v]!) { nextShot() }
                    }
                    nextShot()
                }
            }
        }

        func exports() {
            js("librescript.showView('script')")
            webView.evaluateJavaScript("librescript.exportText('fdx')") { v, _ in
                let fdx = (v as? String) ?? ""
                try? fdx.write(to: outputDir.appendingPathComponent("export.fdx"), atomically: true, encoding: .utf8)
                report["fdxParagraphs"] = fdx.components(separatedBy: "<Paragraph ").count - 1
                let pdfURL = outputDir.appendingPathComponent("export.pdf")
                self.writePDF(to: pdfURL) {
                  let synURL = outputDir.appendingPathComponent("synopsis.pdf")
                  self.writePDF(to: synURL, kind: "synopsis") {
                    report["synopsisPdfPages"] = CGPDFDocument(synURL as CFURL)?.numberOfPages ?? 0
                    if let pdf = CGPDFDocument(pdfURL as CFURL) {
                        report["pdfPages"] = pdf.numberOfPages
                        if let page = pdf.page(at: 1) { report["pdfPageSize"] = "\(page.getBoxRect(.mediaBox).size)" }
                    } else {
                        report["pdfPages"] = 0
                    }
                    importBack(pdfURL)
                  }
                }
            }
        }

        // Projects folder: create → autosave → rename → delete (to the Trash, then cleaned up).
        func libraryTest() {
            var lib: [String: Any] = ["folder": libraryURL.path]
            let fm = FileManager.default
            self.createProject(name: "Test autosave", description: "Créé par l'autotest")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                let created = self.libraryURL.appendingPathComponent("Test autosave.\(fileExtension)")
                lib["createdInFolder"] = fm.fileExists(atPath: created.path)
                lib["currentIsCreated"] = self.currentFile?.standardizedFileURL == created.standardizedFileURL
                // Type something; the app must save it by itself.
                self.js("librescript.editor.applyModel([...librescript.editor.model, { type: 'action', text: 'Texte enregistré tout seul.' }])")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    lib["dirtyRightAfterEdit"] = self.window.isDocumentEdited
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                        lib["autosaved"] = ((try? String(contentsOf: created, encoding: .utf8)) ?? "").contains("Texte enregistré tout seul.")
                        lib["dirtyAfterAutosave"] = self.window.isDocumentEdited
                        // Rename the story → the file follows.
                        self.js("librescript.meta.project.name = 'Histoire renommée'; librescript.editor.applyModel([...librescript.editor.model, { type: 'action', text: 'Encore.' }])")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                            let renamed = self.libraryURL.appendingPathComponent("Histoire renommée.\(fileExtension)")
                            lib["renamedFile"] = fm.fileExists(atPath: renamed.path)
                            lib["oldNameGone"] = !fm.fileExists(atPath: created.path)
                            step("return document.querySelector('.save-state').textContent", "saveIndicator") {
                                self.deleteProject(renamed, confirm: false) { trashed in
                                    lib["deletedFromFolder"] = !fm.fileExists(atPath: renamed.path)
                                    lib["wentToTrash"] = trashed.map { fm.fileExists(atPath: $0.path) } ?? false
                                    lib["backHome"] = self.onHome
                                    if let t = trashed { try? fm.removeItem(at: t) } // don't leave test files in the user's Trash
                                    report["library"] = lib
                                    themes()
                                }
                            }
                        }
                    }
                }
            }
        }

        // Themes: home in Sépia, the settings panel, then Nuit with a light script page.
        func themes() {
            js("document.documentElement.dataset.theme = 'sepia'")
            snapshot("8-accueil-sepia") {
                self.js("librescript.openSettings()")
                snapshot("9-reglages") {
                    self.js("document.querySelector('.settings-dialog').close(); document.documentElement.dataset.theme = 'nuit'; document.documentElement.classList.add('paper-light'); librescript.loadSample(); librescript.showView('script')")
                    snapshot("10-nuit-page-claire") {
                        step("return JSON.stringify({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, page: getComputedStyle(document.querySelector('.page')).backgroundColor, errors: window.__errors })", "themes") { finish() }
                    }
                }
            }
        }

        // Re-import the PDF we just exported and compare with the original blocks.
        func importBack(_ pdfURL: URL) {
            step("window.__orig = JSON.stringify(librescript.editor.model.map(b => [b.type, b.text.toUpperCase()])); return 'ok'", "origCaptured") {
                self.importPDF(url: pdfURL) { ok in
                    report["pdfImportOk"] = ok
                    step("""
                    const orig = JSON.parse(window.__orig);
                    const got = librescript.editor.model.map(b => [b.type, b.text.toUpperCase()]);
                    const mismatches = [];
                    for (let i = 0; i < Math.max(orig.length, got.length); i++)
                      if (JSON.stringify(orig[i]) !== JSON.stringify(got[i])) mismatches.push({ i, want: orig[i], got: got[i] });
                    const r = { origCount: orig.length, gotCount: got.length, mismatches: mismatches.slice(0, 6),
                                titlePage: librescript.meta.titlePage, project: librescript.meta.project.name,
                                toast: document.querySelector('.toast')?.textContent };
                    librescript.loadSample();
                    return JSON.stringify(r);
                    """, "pdfImport") { saveAndReopen() }
                }
            }
        }

        func saveAndReopen() {
            webView.evaluateJavaScript("librescript.meta.characters.ANNA = { role: 'Héroïne' }; librescript.meta.project = { name: 'Le Vent du large', description: 'Une skipper prend la mer malgré la tempête annoncée. Son frère tente de la retenir.' }; 1") { _, _ in
                self.window.isDocumentEdited = true
                self.currentFile = doc
                self.save(as: false) {
                    report["dirtyAfterSave"] = self.window.isDocumentEdited
                    self.js("librescript.newDocument()")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        self.open(doc)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            step("return JSON.stringify({ scenes: librescript.editor.model.filter(b => b.type==='scene_heading').length, note: librescript.editor.model[0].note || null, annaRole: librescript.meta.characters.ANNA?.role, title: librescript.meta.titlePage.title, errors: window.__errors || [] })", "reopened") {
                                report["windowTitle"] = self.window.title
                                self.closeProject(nil)
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                    step("return JSON.stringify({ screen: librescript.screen, cards: [...document.querySelectorAll('.project-card h3')].map(e => e.textContent), desc: document.querySelector('.project-desc')?.textContent })", "home") {
                                        report["homeWindowTitle"] = self.window.title
                                        snapshot("0-accueil") { libraryTest() }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Entry point

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
