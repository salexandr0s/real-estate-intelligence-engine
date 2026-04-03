import CoreLocation
import Foundation

struct CopilotCoordinate: Codable, Hashable {
    let latitude: Double
    let longitude: Double

    var locationCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
