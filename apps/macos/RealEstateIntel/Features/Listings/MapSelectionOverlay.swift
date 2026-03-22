import MapKit
import SwiftUI

/// Transparent overlay that captures drag gestures to draw a selection rectangle on the map.
/// Uses MapProxy to convert screen coordinates to map coordinates.
struct MapSelectionOverlay: View {
    let proxy: MapProxy
    let onComplete: (MKCoordinateRegion?) -> Void

    @State private var dragStart: CGPoint?
    @State private var dragCurrent: CGPoint?

    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .onHover { hovering in
                if hovering {
                    NSCursor.crosshair.push()
                } else {
                    NSCursor.pop()
                }
            }
            .onDisappear {
                NSCursor.pop()
            }
            .gesture(
                DragGesture(minimumDistance: 5)
                    .onChanged { value in
                        if dragStart == nil {
                            dragStart = value.startLocation
                        }
                        dragCurrent = value.location
                    }
                    .onEnded { value in
                        guard let start = dragStart else { return }
                        let end = value.location

                        var result: MKCoordinateRegion?
                        if let startCoord = proxy.convert(start, from: .local),
                           let endCoord = proxy.convert(end, from: .local) {
                            let region = regionFromCorners(startCoord, endCoord)
                            if region.span.latitudeDelta > 0.0005 && region.span.longitudeDelta > 0.0005 {
                                result = region
                            }
                        }

                        dragStart = nil
                        dragCurrent = nil
                        onComplete(result)
                    }
            )
            .overlay {
                if let start = dragStart, let current = dragCurrent {
                    selectionRect(from: start, to: current)
                }
            }
    }

    private func selectionRect(from start: CGPoint, to end: CGPoint) -> some View {
        let x = min(start.x, end.x)
        let y = min(start.y, end.y)
        let w = abs(end.x - start.x)
        let h = abs(end.y - start.y)

        return Rectangle()
            .fill(Color.accentColor.opacity(0.15))
            .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            .frame(width: w, height: h)
            .position(x: x + w / 2, y: y + h / 2)
    }

    private func regionFromCorners(
        _ a: CLLocationCoordinate2D,
        _ b: CLLocationCoordinate2D
    ) -> MKCoordinateRegion {
        let center = CLLocationCoordinate2D(
            latitude: (a.latitude + b.latitude) / 2,
            longitude: (a.longitude + b.longitude) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: abs(a.latitude - b.latitude),
            longitudeDelta: abs(a.longitude - b.longitude)
        )
        return MKCoordinateRegion(center: center, span: span)
    }
}
