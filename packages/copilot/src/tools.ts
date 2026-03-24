// ── Anthropic tool definitions for the copilot ─────────────────────────────
// Each tool maps to an existing @immoradar/db query function. The input_schema
// follows JSON Schema (Anthropic's format).

export interface CopilotToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const COPILOT_TOOLS: CopilotToolDefinition[] = [
  {
    name: 'search_listings',
    description:
      'Search active property listings with filters. Returns up to 10 results sorted by the chosen criteria. Use this when the user wants to find, browse, or filter listings.',
    input_schema: {
      type: 'object',
      properties: {
        operationType: {
          type: 'string',
          enum: ['sale', 'rent'],
          description: 'Filter by sale or rent. Omit to include both.',
        },
        propertyTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['apartment', 'house', 'land', 'commercial', 'parking', 'other'],
          },
          description: 'Filter by property types. Omit to include all.',
        },
        districts: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 23 },
          description: 'Filter by Vienna district numbers (1-23).',
        },
        minPriceEur: {
          type: 'number',
          description: 'Minimum price in EUR.',
        },
        maxPriceEur: {
          type: 'number',
          description: 'Maximum price in EUR.',
        },
        minAreaSqm: {
          type: 'number',
          description: 'Minimum living area in square metres.',
        },
        maxAreaSqm: {
          type: 'number',
          description: 'Maximum living area in square metres.',
        },
        minRooms: {
          type: 'number',
          description: 'Minimum number of rooms.',
        },
        maxRooms: {
          type: 'number',
          description: 'Maximum number of rooms.',
        },
        minScore: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Minimum composite score (0-100). Use 70+ for good deals.',
        },
        minLocationScore: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description:
            'Minimum location score (0-100). Measures transit proximity (U-Bahn, tram, bus), parks, schools, supermarkets, hospitals. Use 60+ for well-connected, 75+ for great, 85+ for top-tier locations.',
        },
        maxPoiDistances: {
          type: 'object',
          properties: {
            ubahn: { type: 'integer', description: 'Max metres to nearest U-Bahn station' },
            tram: { type: 'integer', description: 'Max metres to nearest tram stop' },
            bus: { type: 'integer', description: 'Max metres to nearest bus stop' },
            park: { type: 'integer', description: 'Max metres to nearest park' },
            school: { type: 'integer', description: 'Max metres to nearest school' },
            supermarket: {
              type: 'integer',
              description: 'Max metres to nearest supermarket',
            },
            hospital: { type: 'integer', description: 'Max metres to nearest hospital' },
            doctor: { type: 'integer', description: 'Max metres to nearest doctor' },
          },
          description:
            'Filter by proximity to points of interest. Specify category keys with max distance in metres. Common: ubahn 500 (walking), park 300, supermarket 500. Only listings with a cached POI within that distance are returned.',
        },
        sortBy: {
          type: 'string',
          enum: ['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc'],
          description: 'Sort order. Default: score_desc.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_listing_detail',
    description:
      'Get full details for a single listing by its numeric ID. Includes address, price, area, rooms, amenities, score, and timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        listingId: {
          type: 'integer',
          description: 'The numeric listing ID.',
        },
      },
      required: ['listingId'],
    },
  },
  {
    name: 'get_score_explanation',
    description:
      'Get the score breakdown for a listing: 6 sub-scores (district price, undervaluation, keyword signal, time on market, confidence, location), baseline comparisons, discount percentages, and matched keywords.',
    input_schema: {
      type: 'object',
      properties: {
        listingId: {
          type: 'integer',
          description: 'The numeric listing ID.',
        },
      },
      required: ['listingId'],
    },
  },
  {
    name: 'compare_listings',
    description:
      'Compare 2-5 listings side by side. Returns a comparison table with key metrics (price, area, rooms, score, district) for each listing.',
    input_schema: {
      type: 'object',
      properties: {
        listingIds: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 2,
          maxItems: 5,
          description: 'Array of 2-5 listing IDs to compare.',
        },
      },
      required: ['listingIds'],
    },
  },
  {
    name: 'get_price_history',
    description:
      'Get the price change history for a listing. Shows each version with date, price, and the reason for the change (first seen, price change, content change, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        listingId: {
          type: 'integer',
          description: 'The numeric listing ID.',
        },
      },
      required: ['listingId'],
    },
  },
  {
    name: 'get_market_stats',
    description:
      'Get aggregate market statistics. Returns counts of active listings, new today, high-score listings, and can be filtered by district and operation type.',
    input_schema: {
      type: 'object',
      properties: {
        districtNo: {
          type: 'integer',
          minimum: 1,
          maximum: 23,
          description: 'Vienna district number to get stats for. Omit for citywide.',
        },
        operationType: {
          type: 'string',
          enum: ['sale', 'rent'],
          description: 'Filter stats by sale or rent.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_nearby_pois',
    description:
      'Get points of interest near a listing: U-Bahn stations, tram/bus stops, parks, schools, supermarkets, hospitals, police stations. Requires the listing to have geocoded coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        listingId: {
          type: 'integer',
          description: 'The numeric listing ID.',
        },
      },
      required: ['listingId'],
    },
  },
  {
    name: 'get_cross_source_cluster',
    description:
      'Find cross-source duplicates for a listing. If the same property is listed on multiple portals, returns all instances with their source, price, and score for comparison.',
    input_schema: {
      type: 'object',
      properties: {
        listingId: {
          type: 'integer',
          description: 'The numeric listing ID.',
        },
      },
      required: ['listingId'],
    },
  },
];
