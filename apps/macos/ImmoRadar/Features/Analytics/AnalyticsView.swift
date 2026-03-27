import SwiftUI
import CoreLocation

/// Analytics view showing market baselines, trends, and temperature data.
struct AnalyticsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AnalyticsViewModel()
    @State private var selectedTab: AnalyticsTab = .overview
    @State private var selectedDistrictNo: Int? = nil

    enum AnalyticsTab: String, CaseIterable {
        case overview = "Overview"
        case trends = "Trends"
        case temperature = "Temperature"
    }

    var body: some View {
        Group {
            switch selectedTab {
            case .overview:
                overviewContent
            case .trends:
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                        errorBanner
                        DistrictTrendChartView(data: viewModel.trendData, selectedDistrictNo: $selectedDistrictNo) { months in
                            Task { await viewModel.refreshTrends(using: appState.apiClient, months: months) }
                        }
                    }
                    .padding(Theme.Spacing.xl)
                }
            case .temperature:
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                        errorBanner
                        MarketTemperatureView(data: viewModel.temperatureData, selectedDistrictNo: $selectedDistrictNo)
                    }
                    .padding(Theme.Spacing.xl)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .navigationTitle("Analytics")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "analytics") {
            ToolbarItem(id: "tabPicker", placement: .automatic) {
                Picker("Tab", selection: $selectedTab) {
                    ForEach(AnalyticsTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 280)
            }
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
        }
    }

    private var overviewContent: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            errorBanner
            AnalyticsSummaryBar(viewModel: viewModel)

            if viewModel.baselines.isEmpty && !viewModel.isLoading {
                AnalyticsEmptyState()
            } else {
                AnalyticsOverviewPane(
                    districts: viewModel.districtBreakdown,
                    selectedDistrictNo: $selectedDistrictNo,
                    onOpenTrends: { districtNo in
                        selectedDistrictNo = districtNo
                        selectedTab = .trends
                    }
                )
            }
        }
        .padding(Theme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.errorMessage {
            AnalyticsErrorBanner(message: error) {
                Task { await viewModel.refresh(using: appState.apiClient) }
            }
        }
    }
}

// MARK: - Summary Bar

private struct AnalyticsSummaryBar: View {
    let viewModel: AnalyticsViewModel

    private let columns = [
        GridItem(.adaptive(minimum: 180, maximum: 280), spacing: Theme.Spacing.lg)
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.lg) {
            AnalyticsSummaryCard(
                title: "Total Listings",
                value: PriceFormatter.formatCompact(viewModel.totalListings),
                icon: "building.2.fill",
                color: .accentColor
            )

            AnalyticsSummaryCard(
                title: "Avg District Median/m²",
                value: PriceFormatter.formatPerSqm(viewModel.averagePricePerSqm),
                icon: "eurosign.circle.fill",
                color: .green
            )

            AnalyticsSummaryCard(
                title: "Coverage",
                value: "\(viewModel.districtsWithDataCount)/23",
                icon: "map.fill",
                color: .orange
            )

            AnalyticsSummaryCard(
                title: "Baselines",
                value: "\(viewModel.baselines.count)",
                icon: "chart.bar.fill",
                color: .purple
            )
        }
    }
}

private struct AnalyticsSummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .font(.caption)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(value)
                .font(.title2)
                .fontWeight(.semibold)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dashboardPanelStyle(padding: Theme.Spacing.md, cornerRadius: Theme.Radius.lg, tint: color)
    }
}

// MARK: - Overview Pane

private enum AnalyticsMapMetric: String, CaseIterable {
    case price = "Price"
    case temperature = "Temperature"

    var subtitle: String {
        switch self {
        case .price: "Colors reflect median €/m²."
        case .temperature: "Colors reflect listing velocity temperature."
        }
    }
}

private struct AnalyticsOverviewPane: View {
    let districts: [DistrictSummary]
    @Binding var selectedDistrictNo: Int?
    let onOpenTrends: (Int) -> Void

    @State private var hoveredDistrictNo: Int?
    @State private var mapMetric: AnalyticsMapMetric = .price

    private var activeDistrict: DistrictSummary? {
        if let selectedDistrictNo {
            return districts.first(where: { $0.districtNo == selectedDistrictNo })
        }
        if let hoveredDistrictNo {
            return districts.first(where: { $0.districtNo == hoveredDistrictNo })
        }
        return districts.first(where: \.hasData) ?? districts.first
    }

    var body: some View {
        GeometryReader { proxy in
            let useSideBySide = proxy.size.width >= 1120

            Group {
                if useSideBySide {
                    HStack(alignment: .top, spacing: Theme.Spacing.xl) {
                        AnalyticsDistrictMapCard(
                            districts: districts,
                            mapMetric: $mapMetric,
                            hoveredDistrictNo: $hoveredDistrictNo,
                            selectedDistrictNo: $selectedDistrictNo,
                            onOpenTrends: onOpenTrends
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        AnalyticsDistrictListPanel(
                            districts: districts,
                            activeDistrictNo: selectedDistrictNo ?? hoveredDistrictNo,
                            onSelect: { districtNo in
                                if selectedDistrictNo == districtNo {
                                    selectedDistrictNo = nil
                                } else {
                                    selectedDistrictNo = districtNo
                                }
                            },
                            onOpenTrends: onOpenTrends
                        )
                        .frame(width: min(max(proxy.size.width * 0.28, 300), 360))
                    }
                } else {
                    VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                        AnalyticsDistrictMapCard(
                            districts: districts,
                            mapMetric: $mapMetric,
                            hoveredDistrictNo: $hoveredDistrictNo,
                            selectedDistrictNo: $selectedDistrictNo,
                            onOpenTrends: onOpenTrends
                        )
                        .frame(minHeight: 420)

                        AnalyticsDistrictCompactGrid(
                            districts: districts,
                            activeDistrictNo: selectedDistrictNo ?? hoveredDistrictNo,
                            onSelect: { districtNo in
                                if selectedDistrictNo == districtNo {
                                    selectedDistrictNo = nil
                                } else {
                                    selectedDistrictNo = districtNo
                                }
                            },
                            onOpenTrends: onOpenTrends
                        )
                    }
                }
            }
            .animation(.easeInOut(duration: 0.18), value: hoveredDistrictNo)
            .animation(.easeInOut(duration: 0.18), value: selectedDistrictNo)
            .overlay(alignment: .bottomLeading) {
                if let activeDistrict {
                    AnalyticsDistrictSelectionFootnote(district: activeDistrict)
                        .padding(Theme.Spacing.md)
                }
            }
        }
    }
}

private struct AnalyticsDistrictSelectionFootnote: View {
    let district: DistrictSummary

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Circle()
                .fill(district.temperatureColor)
                .frame(width: 8, height: 8)
            Text("Hover for pricing • click to pin • double-click for trends: \(district.districtLabel)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xs)
        .background(.ultraThinMaterial, in: Capsule())
    }
}

// MARK: - District Map

private struct AnalyticsDistrictMapCard: View {
    let districts: [DistrictSummary]
    @Binding var mapMetric: AnalyticsMapMetric
    @Binding var hoveredDistrictNo: Int?
    @Binding var selectedDistrictNo: Int?
    let onOpenTrends: (Int) -> Void
    @State private var tooltipAnchor: CGPoint?
    @State private var mapSize: CGSize = .zero

    private var activeDistrict: DistrictSummary? {
        if let selectedDistrictNo {
            return districts.first(where: { $0.districtNo == selectedDistrictNo })
        }
        if let hoveredDistrictNo {
            return districts.first(where: { $0.districtNo == hoveredDistrictNo })
        }
        return districts.first(where: \.hasData) ?? districts.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Vienna District Heatmap")
                        .font(.headline)
                    Text("All 23 districts are visible at once. \(mapMetric.subtitle)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Map metric", selection: $mapMetric) {
                    ForEach(AnalyticsMapMetric.allCases, id: \.self) { metric in
                        Text(metric.rawValue).tag(metric)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 220)
                AnalyticsMapLegend(districts: districts, metric: mapMetric)
            }

            if let selectedDistrictNo,
               let district = districts.first(where: { $0.districtNo == selectedDistrictNo }) {
                HStack(spacing: Theme.Spacing.sm) {
                    Label("Pinned", systemImage: "mappin.and.ellipse")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(district.districtLabel)
                        .font(.caption.monospacedDigit().weight(.semibold))
                    Spacer()
                    Button("Clear") {
                        self.selectedDistrictNo = nil
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Color.primary.opacity(0.04), in: Capsule())
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    AnalyticsDistrictMap(
                        districts: districts,
                        mapMetric: mapMetric,
                        hoveredDistrictNo: $hoveredDistrictNo,
                        selectedDistrictNo: $selectedDistrictNo,
                        tooltipAnchor: $tooltipAnchor,
                        mapSize: $mapSize,
                        onOpenTrends: onOpenTrends
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    if let activeDistrict {
                        AnalyticsDistrictTooltip(district: activeDistrict, onOpenTrends: {
                            onOpenTrends(activeDistrict.districtNo)
                        })
                            .position(tooltipPosition(in: proxy.size))
                            .transition(.scale(scale: 0.96).combined(with: .opacity))
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tint: .accentColor, elevated: true)
    }

    private func tooltipPosition(in size: CGSize) -> CGPoint {
        let fallback = CGPoint(x: 170, y: 110)
        guard let anchor = tooltipAnchor else { return fallback }

        let tooltipSize = CGSize(width: 280, height: 168)
        let desiredX = anchor.x + 150
        let desiredY = anchor.y - 70

        return CGPoint(
            x: min(max(desiredX, tooltipSize.width / 2 + 14), size.width - tooltipSize.width / 2 - 14),
            y: min(max(desiredY, tooltipSize.height / 2 + 14), size.height - tooltipSize.height / 2 - 14)
        )
    }
}

private struct AnalyticsDistrictMap: View {
    let districts: [DistrictSummary]
    let mapMetric: AnalyticsMapMetric
    @Binding var hoveredDistrictNo: Int?
    @Binding var selectedDistrictNo: Int?
    @Binding var tooltipAnchor: CGPoint?
    @Binding var mapSize: CGSize
    let onOpenTrends: (Int) -> Void

    private let boundaries = ViennaDistrictStore.boundaries

    private var districtLookup: [Int: DistrictSummary] {
        Dictionary(uniqueKeysWithValues: districts.map { ($0.districtNo, $0) })
    }

    private var medianRange: ClosedRange<Double> {
        let values = districts.compactMap(\.medianPpsqmEur)
        let minValue = values.min() ?? 0
        let maxValue = max(values.max() ?? 1, minValue + 1)
        return minValue...maxValue
    }

    private var mapBounds: (minLon: Double, maxLon: Double, minLat: Double, maxLat: Double) {
        let coords = boundaries.flatMap(\.polygons).flatMap { $0 }
        let minLon = coords.map(\.longitude).min() ?? 16.18
        let maxLon = coords.map(\.longitude).max() ?? 16.58
        let minLat = coords.map(\.latitude).min() ?? 48.10
        let maxLat = coords.map(\.latitude).max() ?? 48.33
        return (minLon, maxLon, minLat, maxLat)
    }

    var body: some View {
        GeometryReader { proxy in
            let frame = projectedFrame(in: proxy.size)

            ZStack {
                RoundedRectangle(cornerRadius: Theme.Radius.xl)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.accentColor.opacity(0.08),
                                Color.purple.opacity(0.06),
                                Color.clear,
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                ForEach(boundaries) { boundary in
                    if let district = districtLookup[boundary.id] {
                        let path = districtPath(for: boundary, in: frame)
                        let isActive = selectedDistrictNo == boundary.id || hoveredDistrictNo == boundary.id

                        path
                            .fill(fillColor(for: district, isActive: isActive))
                            .shadow(
                                color: (selectedDistrictNo == boundary.id ? district.temperatureColor : .clear).opacity(0.45),
                                radius: selectedDistrictNo == boundary.id ? 14 : 0,
                                y: 0
                            )
                            .overlay {
                                path
                                    .stroke(
                                        hoveredDistrictNo == boundary.id && selectedDistrictNo != boundary.id
                                            ? Color.white.opacity(0.18)
                                            : .clear,
                                        lineWidth: hoveredDistrictNo == boundary.id && selectedDistrictNo != boundary.id ? 7 : 0
                                    )
                                path
                                    .stroke(strokeColor(for: district, isActive: isActive), lineWidth: isActive ? 2.2 : 1)
                            }
                            .contentShape(path)
                            .onHover { inside in
                                if inside {
                                    hoveredDistrictNo = boundary.id
                                } else if hoveredDistrictNo == boundary.id {
                                    hoveredDistrictNo = nil
                                }
                            }
                            .onTapGesture {
                                if selectedDistrictNo == boundary.id {
                                    selectedDistrictNo = nil
                                } else {
                                    selectedDistrictNo = boundary.id
                                }
                            }
                            .simultaneousGesture(
                                TapGesture(count: 2).onEnded {
                                    selectedDistrictNo = boundary.id
                                    onOpenTrends(boundary.id)
                                }
                            )

                        let center = projectedPoint(for: boundary.boundingBox.center, in: frame)
                        let offset = labelOffset(for: boundary.id)
                        Text(boundary.id <= 9 ? "\(boundary.id)" : boundary.id.formatted())
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(.black.opacity(isActive ? 0.42 : 0.30), in: Capsule())
                            .foregroundStyle(.white.opacity(isActive ? 0.98 : 0.90))
                            .shadow(color: .black.opacity(0.28), radius: 2, y: 1)
                            .position(x: center.x + offset.width, y: center.y + offset.height)
                            .scaleEffect(isActive ? 1.08 : (hoveredDistrictNo == boundary.id ? 1.04 : 1))
                            .allowsHitTesting(false)

                        if selectedDistrictNo == boundary.id {
                            Text(district.districtName)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, Theme.Spacing.xs)
                                .padding(.vertical, 3)
                                .background(.ultraThinMaterial, in: Capsule())
                                .overlay {
                                    Capsule()
                                        .strokeBorder(.white.opacity(0.16), lineWidth: 0.5)
                                }
                                .position(
                                    x: center.x + offset.width,
                                    y: center.y + offset.height + 20
                                )
                                .allowsHitTesting(false)
                                .transition(.opacity.combined(with: .scale))
                        }
                    }
                }
            }
            .onAppear {
                mapSize = proxy.size
                updateTooltipAnchor()
            }
            .onChange(of: proxy.size) { _, newSize in
                mapSize = newSize
                updateTooltipAnchor()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl))
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: hoveredDistrictNo)
        .animation(.spring(response: 0.32, dampingFraction: 0.84), value: selectedDistrictNo)
        .onChange(of: hoveredDistrictNo) { _, _ in
            updateTooltipAnchor()
        }
        .onChange(of: selectedDistrictNo) { _, _ in
            updateTooltipAnchor()
        }
        .onAppear {
            updateTooltipAnchor()
        }
    }

    private func projectedFrame(in size: CGSize) -> CGRect {
        let padding: CGFloat = 18
        let bounds = mapBounds
        let lonSpan = max(bounds.maxLon - bounds.minLon, 0.0001)
        let latSpan = max(bounds.maxLat - bounds.minLat, 0.0001)

        let availableWidth = max(size.width - padding * 2, 1)
        let availableHeight = max(size.height - padding * 2, 1)
        let scale = min(availableWidth / lonSpan, availableHeight / latSpan)

        let width = lonSpan * scale
        let height = latSpan * scale

        let originX = (size.width - width) / 2
        let originY = (size.height - height) / 2
        return CGRect(x: originX, y: originY, width: width, height: height)
    }

    private func projectedPoint(for coordinate: CLLocationCoordinate2D, in frame: CGRect) -> CGPoint {
        let bounds = mapBounds
        let xRatio = (coordinate.longitude - bounds.minLon) / max(bounds.maxLon - bounds.minLon, 0.0001)
        let yRatio = (bounds.maxLat - coordinate.latitude) / max(bounds.maxLat - bounds.minLat, 0.0001)

        return CGPoint(
            x: frame.minX + (frame.width * xRatio),
            y: frame.minY + (frame.height * yRatio)
        )
    }

    private func districtPath(for boundary: DistrictBoundary, in frame: CGRect) -> Path {
        var path = Path()

        for polygon in boundary.polygons {
            guard let first = polygon.first else { continue }
            path.move(to: projectedPoint(for: first, in: frame))
            for coordinate in polygon.dropFirst() {
                path.addLine(to: projectedPoint(for: coordinate, in: frame))
            }
            path.closeSubpath()
        }

        return path
    }

    private func fillColor(for district: DistrictSummary, isActive: Bool) -> Color {
        switch mapMetric {
        case .price:
            guard let median = district.medianPpsqmEur else {
                return Color.secondary.opacity(isActive ? 0.30 : 0.16)
            }

            let range = medianRange
            let span = max(range.upperBound - range.lowerBound, 1)
            let normalized = (median - range.lowerBound) / span
            let eased = pow(normalized, 0.82)
            let hue = 0.60 - (eased * 0.30)
            let saturation = min(0.58 + (eased * 0.28) + (isActive ? 0.08 : 0), 0.95)
            let brightness = min(0.82 + (eased * 0.11) + (isActive ? 0.04 : 0), 0.98)
            return Color(hue: hue, saturation: saturation, brightness: brightness)
        case .temperature:
            let base = mapTemperatureColor(for: district.temperature)
            return base.opacity(isActive ? 0.90 : (district.temperature == nil ? 0.18 : 0.72))
        }
    }

    private func strokeColor(for district: DistrictSummary, isActive: Bool) -> Color {
        if isActive {
            return .white.opacity(0.98)
        }
        return district.hasData ? .white.opacity(0.35) : .secondary.opacity(0.4)
    }

    private func mapTemperatureColor(for temperature: String?) -> Color {
        switch temperature {
        case "hot": Color(red: 0.98, green: 0.37, blue: 0.33)
        case "warm": Color(red: 0.97, green: 0.66, blue: 0.28)
        case "cool": Color(red: 0.34, green: 0.77, blue: 0.84)
        case "cold": Color(red: 0.38, green: 0.47, blue: 0.63)
        default: .secondary
        }
    }

    private func labelOffset(for districtNo: Int) -> CGSize {
        switch districtNo {
        case 1: CGSize(width: -8, height: -12)
        case 2: CGSize(width: 16, height: -8)
        case 3: CGSize(width: 18, height: 12)
        case 4: CGSize(width: -2, height: 14)
        case 5: CGSize(width: -18, height: 10)
        case 6: CGSize(width: -18, height: -2)
        case 7: CGSize(width: -14, height: -14)
        case 8: CGSize(width: 0, height: -20)
        case 9: CGSize(width: 14, height: -18)
        case 20: CGSize(width: 18, height: -4)
        default: .zero
        }
    }

    private func updateTooltipAnchor() {
        let activeDistrictNo = selectedDistrictNo ?? hoveredDistrictNo
        guard let activeDistrictNo,
              let boundary = boundaries.first(where: { $0.id == activeDistrictNo }) else {
            tooltipAnchor = nil
            return
        }

        let center = boundary.boundingBox.center
        let frame = projectedFrame(in: mapSize == .zero ? CGSize(width: 900, height: 620) : mapSize)
        let point = projectedPoint(for: center, in: frame)
        let offset = labelOffset(for: boundary.id)
        tooltipAnchor = CGPoint(x: point.x + offset.width, y: point.y + offset.height)
    }
}

private struct AnalyticsDistrictTooltip: View {
    let district: DistrictSummary
    let onOpenTrends: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: Theme.Spacing.xs) {
                        Circle()
                            .fill(district.temperatureColor)
                            .frame(width: 8, height: 8)
                        Text("District snapshot")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Text(district.districtLabel)
                        .font(.headline)
                    Text(district.hasData ? "Median €/m² and current activity" : "No district baseline yet")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: Theme.Spacing.md)

                Text(district.temperatureLabel)
                    .font(.caption.bold())
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, 3)
                    .background(district.temperatureColor.opacity(0.16))
                    .foregroundStyle(district.temperatureColor)
                    .clipShape(Capsule())
            }

            Divider()

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: Theme.Spacing.sm),
                    GridItem(.flexible(), spacing: Theme.Spacing.sm),
                ],
                spacing: Theme.Spacing.sm
            ) {
                AnalyticsTooltipMetricCard(
                    label: "Median",
                    value: district.medianPpsqmEur.map(PriceFormatter.formatPerSqm) ?? "No data"
                )
                AnalyticsTooltipMetricCard(
                    label: "Velocity",
                    value: district.velocity.map(PriceFormatter.formatPercent) ?? "—"
                )
                AnalyticsTooltipMetricCard(
                    label: "P25 / P75",
                    value: percentileValue
                )
                AnalyticsTooltipMetricCard(
                    label: "Sample count",
                    value: district.sampleCount > 0 ? PriceFormatter.formatCompact(district.sampleCount) : "—"
                )
            }

            HStack {
                Spacer()
                Button {
                    onOpenTrends()
                } label: {
                    Label("View trends", systemImage: "chart.line.uptrend.xyaxis")
                }
                .buttonStyle(.link)
                .font(.caption.weight(.semibold))
            }
        }
        .frame(width: 280, alignment: .leading)
        .padding(Theme.Spacing.md)
        .background(
            LinearGradient(
                colors: [
                    district.temperatureColor.opacity(0.18),
                    Color(nsColor: .controlBackgroundColor).opacity(0.96),
                    Color(nsColor: .controlBackgroundColor).opacity(0.90),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: Theme.Radius.lg)
        )
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(.white.opacity(0.12), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
    }

    private var percentileValue: String {
        guard let p25 = district.p25PpsqmEur, let p75 = district.p75PpsqmEur else {
            return "—"
        }
        return "\(PriceFormatter.formatPerSqm(p25)) / \(PriceFormatter.formatPerSqm(p75))"
    }
}

private struct AnalyticsTooltipMetricCard: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
        }
    }
}

private struct AnalyticsMapLegend: View {
    let districts: [DistrictSummary]
    let metric: AnalyticsMapMetric

    private var priceRange: ClosedRange<Double>? {
        let values = districts.compactMap(\.medianPpsqmEur)
        guard let minValue = values.min(), let maxValue = values.max() else { return nil }
        return minValue...max(maxValue, minValue + 1)
    }

    var body: some View {
        switch metric {
        case .price:
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 6) {
                    Text(priceRange.map { PriceFormatter.formatPerSqm($0.lowerBound) } ?? "—")
                    RoundedRectangle(cornerRadius: 999)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(hue: 0.61, saturation: 0.68, brightness: 0.82),
                                    Color(hue: 0.50, saturation: 0.72, brightness: 0.84),
                                    Color(hue: 0.39, saturation: 0.76, brightness: 0.88),
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: 96, height: 10)
                    Text(priceRange.map { PriceFormatter.formatPerSqm($0.upperBound) } ?? "—")
                }
                .font(.caption2.monospacedDigit())
                Text("Price heat")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        case .temperature:
            HStack(spacing: Theme.Spacing.xs) {
                AnalyticsLegendDot(color: Color(red: 0.98, green: 0.37, blue: 0.33), label: "Hot")
                AnalyticsLegendDot(color: Color(red: 0.97, green: 0.66, blue: 0.28), label: "Warm")
                AnalyticsLegendDot(color: Color(red: 0.34, green: 0.77, blue: 0.84), label: "Cool")
                AnalyticsLegendDot(color: Color(red: 0.38, green: 0.47, blue: 0.63), label: "Cold")
            }
            .font(.caption2)
        }
    }
}

private struct AnalyticsLegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - District Companion Panels

private struct AnalyticsDistrictListPanel: View {
    let districts: [DistrictSummary]
    let activeDistrictNo: Int?
    let onSelect: (Int) -> Void
    let onOpenTrends: (Int) -> Void

    private let columns = [
        GridItem(.flexible(minimum: 132), spacing: Theme.Spacing.xs),
        GridItem(.flexible(minimum: 132), spacing: Theme.Spacing.xs),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("District Snapshot")
                    .font(.headline)
                Text("Dense 23-district matrix for quick scanning.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: columns, spacing: Theme.Spacing.xs) {
                ForEach(districts) { district in
                    AnalyticsDistrictRow(
                        district: district,
                        isActive: activeDistrictNo == district.districtNo,
                        onSelect: { onSelect(district.districtNo) },
                        onOpenTrends: { onOpenTrends(district.districtNo) }
                    )
                }
            }
            Spacer(minLength: 0)
        }
        .dashboardPanelStyle(padding: Theme.Spacing.md, cornerRadius: Theme.Dashboard.panelRadius, tint: .purple)
    }
}

private struct AnalyticsDistrictCompactGrid: View {
    let districts: [DistrictSummary]
    let activeDistrictNo: Int?
    let onSelect: (Int) -> Void
    let onOpenTrends: (Int) -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 220, maximum: 320), spacing: Theme.Spacing.xs)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("District Snapshot")
                .font(.headline)

            LazyVGrid(columns: columns, spacing: Theme.Spacing.xs) {
                ForEach(districts) { district in
                    AnalyticsDistrictRow(
                        district: district,
                        isActive: activeDistrictNo == district.districtNo,
                        onSelect: { onSelect(district.districtNo) },
                        onOpenTrends: { onOpenTrends(district.districtNo) }
                    )
                }
            }
        }
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tint: .purple)
    }
}

private struct AnalyticsDistrictRow: View {
    let district: DistrictSummary
    let isActive: Bool
    let onSelect: () -> Void
    let onOpenTrends: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: Theme.Spacing.xs) {
                Text(district.shortLabel)
                    .font(.caption2.monospacedDigit().weight(.bold))
                    .frame(width: 16, alignment: .leading)
                    .foregroundStyle(isActive ? .primary : .secondary)

                VStack(alignment: .leading, spacing: 1) {
                    Text(district.snapshotName)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                    Text(district.medianPpsqmEur.map(PriceFormatter.formatPerSqm) ?? "No data")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: Theme.Spacing.xs)

                Circle()
                    .fill(district.temperatureColor)
                    .frame(width: 7, height: 7)
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(borderColor, lineWidth: isActive ? 1 : 0.5)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            TapGesture(count: 2).onEnded {
                onOpenTrends()
            }
        )
    }

    private var rowBackground: some ShapeStyle {
        if isActive {
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        district.temperatureColor.opacity(0.18),
                        Color.accentColor.opacity(0.10),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
        }
        return AnyShapeStyle(Color.primary.opacity(0.03))
    }

    private var borderColor: Color {
        isActive ? district.temperatureColor.opacity(0.55) : Color(nsColor: .separatorColor).opacity(0.15)
    }
}

// MARK: - Empty State

private struct AnalyticsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Analytics Data", systemImage: "chart.bar.xaxis")
        } description: {
            Text("Market baselines will appear here once enough listing data has been collected.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius)
    }
}

// MARK: - Error Banner

private struct AnalyticsErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)

            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Spacer()

            Button("Retry", action: onRetry)
                .controlSize(.small)
        }
        .padding(Theme.Spacing.md)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

#Preview {
    AnalyticsView()
        .environment(AppState())
        .frame(width: 1280, height: 820)
}
