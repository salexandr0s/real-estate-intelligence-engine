import { z, ZodError, type ZodSchema } from 'zod';
import { ValidationError } from '@rei/observability';

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

// ── Schemas ──────────────────────────────────────────────────────────────────

export const idParamSchema = z.object({
  id: z.coerce.number().int(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'limit must be between 1 and 200').max(200, 'limit must be between 1 and 200').optional(),
  cursor: z.string().optional(),
});

export const listingSearchQuerySchema = z.object({
  operationType: z.enum(OPERATION_TYPES).optional(),
  propertyTypes: z.string().transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean)).optional(),
  districts: z.string().transform((s) => {
    return s.split(',').map((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n)) throw new ValidationError(`Invalid number in list: "${v.trim()}"`);
      return n;
    });
  }).optional(),
  minPriceEur: z.coerce.number().optional(),
  maxPriceEur: z.coerce.number().optional(),
  minAreaSqm: z.coerce.number().optional(),
  maxAreaSqm: z.coerce.number().optional(),
  minRooms: z.coerce.number().optional(),
  maxRooms: z.coerce.number().optional(),
  minScore: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1, 'limit must be between 1 and 200').max(200, 'limit must be between 1 and 200').optional(),
  cursor: z.string().optional(),
  sortBy: z.enum(SORT_BY_VALUES).default('score_desc'),
}).refine(
  (d) => !(d.minPriceEur != null && d.maxPriceEur != null && d.minPriceEur > d.maxPriceEur),
  { message: 'maxPriceEur must be greater than or equal to minPriceEur', path: ['maxPriceEur'] },
).refine(
  (d) => !(d.minAreaSqm != null && d.maxAreaSqm != null && d.minAreaSqm > d.maxAreaSqm),
  { message: 'maxAreaSqm must be greater than or equal to minAreaSqm', path: ['maxAreaSqm'] },
).refine(
  (d) => !(d.minRooms != null && d.maxRooms != null && d.minRooms > d.maxRooms),
  { message: 'maxRooms must be greater than or equal to minRooms', path: ['maxRooms'] },
);

export const filterCreateSchema = z.object({
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
});

export const filterUpdateSchema = z.object({
  name: z.string().trim().min(1, 'name must be a non-empty string').optional(),
  isActive: z.coerce.boolean().optional(),
  alertFrequency: z.enum(ALERT_FREQUENCIES).optional(),
  alertChannels: z.array(z.string()).optional(),
});

export const alertUpdateSchema = z.object({
  status: z.enum(ALERT_STATUSES),
});
