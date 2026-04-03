/**
 * BullMQ worker: document processing pipeline.
 *
 * Picks up jobs from the DOCUMENT_PROCESSING queue. Each job references a
 * listing_documents row by ID. Processing stages:
 * 1. Fetch document metadata + listing/source context from DB
 * 2. Download the file through the shared outbound URL policy
 * 3. Compute content hash (SHA-256) and update document row
 * 4. If PDF: extract text via extractPdfText()
 * 5. Parse facts via parseRealEstateFacts()
 * 6. Persist extraction + fact spans to DB
 * 7. Update document status
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { documents, listings, sources } from '@immoradar/db';
import { extractPdfText, parseRealEstateFacts } from '@immoradar/documents';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  getQueuePrefix,
  getRedisConnection,
  type DocumentProcessingJobData,
} from '@immoradar/scraper-core';
import {
  resolveRedirectTarget,
  validateOutboundUrl,
  type OutboundUrlValidationFailure,
} from '@immoradar/alerts';
import type { ListingRow, SourceRow } from '@immoradar/contracts';

const log = createLogger('worker:document');

type DocumentFailureCode =
  | 'invalid_document_url'
  | 'blocked_private_ip'
  | 'blocked_host_mismatch'
  | 'blocked_redirect_host'
  | 'download_timeout'
  | 'download_oversize'
  | 'unsupported_content_type'
  | 'download_http_error'
  | 'download_network_error';

class DocumentDownloadError extends Error {
  constructor(
    public readonly code: DocumentFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentDownloadError';
  }
}

function isPdf(mimeType: string | null, url: string): boolean {
  if (mimeType === 'application/pdf') return true;
  try {
    const pathname = new URL(url).pathname;
    return pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().endsWith('.pdf');
  }
}

export function isAcceptedDocumentContentType(mimeType: string | null, url: string): boolean {
  if (!mimeType) {
    return isPdf(null, url);
  }

  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') return true;
  return normalized.startsWith('image/');
}

function normalizeHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${value}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

function getDocumentHostAllowlist(source: SourceRow): string[] {
  const allowlist = source.config['documentHostAllowlist'];
  if (!Array.isArray(allowlist)) return [];

  return allowlist
    .filter((value): value is string => typeof value === 'string')
    .map((value) => normalizeHostname(value) ?? value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export function buildAllowedDocumentHosts(listing: ListingRow, source: SourceRow): string[] {
  const allowedHosts = new Set<string>();

  const canonicalHost = normalizeHostname(listing.canonicalUrl);
  if (canonicalHost) allowedHosts.add(canonicalHost);

  const sourceBaseHost = normalizeHostname(source.baseUrl);
  if (sourceBaseHost) allowedHosts.add(sourceBaseHost);

  for (const host of getDocumentHostAllowlist(source)) {
    allowedHosts.add(host);
  }

  return Array.from(allowedHosts);
}

function toDownloadError(result: OutboundUrlValidationFailure): DocumentDownloadError {
  return new DocumentDownloadError(result.errorCode as DocumentFailureCode, result.errorMessage);
}

async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new DocumentDownloadError(
        'download_oversize',
        `Document exceeds max size of ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new DocumentDownloadError(
        'download_oversize',
        `Document exceeds max size of ${maxBytes} bytes`,
      );
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new DocumentDownloadError(
        'download_oversize',
        `Document exceeds max size of ${maxBytes} bytes`,
      );
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

async function markDocumentFailure(
  documentId: number,
  code: DocumentFailureCode,
  message: string,
): Promise<void> {
  log.warn('Document processing failed', {
    documentId,
    errorCode: code,
    message,
  });
  await documents.updateStatus(documentId, 'failed', {
    lastErrorCode: code,
    lastErrorMessage: message,
  });
}

async function downloadRemoteDocument(params: {
  url: string;
  listing: ListingRow;
  source: SourceRow;
  timeoutMs: number;
  maxBytes: number;
  nodeEnv: string;
}): Promise<{ buffer: Buffer; mimeType: string | null; finalUrl: string }> {
  const allowedHosts = buildAllowedDocumentHosts(params.listing, params.source);
  if (allowedHosts.length === 0) {
    throw new DocumentDownloadError(
      'blocked_host_mismatch',
      'No allowed document hosts could be derived from listing/source context',
    );
  }

  const allowedProtocols =
    params.nodeEnv === 'production' ? (['https:'] as const) : (['http:', 'https:'] as const);

  const initialUrl = await validateOutboundUrl(params.url, {
    allowedHosts,
    allowedProtocols,
    invalidUrlErrorCode: 'invalid_document_url',
    hostMismatchErrorCode: 'blocked_host_mismatch',
    blockedPrivateIpErrorCode: 'blocked_private_ip',
    dnsFailureErrorCode: 'download_network_error',
  });
  if (!initialUrl.ok) {
    throw toDownloadError(initialUrl);
  }

  let currentUrl = initialUrl.url;
  let redirectsFollowed = 0;
  const deadline = Date.now() + params.timeoutMs;

  while (redirectsFollowed <= 3) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new DocumentDownloadError(
        'download_timeout',
        `Document download timed out after ${params.timeoutMs}ms`,
      );
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new DocumentDownloadError(
          'download_timeout',
          `Document download timed out after ${params.timeoutMs}ms`,
        );
      }

      throw new DocumentDownloadError(
        'download_network_error',
        error instanceof Error ? error.message : String(error),
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectsFollowed === 3) {
        throw new DocumentDownloadError(
          'download_http_error',
          `Too many redirects while downloading ${params.url}`,
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new DocumentDownloadError(
          'download_http_error',
          'Redirect response missing Location header',
        );
      }

      const redirectTarget = resolveRedirectTarget(currentUrl, location);
      if (!redirectTarget) {
        throw new DocumentDownloadError(
          'invalid_document_url',
          `Redirect target is invalid: ${location}`,
        );
      }

      const validatedRedirect = await validateOutboundUrl(redirectTarget.toString(), {
        allowedHosts,
        allowedProtocols,
        invalidUrlErrorCode: 'invalid_document_url',
        hostMismatchErrorCode: 'blocked_redirect_host',
        blockedPrivateIpErrorCode: 'blocked_private_ip',
        dnsFailureErrorCode: 'download_network_error',
      });
      if (!validatedRedirect.ok) {
        throw toDownloadError(validatedRedirect);
      }

      currentUrl = validatedRedirect.url;
      redirectsFollowed += 1;
      continue;
    }

    if (!response.ok) {
      throw new DocumentDownloadError(
        'download_http_error',
        `Document download returned HTTP ${response.status}`,
      );
    }

    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null;
    if (!isAcceptedDocumentContentType(mimeType, currentUrl.toString())) {
      throw new DocumentDownloadError(
        'unsupported_content_type',
        `Unsupported document content type: ${mimeType ?? 'missing'}`,
      );
    }

    const buffer = await readResponseBodyLimited(response, params.maxBytes);
    return {
      buffer,
      mimeType,
      finalUrl: currentUrl.toString(),
    };
  }

  throw new DocumentDownloadError(
    'download_http_error',
    `Too many redirects while downloading ${params.url}`,
  );
}

async function downloadDocument(params: {
  url: string;
  storageKey: string | null;
  mimeType: string | null;
  listing: ListingRow;
  source: SourceRow;
}): Promise<{ buffer: Buffer; mimeType: string | null; finalUrl: string }> {
  const config = loadConfig();
  const storagePath = params.storageKey ? join(config.s3.bucket, params.storageKey) : null;

  if (storagePath) {
    try {
      await access(storagePath, fsConstants.R_OK);
      const buffer = await readFile(storagePath);
      if (buffer.length > config.documents.maxBytes) {
        throw new DocumentDownloadError(
          'download_oversize',
          `Document exceeds max size of ${config.documents.maxBytes} bytes`,
        );
      }

      if (!isAcceptedDocumentContentType(params.mimeType, params.url)) {
        throw new DocumentDownloadError(
          'unsupported_content_type',
          `Unsupported document content type: ${params.mimeType ?? 'missing'}`,
        );
      }

      return {
        buffer,
        mimeType: params.mimeType,
        finalUrl: params.url,
      };
    } catch (error) {
      if (error instanceof DocumentDownloadError) {
        throw error;
      }
    }
  }

  return downloadRemoteDocument({
    url: params.url,
    listing: params.listing,
    source: params.source,
    timeoutMs: config.documents.downloadTimeoutMs,
    maxBytes: config.documents.maxBytes,
    nodeEnv: config.nodeEnv,
  });
}

export function createDocumentWorker(): Worker<DocumentProcessingJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<DocumentProcessingJobData>(
    QUEUE_NAMES.DOCUMENT_PROCESSING,
    async (job: Job<DocumentProcessingJobData>) => {
      const { documentId } = job.data;

      log.info('Document processing started', { documentId });

      const doc = await documents.findById(documentId);
      if (!doc) {
        log.warn('Document not found, skipping', { documentId });
        return;
      }

      if (doc.status !== 'pending') {
        log.debug('Document already processed, skipping', {
          documentId,
          status: doc.status,
        });
        return;
      }

      const listing = await listings.findById(doc.listingId);
      if (!listing) {
        await markDocumentFailure(
          documentId,
          'blocked_host_mismatch',
          `Listing ${doc.listingId} not found for document processing`,
        );
        return;
      }

      const source = await sources.findById(listing.sourceId);
      if (!source) {
        await markDocumentFailure(
          documentId,
          'blocked_host_mismatch',
          `Source ${listing.sourceId} not found for document processing`,
        );
        return;
      }

      log.info('Downloading document', {
        documentId,
        url: doc.url,
        documentType: doc.documentType,
        sourceCode: listing.sourceCode,
      });

      let buffer: Buffer;
      let mimeType: string | null;
      let finalUrl = doc.url;

      try {
        const download = await downloadDocument({
          url: doc.url,
          storageKey: doc.storageKey,
          mimeType: doc.mimeType,
          listing,
          source,
        });
        buffer = download.buffer;
        mimeType = download.mimeType;
        finalUrl = download.finalUrl;
      } catch (error) {
        if (error instanceof DocumentDownloadError) {
          await markDocumentFailure(documentId, error.code, error.message);
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        await markDocumentFailure(documentId, 'download_network_error', message);
        return;
      }

      const checksum = createHash('sha256').update(buffer).digest('hex');
      const sizeBytes = buffer.length;

      await documents.updateStatus(documentId, 'downloaded', {
        checksum,
        mimeType: mimeType ?? undefined,
        sizeBytes,
        clearFailure: true,
      });

      log.info('Document downloaded', {
        documentId,
        mimeType,
        sizeBytes,
        finalUrl,
        checksum: `${checksum.slice(0, 12)}...`,
      });

      if (isPdf(mimeType, finalUrl)) {
        try {
          const extraction = await extractPdfText(buffer);

          log.info('PDF text extracted', {
            documentId,
            textLength: extraction.text.length,
            pageCount: extraction.pageCount,
          });

          const { id: extractionId } = await documents.insertExtraction(
            documentId,
            'pdf_text',
            extraction.text || null,
          );

          if (extraction.pageCount > 0) {
            await documents.updateStatus(documentId, 'downloaded', {
              pageCount: extraction.pageCount,
              clearFailure: true,
            });
          }

          if (extraction.text) {
            const facts = parseRealEstateFacts(extraction.text);

            log.info('Facts parsed from document', {
              documentId,
              extractionId,
              factCount: facts.length,
            });

            for (const fact of facts) {
              await documents.insertFactSpan(
                extractionId,
                fact.factType,
                fact.factValue,
                null,
                fact.confidence,
                fact.sourceSnippet,
              );
            }
          }

          await documents.updateStatus(documentId, 'extracted', {
            clearFailure: true,
          });

          log.info('Document extraction complete', { documentId });
        } catch (error) {
          log.error('PDF extraction failed', {
            documentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        log.debug('Non-PDF document, skipping extraction', {
          documentId,
          mimeType,
        });
      }

      log.info('Document processing complete', { documentId });
    },
    {
      connection,
      prefix,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Document processing job failed', {
      jobId: job?.id,
      documentId: job?.data.documentId,
      error: err.message,
    });
  });

  return worker;
}
