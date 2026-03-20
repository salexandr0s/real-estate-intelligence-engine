// ── Canonical utilities ──
export { parseEurPrice, parseSqm, parseRooms, parseBoolean, parseYear, parseFloor, normalizeWhitespace } from './canonical/coerce.js';
export { computeCompletenessScore } from './canonical/completeness.js';
export { computeContentFingerprint } from './canonical/fingerprint.js';
export { normalizePropertyType, normalizeOperationType } from './canonical/property-type.js';

// ── District utilities ──
export {
  postalCodeToDistrict,
  districtNameToNumber,
  districtTextToNumber,
  districtNumberToName,
  resolveDistrict,
} from './district/lookup.js';

// ── Source mappers ──
export { BaseSourceMapper } from './sources/base-mapper.js';
export { WillhabenMapper } from './sources/willhaben-mapper.js';
export type { WillhabenRawListing } from './sources/willhaben-mapper.js';
