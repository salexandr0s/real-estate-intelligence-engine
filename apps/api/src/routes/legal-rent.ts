import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@immoradar/observability';
import type { LegalRentSummary, BuildingContext } from '@immoradar/contracts';
import { listings, buildingFacts } from '@immoradar/db';
import { assessLegalRent } from '@immoradar/legal-rent';
import { parseOrThrow, idParamSchema } from '../schemas.js';

export async function legalRentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/listings/:id/legal-rent
   *
   * Standalone rent-regulation assessment for a listing.
   * Returns the legal-rent regime classification, signals, and confidence.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/legal-rent',
    {
      schema: {
        tags: ['Analysis'],
        summary: 'Get legal-rent assessment for a listing',
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      const listing = await listings.findById(id);
      if (!listing) {
        throw new NotFoundError('Listing', id);
      }

      // ── Building Facts lookup ──────────────────────────────────────
      let buildingContext: BuildingContext | null = null;
      let buildingMatchConfidence: string | null = null;

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

      // ── Assessment ─────────────────────────────────────────────────
      const textHints: string[] = [];
      if (listing.title) textHints.push(listing.title);
      if (listing.description) textHints.push(listing.description);

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

      const legalRentSummary: LegalRentSummary = {
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

      return reply.send({
        data: {
          listingId: id,
          buildingContext,
          legalRent: legalRentSummary,
          computedAt: new Date(),
        },
      });
    },
  );
}
