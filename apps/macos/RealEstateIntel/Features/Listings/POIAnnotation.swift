import SwiftUI

/// Small map annotation for POIs, differentiated by category color and icon.
struct POIAnnotation: View {
    let poi: POI

    var body: some View {
        Image(systemName: poi.category.systemImage)
            .font(.system(size: 8))
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(poi.category.tintColor, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 0.5))
    }
}

/// Map annotation for Wien development projects.
struct DevelopmentAnnotation: View {
    let development: WienDevelopment

    var body: some View {
        Image(systemName: "building.2.fill")
            .font(.system(size: 8))
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(statusColor, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(.white, lineWidth: 0.5))
    }

    private var statusColor: Color {
        switch development.status {
        case "genehmigt/laufend": .purple
        case "abgeschlossen": .mint
        case "beantragt": .indigo
        default: .gray
        }
    }
}
