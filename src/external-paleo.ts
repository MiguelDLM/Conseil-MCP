/**
 * External API clients for Paleo and Geology data (Macrostrat & PBDB).
 */
import axios from 'axios';

const MACROSTRAT_BASE = 'https://macrostrat.org/api/v2';
const PBDB_BASE = 'https://paleobiodb.org/data1.2';

// ─── MACROSTRAT ─────────────────────────────────────────────────────────────

export async function getMacrostratInterval(name: string): Promise<any[]> {
  const { data } = await axios.get(`${MACROSTRAT_BASE}/defs/intervals`, {
    params: { name }
  });
  return data.success?.data || [];
}

export async function getMacrostratStratName(name: string): Promise<any[]> {
  const { data } = await axios.get(`${MACROSTRAT_BASE}/defs/strat_names`, {
    params: { strat_name: name }
  });
  return data.success?.data || [];
}

// ─── PBDB ───────────────────────────────────────────────────────────────────

export async function matchPbdbTaxon(name: string): Promise<any[]> {
  const { data } = await axios.get(`${PBDB_BASE}/taxa/list.json`, {
    params: { name, vocab: 'pbdb' }
  });
  return data.records || [];
}

export async function getPbdbInterval(name: string): Promise<any[]> {
  const { data } = await axios.get(`${PBDB_BASE}/intervals/list.json`, {
    params: { name, vocab: 'pbdb' }
  });
  return data.records || [];
}

/**
 * Search stratigraphic units in PBDB. The strata endpoint always returns the
 * long-form attribute names (formation/group/member/lithology) regardless of
 * `vocab=pbdb`, so we leave them as-is and let callers reshape.
 */
export async function searchPbdbStrata(name: string): Promise<any[]> {
  const { data } = await axios.get(`${PBDB_BASE}/strata/list.json`, {
    params: { name }
  });
  return data.records || [];
}

/**
 * Get occurrences of a taxon in a specific formation. The occs endpoint
 * exposes `formation`/`stratgroup`/`member` as filters — `strat_name` is not
 * accepted (returns 400).
 */
export async function getPbdbTaxonOccurrences(taxonName: string, stratumName?: string): Promise<any[]> {
  const params: any = { base_name: taxonName, vocab: 'pbdb', limit: 50 };
  if (stratumName) params.formation = stratumName;

  const { data } = await axios.get(`${PBDB_BASE}/occs/list.json`, { params });
  return data.records || [];
}

/**
 * List common taxa reported for a specific formation.
 */
export async function getPbdbStrataTaxa(stratumName: string): Promise<any[]> {
  const { data } = await axios.get(`${PBDB_BASE}/occs/list.json`, {
    params: { formation: stratumName, vocab: 'pbdb', limit: 100 }
  });
  return data.records || [];
}

/**
 * List formations recorded in a geologic interval (e.g., "Maastrichtian").
 * Returns deduplicated formation names with collection counts.
 *
 * Uses /colls/list with show=strat — that endpoint adds an `sfm` field with
 * the formation name. /occs/list does NOT include formation in any vocab/show
 * combination, despite documentation suggesting it should.
 */
export async function listFormationsInInterval(intervalName: string, limit = 50): Promise<{ formation: string; collections: number }[]> {
  const { data } = await axios.get(`${PBDB_BASE}/colls/list.json`, {
    params: { interval: intervalName, show: 'strat', limit: 5000 }
  });
  const records = data.records || [];
  const counts: Record<string, number> = {};
  for (const r of records) {
    const fm = r.sfm || r.formation;
    if (!fm) continue;
    counts[fm] = (counts[fm] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map(([formation, collections]) => ({ formation, collections }));
}
