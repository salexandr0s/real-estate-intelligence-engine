/** Base URL for the Austrian edict database */
export const BASE_URL = 'https://edikte.justiz.gv.at';

/** Path to the forced real estate auction database */
export const EX_DB_PATH = '/edikte/ex/exedi3.nsf';

/** Search form URL */
export const SEARCH_FORM_URL = `${BASE_URL}${EX_DB_PATH}/suche?OpenForm`;

/** Source identifier */
export const SOURCE_CODE = 'edikte';
export const SOURCE_NAME = 'Ediktsdatei Justiz (Zwangsversteigerungen)';
export const PARSER_VERSION = 1;

/**
 * Map Domino VKat category codes to canonical property types.
 * From the actual search form dropdown.
 */
export const PROPERTY_CATEGORY_MAP: Record<string, string> = {
  EH: 'house',
  ZH: 'house',
  MH: 'multi_family_house',
  MW: 'multi_family_house',
  MSH: 'multi_family_house',
  GGH: 'multi_family_house',
  RH: 'house',
  HAN: 'house',
  WE: 'apartment',
  EW: 'apartment',
  MAI: 'apartment',
  DTW: 'apartment',
  DGW: 'apartment',
  GA: 'apartment',
  GW: 'apartment',
  UL: 'land',
  BBL: 'land',
  LF: 'agricultural',
  GL: 'commercial',
  SE: 'other',
  BR: 'other',
  SO: 'other',
};

/**
 * Reverse map: readable German labels for category codes.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  EH: 'Einfamilienhaus',
  ZH: 'Zweifamilienhaus',
  MH: 'Mehrfamilienhaus',
  MW: 'Mietwohnhaus',
  MSH: 'Mietshaus',
  GGH: 'gemischt genutztes Haus',
  RH: 'Reihenhaus',
  HAN: 'Hausanteil',
  WE: 'Wohnungseigentumsobjekt',
  EW: 'Eigentumswohnung',
  MAI: 'Maisonette',
  DTW: 'Dachterrassenwohnung',
  DGW: 'Dachgeschoßwohnung',
  GA: 'Garconniere',
  GW: 'Gartenwohnung',
  UL: 'unbebaute Liegenschaft',
  BBL: 'bebaubare Liegenschaft',
  LF: 'land- und forstwirtschaftlich genutzte Liegenschaft',
  GL: 'gewerbliche Liegenschaft',
  SE: 'Superädifikat',
  BR: 'Baurecht',
  SO: 'Sonstiges',
};

/**
 * Selectors for interacting with the Domino search form.
 * Derived from recon of the actual site (form-analysis.json).
 */
export const SELECTORS = {
  /** The search form that submits to submitSuche */
  searchForm: 'form[action*="submitSuche"]',
  /** Bundesland (federal state) dropdown — field name: BL */
  bundeslandSelect: 'select#BL',
  /** Property category dropdown — field name: VKat */
  categorySelect: 'select#VKat',
  /** Location (Ort) text input — field name: VOrt */
  ortInput: 'input#VOrt',
  /** Postal code input — field name: VPLZ */
  plzInput: 'input#VPLZ',
  /** Search submit button — name: sebut */
  submitButton: 'input[name="sebut"]',
  /** Results container */
  resultsContainer: 'table',
  /** Detail page main content */
  detailContent: 'body',
  /** PDF attachment links (Domino pattern) */
  pdfLink: 'a[href*="/$file/"], a[href$=".pdf"]',
} as const;

/**
 * Bundesland select option values (numeric codes used by the Domino form).
 */
export const BUNDESLAND_CODES: Record<string, string> = {
  Wien: '0',
  Niederösterreich: '1',
  Burgenland: '2',
  Oberösterreich: '3',
  Salzburg: '4',
  Steiermark: '5',
  Kärnten: '6',
  Tirol: '7',
  Vorarlberg: '8',
};
