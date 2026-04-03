import CoreLocation
import SwiftUI

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
                            Task { await viewModel.refreshTrends(using: appState.apiClient, districtNo: selectedDistrictNo, months: months) }
                        }
                    }
                    .padding(Theme.Spacing.xl)
                }
            case .temperature:
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                        errorBanner
                        MarketTemperatureView(data: viewModel.temperatureData, selectedDistrictNo: $selectedDistrictNo) { districtNo in
                            selectedDistrictNo = districtNo
                            selectedTab = .trends
                        }
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
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
        }
    }

    private var overviewContent: some View {
        GeometryReader { proxy in
            let usePinnedWorkspace = proxy.size.width >= 1120

            Group {
                if usePinnedWorkspace {
                    VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                        errorBanner
                        AnalyticsSummaryBar(viewModel: viewModel)
                        overviewMainContent
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .padding(Theme.Spacing.xl)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                            errorBanner
                            AnalyticsSummaryBar(viewModel: viewModel)
                            overviewMainContent
                        }
                        .padding(Theme.Spacing.xl)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var overviewMainContent: some View {
        if viewModel.isInitialLoading {
            AnalyticsLoadingState()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.baselines.isEmpty {
            AnalyticsEmptyState()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.errorMessage,
           !AppErrorPresentation.isConnectionIssue(message: error) {
            InlineWarningBanner(
                title: "Couldn’t load analytics.",
                message: error,
                actions: [
                    .init("Retry", systemImage: "arrow.clockwise", isProminent: true) {
                        Task { await viewModel.refresh(using: appState.apiClient) }
                    },
                ]
            )
        }
    }
}

private struct AnalyticsSummaryBar: View {
    let viewModel: AnalyticsViewModel

    private let columns = [GridItem(.adaptive(minimum: 170, maximum: 220), spacing: Theme.Spacing.sm)]
    private var items: [AnalyticsSummaryItem] {
        [
            AnalyticsSummaryItem(title: "Total Listings", value: PriceFormatter.formatCompact(viewModel.totalListings), detail: "district baseline sample count", icon: "building.2.fill", tint: .accentColor),
            AnalyticsSummaryItem(title: "Avg Median/m²", value: PriceFormatter.formatPerSqm(viewModel.averagePricePerSqm), detail: "across districts with data", icon: "eurosign.circle.fill", tint: .secondary),
            AnalyticsSummaryItem(title: "Coverage", value: "\(viewModel.districtsWithDataCount)/23", detail: "districts with baseline data", icon: "map.fill", tint: .secondary),
            AnalyticsSummaryItem(title: "Baselines", value: "\(viewModel.baselines.count)", detail: "loaded into analytics", icon: "chart.bar.fill", tint: .secondary),
        ]
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.sm) {
                ForEach(items) { item in
                    AnalyticsSummaryMetric(item: item)
                }
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.sm) {
                ForEach(items) { item in
                    AnalyticsSummaryMetric(item: item)
                }
            }
        }
    }
}

private struct AnalyticsSummaryItem: Identifiable {
    let title: String
    let value: String
    let detail: String
    let icon: String
    let tint: Color

    var id: String { title }
}

private struct AnalyticsSummaryMetric: View {
    let item: AnalyticsSummaryItem

    let title: String
    let value: String
    let detail: String
    let icon: String
    let tint: Color

    init(item: AnalyticsSummaryItem) {
        self.item = item
        title = item.title
        value = item.value
        detail = item.detail
        icon = item.icon
        tint = item.tint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.medium))
                .foregroundStyle(tint)
            Text(value)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(.subtle, padding: Theme.Spacing.sm - 2, cornerRadius: Theme.Radius.lg)
    }
}

private enum AnalyticsMapMetric: String, CaseIterable {
    case price = "Price"
    case temperature = "Temperature"

    var subtitle: String {
        switch self {
        case .price: "Median €/m² by district"
        case .temperature: "Current activity temperature by district"
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
                    HStack(alignment: .top, spacing: Theme.Spacing.md) {
                        AnalyticsDistrictMapCard(
                            districts: districts,
                            mapMetric: $mapMetric,
                            hoveredDistrictNo: $hoveredDistrictNo,
                            selectedDistrictNo: $selectedDistrictNo
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        AnalyticsDistrictSidebar(
                            districts: districts,
                            activeDistrict: activeDistrict,
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
                        .frame(width: min(max(proxy.size.width * 0.245, 288), 308))
                        .frame(maxHeight: .infinity)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else {
                    VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                        AnalyticsDistrictMapCard(
                            districts: districts,
                            mapMetric: $mapMetric,
                            hoveredDistrictNo: $hoveredDistrictNo,
                            selectedDistrictNo: $selectedDistrictNo
                        )
                        .frame(minHeight: 420)

                        AnalyticsDistrictDetailPanel(
                            district: activeDistrict,
                            onOpenTrends: {
                                if let districtNo = activeDistrict?.districtNo {
                                    onOpenTrends(districtNo)
                                }
                            }
                        )

                        AnalyticsDistrictCompactGrid(
                            districts: districts,
                            activeDistrictNo: selectedDistrictNo ?? hoveredDistrictNo,
                            onSelect: { districtNo in
                                if selectedDistrictNo == districtNo {
                                    selectedDistrictNo = nil
                                } else {
                                    selectedDistrictNo = districtNo
                                }
                            }
                        )
                    }
                }
            }
            .animation(.easeInOut(duration: 0.18), value: hoveredDistrictNo)
            .animation(.easeInOut(duration: 0.18), value: selectedDistrictNo)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 620)
    }
}

private struct AnalyticsDistrictMapCard: View {
    let districts: [DistrictSummary]
    @Binding var mapMetric: AnalyticsMapMetric
    @Binding var hoveredDistrictNo: Int?
    @Binding var selectedDistrictNo: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Vienna District Map")
                        .font(.headline)
                    Text("Select a district to focus it, then open trends from the detail rail.")
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
                    Label("Focused", systemImage: "mappin.and.ellipse")
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
            }

            AnalyticsDistrictMap(
                districts: districts,
                mapMetric: mapMetric,
                hoveredDistrictNo: $hoveredDistrictNo,
                selectedDistrictNo: $selectedDistrictNo
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tone: .neutral, elevated: true)
    }
}

private struct AnalyticsPriceScale {
    let districts: [DistrictSummary]

    private let palette: [Color] = [
        Color(red: 0.36, green: 0.52, blue: 0.82),
        Color(red: 0.40, green: 0.69, blue: 0.84),
        Color(red: 0.55, green: 0.67, blue: 0.73),
        Color(red: 0.82, green: 0.66, blue: 0.42),
        Color(red: 0.84, green: 0.46, blue: 0.41),
    ]

    private var sortedValues: [Double] {
        districts.compactMap(\.medianPpsqmEur).sorted()
    }

    private var thresholds: [Double] {
        guard !sortedValues.isEmpty else { return [] }
        return [0.2, 0.4, 0.6, 0.8].map { quantile($0) }
    }

    var legendColors: [Color] {
        palette
    }

    var minLabel: String {
        guard let value = sortedValues.first else { return "—" }
        return PriceFormatter.formatPerSqm(value)
    }

    var maxLabel: String {
        guard let value = sortedValues.last else { return "—" }
        return PriceFormatter.formatPerSqm(value)
    }

    func color(for value: Double?) -> Color {
        guard let value else { return .secondary }
        let bucket = thresholds.firstIndex(where: { value <= $0 }) ?? (palette.count - 1)
        return palette[bucket]
    }

    private func quantile(_ percentile: Double) -> Double {
        guard !sortedValues.isEmpty else { return 0 }
        let position = percentile * Double(sortedValues.count - 1)
        let lowerIndex = Int(position.rounded(.down))
        let upperIndex = Int(position.rounded(.up))
        let lower = sortedValues[lowerIndex]
        let upper = sortedValues[upperIndex]
        guard lowerIndex != upperIndex else { return lower }
        let fraction = position - Double(lowerIndex)
        return lower + ((upper - lower) * fraction)
    }
}

private struct AnalyticsDistrictMap: View {
    let districts: [DistrictSummary]
    let mapMetric: AnalyticsMapMetric
    @Binding var hoveredDistrictNo: Int?
    @Binding var selectedDistrictNo: Int?

    private let boundaries = ViennaDistrictStore.boundaries
    private var priceScale: AnalyticsPriceScale { AnalyticsPriceScale(districts: districts) }

    private var districtLookup: [Int: DistrictSummary] {
        Dictionary(uniqueKeysWithValues: districts.map { ($0.districtNo, $0) })
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
            let effectiveHoveredDistrictNo = selectedDistrictNo == nil ? hoveredDistrictNo : nil

            ZStack {
                RoundedRectangle(cornerRadius: Theme.Radius.xl)
                    .fill(Color.primary.opacity(0.03))

                ForEach(boundaries) { boundary in
                    if let district = districtLookup[boundary.id] {
                        let path = districtPath(for: boundary, in: frame)
                        let isActive = selectedDistrictNo == boundary.id || effectiveHoveredDistrictNo == boundary.id

                        Button {
                            toggleDistrictSelection(boundary.id)
                        } label: {
                            path
                                .fill(fillColor(for: district, isActive: isActive))
                                .overlay {
                                    path.stroke(strokeColor(for: district, isActive: isActive), lineWidth: isActive ? 2 : 1)
                                }
                        }
                        .buttonStyle(.plain)
                            .contentShape(path)
                            .onHover { inside in
                                if selectedDistrictNo == nil {
                                    hoveredDistrictNo = inside ? boundary.id : nil
                                }
                            }
                            .accessibilityElement()
                            .accessibilityLabel(district.districtLabel)
                            .accessibilityValue(isActive ? "Selected" : "Not selected")

                        Text(boundary.id <= 9 ? "\(boundary.id)" : boundary.id.formatted())
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(.black.opacity(isActive ? 0.34 : 0.22), in: Capsule())
                            .foregroundStyle(.white.opacity(isActive ? 0.98 : 0.88))
                            .position(labelPosition(for: boundary, in: frame))
                            .allowsHitTesting(false)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl))
        .animation(.easeInOut(duration: 0.18), value: hoveredDistrictNo)
        .animation(.easeInOut(duration: 0.18), value: selectedDistrictNo)
        .onChange(of: selectedDistrictNo) { _, newValue in
            if newValue != nil {
                hoveredDistrictNo = nil
            }
        }
    }

    private func toggleDistrictSelection(_ districtNo: Int) {
        if selectedDistrictNo == districtNo {
            selectedDistrictNo = nil
        } else {
            selectedDistrictNo = districtNo
        }
        hoveredDistrictNo = nil
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
            guard district.medianPpsqmEur != nil else {
                return Color.secondary.opacity(isActive ? 0.24 : 0.12)
            }
            return priceScale.color(for: district.medianPpsqmEur).opacity(isActive ? 0.92 : 0.78)
        case .temperature:
            let base = mapTemperatureColor(for: district.temperature)
            return base.opacity(isActive ? 0.86 : (district.temperature == nil ? 0.14 : 0.55))
        }
    }

    private func strokeColor(for district: DistrictSummary, isActive: Bool) -> Color {
        if isActive {
            return Color.accentColor.opacity(0.82)
        }
        return district.hasData ? Color.white.opacity(0.42) : .secondary.opacity(0.30)
    }

    private func mapTemperatureColor(for temperature: String?) -> Color {
        switch temperature {
        case "hot": Color(red: 0.88, green: 0.43, blue: 0.39)
        case "warm": Color(red: 0.90, green: 0.67, blue: 0.38)
        case "cool": Color(red: 0.42, green: 0.70, blue: 0.82)
        case "cold": Color(red: 0.54, green: 0.58, blue: 0.67)
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

    private func labelPosition(for boundary: DistrictBoundary, in frame: CGRect) -> CGPoint {
        let center = projectedPoint(for: boundary.boundingBox.center, in: frame)
        let offset = labelOffset(for: boundary.id)
        let rawPoint = CGPoint(x: center.x + offset.width, y: center.y + offset.height)
        let insetX: CGFloat = 20
        let insetY: CGFloat = 16

        return CGPoint(
            x: min(max(rawPoint.x, frame.minX + insetX), frame.maxX - insetX),
            y: min(max(rawPoint.y, frame.minY + insetY), frame.maxY - insetY)
        )
    }
}

private struct AnalyticsMapLegend: View {
    let districts: [DistrictSummary]
    let metric: AnalyticsMapMetric
    private var priceScale: AnalyticsPriceScale { AnalyticsPriceScale(districts: districts) }

    var body: some View {
        switch metric {
        case .price:
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 6) {
                    Text(priceScale.minLabel)
                    HStack(spacing: 4) {
                        ForEach(Array(priceScale.legendColors.enumerated()), id: \.offset) { _, color in
                            RoundedRectangle(cornerRadius: 999)
                                .fill(color)
                                .frame(width: 18, height: 10)
                        }
                    }
                    Text(priceScale.maxLabel)
                }
                .font(.caption2.monospacedDigit())
                Text("Price buckets")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        case .temperature:
            HStack(spacing: Theme.Spacing.xs) {
                AnalyticsLegendDot(color: Color(red: 0.88, green: 0.43, blue: 0.39), label: "Hot")
                AnalyticsLegendDot(color: Color(red: 0.90, green: 0.67, blue: 0.38), label: "Warm")
                AnalyticsLegendDot(color: Color(red: 0.42, green: 0.70, blue: 0.82), label: "Cool")
                AnalyticsLegendDot(color: Color(red: 0.54, green: 0.58, blue: 0.67), label: "Cold")
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

private struct AnalyticsDistrictSidebar: View {
    let districts: [DistrictSummary]
    let activeDistrict: DistrictSummary?
    let activeDistrictNo: Int?
    let onSelect: (Int) -> Void
    let onOpenTrends: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            AnalyticsDistrictDetailPanel(district: activeDistrict) {
                if let districtNo = activeDistrict?.districtNo {
                    onOpenTrends(districtNo)
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(alignment: .firstTextBaseline) {
                    Text("District Snapshot")
                        .font(.headline)
                    Spacer()
                    Text("23 districts")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text("Scan the city, then open trends from the focused district above.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                ScrollView {
                    LazyVStack(spacing: Theme.Spacing.xs) {
                        ForEach(districts) { district in
                            AnalyticsDistrictRow(
                                district: district,
                                isActive: activeDistrictNo == district.districtNo,
                                onSelect: { onSelect(district.districtNo) }
                            )
                        }
                    }
                }
                .scrollIndicators(.visible)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .dashboardPanelStyle(padding: Theme.Spacing.md, cornerRadius: Theme.Dashboard.panelRadius, tone: .neutral)
    }
}

private struct AnalyticsDistrictCompactGrid: View {
    let districts: [DistrictSummary]
    let activeDistrictNo: Int?
    let onSelect: (Int) -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 220, maximum: 320), spacing: Theme.Spacing.xs)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("District Snapshot")
                .font(.headline)
            Text("Select a district, then use the detail panel to open its trend view.")
                .font(.caption)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: Theme.Spacing.xs) {
                ForEach(districts) { district in
                    AnalyticsDistrictRow(
                        district: district,
                        isActive: activeDistrictNo == district.districtNo,
                        onSelect: { onSelect(district.districtNo) }
                    )
                }
            }
        }
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tone: .neutral)
    }
}

private struct AnalyticsDistrictDetailPanel: View {
    let district: DistrictSummary?
    let onOpenTrends: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if let district {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: Theme.Spacing.xs) {
                            Circle()
                                .fill(district.temperatureColor)
                                .frame(width: 8, height: 8)
                            Text("District detail")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        Text(district.districtLabel)
                            .font(.headline)
                        Text(district.hasData ? "Median €/m² and activity snapshot." : "No district baseline yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: Theme.Spacing.md)

                    Text(district.temperatureLabel)
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, Theme.Spacing.sm)
                        .padding(.vertical, 4)
                        .background(district.temperatureColor.opacity(0.12), in: Capsule())
                        .foregroundStyle(district.temperatureColor)
                }

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: Theme.Spacing.sm),
                        GridItem(.flexible(), spacing: Theme.Spacing.sm),
                    ],
                    spacing: Theme.Spacing.xs
                ) {
                    AnalyticsDetailMetric(label: "Median", value: district.medianPpsqmEur.map(PriceFormatter.formatPerSqm) ?? "No data")
                    AnalyticsDetailMetric(label: "Velocity", value: district.velocity.map(PriceFormatter.formatPercent) ?? "—")
                    AnalyticsDetailMetric(label: "P25 / P75", value: percentileValue(for: district))
                    AnalyticsDetailMetric(label: "Sample count", value: district.sampleCount > 0 ? PriceFormatter.formatCompact(district.sampleCount) : "—")
                }

                HStack {
                    Button("Open Trends", action: onOpenTrends)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    Spacer()
                }
            } else {
                ContentUnavailableView {
                    Label("No District Selected", systemImage: "map")
                } description: {
                    Text("Select a district to review pricing and activity, then open trends explicitly.")
                }
                .frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .cardStyle(.subtle, padding: Theme.Spacing.md, cornerRadius: Theme.Radius.lg)
    }

    private func percentileValue(for district: DistrictSummary) -> String {
        guard let p25 = district.p25PpsqmEur, let p75 = district.p75PpsqmEur else { return "—" }
        return "\(PriceFormatter.formatPerSqm(p25)) / \(PriceFormatter.formatPerSqm(p75))"
    }
}

private struct AnalyticsDetailMetric: View {
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
        .padding(.vertical, Theme.Spacing.xs + 2)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

private struct AnalyticsDistrictRow: View {
    let district: DistrictSummary
    let isActive: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: Theme.Spacing.xs) {
                Text(district.shortLabel)
                    .font(.caption2.monospacedDigit().weight(.bold))
                    .foregroundStyle(isActive ? .primary : .secondary)
                    .frame(width: 18, alignment: .leading)

                VStack(alignment: .leading, spacing: 1) {
                    Text(district.snapshotName)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                    Text(district.temperatureLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                Text(district.medianPpsqmEur.map(PriceFormatter.formatPerSqm) ?? "No data")
                    .font(.caption2.monospacedDigit().weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Circle()
                    .fill(district.temperatureColor)
                    .frame(width: 7, height: 7)
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isActive ? district.temperatureColor.opacity(0.10) : Color.primary.opacity(0.03))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(isActive ? district.temperatureColor.opacity(0.45) : Color(nsColor: .separatorColor).opacity(0.14), lineWidth: isActive ? 1.2 : 0.8)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
    }
}

private struct AnalyticsLoadingState: View {
    var body: some View {
        ContentUnavailableView {
            ProgressView("Loading Analytics")
                .controlSize(.regular)
        } description: {
            Text("Fetching market baselines, trends, and district temperature data…")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tone: .neutral)
    }
}

private struct AnalyticsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Analytics Data", systemImage: "chart.bar.xaxis")
        } description: {
            Text("Market baselines will appear here once enough listing data has been collected.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .dashboardPanelStyle(cornerRadius: Theme.Dashboard.panelRadius, tone: .neutral)
    }
}

#Preview {
    AnalyticsView()
        .environment(AppState())
        .frame(width: 1280, height: 820)
}
