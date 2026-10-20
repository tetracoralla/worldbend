#if canImport(UIKit)
  import XCTest

  @MainActor
  final class TideNativeUITests: XCTestCase {
    private func launch() -> XCUIApplication {
      let app = XCUIApplication()
      app.launch()
      XCTAssertTrue(app.buttons["play-tide"].waitForExistence(timeout: 10))
      return app
    }
    private func wait(_ element: XCUIElement, _ text: String) {
      let check = expectation(
        for: NSPredicate(format: "label CONTAINS %@", text), evaluatedWith: element)
      wait(for: [check], timeout: 8)
    }
    private func image(_ app: XCUIApplication, _ name: String) {
      let attachment = XCTAttachment(screenshot: app.screenshot())
      attachment.name = name
      attachment.lifetime = .keepAlways
      add(attachment)
    }
    func testRealDynamicSourceOpticsAndControls() {
      let app = launch()
      wait(app.buttons["play-tide"], "暂停")
      Thread.sleep(forTimeInterval: 5)
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "继续")
      image(app, "actual-native-dynamic-source-with-optical-panes")
      let before = app.staticTexts["tide-status"].label
      XCTAssertTrue(before.contains("×"))
      app.switches["show-optics"].tap()
      image(app, "same-paused-native-source-without-optics")
      app.switches["show-optics"].tap()
      XCTAssertTrue(app.buttons["change-palette"].exists)
      app.buttons["change-palette"].tap()
      image(app, "same-time-source-palette-revision")
      app.buttons["change-alpha"].tap()
      image(app, "native-transparent-source-and-optics")
      app.buttons["change-hdr"].tap()
      image(app, "extended-float-source-through-sdr-optical-surface")
      app.buttons["stop-tide"].tap()
      wait(app.staticTexts["tide-status"], "0.0 秒")
      image(app, "stopped-native-source-withdrawn")
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "暂停")
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "继续")
      image(app, "native-source-restarted")
      app.terminate()
    }
    func testBackgroundSuspensionResumesWithoutAdvancingHiddenTime() {
      let app = launch()
      wait(app.buttons["play-tide"], "暂停")
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "继续")
      let before = app.staticTexts["tide-status"].label
      XCUIDevice.shared.press(.home)
      Thread.sleep(forTimeInterval: 3)
      app.activate()
      wait(app.buttons["play-tide"], "继续")
      XCTAssertEqual(app.staticTexts["tide-status"].label, before)
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "暂停")
      Thread.sleep(forTimeInterval: 2)
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "继续")
      image(app, "resumed-native-gpu-source")
      app.terminate()
    }

    func testPlayingSourceFreezesDuringBackgroundAndResumes() {
      let app = launch()
      wait(app.buttons["play-tide"], "暂停")
      func time() -> Double {
        Double(app.staticTexts["tide-status"].label.components(separatedBy: " 秒")[0]) ?? -1
      }
      let before = time()
      XCUIDevice.shared.press(.home)
      Thread.sleep(forTimeInterval: 3)
      app.activate()
      wait(app.buttons["play-tide"], "暂停")
      let after = time()
      XCTAssertGreaterThanOrEqual(after, before)
      XCTAssertLessThan(after - before, 2.5)
      image(app, "playing-native-source-resumes-after-background")
      app.buttons["play-tide"].tap()
      wait(app.buttons["play-tide"], "继续")
      app.terminate()
    }
  }
#endif
