import { z, ZodError, type ZodSchema } from 'zod';
import { ValidationError } from '@immoradar/observability';

// ── Parse helper ─────────────────────────────────────────────────────────────

export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      throw new ValidationError(first?.message ?? 'Validation failed', {
        field: first?.path.join('.'),
        issues: err.issues,
      });
    }
    throw err;
  }
}

// ── Enum value arrays ────────────────────────────────────────────────────────

const OPERATION_TYPES = ['sale', 'rent'] as const;
const PROPERTY_TYPES = ['apartment', 'house', 'land', 'commercial', 'parking', 'other'] as const;
const SORT_BY_VALUES = ['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc'] as const;
const FILTER_KINDS = ['listing_search', 'alert'] as const;
const ALERT_FREQUENCIES = ['instant', 'hourly_digest', 'daily_digest', 'manual'] as const;
const ALERT_CHANNELS = ['in_app', 'email', 'push', 'webhook'] as const;
const ALERT_STATUSES = ['queued', 'sent', 'failed', 'dismissed', 'opened', 'suppressed'] as const;

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Treat both null and empty string as absent (matches original `== null` / `??` checks) */
function absentToUndefined(val: unknown): unknown {
  return val == null || val === '' ? undefined : val;
}

/**
 * Convert null values in a JSON body object to undefined.
 * Original validation used `!= null` (loose equality) to skip both null and
 * undefined, while Zod's `.optional()` only handles undefined. This preprocess
 * bridges the gap so clients sending explicit nulls still get default/skip behavior.
 */
function stripNullValues(val: unknown): unknown {
  if (val == null || typeof val !== 'object') return val;
  const obj = val as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = v === null ? undefined : v;
  }
  return result;
}

// ── Query param helpers ──────────────────────────────────────────────────────
// Query params arrive as strings; empty strings (from ?key= with no value)
// must be treated as absent to match the original manual parsing behavior.

const optionalQueryNumber = z.preprocess(absentToUndefined, z.coerce.number().optional());

const optionalQueryLimit = z.preprocess(
  absentToUndefined,
  z.coerce
    .number()
    .int()
    .min(1, 'limit must be between 1 and 200')
    .max(200, 'limit must be between 1 and 200')
    .optional(),
);

// ── Schemas ──────────────────────────────────────────────────────────────────

export const idParamSchema = z.object({
  id: z.coerce.number().int(),
});

export const paginationQuerySchema = z.object({
  limit: optionalQueryLimit,
  cursor: z.string().optional(),
});

export const listingSearchQuerySchema = z
  .object({
    operationType: z.enum(OPERATION_TYPES).optional(),
    propertyTypes: z
      .string()
      .transform((s) => {
        if (s === '') return undefined;
        return s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      })
      .optional(),
    districts: z
      .string()
      .transform((s, ctx) => {
        if (s === '') return undefined;
        const nums: number[] = [];
        for (const part of s.split(',')) {
          const n = parseInt(part.trim(), 10);
          if (Number.isNaN(n)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid number in list: "${part.trim()}"`,
            });
            return z.NEVER;
          }
          nums.push(n);
        }
        return nums;
      })
      .optional(),
    minPriceEur: optionalQueryNumber,
    maxPriceEur: optionalQueryNumber,
    minAreaSqm: optionalQueryNumber,
    maxAreaSqm: optionalQueryNumber,
    minRooms: optionalQueryNumber,
    maxRooms: optionalQueryNumber,
    minScore: optionalQueryNumber,
    limit: optionalQueryLimit,
    cursor: z.string().optional(),
    sortBy: z.enum(SORT_BY_VALUES).default('score_desc'),
  })
  .refine(
    (d) => !(d.minPriceEur != null && d.maxPriceEur != null && d.minPriceEur > d.maxPriceEur),
    { message: 'maxPriceEur must be greater than or equal to minPriceEur', path: ['maxPriceEur'] },
  )
  .refine((d) => !(d.minAreaSqm != null && d.maxAreaSqm != null && d.minAreaSqm > d.maxAreaSqm), {
    message: 'maxAreaSqm must be greater than or equal to minAreaSqm',
    path: ['maxAreaSqm'],
  })
  .refine((d) => !(d.minRooms != null && d.maxRooms != null && d.minRooms > d.maxRooms), {
    message: 'maxRooms must be greater than or equal to minRooms',
    path: ['maxRooms'],
  });

export const filterCreateSchema = z.preprocess(
  stripNullValues,
  z.object({
    name: z.string().trim().min(1, 'name is required and must be a non-empty string'),
    filterKind: z.enum(FILTER_KINDS),
    alertFrequency: z.enum(ALERT_FREQUENCIES).default('manual'),
    alertChannels: z.array(z.enum(ALERT_CHANNELS)).default(['in_app']),
    operationType: z.enum(OPERATION_TYPES).optional(),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).optional(),
    districts: z.array(z.number()).optional(),
    minPriceEur: z.number().optional(),
    maxPriceEur: z.number().optional(),
    minAreaSqm: z.number().optional(),
    maxAreaSqm: z.number().optional(),
    minRooms: z.number().optional(),
    maxRooms: z.number().optional(),
    minScore: z.number().optional(),
    requiredKeywords: z.array(z.string()).optional(),
    excludedKeywords: z.array(z.string()).optional(),
    sortBy: z.enum(SORT_BY_VALUES).optional(),
  }),
);

export const filterUpdateSchema = z.preprocess(
  stripNullValues,
  z.object({
    name: z.string().trim().min(1, 'name must be a non-empty string').optional(),
    isActive: z.coerce.boolean().optional(),
    alertFrequency: z.enum(ALERT_FREQUENCIES).optional(),
    alertChannels: z.array(z.enum(ALERT_CHANNELS)).optional(),
  }),
);

export const alertUpdateSchema = z.object({
  status: z.enum(ALERT_STATUSES),
});

export const sourceUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    crawlIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .refine((data) => data.isActive !== undefined || data.crawlIntervalMinutes !== undefined, {
    message: 'At least one field must be provided',
  });

export const scrapeRunCreateSchema = z.object({
  sourceCode: z.string().trim().min(1, 'sourceCode is required'),
});

export const highScoreQuerySchema = z.object({
  minScore: z.preprocess(absentToUndefined, z.coerce.number().min(0).max(100).optional()),
  limit: optionalQueryLimit,
  cursor: z.string().optional(),
});

const FEEDBACK_RATINGS = ['interested', 'not_interested', 'bookmarked', 'contacted'] as const;

export const feedbackCreateSchema = z.object({
  listingId: z.number().int(),
  rating: z.enum(FEEDBACK_RATINGS),
  notes: z.string().max(2000).optional(),
});

export const alertBulkUpdateSchema = z
  .object({
    action: z.enum(['opened', 'dismissed']),
    ids: z.array(z.number().int()).min(1).max(500).optional(),
    filter: z
      .object({
        status: z.enum(ALERT_STATUSES).optional(),
      })
      .optional(),
  })
  .refine((d) => d.ids != null || d.filter != null, {
    message: 'Either ids or filter must be provided',
  });

export const canaryHistoryQuerySchema = z.object({
  limit: z.preprocess(absentToUndefined, z.coerce.number().int().min(1).max(100).default(10)),
});

export const districtTrendQuerySchema = z.object({
  districtNo: optionalQueryNumber,
  operationType: z.enum(OPERATION_TYPES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  months: z.preprocess(absentToUndefined, z.coerce.number().int().min(1).max(60).optional()),
});
