/**
 * Crossref + Unpaywall — resolve DOIs to metadata and find open-access PDFs.
 *
 * Crossref:   https://api.crossref.org (public, polite-pool via mailto)
 * Unpaywall:  https://api.unpaywall.org (free, requires email param)
 */
import axios from 'axios';

const CROSSREF_BASE = 'https://api.crossref.org';
const UNPAYWALL_BASE = 'https://api.unpaywall.org/v2';

function politeMailto(): string {
  // Unpaywall rejects synthetic domains with HTTP 422. Prefer a real address
  // configured by env. The fallback uses a publicly-reachable mailbox so the
  // tool still works out-of-the-box without configuration.
  return process.env.CROSSREF_MAILTO || process.env.UNPAYWALL_EMAIL || 'unpaywall@impactstory.org';
}

export interface CrossrefWork {
  doi: string;
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  publisher: string | null;
  type: string | null;
  url: string | null;
  isbn: string | null;
}

export async function resolveDoi(doi: string): Promise<CrossrefWork | null> {
  const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
  const url = `${CROSSREF_BASE}/works/${encodeURIComponent(cleanDoi)}`;

  try {
    const { data } = await axios.get(url, {
      params: { mailto: politeMailto() },
      headers: { 'User-Agent': 'ConseilMCP/1.0 (mailto:' + politeMailto() + ')' },
      timeout: 15_000,
    });
    const msg = data?.message;
    if (!msg) return null;
    return {
      doi: msg.DOI,
      title: Array.isArray(msg.title) ? msg.title[0] : (msg.title || ''),
      authors: (msg.author || []).map((a: any) =>
        [a.family, a.given].filter(Boolean).join(', ').trim()
      ),
      year: msg.issued?.['date-parts']?.[0]?.[0] ?? msg['published-print']?.['date-parts']?.[0]?.[0] ?? null,
      journal: Array.isArray(msg['container-title']) ? msg['container-title'][0] : (msg['container-title'] || null),
      publisher: msg.publisher || null,
      type: msg.type || null,
      url: msg.URL || `https://doi.org/${msg.DOI}`,
      isbn: Array.isArray(msg.ISBN) ? msg.ISBN[0] : (msg.ISBN || null),
    };
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw new Error(`Crossref resolve failed: ${err.message}`);
  }
}

export interface UnpaywallResult {
  doi: string;
  isOpenAccess: boolean;
  bestOaPdfUrl: string | null;
  bestOaLocation: string | null;
  license: string | null;
  oaStatus: string | null;
}

export async function findOpenAccess(doi: string): Promise<UnpaywallResult | null> {
  const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
  const url = `${UNPAYWALL_BASE}/${encodeURIComponent(cleanDoi)}`;

  try {
    const { data } = await axios.get(url, {
      params: { email: politeMailto() },
      timeout: 15_000,
    });
    const best = data.best_oa_location || null;
    return {
      doi: data.doi,
      isOpenAccess: data.is_oa === true,
      bestOaPdfUrl: best?.url_for_pdf || null,
      bestOaLocation: best?.url || null,
      license: best?.license || null,
      oaStatus: data.oa_status || null,
    };
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw new Error(`Unpaywall lookup failed: ${err.message}`);
  }
}
