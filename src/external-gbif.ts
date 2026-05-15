/**
 * GBIF API Client for Taxonomic Curation.
 */
import axios from 'axios';

const GBIF_BASE = 'https://api.gbif.org/v1';

export interface GbifMatchResponse {
  usageKey?: number;
  scientificName?: string;
  rank?: string;
  status?: string;
  confidence?: number;
  matchType?: 'EXACT' | 'FUZZY' | 'HIGHERRANK' | 'NONE';
  acceptedUsageKey?: number;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  synonym?: boolean;
}

export async function matchGbifTaxon(name: string, kingdom?: string): Promise<GbifMatchResponse> {
  const params = { name, kingdom, verbose: false };
  const { data } = await axios.get(`${GBIF_BASE}/species/match`, { params });
  return data;
}

export async function getGbifTaxonDetails(usageKey: number): Promise<any> {
  const { data } = await axios.get(`${GBIF_BASE}/species/${usageKey}`);
  return data;
}

export async function getGbifSynonyms(usageKey: number): Promise<any[]> {
  const { data } = await axios.get(`${GBIF_BASE}/species/${usageKey}/synonyms`);
  return data.results || [];
}

export interface GbifOccurrenceSearchParams {
  taxonName?: string;
  taxonKey?: number;
  decimalLatitude?: string;  // e.g. "30,40" (range)
  decimalLongitude?: string;
  country?: string;          // ISO 3166-1 alpha-2
  hasCoordinate?: boolean;
  limit?: number;
}

export interface GbifOccurrence {
  key: number;
  scientificName: string;
  acceptedScientificName: string | null;
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  country: string | null;
  locality: string | null;
  eventDate: string | null;
  basisOfRecord: string | null;
  institutionCode: string | null;
  catalogNumber: string | null;
  recordedBy: string | null;
  url: string;
}

export async function searchGbifOccurrences(p: GbifOccurrenceSearchParams): Promise<GbifOccurrence[]> {
  const params: Record<string, string | number | boolean> = {
    limit: Math.max(1, Math.min(300, p.limit ?? 20)),
  };
  if (p.taxonName) params.scientificName = p.taxonName;
  if (p.taxonKey !== undefined) params.taxonKey = p.taxonKey;
  if (p.decimalLatitude) params.decimalLatitude = p.decimalLatitude;
  if (p.decimalLongitude) params.decimalLongitude = p.decimalLongitude;
  if (p.country) params.country = p.country;
  if (p.hasCoordinate !== undefined) params.hasCoordinate = p.hasCoordinate;

  const { data } = await axios.get(`${GBIF_BASE}/occurrence/search`, { params, timeout: 20_000 });
  return (data.results || []).map((r: any): GbifOccurrence => ({
    key: r.key,
    scientificName: r.scientificName || '',
    acceptedScientificName: r.acceptedScientificName || null,
    decimalLatitude: r.decimalLatitude ?? null,
    decimalLongitude: r.decimalLongitude ?? null,
    country: r.country || null,
    locality: r.locality || null,
    eventDate: r.eventDate || null,
    basisOfRecord: r.basisOfRecord || null,
    institutionCode: r.institutionCode || null,
    catalogNumber: r.catalogNumber || null,
    recordedBy: r.recordedBy || null,
    url: `https://www.gbif.org/occurrence/${r.key}`,
  }));
}
