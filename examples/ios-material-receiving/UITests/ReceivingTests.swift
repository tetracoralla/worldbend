import XCTest

final class ReceivingTests: XCTestCase {
    @MainActor func testNeutralOpticsKeepBackdropAlignedWhileScrolling() throws {
        let app = XCUIApplication(); app.launchArguments = ["-optical-example", "-optical-chart", "-optical-variant", "neutral"]; app.launch()
        let sample = app.otherElements["optical-sample"]
        XCTAssertTrue(sample.waitForExistence(timeout: 8))
        func bytes(_ name: String) throws -> [UInt8] {
            let shot = sample.screenshot()
            let attachment = XCTAttachment(screenshot: shot); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
            let source = try XCTUnwrap(shot.image.cgImage)
            let image = try XCTUnwrap(source.cropping(to: CGRect(x: 100, y: 60, width: source.width - 200, height: source.height - 120)))
            var result = [UInt8](repeating: 0, count: image.width * image.height * 4)
            let context = try XCTUnwrap(CGContext(data: &result, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return result
        }
        for scroll in [false, true] {
            if scroll { app.scrollViews.firstMatch.swipeUp() }
            app.buttons["optical-restore"].tap()
            let rendered = try bytes("neutral-rendered-\(scroll)")
            app.buttons["optical-remove"].tap()
            let original = try bytes("neutral-original-\(scroll)")
            XCTAssertEqual(rendered.count, original.count)
            let difference = zip(rendered, original).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(original.count)
            XCTAssertLessThan(difference, 0.5, "Neutral optics shifted the actual backdrop")
        }
    }
    @MainActor func testOpticalParametersChangeRenderedPixels() throws {
        let app = XCUIApplication()
        func capture(_ variant: String?) throws -> [UInt8] {
            app.launchArguments = ["-optical-example", "-optical-chart"] + (variant.map { ["-optical-variant", $0] } ?? [])
            app.launch()
            let sample = app.otherElements["optical-sample"]
            XCTAssertTrue(sample.waitForExistence(timeout: 8))
            let shot = sample.screenshot()
            let attachment = XCTAttachment(screenshot: shot); attachment.name = "optical-\(variant ?? "initial")"; attachment.lifetime = .keepAlways; add(attachment)
            let image = try XCTUnwrap(shot.image.cgImage)
            var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
            let context = try XCTUnwrap(CGContext(data: &bytes, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            app.terminate()
            return bytes
        }
        let baseline = try capture(nil)
        for field in ["refraction", "depth", "dispersion", "radius", "lightIntensity", "lightAngle"] {
            let current = try capture(field)
            XCTAssertEqual(current.count, baseline.count)
            let difference = zip(baseline, current).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(baseline.count)
            XCTAssertGreaterThan(difference, 0.12, "\(field) did not alter the rendered pane")
        }
    }

    @MainActor func testOpticalReceivingKeepsInputAndActions() throws {
        let app = XCUIApplication(); app.launchArguments = ["-optical-example"]; app.launch()
        let note = app.textFields["optical-note"]
        XCTAssertTrue(note.waitForExistence(timeout: 8))
        let action = app.buttons["optical-save"]
        XCTAssertEqual(note.frame.midY, action.frame.midY, accuracy: 2)
        XCTAssertLessThanOrEqual(note.frame.height, 60)
        XCTAssertLessThan(note.frame.maxX, action.frame.minX)
        note.tap(); note.typeText("Morning coffee")
        app.buttons["optical-save"].tap()
        app.buttons["optical-receive"].tap()
        XCTAssertTrue(app.staticTexts["Updated look"].waitForExistence(timeout: 5))
        XCTAssertEqual(note.value as? String, "Morning coffee")
        app.buttons["optical-remove"].tap()
        XCTAssertEqual(note.value as? String, "Morning coffee")
        app.buttons["optical-restore"].tap()
        note.tap(); note.typeText(" please")
        XCTAssertEqual(note.value as? String, "Morning coffee please")
    }
    @MainActor func testContinuedControlsThroughDesignUpdate() throws {
        let app = XCUIApplication(); app.launchArguments = ["-reset-example"]; app.launch()
        XCTAssertTrue(app.buttons["save"].waitForExistence(timeout: 5))
        app.buttons["save"].tap()
        let note = app.textFields["note"]
        app.scrollViews.firstMatch.swipeUp(); XCTAssertTrue(note.waitForExistence(timeout: 5))
        let increment = app.buttons["guests-Increment"]
        increment.tap()
        note.tap(); note.typeText("Coffee by the lake")
        // Same view identity must survive a source visibility change while editing.
        let receive = app.buttons["receive"]
        if !receive.isHittable { app.scrollViews.firstMatch.swipeUp() }
        receive.tap()
        XCTAssertTrue(app.staticTexts["Revision 2"].waitForExistence(timeout: 5))
        XCTAssertEqual(note.value as? String, "Coffee by the lake")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertEqual(app.buttons["save"].label, "Saved trip")
        app.buttons["done"].tap()
        XCTAssertTrue(app.buttons["guests-Increment"].value as? String == "2")
        let reserve = app.buttons["reserve"]; reserve.tap()
        XCTAssertTrue(app.buttons["Reservation saved"].exists)
        receive.tap()
        XCTAssertTrue(app.staticTexts["Revision 1"].waitForExistence(timeout: 5))
        XCTAssertEqual(note.value as? String, "Coffee by the lake")
        app.terminate(); app.launchArguments = []; app.launch(); app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(app.buttons["Reservation saved"].exists)
    }
    @MainActor func testRemovedFailedAndCancelledUpdates() throws {
        let app = XCUIApplication(); app.launch(); app.scrollViews.firstMatch.swipeUp()
        func choose(_ label: String) { app.buttons["more"].tap(); app.buttons[label].tap() }
        choose("Remove material")
        app.buttons["receive"].tap()
        XCTAssertTrue(app.staticTexts["Look updated. Your local removal is kept."].waitForExistence(timeout: 5))
        choose("Try old update")
        XCTAssertTrue(app.staticTexts["Old update rejected. Your current look is kept."].exists)
        choose("Restore latest look")
        choose("Simulate failed receipt")
        app.buttons["receive"].tap()
        XCTAssertTrue(app.staticTexts["Update unavailable. Your current look is kept. Retry when ready."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Revision 2"].exists)
        app.buttons["receive"].tap()
        XCTAssertTrue(app.staticTexts["Revision 1"].waitForExistence(timeout: 5))
        app.buttons["receive"].tap(); app.buttons["cancel"].tap()
        XCTAssertTrue(app.staticTexts["Update cancelled. The current look is kept."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Revision 1"].exists)
        app.buttons["receive"].tap()
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.staticTexts["Update cancelled. The current look is kept."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Revision 1"].exists)
    }
}
