import Foundation

// MARK: - Listing DTOs

struct APIListingResponse: Codable {
    let id: Int
    let listingUid: String
    let sourceCode: String?
    let title: String
    let canonicalUrl: String
    let operationType: String
    let propertyType: String
    let city: String
    let postalCode: String?
    let districtNo: Int?
    let districtName: String?
    let listPriceEur: Double?
    let livingAreaSqm: Double?
    let rooms: Double?
    let pricePerSqmEur: Double?
    let currentScore: Double?
    let latitude: Double?
    let longitude: Double?
    let geocodePrecision: String?
    let geocodeSource: String?
    let lastPriceChangePct: Double?
    let lastPriceChangeAt: String?
    let firstSeenAt: String
    let listingStatus: String?
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String?
    let contactPhone: String?
    let outreachSummary: APIOutreachSummaryResponse?

    func toDomain(decoder: JSONDecoder) -> Listing? {
        guard let opType = OperationType(rawValue: operationType),
              let propType = PropertyType(rawValue: propertyType) else {
            return nil
        }

        let date = Date.fromISO(firstSeenAt)
        let priceChangeDate = lastPriceChangeAt.map { Date.fromISO($0) }
        let status = ListingStatus(rawValue: listingStatus ?? "active") ?? .active

        return Listing(
            id: id,
            listingUid: listingUid,
            sourceCode: sourceCode ?? "unknown",
            title: title,
            canonicalUrl: canonicalUrl,
            operationType: opType,
            propertyType: propType,
            city: city,
            postalCode: postalCode,
            districtNo: districtNo,
            districtName: districtName,
            listPriceEur: Int(listPriceEur ?? 0),
            livingAreaSqm: livingAreaSqm,
            rooms: rooms,
            pricePerSqmEur: pricePerSqmEur,
            currentScore: currentScore,
            latitude: latitude,
            longitude: longitude,
            geocodePrecision: geocodePrecision,
            geocodeSource: geocodeSource,
            lastPriceChangePct: lastPriceChangePct,
            lastPriceChangeAt: priceChangeDate,
            firstSeenAt: date,
            listingStatus: status,
            contactName: contactName,
            contactCompany: contactCompany,
            contactEmail: contactEmail,
            contactPhone: contactPhone,
            outreachSummary: outreachSummary?.toDomain()
        )
    }
}


struct APIMailboxResponse: Codable, Sendable {
    let id: Int
    let email: String
    let displayName: String?
    let syncStatus: String
    let pollIntervalSeconds: Int
    let lastSuccessfulSyncAt: String?
    let lastErrorMessage: String?

    func toDomain() -> MailboxAccount {
        MailboxAccount(
            id: id,
            email: email,
            displayName: displayName,
            syncStatus: syncStatus,
            pollIntervalSeconds: pollIntervalSeconds,
            lastSuccessfulSyncAt: lastSuccessfulSyncAt.map { Date.fromISO($0) },
            lastErrorMessage: lastErrorMessage
        )
    }
}

struct APIOutreachSummaryResponse: Codable, Sendable {
    let threadId: Int
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?

    func toDomain() -> OutreachSummary {
        OutreachSummary(
            threadId: threadId,
            workflowState: workflowState,
            unreadInboundCount: unreadInboundCount,
            nextActionAt: nextActionAt.map { Date.fromISO($0) },
            lastInboundAt: lastInboundAt.map { Date.fromISO($0) },
            lastOutboundAt: lastOutboundAt.map { Date.fromISO($0) }
        )
    }
}

struct APIOutreachAttachmentResponse: Codable, Sendable {
    let documentId: Int
    let label: String?
    let status: String
}

struct APIOutreachMessageResponse: Codable, Sendable {
    let id: Int
    let direction: String
    let messageKind: String
    let deliveryStatus: String
    let subject: String
    let bodyText: String?
    let bodyHtml: String?
    let fromEmail: String?
    let toEmail: String?
    let matchStrategy: String
    let occurredAt: String
    let errorMessage: String?
    let attachments: [APIOutreachAttachmentResponse]

    func toDomain() -> OutreachMessage {
        OutreachMessage(
            id: id,
            direction: direction,
            messageKind: messageKind,
            deliveryStatus: deliveryStatus,
            subject: subject,
            bodyText: bodyText,
            bodyHtml: bodyHtml,
            fromEmail: fromEmail,
            toEmail: toEmail,
            matchStrategy: matchStrategy,
            occurredAt: Date.fromISO(occurredAt),
            errorMessage: errorMessage,
            attachments: attachments.map { OutreachAttachment(documentId: $0.documentId, label: $0.label, status: $0.status) }
        )
    }
}

struct APIOutreachEventResponse: Codable, Sendable {
    let id: Int
    let eventType: String
    let fromState: String?
    let toState: String?
    let payload: [String: String]?
    let occurredAt: String

    func toDomain() -> OutreachEvent {
        OutreachEvent(
            id: id,
            eventType: eventType,
            fromState: fromState,
            toState: toState,
            payload: payload,
            occurredAt: Date.fromISO(occurredAt)
        )
    }
}

struct APIOutreachThreadSummaryResponse: Codable, Sendable {
    let id: Int
    let listingId: Int
    let mailboxAccountId: Int
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String
    let contactPhone: String?
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?
    let updatedAt: String

    func toDomain() -> OutreachThreadSummary {
        OutreachThreadSummary(
            id: id,
            listingId: listingId,
            mailboxAccountId: mailboxAccountId,
            contactName: contactName,
            contactCompany: contactCompany,
            contactEmail: contactEmail,
            contactPhone: contactPhone,
            workflowState: workflowState,
            unreadInboundCount: unreadInboundCount,
            nextActionAt: nextActionAt.map { Date.fromISO($0) },
            lastInboundAt: lastInboundAt.map { Date.fromISO($0) },
            lastOutboundAt: lastOutboundAt.map { Date.fromISO($0) },
            updatedAt: Date.fromISO(updatedAt)
        )
    }
}

struct APIOutreachThreadResponse: Codable, Sendable {
    let id: Int
    let listingId: Int
    let mailboxAccountId: Int
    let contactName: String?
    let contactCompany: String?
    let contactEmail: String
    let contactPhone: String?
    let workflowState: String
    let unreadInboundCount: Int
    let nextActionAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?
    let updatedAt: String
    let messages: [APIOutreachMessageResponse]
    let events: [APIOutreachEventResponse]

    func toDomain() -> OutreachThread {
        OutreachThread(
            id: id,
            listingId: listingId,
            mailboxAccountId: mailboxAccountId,
            contactName: contactName,
            contactCompany: contactCompany,
            contactEmail: contactEmail,
            contactPhone: contactPhone,
            workflowState: workflowState,
            unreadInboundCount: unreadInboundCount,
            nextActionAt: nextActionAt.map { Date.fromISO($0) },
            lastInboundAt: lastInboundAt.map { Date.fromISO($0) },
            lastOutboundAt: lastOutboundAt.map { Date.fromISO($0) },
            updatedAt: Date.fromISO(updatedAt),
            messages: messages.map { $0.toDomain() },
            events: events.map { $0.toDomain() }
        )
    }
}

struct APIOutreachActionRequest: Codable, Sendable {
    let action: String
}
