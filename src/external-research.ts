/**
 * Comprehensive API clients for Research Pillar Integration:
 * 1. NCBI (Molecular)
 * 2. BHL (Historical Literature)
 * 3. iDigBio (Visual Evidence)
 * 4. WoRMS (Marine Taxonomy)
 * 5. Open-Elevation (Geographic validation)
 */
import axios from 'axios';
import { config } from './config.js';

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const BHL_BASE = 'https://www.biodiversitylibrary.org/api2/httpquery.ashx';
const IDIGBIO_BASE = 'https://search.idigbio.org/v2';
const WORMS_BASE = 'https://www.marinespecies.org/rest';
const ELEVATION_BASE = 'https://api.open-elevation.com/api/v1/lookup';

// ─── NCBI ENTREZ (Molecular) ────────────────────────────────────────────────

export async function searchGenBank(taxonName: string): Promise<any[]> {
  const searchUrl = `${NCBI_BASE}/esearch.fcgi?db=nucleotide&term=${encodeURIComponent(taxonName)}&retmode=json&retmax=10`;
  const { data } = await axios.get(searchUrl);
  const ids = data.esearchresult?.idlist || [];
  
  if (ids.length === 0) return [];
  
  const summaryUrl = `${NCBI_BASE}/esummary.fcgi?db=nucleotide&id=${ids.join(',')}&retmode=json`;
  const summaryResp = await axios.get(summaryUrl);
  return Object.values(summaryResp.data.result || {}).filter(x => typeof x === 'object');
}

// ─── BHL (Historical Literature) ────────────────────────────────────────────

export async function searchBHL(taxonName: string, apiKey?: string): Promise<any[]> {
  const effectiveKey = apiKey || config.bhlApiKey;
  if (!effectiveKey) {
    throw new Error('BHL_API_KEY is not configured. Set the env var or pass an apiKey argument.');
  }

  const params = {
    op: 'TaxonSearch',
    name: taxonName,
    format: 'json',
    apikey: effectiveKey
  };
  const { data } = await axios.get(BHL_BASE, { params });
  return data.Result || [];
}

// ─── IDIGBIO (Visual Evidence) ──────────────────────────────────────────────

export async function searchIDigBioImages(taxonName: string): Promise<any[]> {
  const query = {
    "scientificname": taxonName,
    "hasImage": true
  };
  const { data } = await axios.post(`${IDIGBIO_BASE}/search/records/`, {
    rq: query,
    limit: 10
  });
  return data.items || [];
}

// ─── WORMS (Marine Taxonomy) ────────────────────────────────────────────────

export async function matchWoRMSTaxon(name: string): Promise<any[]> {
  const { data } = await axios.get(`${WORMS_BASE}/AphiaRecordsByName/${encodeURIComponent(name)}`, {
    params: { like: true, fuzzy: true, marine_only: false }
  });
  return Array.isArray(data) ? data : [data];
}

// ─── ELEVATION (Geographic Validation) ──────────────────────────────────────

export async function getElevation(lat: number, lon: number): Promise<number | null> {
  try {
    const { data } = await axios.get(ELEVATION_BASE, {
      params: { locations: `${lat},${lon}` }
    });
    return data.results?.[0]?.elevation || null;
  } catch {
    return null;
  }
}
