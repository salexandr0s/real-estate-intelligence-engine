import Darwin
import Foundation

enum EngineLogs {
    static let rotationLimitAtStart: UInt64 = 20_000_000
    static let rotationLimitWhileRunning: UInt64 = 100_000_000

    /// Children inherit this as stdout and stderr. O_APPEND is what lets rotation truncate the file
    /// under a running writer: the writer's next line goes to the new end of the file.
    static func openForAppend(_ url: URL) throws -> FileHandle {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0o644)
        guard descriptor >= 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }

    /// Moves each oversized log to `<name>.1`, replacing the previous copy. A clone costs almost no
    /// disk and no copying, and lines written between the clone and the truncate are lost.
    static func rotate(in directory: URL, largerThan limit: UInt64) {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey]
        )) ?? []

        for file in files where file.pathExtension == "log" {
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            guard UInt64(size) > limit else { continue }

            let rotated = file.path + ".1"
            unlink(rotated)
            guard copyfile(file.path, rotated, nil, copyfile_flags_t(COPYFILE_CLONE)) == 0 else {
                continue
            }
            truncate(file.path, 0)
        }
    }
}
