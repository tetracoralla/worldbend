import Foundation
import Testing
@testable import WorldbendMaterialReceiving

struct ReceivingPersistenceTests {
    private func directory()throws->URL{
        let base=ProcessInfo.processInfo.environment["WORLDBEND_QA_STORAGE_ROOT"].map{URL(fileURLWithPath:$0)} ?? FileManager.default.temporaryDirectory
        let url=base.appendingPathComponent("worldbend-receiving-test-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true);return url
    }
    @Test func olderQueuedSnapshotCannotReplaceNewerSave()async throws{
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let store=PersonalPreferenceFileStore(dir.appendingPathComponent("preference.json"))
        try await store.write(Data("newer".utf8),generation:2)
        try await store.write(Data("older".utf8),generation:1)
        let restored=try await store.read();#expect(restored==Data("newer".utf8))
        try await store.write(Data("retry".utf8),generation:3)
        let latest=try await store.read();#expect(latest==Data("retry".utf8))
    }
    @Test func failedLocationCanBeRetriedAndOversizeReadIsRejected()async throws{
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let parent=dir.appendingPathComponent("location"),file=parent.appendingPathComponent("record.json")
        try Data("file, not a directory".utf8).write(to:parent)
        let store=PersonalPreferenceFileStore(file)
        do{try await store.write(Data("accepted material".utf8),generation:1);Issue.record("A file cannot be a save directory")}catch{}
        try FileManager.default.removeItem(at:parent)
        try await store.write(Data("saved after retry".utf8),generation:2)
        let restored=try await store.read();#expect(restored==Data("saved after retry".utf8))
        try Data(repeating:32,count:65537).write(to:file)
        do{_ = try await store.read();Issue.record("Oversize host record must reject")}catch{}
        let bytes=try Data(contentsOf:URL(fileURLWithPath:file.path))
        #expect(bytes.count==65537)
    }
}
