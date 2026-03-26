import SwiftUI

/// Listings filter bar with clearer grouping and visible active criteria.
struct ListingsFilterBar: View {
    @Bindable var viewModel: ListingsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top, spacing: Theme.Spacing.lg) {
                FilterControlGroup(title: "Operation") {
                    Picker("Operation", selection: $viewModel.selectedOperationType) {
                        Text("All operations").tag(nil as OperationType?)
                        ForEach(OperationType.allCases, id: \.self) { type in
                            Text(type.rawValue.capitalized).tag(type as OperationType?)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .frame(width: 130)
                }

                FilterControlGroup(title: "Property") {
                    Picker("Property", selection: $viewModel.selectedPropertyType) {
                        Text("All properties").tag(nil as PropertyType?)
                        ForEach(PropertyType.allCases) { type in
                            Text(type.displayName).tag(type as PropertyType?)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .frame(width: 140)
                }

                FilterControlGroup(title: "District") {
                    Picker("District", selection: $viewModel.selectedDistrict) {
                        Text("All districts").tag(nil as Int?)
                        ForEach(viewModel.availableDistricts, id: \.number) { district in
                            Text("\(district.number). \(district.name)").tag(district.number as Int?)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .frame(width: 160)
                }

                FilterControlGroup(title: "Price range") {
                    HStack(spacing: Theme.Spacing.xs) {
                        TextField("Min €", text: $viewModel.minPrice)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 88)
                        Text("–")
                            .foregroundStyle(.tertiary)
                        TextField("Max €", text: $viewModel.maxPrice)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 88)
                    }
                }

                FilterControlGroup(title: "Minimum score") {
                    HStack(spacing: Theme.Spacing.xs) {
                        Text("≥")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Score", text: $viewModel.minScore)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 68)
                    }
                }

                Spacer(minLength: 0)
            }

            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                FlowLayout(spacing: Theme.Spacing.xs) {
                    ForEach(activeFilterTokens, id: \.self) { token in
                        FilterToken(text: token)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: Theme.Spacing.sm) {
                    Text("\(viewModel.filteredListings.count) results")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if viewModel.hasActiveFilters {
                        Button("Clear All") {
                            viewModel.clearFilters()
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var activeFilterTokens: [String] {
        var tokens: [String] = []

        if let operation = viewModel.selectedOperationType {
            tokens.append("Operation: \(operation.rawValue.capitalized)")
        }
        if let property = viewModel.selectedPropertyType {
            tokens.append("Property: \(property.displayName)")
        }
        if let district = viewModel.selectedDistrict,
           let districtLabel = viewModel.availableDistricts.first(where: { $0.number == district }) {
            tokens.append("District: \(districtLabel.number). \(districtLabel.name)")
        }
        if !viewModel.minPrice.isEmpty || !viewModel.maxPrice.isEmpty {
            let minimum = viewModel.minPrice.isEmpty ? "0" : viewModel.minPrice
            let maximum = viewModel.maxPrice.isEmpty ? "∞" : viewModel.maxPrice
            tokens.append("Price: \(minimum)–\(maximum) €")
        }
        if !viewModel.minScore.isEmpty {
            tokens.append("Score ≥ \(viewModel.minScore)")
        }
        if viewModel.selectionRegion != nil {
            tokens.append("Area selected")
        }

        return tokens
    }
}

private struct FilterControlGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            content
        }
    }
}

private struct FilterToken: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xxs)
            .background(Color.secondary.opacity(0.08), in: Capsule())
    }
}
