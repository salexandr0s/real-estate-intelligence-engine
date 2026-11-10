import Foundation

/// One event from a `text/event-stream` body.
struct ServerSentEvent: Equatable, Sendable {
    /// The `event:` field, or `message` when the event has none.
    let type: String
    /// The event's `data:` lines, joined with newlines.
    let data: String
}

/// Turns the bytes of a `text/event-stream` body into events, following the WHATWG rules: a blank
/// line ends an event, `data:` lines join with newlines, lines starting with `:` are comments, and
/// lines end in LF, CR or CRLF. Bytes can arrive in any split; an event comes out once its blank
/// line arrives. The `id:` and `retry:` fields are ignored, since the server sends neither.
struct ServerSentEventParser {
    private var line: [UInt8] = []
    private var lastByteWasCR = false
    private var eventType = ""
    private var dataLines: [String] = []

    /// Takes the next byte and returns the event it completes, if any.
    mutating func feed(_ byte: UInt8) -> ServerSentEvent? {
        switch byte {
        case UInt8(ascii: "\n") where lastByteWasCR:
            // The LF of a CRLF: the CR already ended the line.
            lastByteWasCR = false
            return nil
        case UInt8(ascii: "\n"), UInt8(ascii: "\r"):
            lastByteWasCR = byte == UInt8(ascii: "\r")
            return endLine()
        default:
            lastByteWasCR = false
            line.append(byte)
            return nil
        }
    }

    /// Takes the next chunk and returns the events it completes, in order.
    mutating func feed(_ chunk: some Sequence<UInt8>) -> [ServerSentEvent] {
        var events: [ServerSentEvent] = []
        for byte in chunk {
            if let event = feed(byte) {
                events.append(event)
            }
        }
        return events
    }

    private mutating func endLine() -> ServerSentEvent? {
        defer { line.removeAll(keepingCapacity: true) }
        guard !line.isEmpty else { return dispatch() }
        // A comment, such as the server's keepalive.
        guard line.first != UInt8(ascii: ":") else { return nil }

        // UTF-8 never uses CR or LF inside a multi-byte character, so a whole line decodes cleanly.
        let colon = line.firstIndex(of: UInt8(ascii: ":"))
        let field = String(decoding: line[..<(colon ?? line.endIndex)], as: UTF8.self)
        var value = colon.map { line[($0 + 1)...] } ?? []
        if value.first == UInt8(ascii: " ") {
            value = value.dropFirst()
        }

        switch field {
        case "event":
            eventType = String(decoding: value, as: UTF8.self)
        case "data":
            dataLines.append(String(decoding: value, as: UTF8.self))
        default:
            break
        }
        return nil
    }

    private mutating func dispatch() -> ServerSentEvent? {
        defer {
            eventType = ""
            dataLines = []
        }
        // An event without data lines carries nothing, so it's dropped.
        guard !dataLines.isEmpty else { return nil }
        return ServerSentEvent(
            type: eventType.isEmpty ? "message" : eventType,
            data: dataLines.joined(separator: "\n")
        )
    }
}
