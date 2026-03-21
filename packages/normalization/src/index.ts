// ── Canonical utilities ──
export {
  parseEurPrice,
  parseSqm,
  parseRooms,
  parseBoolean,
  parseYear,
  parseFloor,
  normalizeWhitespace,
} from './canonical/coerce.js';
export { computeCompletenessScore } from './canonical/completeness.js';
export {
  computeContentFingerprint,
  computeCrossSourceFingerprint,
} from './canonical/fingerprint.js';
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
export { BaseSourceMapper, resolveListingStatus } from './sources/base-mapper.js';
export { WillhabenMapper } from './sources/willhaben-mapper.js';
export type { WillhabenRawListing } from './sources/willhaben-mapper.js';
export { Immoscout24Mapper } from './sources/immoscout24-mapper.js';
export type { Immoscout24RawListing } from './sources/immoscout24-mapper.js';
export { WohnnetMapper } from './sources/wohnnet-mapper.js';
export type { WohnnetRawListing } from './sources/wohnnet-mapper.js';
export { DerStandardMapper } from './sources/derstandard-mapper.js';
export type { DerStandardRawListing } from './sources/derstandard-mapper.js';
export { FindMyHomeMapper } from './sources/findmyhome-mapper.js';
export type { FindMyHomeRawListing } from './sources/findmyhome-mapper.js';
export { OpenImmoMapper } from './sources/openimmo-mapper.js';
export type { OpenImmoRawListing } from './sources/openimmo-mapper.js';
export { RemaxMapper } from './sources/remax-mapper.js';
export type { RemaxRawListing } from './sources/remax-mapper.js';
