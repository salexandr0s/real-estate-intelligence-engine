import SwiftUI

/// Saved search filters management with list, toggle, edit, and delete.
struct FiltersView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = FiltersViewModel()

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
            ToolbarItemGroup {
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                Button {
                    Task { await viewModel.refresh(using: appState.apiClient) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    viewModel.startNewFilter()
                } label: {
                    Label("New Filter", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $viewModel.showingEditor) {
            FilterEditorSheet(
                viewModel: viewModel,
                editingFilter: viewModel.editingFilter
            )
        }
        .task {
            await viewModel.refresh(using: appState.apiClient)
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

    var body: some View {
        List {
            ForEach(viewModel.filters) { filter in
                FilterRow(
                    filter: filter,
                    onToggle: { viewModel.toggleActive(filter) },
                    onEdit: { viewModel.startEditing(filter) }
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        viewModel.deleteFilter(filter)
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
                        viewModel.toggleActive(filter)
                    } label: {
                        Label(
                            filter.isActive ? "Deactivate" : "Activate",
                            systemImage: filter.isActive ? "pause.circle" : "play.circle"
                        )
                    }

                    Divider()

                    Button(role: .destructive) {
                        viewModel.deleteFilter(filter)
                    } label: {
                        Label("Delete Filter", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }
}

// MARK: - Filter Row

private struct FilterRow: View {
    let filter: Filter
    let onToggle: () -> Void
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Active toggle
            Circle()
                .fill(filter.isActive ? Color.green : Color.gray)
                .frame(width: 10, height: 10)
                .onTapGesture(perform: onToggle)
                .help(filter.isActive ? "Active" : "Inactive")

            // Filter info
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(filter.name)
                    .font(.body)
                    .fontWeight(.medium)
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

            // Match count badge
            if let matchCount = filter.matchCount, matchCount > 0 {
                Text("\(matchCount)")
                    .font(.caption)
                    .fontWeight(.semibold)
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
        .contentShape(Rectangle())
        .onTapGesture(count: 2, perform: onEdit)
    }
}

// MARK: - Filter Editor Sheet

private struct FilterEditorSheet: View {
    let viewModel: FiltersViewModel
    let editingFilter: Filter?
    @State private var draft: FilterDraft
    @Environment(\.dismiss) private var dismiss

    init(viewModel: FiltersViewModel, editingFilter: Filter?) {
        self.viewModel = viewModel
        self.editingFilter = editingFilter
        if let existing = editingFilter {
            self._draft = State(initialValue: FilterDraft.from(existing))
        } else {
            self._draft = State(initialValue: FilterDraft())
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(editingFilter != nil ? "Edit Filter" : "New Filter")
                    .font(.headline)
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Theme.Spacing.lg)

            Divider()

            // Form
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                    // Name
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Filter Name")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        TextField("e.g. Vienna Value Apartments", text: $draft.name)
                            .textFieldStyle(.roundedBorder)
                    }

                    // Operation type
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Operation Type")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Picker("Operation", selection: $draft.operationType) {
                            Text("Any").tag(Optional<OperationType>.none)
                            ForEach(OperationType.allCases, id: \.self) { opType in
                                Text(opType.rawValue.capitalized).tag(Optional(opType))
                            }
                        }
                        .labelsHidden()
                    }

                    // Property types
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Property Types")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        HStack(spacing: Theme.Spacing.sm) {
                            ForEach(PropertyType.allCases) { propType in
                                Toggle(propType.displayName, isOn: Binding(
                                    get: { draft.selectedPropertyTypes.contains(propType) },
                                    set: { selected in
                                        if selected {
                                            draft.selectedPropertyTypes.insert(propType)
                                        } else {
                                            draft.selectedPropertyTypes.remove(propType)
                                        }
                                    }
                                ))
                                .toggleStyle(.checkbox)
                            }
                        }
                    }

                    // Price range
                    HStack(spacing: Theme.Spacing.lg) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Min Price (EUR)")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 100000", text: $draft.minPriceStr)
                                .textFieldStyle(.roundedBorder)
                        }
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Max Price (EUR)")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 350000", text: $draft.maxPriceStr)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    // Area range
                    HStack(spacing: Theme.Spacing.lg) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Min Area (m\u{00B2})")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 50", text: $draft.minAreaStr)
                                .textFieldStyle(.roundedBorder)
                        }
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Max Area (m\u{00B2})")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 120", text: $draft.maxAreaStr)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    // Rooms range
                    HStack(spacing: Theme.Spacing.lg) {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Min Rooms")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 2", text: $draft.minRoomsStr)
                                .textFieldStyle(.roundedBorder)
                        }
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("Max Rooms")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            TextField("e.g. 5", text: $draft.maxRoomsStr)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    // Keywords
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Required Keywords (comma-separated)")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        TextField("e.g. provisionsfrei, balkon", text: $draft.keywords)
                            .textFieldStyle(.roundedBorder)
                    }

                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Excluded Keywords (comma-separated)")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        TextField("e.g. baurecht, vermietet", text: $draft.excludedKeywordsStr)
                            .textFieldStyle(.roundedBorder)
                    }

                    // Alert frequency
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Alert Frequency")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Picker("Frequency", selection: $draft.alertFrequency) {
                            ForEach(AlertFrequency.allCases, id: \.self) { freq in
                                Text(freq.displayName).tag(freq)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                    }

                    // Districts
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("Vienna Districts")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        DistrictGrid(selected: $draft.selectedDistricts)
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
                    viewModel.saveFilter(draft)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!draft.isValid)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(width: 560, height: 640)
    }
}

// MARK: - District Grid

private struct DistrictGrid: View {
    @Binding var selected: Set<Int>

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: Theme.Spacing.xs)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.xs) {
            ForEach(ViennaDistricts.all, id: \.number) { district in
                Toggle(isOn: Binding(
                    get: { selected.contains(district.number) },
                    set: { isOn in
                        if isOn {
                            selected.insert(district.number)
                        } else {
                            selected.remove(district.number)
                        }
                    }
                )) {
                    Text("\(district.number). \(district.name)")
                        .font(.caption)
                        .lineLimit(1)
                }
                .toggleStyle(.checkbox)
            }
        }
    }
}

#Preview {
    FiltersView()
        .environment(AppState())
        .frame(width: 700, height: 500)
}
