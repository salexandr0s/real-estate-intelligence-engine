import type { FilterCriteria, FilterCreateInput } from '@immoradar/contracts';

interface ValidationError {
  field: string;
  message: string;
}

const VALID_PROPERTY_TYPES = ['apartment', 'house', 'land', 'commercial', 'parking', 'other'];
const VALID_SORT_BY = ['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc'];

function validateCriteria(c: FilterCriteria): ValidationError[] {
  const errors: ValidationError[] = [];

  if (c.minPriceEur != null && c.maxPriceEur != null && c.minPriceEur > c.maxPriceEur) {
    errors.push({ field: 'price', message: 'minPriceEur must be <= maxPriceEur' });
  }
  if (c.minAreaSqm != null && c.maxAreaSqm != null && c.minAreaSqm > c.maxAreaSqm) {
    errors.push({ field: 'area', message: 'minAreaSqm must be <= maxAreaSqm' });
  }
  if (c.minRooms != null && c.maxRooms != null && c.minRooms > c.maxRooms) {
    errors.push({ field: 'rooms', message: 'minRooms must be <= maxRooms' });
  }
  if (c.minPriceEur != null && c.minPriceEur < 0) {
    errors.push({ field: 'minPriceEur', message: 'Must be non-negative' });
  }
  if (c.maxPriceEur != null && c.maxPriceEur < 0) {
    errors.push({ field: 'maxPriceEur', message: 'Must be non-negative' });
  }
  if (c.minScore != null && (c.minScore < 0 || c.minScore > 100)) {
    errors.push({ field: 'minScore', message: 'Must be 0-100' });
  }
  c.districts?.forEach((d) => {
    if (d < 1 || d > 23) errors.push({ field: 'districts', message: `Invalid district: ${d}` });
  });
  c.propertyTypes?.forEach((pt) => {
    if (!VALID_PROPERTY_TYPES.includes(pt)) {
      errors.push({ field: 'propertyTypes', message: `Invalid: ${pt}` });
    }
  });
  if (c.sortBy && !VALID_SORT_BY.includes(c.sortBy)) {
    errors.push({ field: 'sortBy', message: `Invalid sort: ${c.sortBy}` });
  }

  return errors;
}

export function validateFilterCreate(input: FilterCreateInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.name?.trim()) errors.push({ field: 'name', message: 'Name is required' });
  if (!input.userId) errors.push({ field: 'userId', message: 'userId is required' });
  errors.push(...validateCriteria(input.criteria));
  return errors;
}

export function validateFilterUpdate(criteria: Partial<FilterCriteria>): ValidationError[] {
  return validateCriteria(criteria as FilterCriteria);
}
