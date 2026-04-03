import SwiftUI

/// Saved search filters management with list, toggle, edit, test, duplicate, and delete.
struct FiltersView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = FiltersViewModel()
    @State private var showTestError: Bool = false

    var body: some View {
        Group {
            if viewModel.filters.isEmpty && !viewModel.isLoading {
                FiltersEmptyState {
                    viewModel.startNewFilter()
                }
            } else {
                FiltersList(viewModel: viewModel, appState: appState)
            }
        }
        .navigationTitle("Filters")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                if viewModel.isLoading || viewModel.isTestingFilter {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .toolbar(id: "filters") {
            ToolbarItem(id: "refresh", placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh filters")
            }
            ToolbarItem(id: "newFilter", placement: .automatic) {
                Button {
                    viewModel.startNewFilter()
                } label: {
                    Label("New Filter", systemImage: "plus")
                }
                .help("Create a new filter")
            }
        }
        .sheet(item: $viewModel.editorPresentation) { presentation in
            FilterEditorSheet(
                viewModel: viewModel,
                presentation: presentation
            )
        }
        .sheet(item: $viewModel.testResultsPresentation) { _ in
            FilterTestResultsSheet(viewModel: viewModel)
        }
        .task {
            guard appState.allowsAutomaticFeatureLoads else { return }
            await viewModel.refresh(using: appState.apiClient)
        }
        .onChange(of: viewModel.testErrorMessage) { _, newValue in
            showTestError = newValue != nil
        }
        .alert("Test Failed", isPresented: $showTestError) {
            Button("OK", role: .cancel) { viewModel.testErrorMessage = nil }
        } message: {
            if let msg = viewModel.testErrorMessage {
                Text(msg)
            }
        }
    }
}

// MARK: - Empty State

private struct FiltersEmptyState: View {
    let onCreate: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No Filters", systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text("Create a filter to track listings matching your investment criteria.")
        } actions: {
            Button("New Filter", action: onCreate)
                .buttonStyle(.borderedProminent)
        }
    }
}

// MARK: - Filters List

private struct FiltersList: View {
    @Bindable var viewModel: FiltersViewModel
    let appState: AppState
    @Environment(\.undoManager) private var undoManager
    @State private var selectedFilterID: Int?

    var body: some View {
        List(selection: $selectedFilterID) {
            ForEach(viewModel.filters) { filter in
                FilterRow(
                    filter: filter,
                    isTesting: viewModel.isTestingFilter && viewModel.testingFilterId == filter.id,
                    onToggle: { Task { await viewModel.toggleActive(filter, using: appState.apiClient) } },
                    onEdit: { viewModel.startEditing(filter) },
                    onTest: {
                        Task { await viewModel.testFilter(filter, using: appState.apiClient) }
                    }
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        Task { await viewModel.deleteFilter(filter, using: appState.apiClient, undoManager: undoManager) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .leading) {
                    Button {
                        viewModel.startEditing(filter)
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    .tint(.accentColor)
                }
                .contextMenu {
                    Button {
                        viewModel.startEditing(filter)
                    } label: {
                        Label("Edit Filter", systemImage: "pencil")
                    }

                    Button {
                        Task { await viewModel.testFilter(filter, using: appState.apiClient) }
                    } label: {
                        Label("Test Filter", systemImage: "magnifyingglass")
                    }

                    Button {
                        viewModel.duplicateFilter(filter)
                    } label: {
                        Label("Duplicate Filter", systemImage: "doc.on.doc")
                    }

                    Button {
                        Task { await viewModel.toggleActive(filter, using: appState.apiClient) }
                    } label: {
                        Label(
                            filter.isActive ? "Deactivate" : "Activate",
                            systemImage: filter.isActive ? "pause.circle" : "play.circle"
                        )
                    }

                    Divider()

                    Button(role: .destructive) {
                        Task { await viewModel.deleteFilter(filter, using: appState.apiClient, undoManager: undoManager) }
                    } label: {
                        Label("Delete Filter", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
        .onDeleteCommand {
            if let id = selectedFilterID,
               let filter = viewModel.filters.first(where: { $0.id == id }) {
                Task { await viewModel.deleteFilter(filter, using: appState.apiClient, undoManager: undoManager) }
                selectedFilterID = nil
            }
        }
    }
}

// MARK: - Filter Row

private struct FilterRow: View {
    let filter: Filter
    let isTesting: Bool
    let onToggle: () -> Void
    let onEdit: () -> Void
    let onTest: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Active toggle
            Button(
                filter.isActive ? "Deactivate Filter" : "Activate Filter",
                systemImage: filter.isActive ? "checkmark.circle.fill" : "circle",
                action: onToggle
            )
            .labelStyle(.iconOnly)
            .font(.caption)
            .foregroundStyle(filter.isActive ? .green : .secondary)
            .buttonStyle(.plain)
            .accessibilityValue(filter.isActive ? "Active" : "Inactive")
            .help(filter.isActive ? "Filter active" : "Filter inactive")

            // Filter info
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(filter.name)
                    .font(.body)
                    .adaptiveFontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: Theme.Spacing.sm) {
                    if let matchCount = filter.matchCount {
                        Label("\(matchCount) matches", systemImage: "number")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Label(filter.alertFrequency.displayName, systemImage: "bell")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Label(filter.filterKind == .alert ? "Alert" : "Saved", systemImage: filter.filterKind == .alert ? "bell.badge" : "bookmark")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            HStack(spacing: Theme.Spacing.xs) {
                Button("Edit", systemImage: "pencil", action: onEdit)
                    .font(.caption)
                    .buttonStyle(.borderless)
                    .help("Edit filter")

                if isTesting {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button("Test Filter", systemImage: "magnifyingglass", action: onTest)
                        .labelStyle(.iconOnly)
                        .font(.caption)
                        .buttonStyle(.borderless)
                        .help("Test filter against current listings")
                }
            }

            // Match count badge
            if let matchCount = filter.matchCount, matchCount > 0 {
                Text("\(matchCount)")
                    .font(.caption)
                    .adaptiveFontWeight(.semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, Theme.Spacing.xxs)
                    .background(filter.isActive ? Color.accentColor : Color.gray)
                    .clipShape(Capsule())
            }

            // Alert frequency
            Text(filter.alertFrequency.displayName)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .trailing)
        }
        .padding(.vertical, Theme.Spacing.xs)
        .background(isHovered ? Color(nsColor: .separatorColor).opacity(0.05) : .clear)
        .onHover { isHovered = $0 }
        .contentShape(Rectangle())
    }
}

// MARK: - Filter Test Results Sheet

private struct FilterTestResultsSheet: View {
    let viewModel: FiltersViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Test Results")
                    .font(.headline)
                Spacer()
                Text("^[\(viewModel.testResultListings.count) match](inflect: true)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Theme.Spacing.lg)

            Divider()

            if viewModel.testResultListings.isEmpty {
                ContentUnavailableView(
                    "No Matches",
                    systemImage: "magnifyingglass",
                    description: Text("This filter did not match any current listings.")
                )
            } else {
                List(viewModel.testResultListings) { listing in
                    HStack(spacing: Theme.Spacing.md) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                            Text(listing.title)
                                .font(.body)
                                .lineLimit(2)
                            HStack(spacing: Theme.Spacing.sm) {
                                if let district = listing.districtName {
                                    Text(district)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if let area = listing.livingAreaSqm {
                                    Text(PriceFormatter.formatArea(area))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if let rooms = listing.rooms {
                                    Text("\(PriceFormatter.formatRooms(rooms)) rooms")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: Theme.Spacing.xxs) {
                            Text(PriceFormatter.format(eur: listing.listPriceEur))
                                .font(.subheadline)
                                .adaptiveFontWeight(.semibold)
                            if let score = listing.currentScore {
                                HStack(spacing: Theme.Spacing.xs) {
                                    Circle()
                                        .fill(Theme.scoreColor(for: score))
                                        .frame(width: 8, height: 8)
                                    Text("\(score.formatted(.number.precision(.fractionLength(1))))")
                                        .font(.caption)
                                        .adaptiveFontWeight(.medium)
                                }
                            }
                        }
                    }
                    .padding(.vertical, Theme.Spacing.xxs)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            }
        }
        .frame(width: 560, height: 480)
    }
}

// MARK: - Filter Editor Sheet

private struct FilterEditorSheet: View {
    let viewModel: FiltersViewModel
    let editingFilter: Filter?
    @State private var draft: FilterDraft
    @State private var showsValidation = false
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    init(viewModel: FiltersViewModel, presentation: FilterEditorPresentation) {
        self.viewModel = viewModel
        self.editingFilter = presentation.editingFilter
        self._draft = State(initialValue: presentation.initialDraft)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text(editingFilter != nil ? "Edit Filter" : "New Filter")
                        .font(.headline)
                    Text("Define the exact listings that should earn a place in your investor queue.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Theme.Spacing.lg)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    FilterCriteriaSummaryCard(summary: draft.summaryText)

                    FilterBuilderSection(
                        title: "Goal",
                        subtitle: "Name the investment thesis you want the app to watch for."
                    ) {
                        TextField("e.g. Vienna Value Apartments", text: $draft.name)
                            .textFieldStyle(.roundedBorder)

                        if let error = draft.nameError, showsValidation {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }

                    FilterBuilderSection(
                        title: "Acquisition target",
                        subtitle: "Start with the market segment: operation, property type, and Vienna districts."
                    ) {
                        HStack(spacing: Theme.Spacing.lg) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                                Text("Operation")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Picker("Operation", selection: $draft.operationType) {
                                    Text("Any").tag(Optional<OperationType>.none)
                                    ForEach(OperationType.allCases, id: \.self) { opType in
                                        Text(opType.rawValue.capitalized).tag(Optional(opType))
                                    }
                                }
                                .labelsHidden()
                                .pickerStyle(.menu)
                                .frame(width: 140)
                            }

                            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                                Text("Alert cadence")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Picker("Frequency", selection: $draft.alertFrequency) {
                                    ForEach(AlertFrequency.allCases, id: \.self) { freq in
                                        Text(freq.displayName).tag(freq)
                                    }
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                            }
                        }

                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Property types")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            PropertyTypeGrid(draft: draft)
                        }

                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Vienna districts")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            DistrictGrid(selected: $draft.selectedDistricts)
                        }
                    }

                    FilterBuilderSection(
                        title: "Budget and size",
                        subtitle: "Define the rough envelope of listings that should qualify."
                    ) {
                        HStack(spacing: Theme.Spacing.lg) {
                            numericField("Min Price (EUR)", value: $draft.minPriceEur, prompt: "100000")
                            numericField("Max Price (EUR)", value: $draft.maxPriceEur, prompt: "350000")
                        }

                        if let error = draft.priceRangeError, showsValidation {
                            Text(error).font(.caption).foregroundStyle(.red)
                        }

                        HStack(spacing: Theme.Spacing.lg) {
                            numericField("Min Area (m²)", value: $draft.minAreaSqm, prompt: "50")
                            numericField("Max Area (m²)", value: $draft.maxAreaSqm, prompt: "120")
                        }

                        if let error = draft.areaRangeError, showsValidation {
                            Text(error).font(.caption).foregroundStyle(.red)
                        }

                        HStack(spacing: Theme.Spacing.lg) {
                            numericField("Min Rooms", value: $draft.minRooms, prompt: "2")
                            numericField("Max Rooms", value: $draft.maxRooms, prompt: "5")
                        }

                        if let error = draft.roomsRangeError, showsValidation {
                            Text(error).font(.caption).foregroundStyle(.red)
                        }
                    }

                    FilterBuilderSection(
                        title: "Thesis keywords",
                        subtitle: "Use keywords sparingly to express what must appear — and what should be filtered out."
                    ) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Required keywords")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("e.g. provisionsfrei, balkon", text: $draft.keywords)
                                .textFieldStyle(.roundedBorder)
                        }

                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Excluded keywords")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("e.g. baurecht, vermietet", text: $draft.excludedKeywordsStr)
                                .textFieldStyle(.roundedBorder)
                        }
                    }
                }
                .padding(Theme.Spacing.lg)
            }

            Divider()

            // Actions
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    if draft.isValid {
                        Task {
                            await viewModel.saveFilter(draft, using: appState.apiClient)
                        }
                    } else {
                        showsValidation = true
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(width: 620, height: 720)
    }

    private func numericField(
        _ title: String,
        value: Binding<Int?>,
        prompt: String
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(prompt, value: value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func numericField(
        _ title: String,
        value: Binding<Double?>,
        prompt: String
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(prompt, value: value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FilterCriteriaSummaryCard: View {
    let summary: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("This filter means")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(summary)
                .font(.body)
                .adaptiveFontWeight(.medium)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.md)
        .background(Color.accentColor.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Color.accentColor.opacity(0.12), lineWidth: 0.5)
        }
    }
}

private struct FilterBuilderSection<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(.subheadline)
                    .adaptiveFontWeight(.semibold)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            content
        }
        .padding(Theme.Spacing.md)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }
}

private struct PropertyTypeGrid: View {
    @Bindable var draft: FilterDraft

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: Theme.Spacing.sm)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.sm) {
            ForEach(PropertyType.allCases) { propType in
                Toggle(propType.displayName, isOn: selectionBinding(for: propType))
                    .toggleStyle(.checkbox)
            }
        }
    }

    private func selectionBinding(for propertyType: PropertyType) -> Binding<Bool> {
        Binding(
            get: { draft.selectedPropertyTypes.contains(propertyType) },
            set: { isSelected in
                if isSelected {
                    draft.selectedPropertyTypes.insert(propertyType)
                } else {
                    draft.selectedPropertyTypes.remove(propertyType)
                }
            }
        )
    }
}

// MARK: - District Grid

private struct DistrictGrid: View {
    @Binding var selected: Set<Int>

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: Theme.Spacing.xs)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.xs) {
            ForEach(ViennaDistricts.all, id: \.number) { district in
                Toggle(isOn: selectionBinding(for: district.number)) {
                    Text("\(district.number). \(district.name)")
                        .font(.caption)
                        .lineLimit(1)
                }
                .toggleStyle(.checkbox)
            }
        }
    }

    private func selectionBinding(for districtNumber: Int) -> Binding<Bool> {
        Binding(
            get: { selected.contains(districtNumber) },
            set: { isSelected in
                if isSelected {
                    selected.insert(districtNumber)
                } else {
                    selected.remove(districtNumber)
                }
            }
        )
    }
}

#Preview {
    FiltersView()
        .environment(AppState())
        .frame(width: 700, height: 500)
}
