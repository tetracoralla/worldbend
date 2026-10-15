import Foundation
import WorldbendAppearance

actor PersonalPreferenceFileStore {
    let url:URL
    private var latestGeneration=0
    init(_ url:URL){self.url=url}
    func read()throws->Data?{
        guard FileManager.default.fileExists(atPath:url.path) else{return nil}
        let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize
        guard let size,size<=65536 else{throw AppearanceError.invalidReceipt}
        let handle=try FileHandle(forReadingFrom:url);defer{try? handle.close()}
        let data=try handle.read(upToCount:65537) ?? Data()
        guard data.count<=65536 else{throw AppearanceError.invalidReceipt};return data
    }
    // Actor serialization prevents an older completion from replacing newer state.
    func write(_ data:Data,generation:Int)throws{
        guard generation>latestGeneration else{return}
        latestGeneration=generation
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        try data.write(to:url,options:.atomic)
    }
}
