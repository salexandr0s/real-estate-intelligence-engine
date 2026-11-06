import Darwin
import Foundation

/// PIDs get reused, so a process is named by its PID, start time and executable together.
struct ProcessIdentity: Codable, Equatable, Sendable {
    let pid: pid_t
    let startSeconds: UInt64
    let startMicros: UInt64
    let executablePath: String
}

enum ProcessObservation: Equatable, Sendable {
    case live(ProcessIdentity)
    case exited
    /// The process can't be read, which doesn't prove it is gone. Only ESRCH proves that.
    case unknown
}

/// Reads process facts from the kernel, without spawning `ps`.
enum ProcessInspector {
    static func observe(pid: pid_t) -> ProcessObservation {
        guard pid > 0 else { return .exited }

        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else {
            return errno == ESRCH ? .exited : .unknown
        }
        guard info.pbi_status != UInt32(SZOMB) else { return .exited }

        var pathBuffer = [UInt8](repeating: 0, count: Int(4 * MAXPATHLEN))
        let pathLength = pathBuffer.withUnsafeMutableBytes { raw in
            proc_pidpath(pid, raw.baseAddress, UInt32(raw.count))
        }
        guard pathLength > 0 else {
            return errno == ESRCH ? .exited : .unknown
        }

        return .live(
            ProcessIdentity(
                pid: pid,
                startSeconds: info.pbi_start_tvsec,
                startMicros: info.pbi_start_tvusec,
                executablePath: String(decoding: pathBuffer.prefix(Int(pathLength)), as: UTF8.self)
            )
        )
    }

    static func parentPID(pid: pid_t) -> pid_t? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        return pid_t(info.pbi_ppid)
    }

    static func cwd(pid: pid_t) -> String? {
        var info = proc_vnodepathinfo()
        let size = Int32(MemoryLayout<proc_vnodepathinfo>.stride)
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }

        let path = withUnsafeBytes(of: &info.pvi_cdir.vip_path) { raw -> String in
            guard let start = raw.bindMemory(to: CChar.self).baseAddress else { return "" }
            return String(cString: start)
        }
        return path.isEmpty ? nil : path
    }

    /// macOS hides the environment of Apple's platform binaries, and Postgres and Redis overwrite
    /// theirs when they set a process title, so an empty environment proves nothing.
    static func argumentsAndEnvironment(pid: pid_t) -> (arguments: [String], environment: [String])? {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else { return nil }

        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0 else { return nil }
        return parseProcessArguments(buffer.prefix(size))
    }

    static func allProcessIDs() -> [pid_t] {
        let estimate = proc_listallpids(nil, 0)
        guard estimate > 0 else { return [] }

        // Room for processes that start between the two calls.
        var pids = [pid_t](repeating: 0, count: Int(estimate) + 64)
        let filled = pids.withUnsafeMutableBytes { raw in
            proc_listallpids(raw.baseAddress, Int32(raw.count))
        }
        guard filled > 0 else { return [] }
        return Array(pids.prefix(Int(filled)))
    }

    /// The layout is argc, the executable path, padding NULs, then argc arguments and the
    /// environment, each NUL-terminated.
    private static func parseProcessArguments(
        _ bytes: ArraySlice<UInt8>
    ) -> (arguments: [String], environment: [String])? {
        let argcSize = MemoryLayout<Int32>.size
        guard bytes.count > argcSize else { return nil }

        let argc = bytes.prefix(argcSize).reversed().reduce(Int32(0)) { ($0 << 8) | Int32($1) }
        guard argc >= 0 else { return nil }

        var cursor = bytes.startIndex + argcSize
        guard let executableEnd = bytes[cursor...].firstIndex(of: 0) else { return nil }
        cursor = executableEnd
        while cursor < bytes.endIndex, bytes[cursor] == 0 {
            cursor += 1
        }

        var strings: [String] = []
        while cursor < bytes.endIndex {
            let end = bytes[cursor...].firstIndex(of: 0) ?? bytes.endIndex
            // An empty string ends the environment, and the rest is Apple's private data.
            if end == cursor, strings.count >= Int(argc) { break }
            strings.append(String(decoding: bytes[cursor..<end], as: UTF8.self))
            cursor = end + 1
        }

        guard strings.count >= Int(argc) else { return nil }
        return (Array(strings.prefix(Int(argc))), Array(strings.dropFirst(Int(argc))))
    }
}
