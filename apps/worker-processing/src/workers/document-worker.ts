/**
 * BullMQ worker: document processing pipeline.
 *
 * Picks up jobs from the DOCUMENT_PROCESSING queue. Each job references a
 * listing_documents row by ID. Processing stages:
 * 1. Fetch document metadata from DB
 * 2. Download the file via fetch()
 * 3. Compute content hash (SHA-256) and update document row
 * 4. If PDF: extract text via extractPdfText()
 * 5. Parse facts via parseRealEstateFacts()
 * 6. Persist extraction + fact spans to DB
 * 7. Update document status
 */

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@immoradar/scraper-core';
import type { DocumentProcessingJobData } from '@immoradar/scraper-core';
import { documents } from '@immoradar/db';
import { extractPdfText, parseRealEstateFacts } from '@immoradar/documents';
import { loadConfig } from '@immoradar/config';

const log = createLogger('worker:document');

/**
 * Determine whether a document should be treated as a PDF based on its
 * Content-Type header and/or URL extension.
 */
function isPdf(mimeType: string | null, url: string): boolean {
  if (mimeType === 'application/pdf') return true;
  try {
    const pathname = new URL(url).pathname;
    return pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().endsWith('.pdf');
  }
}

export function createDocumentWorker(): Worker<DocumentProcessingJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<DocumentProcessingJobData>(
    QUEUE_NAMES.DOCUMENT_PROCESSING,
    async (job: Job<DocumentProcessingJobData>) => {
      const { documentId } = job.data;

      log.info('Document processing started', { documentId });

      // ── 1. Fetch document row ──────────────────────────────────────────

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

      // ── 2. Download ───────────────────────────────────────────────────

      log.info('Downloading document', {
        documentId,
        url: doc.url,
        documentType: doc.documentType,
      });

      let buffer: Buffer;
      let mimeType: string | null;
      const config = loadConfig();

      try {
        const storagePath = doc.storageKey ? join(config.s3.bucket, doc.storageKey) : null;
        if (storagePath) {
          try {
            await access(storagePath, fsConstants.R_OK);
            buffer = await readFile(storagePath);
            mimeType = doc.mimeType;
          } catch {
            const response = await fetch(doc.url);

            if (!response.ok) {
              log.error('Document download failed', {
                documentId,
                url: doc.url,
                status: response.status,
              });
              await documents.updateStatus(documentId, 'failed');
              return;
            }

            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
            mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
          }
        } else {
          const response = await fetch(doc.url);

          if (!response.ok) {
            log.error('Document download failed', {
              documentId,
              url: doc.url,
              status: response.status,
            });
            await documents.updateStatus(documentId, 'failed');
            return;
          }

          const arrayBuffer = await response.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
          mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
        }
      } catch (err) {
        log.error('Document download error', {
          documentId,
          url: doc.url,
          error: err instanceof Error ? err.message : String(err),
        });
        await documents.updateStatus(documentId, 'failed');
        return;
      }

      // ── 3. Hash + update status to downloaded ─────────────────────────

      const checksum = createHash('sha256').update(buffer).digest('hex');
      const sizeBytes = buffer.length;

      await documents.updateStatus(documentId, 'downloaded', {
        checksum,
        mimeType: mimeType ?? undefined,
        sizeBytes,
      });

      log.info('Document downloaded', {
        documentId,
        mimeType,
        sizeBytes,
        checksum: checksum.slice(0, 12) + '...',
      });

      // ── 4-6. PDF extraction pipeline ──────────────────────────────────

      if (isPdf(mimeType, doc.url)) {
        try {
          // 4a. Extract text
          const extraction = await extractPdfText(buffer);

          log.info('PDF text extracted', {
            documentId,
            textLength: extraction.text.length,
            pageCount: extraction.pageCount,
          });

          // 4b. Persist extraction
          const { id: extractionId } = await documents.insertExtraction(
            documentId,
            'pdf_text',
            extraction.text || null,
          );

          // Update page count if we got one
          if (extraction.pageCount > 0) {
            await documents.updateStatus(documentId, 'downloaded', {
              pageCount: extraction.pageCount,
            });
          }

          // 4c. Parse facts from extracted text
          if (extraction.text) {
            const facts = parseRealEstateFacts(extraction.text);

            log.info('Facts parsed from document', {
              documentId,
              extractionId,
              factCount: facts.length,
            });

            // 4d. Persist each fact span
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

          // 4e. Mark as extracted
          await documents.updateStatus(documentId, 'extracted');

          log.info('Document extraction complete', { documentId });
        } catch (err) {
          log.error('PDF extraction failed', {
            documentId,
            error: err instanceof Error ? err.message : String(err),
          });
          // Leave status as 'downloaded' rather than failing entirely --
          // the download itself succeeded.
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
