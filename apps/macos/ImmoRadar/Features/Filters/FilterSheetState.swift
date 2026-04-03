import Foundation

struct FilterEditorPresentation: Identifiable {
    let id = UUID()
    let editingFilter: Filter?
    let initialDraft: FilterDraft
}

struct FilterTestResultsPresentation: Identifiable {
    let id = UUID()
}
