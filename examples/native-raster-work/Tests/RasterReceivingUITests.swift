import XCTest

@MainActor
final class RasterReceivingUITests: XCTestCase {
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.buttons["revision-revised"].waitForExistence(timeout: 5))
    waitLabel(app.staticTexts["work-progress"], contains: "/ 4.0")
    return app
  }
  private func waitLabel(_ element: XCUIElement, contains text: String) {
    let predicate = NSPredicate(format: "label CONTAINS %@", text)
    let check = expectation(for: predicate, evaluatedWith: element)
    wait(for: [check], timeout: 5)
  }
  private func time(_ app: XCUIApplication) -> Double {
    Double(
      app.staticTexts["work-progress"].label.split(separator: "/")[0].trimmingCharacters(
        in: .whitespaces)) ?? -1
  }
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testSourceRevisionRetainsViewingProgress() {
    let app = launch()
    capture(app, "initial-four-second-work")
    app.buttons["toggle-play"].tap()
    waitLabel(app.buttons["toggle-play"], contains: "暂停")
    let progressed = expectation(
      for: NSPredicate { _, _ in self.time(app) >= 0.5 }, evaluatedWith: nil)
    wait(for: [progressed], timeout: 5)
    app.buttons["toggle-play"].tap()
    let before = time(app)
    app.buttons["revision-revised"].tap()
    waitLabel(app.staticTexts["work-progress"], contains: "/ 6.0")
    XCTAssertEqual(time(app), before * 1.5, accuracy: 0.2)
    XCTAssertEqual(app.buttons["toggle-play"].label, "播放")
    capture(app, "revised-six-second-work")
    app.terminate()
  }

  func testStopResetAndContinuedUse() {
    let app = launch()
    app.buttons["revision-revised"].tap()
    waitLabel(app.staticTexts["work-progress"], contains: "/ 6.0")
    app.buttons["toggle-play"].tap()
    waitLabel(app.buttons["toggle-play"], contains: "暂停")
    app.buttons["stop-work"].tap()
    waitLabel(app.staticTexts["work-progress"], contains: "0.0 / 6.0")
    XCTAssertEqual(app.buttons["toggle-play"].label, "播放")
    capture(app, "stopped-cleared-frame")
    app.buttons["reset-work"].tap()
    waitLabel(app.staticTexts["work-progress"], contains: "0.0 / 6.0")
    capture(app, "reset-restored-first-frame")
    app.buttons["toggle-play"].tap()
    waitLabel(app.buttons["toggle-play"], contains: "暂停")
    app.buttons["toggle-play"].tap()
    XCTAssertGreaterThanOrEqual(time(app), 0)
    app.terminate()
  }

  func testForegroundSuspensionExcludesBackgroundTime() {
    let app = launch()
    app.buttons["revision-revised"].tap()
    waitLabel(app.staticTexts["work-progress"], contains: "/ 6.0")
    app.buttons["toggle-play"].tap()
    waitLabel(app.buttons["toggle-play"], contains: "暂停")
    let before = time(app)
    XCUIDevice.shared.press(.home)
    // This is deliberately longer than the whole authored clip. On return,
    // foreground continuation must not have consumed background wall time.
    Thread.sleep(forTimeInterval: 7)
    app.activate()
    // activate() can return during the opening transition. The first run tapped
    // against that moving surface and reset the slider instead of pausing.
    // Wait for actual foreground playback before observing or interacting.
    waitLabel(app.buttons["toggle-play"], contains: "暂停")
    let after = time(app)
    XCTAssertLessThan(after, 6)
    XCTAssertGreaterThanOrEqual(after, before)
    capture(app, "foreground-resumed-work")
    app.terminate()
  }
}
