import SwiftUI

/// Filter bar with pickers for operation type, property type, district, price range, and score.
struct ListingsFilterBar: View {
    @Bindable var viewModel: ListingsViewModel

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            // Operation type
            Picker("Type", selection: $viewModel.selectedOperationType) {
                Text("All Types").tag(nil as OperationType?)
                ForEach(OperationType.allCases, id: \.self) { type in
                    Text(type.rawValue.capitalized).tag(type as OperationType?)
                }
            }
            .frame(width: 120)

            // Property type
            Picker("Property", selection: $viewModel.selectedPropertyType) {
                Text("All Properties").tag(nil as PropertyType?)
                ForEach(PropertyType.allCases) { type in
                    Text(type.displayName).tag(type as PropertyType?)
                }
            }
            .frame(width: 140)

            // District
            Picker("District", selection: $viewModel.selectedDistrict) {
                Text("All Districts").tag(nil as Int?)
                ForEach(viewModel.availableDistricts, id: \.number) { district in
                    Text("\(district.number). \(district.name)").tag(district.number as Int?)
                }
            }
            .frame(width: 180)

            Divider()
                .frame(height: 20)

            // Price range
            HStack(spacing: Theme.Spacing.xs) {
                Text("Price:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Min", text: $viewModel.minPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
                Text("--")
                    .foregroundStyle(.quaternary)
                TextField("Max", text: $viewModel.maxPrice)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
            }

            // Min score
            HStack(spacing: Theme.Spacing.xs) {
                Text("Score:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Min", text: $viewModel.minScore)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 60)
            }

            Spacer()

            if viewModel.hasActiveFilters {
                Button("Clear Filters") {
                    viewModel.clearFilters()
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            Text("\(viewModel.filteredListings.count) listings")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
