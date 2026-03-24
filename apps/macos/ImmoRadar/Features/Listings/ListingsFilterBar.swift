import SwiftUI

/// Filter bar with search, pickers for operation type, property type, district, price range, and score.
struct ListingsFilterBar: View {
    @Bindable var viewModel: ListingsViewModel

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            // Operation type
            Picker("", selection: $viewModel.selectedOperationType) {
                Text("All Types").tag(nil as OperationType?)
                ForEach(OperationType.allCases, id: \.self) { type in
                    Text(type.rawValue.capitalized).tag(type as OperationType?)
                }
            }
            .labelsHidden()
            .frame(minWidth: 80, idealWidth: 100)

            // Property type
            Picker("", selection: $viewModel.selectedPropertyType) {
                Text("All Properties").tag(nil as PropertyType?)
                ForEach(PropertyType.allCases) { type in
                    Text(type.displayName).tag(type as PropertyType?)
                }
            }
            .labelsHidden()
            .frame(minWidth: 80, idealWidth: 120)

            // District
            Picker("", selection: $viewModel.selectedDistrict) {
                Text("All Districts").tag(nil as Int?)
                ForEach(viewModel.availableDistricts, id: \.number) { district in
                    Text("\(district.number). \(district.name)").tag(district.number as Int?)
                }
            }
            .labelsHidden()
            .frame(minWidth: 80, idealWidth: 120)

            Divider()
                .frame(height: 16)

            // Price range
            HStack(spacing: 2) {
                TextField("Min €", text: $viewModel.minPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 60)
                Text("-")
                    .foregroundStyle(.quaternary)
                    .font(.caption2)
                TextField("Max €", text: $viewModel.maxPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 60)
            }

            // Min score
            HStack(spacing: 2) {
                Text("≥")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                TextField("Score", text: $viewModel.minScore)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 44)
            }

            if viewModel.selectionRegion != nil {
                HStack(spacing: Theme.Spacing.xs) {
                    Image(systemName: "selection.pin.in.out")
                        .foregroundStyle(Color.accentColor)
                    Text("Area")
                        .font(.caption)
                    Button {
                        viewModel.selectionRegion = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption)
                    }
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xxs)
                .background(Color.accentColor.opacity(0.1))
                .clipShape(Capsule())
            }

            Spacer(minLength: 0)

            if viewModel.hasActiveFilters {
                Button("Clear") {
                    viewModel.clearFilters()
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .font(.caption)
            }

            Text("\(viewModel.filteredListings.count)")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
