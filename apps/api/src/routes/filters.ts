import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '@rei/observability';
import type { FilterKind, AlertFrequency, FilterCriteria, FilterUpdateInput } from '@rei/contracts';
import { userFilters } from '@rei/db';

const VALID_FILTER_KINDS = new Set(['listing_search', 'alert']);
const VALID_ALERT_FREQUENCIES = new Set(['instant', 'hourly_digest', 'daily_digest', 'manual']);
const VALID_ALERT_CHANNELS = new Set(['in_app', 'email', 'push', 'webhook']);
const VALID_OPERATION_TYPES = new Set(['sale', 'rent']);
const VALID_PROPERTY_TYPES = new Set(['apartment', 'house', 'land', 'commercial', 'parking', 'other']);
const VALID_SORT_VALUES = new Set(['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc']);

function validateCreateBody(body: unknown): {
  name: string;
  filterKind: string;
  criteria: Record<string, unknown>;
  alertFrequency: string;
  alertChannels: string[];
} {
  if (body == null || typeof body !== 'object') {
    throw new ValidationError('Request body is required');
  }

  const b = body as Record<string, unknown>;

  if (typeof b['name'] !== 'string' || b['name'].trim().length === 0) {
    throw new ValidationError('name is required and must be a non-empty string', { field: 'name' });
  }

  if (!VALID_FILTER_KINDS.has(b['filterKind'] as string)) {
    throw new ValidationError(`filterKind must be one of: ${[...VALID_FILTER_KINDS].join(', ')}`, { field: 'filterKind' });
  }

  const alertFrequency = (b['alertFrequency'] as string) ?? 'manual';
  if (!VALID_ALERT_FREQUENCIES.has(alertFrequency)) {
    throw new ValidationError(`alertFrequency must be one of: ${[...VALID_ALERT_FREQUENCIES].join(', ')}`, { field: 'alertFrequency' });
  }

  const alertChannels = (b['alertChannels'] as string[]) ?? ['in_app'];
  if (!Array.isArray(alertChannels)) {
    throw new ValidationError('alertChannels must be an array', { field: 'alertChannels' });
  }
  for (const ch of alertChannels) {
    if (!VALID_ALERT_CHANNELS.has(ch)) {
      throw new ValidationError(`Invalid alert channel: "${ch}". Valid: ${[...VALID_ALERT_CHANNELS].join(', ')}`, { field: 'alertChannels' });
    }
  }

  // Build criteria from body fields
  const criteria: Record<string, unknown> = {};

  if (b['operationType'] != null) {
    if (!VALID_OPERATION_TYPES.has(b['operationType'] as string)) {
      throw new ValidationError(`Invalid operationType: "${String(b['operationType'])}"`, { field: 'operationType' });
    }
    criteria['operationType'] = b['operationType'];
  }

  if (b['propertyTypes'] != null) {
    if (!Array.isArray(b['propertyTypes'])) {
      throw new ValidationError('propertyTypes must be an array', { field: 'propertyTypes' });
    }
    for (const pt of b['propertyTypes'] as string[]) {
      if (!VALID_PROPERTY_TYPES.has(pt)) {
        throw new ValidationError(`Invalid property type: "${pt}"`, { field: 'propertyTypes' });
      }
    }
    criteria['propertyTypes'] = b['propertyTypes'];
  }

  if (b['districts'] != null) {
    if (!Array.isArray(b['districts'])) {
      throw new ValidationError('districts must be an array of numbers', { field: 'districts' });
    }
    criteria['districts'] = b['districts'];
  }

  // Numeric filter fields
  const numericFields = ['minPriceEur', 'maxPriceEur', 'minAreaSqm', 'maxAreaSqm', 'minRooms', 'maxRooms', 'minScore'] as const;
  for (const field of numericFields) {
    if (b[field] != null) {
      const val = Number(b[field]);
      if (Number.isNaN(val)) {
        throw new ValidationError(`${field} must be a number`, { field });
      }
      criteria[field] = val;
    }
  }

  // Keyword arrays
  if (b['requiredKeywords'] != null) {
    if (!Array.isArray(b['requiredKeywords'])) {
      throw new ValidationError('requiredKeywords must be an array of strings', { field: 'requiredKeywords' });
    }
    criteria['requiredKeywords'] = b['requiredKeywords'];
  }

  if (b['excludedKeywords'] != null) {
    if (!Array.isArray(b['excludedKeywords'])) {
      throw new ValidationError('excludedKeywords must be an array of strings', { field: 'excludedKeywords' });
    }
    criteria['excludedKeywords'] = b['excludedKeywords'];
  }

  if (b['sortBy'] != null) {
    if (!VALID_SORT_VALUES.has(b['sortBy'] as string)) {
      throw new ValidationError(`Invalid sortBy: "${String(b['sortBy'])}"`, { field: 'sortBy' });
    }
    criteria['sortBy'] = b['sortBy'];
  }

  return {
    name: (b['name'] as string).trim(),
    filterKind: b['filterKind'] as string,
    criteria,
    alertFrequency,
    alertChannels,
  };
}

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

function formatFilterResponse(filter: {
  id: number;
  userId: number;
  name: string;
  filterKind: string;
  isActive: boolean;
  operationType: string | null;
  propertyTypes: string[];
  districts: number[];
  minPriceEurCents: number | null;
  maxPriceEurCents: number | null;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  minScore: number | null;
  requiredKeywords: string[];
  excludedKeywords: string[];
  sortBy: string;
  alertFrequency: string;
  alertChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: filter.id,
    name: filter.name,
    filterKind: filter.filterKind,
    isActive: filter.isActive,
    operationType: filter.operationType,
    propertyTypes: filter.propertyTypes,
    districts: filter.districts,
    minPriceEur: centsToEur(filter.minPriceEurCents),
    maxPriceEur: centsToEur(filter.maxPriceEurCents),
    minAreaSqm: filter.minAreaSqm,
    maxAreaSqm: filter.maxAreaSqm,
    minRooms: filter.minRooms,
    maxRooms: filter.maxRooms,
    minScore: filter.minScore,
    requiredKeywords: filter.requiredKeywords,
    excludedKeywords: filter.excludedKeywords,
    sortBy: filter.sortBy,
    alertFrequency: filter.alertFrequency,
    alertChannels: filter.alertChannels,
    createdAt: filter.createdAt.toISOString(),
    updatedAt: filter.updatedAt.toISOString(),
  };
}

export async function filterRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/filters - List user's filters
  app.get('/v1/filters', async (request, reply) => {
    const userId = request.userId;

    const filters = await userFilters.findByUserId(userId);

    return reply.send({
      data: filters.map(formatFilterResponse),
      meta: {},
    });
  });

  // POST /v1/filters - Create filter
  app.post('/v1/filters', async (request, reply) => {
    const userId = request.userId;
    const validated = validateCreateBody(request.body);

    const filter = await userFilters.create({
      userId,
      name: validated.name,
      filterKind: validated.filterKind as FilterKind,
      criteria: validated.criteria as FilterCriteria,
      alertFrequency: validated.alertFrequency as AlertFrequency,
      alertChannels: validated.alertChannels,
    });

    return reply.status(201).send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // GET /v1/filters/:id - Get filter
  app.get<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid filter id', { field: 'id' });
    }

    const filter = await userFilters.findById(id);
    if (!filter || filter.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // PATCH /v1/filters/:id - Update filter
  app.patch<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid filter id', { field: 'id' });
    }

    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body is required');
    }

    // Validate update fields
    const updates: Record<string, unknown> = {};

    if (body['name'] != null) {
      if (typeof body['name'] !== 'string' || (body['name'] as string).trim().length === 0) {
        throw new ValidationError('name must be a non-empty string', { field: 'name' });
      }
      updates['name'] = (body['name'] as string).trim();
    }

    if (body['isActive'] != null) {
      updates['isActive'] = Boolean(body['isActive']);
    }

    if (body['alertFrequency'] != null) {
      if (!VALID_ALERT_FREQUENCIES.has(body['alertFrequency'] as string)) {
        throw new ValidationError(`Invalid alertFrequency`, { field: 'alertFrequency' });
      }
      updates['alertFrequency'] = body['alertFrequency'];
    }

    if (body['alertChannels'] != null) {
      if (!Array.isArray(body['alertChannels'])) {
        throw new ValidationError('alertChannels must be an array', { field: 'alertChannels' });
      }
      updates['alertChannels'] = body['alertChannels'];
    }

    // Verify ownership
    const existing = await userFilters.findById(id);
    if (!existing || existing.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    const updateInput: FilterUpdateInput = {};
    if (updates['name'] !== undefined) updateInput.name = updates['name'] as string;
    if (updates['isActive'] !== undefined) updateInput.isActive = updates['isActive'] as boolean;
    if (updates['alertFrequency'] !== undefined) updateInput.alertFrequency = updates['alertFrequency'] as AlertFrequency;
    if (updates['alertChannels'] !== undefined) updateInput.alertChannels = updates['alertChannels'] as string[];

    const filter = await userFilters.update(id, updateInput);
    if (!filter) {
      throw new NotFoundError('Filter', id);
    }

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // DELETE /v1/filters/:id - Soft delete (set is_active=false)
  app.delete<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid filter id', { field: 'id' });
    }

    // Verify ownership
    const existing = await userFilters.findById(id);
    if (!existing || existing.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    await userFilters.update(id, { isActive: false });

    return reply.status(204).send();
  });
}
