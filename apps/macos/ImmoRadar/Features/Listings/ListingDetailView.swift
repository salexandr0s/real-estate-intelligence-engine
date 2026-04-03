import SwiftUI

/// Detail view for a single listing, shown in the inspector pane.
/// Uses grouped sections with subtle card backgrounds for a native macOS inspector feel.
struct ListingDetailView: View {
    let listing: Listing
    var onExpandMap: (() -> Void)?
    @Environment(AppState.self) private var appState
    @State private var viewModel: ListingDetailViewModel

    init(listing: Listing, onExpandMap: (() -> Void)? = nil) {
        self.listing = listing
        self.onExpandMap = onExpandMap
        _viewModel = State(initialValue: ListingDetailViewModel(listing: listing))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                // Header: status, title, price, score, metrics
                ListingHeaderSection(
                    listing: viewModel.displayedListing,
                    cluster: viewModel.cluster
                )

                ListingExternalActionsBar(listing: viewModel.displayedListing)

                ListingPrimaryActionsBar(
                    isSaved: viewModel.isSaved,
                    isSaving: viewModel.isSaving,
                    canContact: viewModel.canContact,
                    isLoadingOutreach: viewModel.isLoadingOutreach,
                    contactButtonTitle: viewModel.contactButtonTitle,
                    contactButtonSystemImage: viewModel.contactButtonSystemImage,
                    contactButtonHelpText: viewModel.contactButtonHelpText,
                    onToggleSave: {
                        Task { await viewModel.toggleSave(using: appState.apiClient) }
                    },
                    onContact: {
                        Task {
                            if let threadID = await viewModel.handleContactAction(using: appState.apiClient) {
                                appState.openOutreachThread(threadID)
                            }
                        }
                    }
                )

                if let actionErrorMessage = viewModel.actionErrorMessage,
                   !actionErrorMessage.isEmpty {
                    Text(actionErrorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                // Key investor metrics ribbon
                KeyMetricsRibbon(analysis: viewModel.analysis, explanation: viewModel.explanation)

                ListingAnalysisSection(
                    analysis: viewModel.analysis,
                    isLoadingAnalysis: viewModel.isLoadingAnalysis
                )

                // Price history
                PriceHistoryView(versions: viewModel.priceVersions)

                // Cross-source comparison
                if let cluster = viewModel.cluster,
                   cluster.deduplicatedMembers.count >= 2 {
                    CrossSourceComparisonView(cluster: cluster)
                }

                Divider()

                // Score breakdown
                if let explanation = viewModel.explanation {
                    Text("Score Breakdown")
                        .font(.headline)
                    ScoreBreakdownView(explanation: explanation)
                }

                // Confidence
                if let analysis = viewModel.analysis {
                    AnalysisConfidenceBadge(confidence: analysis.confidence)
                }

                Divider()

                // Property details grid
                ListingDetailsSection(listing: viewModel.displayedListing)

                OutreachDetailSection(
                    listing: viewModel.displayedListing,
                    thread: viewModel.outreachThread,
                    isLoading: viewModel.isLoadingOutreach,
                    errorMessage: viewModel.outreachErrorMessage,
                    onStart: {
                        Task {
                            if let threadID = await viewModel.startOutreach(using: appState.apiClient) {
                                appState.openOutreachThread(threadID)
                            }
                        }
                    },
                    onReload: {
                        Task { await viewModel.loadOutreachThread(using: appState.apiClient) }
                    },
                    onAction: { action in
                        Task { await viewModel.applyOutreachAction(action, using: appState.apiClient) }
                    },
                    onSendFollowup: {
                        Task { await viewModel.sendFollowup(using: appState.apiClient) }
                    }
                )

                // Building context
                if let building = viewModel.analysis?.buildingContext {
                    AnalysisBuildingContextCard(building: building)
                }

                // Nearby POIs
                ListingLocationSection(listing: viewModel.displayedListing)

                Divider()

                // Documents
                DocumentsSection(
                    documents: viewModel.listingDocuments,
                    isLoading: viewModel.isLoadingDocuments,
                    onLoadFacts: { documentID in
                        await viewModel.loadDocumentFacts(
                            documentId: documentID,
                            using: appState.apiClient
                        )
                    }
                )

                Divider()

                // Map
                ListingMapView(listing: viewModel.displayedListing, onExpandToFullMap: onExpandMap)
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: listing.id) {
            await viewModel.load(using: appState.apiClient, listing: listing)
        }
    }
}

private struct OutreachDetailSection: View {
    let listing: Listing
    let thread: OutreachThread?
    let isLoading: Bool
    let errorMessage: String?
    let onStart: () -> Void
    let onReload: () -> Void
    let onAction: (OutreachAction) -> Void
    let onSendFollowup: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Outreach")
                    .font(.headline)
                Spacer()
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if let thread {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    OutreachWorkflowBadge(state: thread.workflowState)
                    if let lastOutboundAt = thread.lastOutboundAt {
                        Text("Last outbound: \(PriceFormatter.formatDateTime(lastOutboundAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let lastInboundAt = thread.lastInboundAt {
                        Text("Last reply: \(PriceFormatter.formatDateTime(lastInboundAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if thread.unreadInboundCount > 0 {
                        Text("Unread replies: \(thread.unreadInboundCount)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Button("Reload", action: onReload)
                        Button("Pause") { onAction(.pause) }
                            .disabled(thread.workflowState == "paused" || thread.workflowState == "closed")
                        Button("Resume") { onAction(.resume) }
                            .disabled(thread.workflowState != "paused")
                        Button("Close") { onAction(.close) }
                            .disabled(thread.workflowState == "closed")
                        Button("Follow-up", action: onSendFollowup)
                            .disabled(thread.lastInboundAt != nil || thread.workflowState == "closed")
                    }

                    if !thread.messages.isEmpty {
                        Divider()
                        ForEach(thread.messages.prefix(3)) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(message.direction.capitalized)
                                        .font(.caption.weight(.semibold))
                                    Spacer()
                                    Text(PriceFormatter.formatDateTime(message.occurredAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(message.subject)
                                    .font(.subheadline.weight(.semibold))
                                if let body = message.bodyText, !body.isEmpty {
                                    Text(body)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(4)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            } else if let contactEmail = listing.contactEmail {
                Text(contactEmail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Start outreach", action: onStart)
            } else {
                Text("No contact email available for this listing.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ListingExternalActionsBar: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Button {
                if let url = URL(string: listing.canonicalUrl) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open in Browser", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.borderedProminent)

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(listing.canonicalUrl, forType: .string)
            } label: {
                Label("Copy URL", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.bordered)

            if let shareURL = URL(string: listing.canonicalUrl) {
                ShareLink(item: shareURL) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.regular)
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct ListingPrimaryActionsBar: View {
    let isSaved: Bool
    let isSaving: Bool
    let canContact: Bool
    let isLoadingOutreach: Bool
    let contactButtonTitle: String
    let contactButtonSystemImage: String
    let contactButtonHelpText: String
    let onToggleSave: () -> Void
    let onContact: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Button(action: onToggleSave) {
                Label(
                    isSaved ? "Saved to Watchlist" : "Save to Watchlist",
                    systemImage: isSaved ? "bookmark.fill" : "bookmark"
                )
                .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.bordered)
            .tint(isSaved ? .orange : .accentColor)
            .disabled(isSaving)
            .help(isSaved ? "Remove from watchlist" : "Save this listing to the watchlist")

            Button(action: onContact) {
                Label(contactButtonTitle, systemImage: contactButtonSystemImage)
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.regular)
            .buttonStyle(.borderedProminent)
            .disabled(!canContact || isLoadingOutreach)
            .help(contactButtonHelpText)
        }
    }
}

private struct ListingAnalysisSection: View {
    let analysis: ListingAnalysis?
    let isLoadingAnalysis: Bool

    var body: some View {
        if isLoadingAnalysis && analysis == nil {
            ProgressView("Loading analysis…")
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, Theme.Spacing.md)
        } else if let analysis {
            if let rent = analysis.marketRentContext {
                AnalysisMarketRentCard(rent: rent)
            }

            if let metrics = analysis.investorMetrics {
                AnalysisInvestorMetricsCard(metrics: metrics)
            }

            if let sale = analysis.marketSaleContext {
                AnalysisSaleContextCard(sale: sale)
            }

            if let legal = analysis.legalRentSummary {
                AnalysisLegalRentCard(legal: legal)
            }

            if !analysis.riskFlags.isEmpty && !analysis.upsideFlags.isEmpty {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    AnalysisFlagsList(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                        .frame(maxWidth: .infinity)
                    AnalysisFlagsList(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                        .frame(maxWidth: .infinity)
                }
            } else {
                if !analysis.riskFlags.isEmpty {
                    AnalysisFlagsList(title: "Risk Flags", flags: analysis.riskFlags, color: .red)
                }
                if !analysis.upsideFlags.isEmpty {
                    AnalysisFlagsList(title: "Upside Flags", flags: analysis.upsideFlags, color: .green)
                }
            }

            if !analysis.missingData.isEmpty {
                AnalysisMissingDataList(items: analysis.missingData)
            }

            if !analysis.assumptions.isEmpty {
                AnalysisAssumptionsList(items: analysis.assumptions)
            }
        }
    }
}

#Preview {
    ListingDetailView(listing: Listing.samples[0])
        .frame(width: 380, height: 900)
}
