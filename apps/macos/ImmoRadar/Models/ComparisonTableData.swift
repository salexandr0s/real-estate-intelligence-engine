import Foundation

struct ComparisonTableData: Codable {
    let headers: [String]
    let rows: [ComparisonRow]
}
