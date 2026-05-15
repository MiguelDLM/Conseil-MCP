/**
 * IUCN Red List API v3/v4 — conservation status for a species.
 *
 * Requires IUCN_API_KEY (free, register at apiv3.iucnredlist.org/api/v3/token).
 * Maps to Specify's `taxon.EnvironmentalProtectionStatus` field.
 */
import axios from 'axios';

const IUCN_BASE = 'https://apiv3.iucnredlist.org/api/v3';

export interface IucnSpecies {
  taxonName: string;
  category: string | null;
  populationTrend: string | null;
  yearAssessed: number | null;
  scopes: string[];
  url: string;
}

function getKey(): string {
  const k = process.env.IUCN_API_KEY;
  if (!k) throw new Error('IUCN_API_KEY not set. Register at https://apiv3.iucnredlist.org/api/v3/token.');
  return k;
}

export async function lookupIucnStatus(taxonName: string): Promise<IucnSpecies | null> {
  const token = getKey();
  const url = `${IUCN_BASE}/species/${encodeURIComponent(taxonName)}`;
  try {
    const { data } = await axios.get(url, { params: { token }, timeout: 15_000 });
    const result = data?.result?.[0];
    if (!result) return null;
    return {
      taxonName: result.scientific_name,
      category: result.category || null,
      populationTrend: result.population_trend || null,
      yearAssessed: result.assessment_date ? parseInt(String(result.assessment_date).slice(0, 4)) : null,
      scopes: Array.isArray(result.scopes) ? result.scopes.map((s: any) => s.scope) : [],
      url: `https://www.iucnredlist.org/species/${result.taxonid}/0`,
    };
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw new Error(`IUCN lookup failed: ${err.message}`);
  }
}
