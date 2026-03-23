import { query } from '../client.js';

export interface DeadLetterInsert {
  queueName: string;
  jobId: string;
  jobData: Record<string, unknown>;
  errorMessage: string | null;
  errorClass: string | null;
  sourceCode: string | null;
  attempts: number;
}

interface DeadLetterDbRow {
  id: string;
  queue_name: string;
  job_id: string;
  job_data: Record<string, unknown>;
  error_message: string | null;
  error_class: string | null;
  source_code: string | null;
  attempts: number;
  failed_at: Date;
  created_at: Date;
}

export interface DeadLetterRow {
  id: number;
  queueName: string;
  jobId: string;
  jobData: Record<string, unknown>;
  errorMessage: string | null;
  errorClass: string | null;
  sourceCode: string | null;
  attempts: number;
  failedAt: Date;
  createdAt: Date;
}

function mapRow(row: DeadLetterDbRow): DeadLetterRow {
  return {
    id: Number(row.id),
    queueName: row.queue_name,
    jobId: row.job_id,
    jobData: row.job_data,
    errorMessage: row.error_message,
    errorClass: row.error_class,
    sourceCode: row.source_code,
    attempts: row.attempts,
    failedAt: row.failed_at,
    createdAt: row.created_at,
  };
}

/** Insert a permanently failed job into the dead letter queue. */
export async function insert(input: DeadLetterInsert): Promise<DeadLetterRow> {
  const rows = await query<DeadLetterDbRow>(
    `INSERT INTO dead_letter_jobs (queue_name, job_id, job_data, error_message, error_class, source_code, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.queueName,
      input.jobId,
      JSON.stringify(input.jobData),
      input.errorMessage,
      input.errorClass,
      input.sourceCode,
      input.attempts,
    ],
  );
  return mapRow(rows[0]!);
}

/** Find recent dead letter entries, optionally filtered by queue or source. */
export async function findRecent(
  limit = 50,
  filters?: { queueName?: string; sourceCode?: string },
): Promise<DeadLetterRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.queueName) {
    params.push(filters.queueName);
    conditions.push(`queue_name = $${params.length}`);
  }
  if (filters?.sourceCode) {
    params.push(filters.sourceCode);
    conditions.push(`source_code = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const rows = await query<DeadLetterDbRow>(
    `SELECT * FROM dead_letter_jobs ${where} ORDER BY failed_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapRow);
}

/** Count dead letter entries in the last N hours. */
export async function countRecent(hours = 24): Promise<number> {
  const [row] = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dead_letter_jobs WHERE failed_at > NOW() - make_interval(hours => $1)`,
    [hours],
  );
  return Number(row!.count);
}
