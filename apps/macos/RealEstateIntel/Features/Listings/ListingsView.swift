import SwiftUI

/// Main listings view with native Table, sortable columns, filters, and detail inspector.
struct ListingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ListingsViewModel()
    @State private var showInspector: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            ListingsFilterBar(viewModel: viewModel)
            Divider()
            ListingsTable(viewModel: viewModel)
        }
        .navigationTitle("Listings")
        .inspector(isPresented: $showInspector) {
            ListingsInspectorContent(listing: viewModel.selectedListing)
                .inspectorColumnWidth(min: 320, ideal: 380, max: 500)
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                ToolbarSearchField(text: $viewModel.searchText, prompt: "Search by title, district, postal code...")
                    .frame(minWidth: 200, idealWidth: 320, maxWidth: 400)
            }
            ToolbarItem(placement: .automatic) {
                Button {
                    Task { await viewModel.refresh(using: appState.apiClient, cache: appState.localCache) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(viewModel.isLoading)
                .help("Refresh listings")
            }
            ToolbarItem(placement: .automatic) {
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.trailing")
                }
                .help("Toggle listing detail inspector")
            }
        }
        .task {
            await viewModel.refresh(using: appState.apiClient, cache: appState.localCache)
        }
        .onChange(of: viewModel.selectedListingID) { _, newValue in
            if newValue != nil {
                showInspector = true
            }
        }
    }
}

// MARK: - Native macOS Search Field

/// Wraps NSSearchField for a proper native macOS look in the toolbar.
private struct ToolbarSearchField: NSViewRepresentable {
    @Binding var text: String
    let prompt: String

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.sendsSearchStringImmediately = true
        field.sendsWholeSearchString = false
        return field
    }

    func updateNSView(_ nsView: NSSearchField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    final class Coordinator: NSObject, NSSearchFieldDelegate {
        @Binding var text: String

        init(text: Binding<String>) {
            _text = text
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSSearchField else { return }
            text = field.stringValue
        }
    }
}

#Preview {
    ListingsView()
        .environment(AppState())
        .frame(width: 1100, height: 600)
}
