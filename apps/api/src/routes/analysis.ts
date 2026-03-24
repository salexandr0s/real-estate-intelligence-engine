import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@immoradar/observability';
import type {
  ComparableEntry,
  ComparableFallbackLevel,
  ListingAnalysis,
  MarketContext,
  BuildingContext,
  LegalRentSummary,
} from '@immoradar/contracts';
import { listings, comparables, listingPois, marketBaselines, buildingFacts } from '@immoradar/db';
import {
  estimateMarketRent,
  computeInvestorMetrics,
  computeRiskFlags,
  computeUpsideFlags,
  computeAnalysisConfidence,
  deriveConfidence,
} from '@immoradar/analysis';
import { assessLegalRent } from '@immoradar/legal-rent';
import { parseOrThrow, idParamSchema } from '../schemas.js';

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/listings/:id/analysis
   *
   * One-click investor analysis for a listing.
   * Assembles: summary, building context, location context, comparable sales,
   * market rent estimate, investor metrics, legal-rent assessment,
   * risk/upside flags, confidence model.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/analysis',
    {
      schema: {
        tags: ['Analysis'],
        summary: 'Get investor analysis for a listing',
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      const listing = await listings.findById(id);
      if (!listing) {
        throw new NotFoundError('Listing', id);
      }

      // ── Location Context ───────────────────────────────────────────
      const listingPoiRows = await listingPois.getByListingId(id);
      const transitPoi = listingPoiRows.find(
        (p) => (p.category === 'ubahn' || p.category === 'tram') && p.rank === 1,
      );

      const locationContext = {
        districtNo: listing.districtNo,
        districtName: listing.districtName,
        nearestTransit: transitPoi?.poiName ?? null,
        nearestTransitDistanceM: transitPoi?.distanceM ?? null,
        parksNearby: listingPoiRows.filter((p) => p.category === 'park').length,
        schoolsNearby: listingPoiRows.filter((p) => p.category === 'school').length,
      };

      // ── Building Facts ─────────────────────────────────────────────
      let buildingContext: BuildingContext | null = null;
      let buildingMatchConfidence: string | null = null;

      // Try spatial lookup by coordinates — degrade gracefully if table missing.
      // Widen radius for less precise geocodes to increase match rate.
      const buildingSearchRadius =
        listing.geocodePrecision === 'source_exact'
          ? 50
          : listing.geocodePrecision === 'street'
            ? 100
            : 150;

      let buildingFactRow = null;
      try {
        buildingFactRow =
          listing.latitude != null && listing.longitude != null
            ? await buildingFacts.findNearestBuilding(
                listing.latitude,
                listing.longitude,
                buildingSearchRadius,
              )
            : null;
      } catch {
        buildingFactRow = null;
      }

      if (buildingFactRow) {
        // Derive confidence from spatial distance when stored confidence is unknown
        buildingMatchConfidence =
          buildingFactRow.matchConfidence !== 'unknown'
            ? buildingFactRow.matchConfidence
            : buildingFactRow.distanceM <= 30
              ? 'high'
              : buildingFactRow.distanceM <= 80
                ? 'medium'
                : 'low';

        const acceptableConfidence = ['exact', 'high', 'medium', 'low'].includes(
          buildingMatchConfidence ?? '',
        );

        if (acceptableConfidence) {
          const facts = buildingFactRow.factsJson as Record<string, unknown>;
          buildingContext = {
            buildingFactId: buildingFactRow.id,
            matchConfidence: buildingMatchConfidence ?? 'unknown',
            yearBuilt: typeof facts.year_built === 'number' ? facts.year_built : null,
            typology: typeof facts.typology === 'string' ? facts.typology : null,
            unitCount: typeof facts.unit_count === 'number' ? facts.unit_count : null,
            source: buildingFactRow.sourceName,
            sourceUpdatedAt: buildingFactRow.sourceUpdatedAt,
          };
        }
      }

      // ── Sale Comparables (tiered) ─────────────────────────────────
      let saleComps: ComparableEntry[] = [];
      let saleFallbackLevel: ComparableFallbackLevel = 'city';

      if (
        listing.latitude != null &&
        listing.longitude != null &&
        listing.geocodePrecision != null &&
        ['source_exact', 'source_approx', 'street'].includes(listing.geocodePrecision)
      ) {
        const nearby = await comparables.findNearbyComparables({
          listingId: id,
          latitude: listing.latitude,
          longitude: listing.longitude,
          operationType: listing.operationType,
          propertyType: listing.propertyType,
          livingAreaSqm: listing.livingAreaSqm,
          rooms: listing.rooms,
        });
        if (nearby.length >= 3) {
          saleComps = nearby;
          saleFallbackLevel = 'nearby';
        }
      }

      if (saleComps.length < 3 && listing.districtNo != null) {
        const district = await comparables.findDistrictComparables({
          listingId: id,
          districtNo: listing.districtNo,
          operationType: listing.operationType,
          propertyType: listing.propertyType,
          livingAreaSqm: listing.livingAreaSqm,
        });
        if (district.length > saleComps.length) {
          saleComps = district;
          saleFallbackLevel = 'district';
        }
      }

      // Enrich comparables with explanation fields
      const enrichedSaleComps: ComparableEntry[] = saleComps.map((c) => {
        const recencyDays = Math.floor(
          (Date.now() - c.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        const areaSimilarityPct =
          c.livingAreaSqm != null && listing.livingAreaSqm != null && listing.livingAreaSqm > 0
            ? Math.round(
                (1 - Math.abs(c.livingAreaSqm - listing.livingAreaSqm) / listing.livingAreaSqm) *
                  100,
              )
            : null;
        const roomDiff = c.rooms != null && listing.rooms != null ? c.rooms - listing.rooms : null;

        return {
          ...c,
          matchReason:
            saleFallbackLevel === 'nearby'
              ? `Nearby similar ${c.propertyType}`
              : `Same district ${c.propertyType}`,
          recencyDays,
          areaSimilarityPct,
          roomDiff,
        };
      });

      // Compute sale context stats
      let marketSaleContext: MarketContext | null = null;
      if (enrichedSaleComps.length > 0) {
        const ppsqmValues = enrichedSaleComps
          .filter((c) => c.pricePerSqmEur != null)
          .map((c) => c.pricePerSqmEur!)
          .sort((a, b) => a - b);

        const medianPpsqm =
          ppsqmValues.length > 0 ? ppsqmValues[Math.floor(ppsqmValues.length / 2)]! : null;
        const p25 =
          ppsqmValues.length > 0 ? ppsqmValues[Math.floor(ppsqmValues.length * 0.25)]! : null;
        const p75 =
          ppsqmValues.length > 0 ? ppsqmValues[Math.floor(ppsqmValues.length * 0.75)]! : null;

        marketSaleContext = {
          comparables: enrichedSaleComps,
          fallbackLevel: saleFallbackLevel,
          sampleSize: enrichedSaleComps.length,
          medianPpsqm: medianPpsqm != null ? Math.round(medianPpsqm) : null,
          p25Ppsqm: p25 != null ? Math.round(p25) : null,
          p75Ppsqm: p75 != null ? Math.round(p75) : null,
          confidence: deriveConfidence(enrichedSaleComps.length, saleFallbackLevel),
        };
      }

      // ── Market Rent Estimate ───────────────────────────────────────
      let rentComps: ComparableEntry[] = [];
      let rentFallbackLevel: ComparableFallbackLevel = 'city';

      if (
        listing.latitude != null &&
        listing.longitude != null &&
        listing.geocodePrecision != null &&
        ['source_exact', 'source_approx', 'street'].includes(listing.geocodePrecision)
      ) {
        const nearbyRent = await comparables.findNearbyComparables({
          listingId: id,
          latitude: listing.latitude,
          longitude: listing.longitude,
          operationType: 'rent',
          propertyType: listing.propertyType,
          livingAreaSqm: listing.livingAreaSqm,
          rooms: listing.rooms,
          radiusM: 1000,
          maxAgeDays: 180,
        });
        if (nearbyRent.length >= 3) {
          rentComps = nearbyRent;
          rentFallbackLevel = 'nearby';
        }
      }

      if (rentComps.length < 3 && listing.districtNo != null) {
        const districtRent = await comparables.findDistrictComparables({
          listingId: id,
          districtNo: listing.districtNo,
          operationType: 'rent',
          propertyType: listing.propertyType,
          livingAreaSqm: listing.livingAreaSqm,
          maxAgeDays: 365,
        });
        if (districtRent.length > rentComps.length) {
          rentComps = districtRent;
          rentFallbackLevel = 'district';
        }
      }

      const marketRentContext =
        listing.operationType === 'sale'
          ? estimateMarketRent(rentComps, listing.livingAreaSqm, rentFallbackLevel)
          : null;

      // ── Investor Metrics ───────────────────────────────────────────
      const investorMetrics =
        listing.operationType === 'sale'
          ? computeInvestorMetrics(listing.listPriceEurCents, marketRentContext)
          : null;

      // ── Legal-Rent Assessment ──────────────────────────────────────
      let legalRentSummary: LegalRentSummary | null = null;

      if (listing.operationType === 'rent' || listing.operationType === 'sale') {
        // Gather text hints from title/description
        const textHints: string[] = [];
        if (listing.title) textHints.push(listing.title);
        if (listing.description) textHints.push(listing.description);

        // Determine year_built source — prefer building facts (official) over listing
        const effectiveYearBuilt = buildingContext?.yearBuilt ?? listing.yearBuilt;
        const yearBuiltSource =
          buildingContext?.yearBuilt != null
            ? 'official'
            : listing.yearBuilt != null
              ? 'listing'
              : null;

        const isSubsidized =
          buildingContext?.typology != null
            ? buildingContext.typology.toLowerCase().includes('gefördert') ||
              buildingContext.typology.toLowerCase().includes('gemeinde')
            : null;

        const assessment = assessLegalRent({
          yearBuilt: effectiveYearBuilt,
          yearBuiltSource,
          unitCount: buildingContext?.unitCount ?? null,
          isSubsidized,
          listingTextHints: textHints,
          livingAreaSqm: listing.livingAreaSqm,
          buildingMatchConfidence: buildingMatchConfidence,
        });

        legalRentSummary = {
          status: assessment.status,
          regimeCandidate: assessment.regimeCandidate,
          confidence: assessment.confidence,
          strongSignals: assessment.strongSignals.map((s) => ({
            signal: s.signal,
            source: s.source,
          })),
          weakSignals: assessment.weakSignals.map((s) => ({
            signal: s.signal,
            source: s.source,
          })),
          missingFacts: assessment.missingFacts,
          reviewRequired: assessment.reviewRequired,
          indicativeBandLow: assessment.indicativeBandLow,
          indicativeBandHigh: assessment.indicativeBandHigh,
          disclaimer: assessment.disclaimer,
        };
      }

      // ── District Baseline for Risk Flags ───────────────────────────
      let districtMedianPpsqm: number | null = null;
      if (listing.districtNo != null) {
        const bl = await marketBaselines.findBaseline(
          listing.districtNo,
          listing.operationType,
          listing.propertyType,
          'all',
          'all',
        );
        districtMedianPpsqm = bl?.medianPpsqmEur ?? null;
      }

      // ── Risk & Upside Flags ────────────────────────────────────────
      const riskFlagInput = {
        operationType: listing.operationType,
        propertyType: listing.propertyType,
        listPriceEurCents: listing.listPriceEurCents,
        pricePerSqmEur: listing.pricePerSqmEur,
        livingAreaSqm: listing.livingAreaSqm,
        rooms: listing.rooms,
        yearBuilt: listing.yearBuilt,
        conditionCategory: listing.conditionCategory,
        districtNo: listing.districtNo,
        geocodePrecision: listing.geocodePrecision,
        currentScore: listing.currentScore,
        completenessScore: listing.completenessScore,
        firstSeenAt: listing.firstSeenAt,
        lastPriceChangeAt: listing.lastPriceChangeAt,
        districtMedianPpsqm,
        legalRentStatus: legalRentSummary?.status ?? null,
        saleCompSampleSize: marketSaleContext?.sampleSize ?? 0,
        hasBalcony: listing.hasBalcony,
        hasTerrace: listing.hasTerrace,
        hasGarden: listing.hasGarden,
        nearestTransitDistanceM: transitPoi?.distanceM ?? null,
      };

      const riskFlags = computeRiskFlags(riskFlagInput);
      const upsideFlags = computeUpsideFlags(riskFlagInput);

      // ── Missing Data Warnings ──────────────────────────────────────
      const missingData: string[] = [];
      if (listing.livingAreaSqm == null) missingData.push('Living area not available');
      if (listing.rooms == null) missingData.push('Room count not available');
      if (listing.yearBuilt == null && buildingContext?.yearBuilt == null) {
        missingData.push('Year built not available');
      }
      if (listing.latitude == null) missingData.push('No geocoded location');
      if (listing.operationType === 'sale' && marketRentContext?.sampleSize === 0) {
        missingData.push('No rent comparables found for market rent estimate');
      }
      if (buildingContext == null) missingData.push('Building not identified');

      // ── Assumptions ────────────────────────────────────────────────
      const assumptions: string[] = [
        'All prices are asking prices, not transaction prices',
        'Comparable selection is based on currently listed properties',
      ];
      if (marketSaleContext && marketSaleContext.fallbackLevel !== 'nearby') {
        assumptions.push(
          `Sale comparables use ${marketSaleContext.fallbackLevel}-level data (broader area)`,
        );
      }
      if (marketRentContext && marketRentContext.fallbackLevel !== 'nearby') {
        assumptions.push(
          `Rent estimate uses ${marketRentContext.fallbackLevel}-level data (broader area)`,
        );
      }

      // ── Confidence Model ───────────────────────────────────────────
      const confidence = computeAnalysisConfidence({
        geocodePrecision: listing.geocodePrecision,
        saleCompSampleSize: marketSaleContext?.sampleSize ?? 0,
        rentCompSampleSize: marketRentContext?.sampleSize ?? 0,
        buildingMatchConfidence: buildingMatchConfidence,
        hasLivingArea: listing.livingAreaSqm != null,
        hasRooms: listing.rooms != null,
        hasYearBuilt: listing.yearBuilt != null || buildingContext?.yearBuilt != null,
      });

      // ── Summary ────────────────────────────────────────────────────
      const price = listing.listPriceEurCents
        ? `€${Math.round(listing.listPriceEurCents / 100).toLocaleString('de-AT')}`
        : 'Price on request';
      const area = listing.livingAreaSqm ? `${listing.livingAreaSqm}m²` : '';
      const rooms = listing.rooms ? `${listing.rooms} rooms` : '';

      const keyFacts: string[] = [];
      if (price) keyFacts.push(price);
      if (area) keyFacts.push(area);
      if (rooms) keyFacts.push(rooms);
      if (listing.districtName) keyFacts.push(listing.districtName);
      if (listing.pricePerSqmEur) keyFacts.push(`€${Math.round(listing.pricePerSqmEur)}/m²`);

      const analysis: ListingAnalysis = {
        listingId: id,
        summary: {
          headline: listing.title,
          keyFacts,
        },
        locationContext,
        buildingContext,
        marketSaleContext,
        marketRentContext,
        investorMetrics,
        riskFlags,
        upsideFlags,
        assumptions,
        missingData,
        legalRentSummary,
        confidence,
        computedAt: new Date(),
      };

      return reply.send({ data: analysis });
    },
  );
}
