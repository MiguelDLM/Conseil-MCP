/**
 * iNaturalist observations API — recent observations with photos for a taxon
 * or within a bounding box. Useful as supplementary distribution evidence.
 */
import axios from 'axios';

const INAT_BASE = 'https://api.inaturalist.org/v1';

export interface InatObservation {
  id: number;
  scientificName: string;
  observedOn: string | null;
  placeGuess: string | null;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  observerLogin: string | null;
  url: string;
}

export interface InatSearchParams {
  taxon_name?: string;
  per_page?: number;
  swlat?: number;
  swlng?: number;
  nelat?: number;
  nelng?: number;
}

export async function searchInaturalist(params: InatSearchParams): Promise<InatObservation[]> {
  const q: Record<string, string | number> = {
    photos: 'true',
    quality_grade: 'research',
    per_page: Math.max(1, Math.min(50, params.per_page ?? 20)),
  };
  if (params.taxon_name) q.taxon_name = params.taxon_name;
  if (params.swlat !== undefined && params.swlng !== undefined && params.nelat !== undefined && params.nelng !== undefined) {
    q.swlat = params.swlat; q.swlng = params.swlng; q.nelat = params.nelat; q.nelng = params.nelng;
  }

  const { data } = await axios.get(`${INAT_BASE}/observations`, {
    params: q,
    headers: { 'User-Agent': 'ConseilMCP/1.0' },
    timeout: 20_000,
  });

  return (data?.results || []).map((o: any): InatObservation => ({
    id: o.id,
    scientificName: o.taxon?.name || '',
    observedOn: o.observed_on || null,
    placeGuess: o.place_guess || null,
    latitude: o.geojson?.coordinates?.[1] ?? null,
    longitude: o.geojson?.coordinates?.[0] ?? null,
    photoUrl: o.photos?.[0]?.url?.replace('square.', 'medium.') || null,
    observerLogin: o.user?.login || null,
    url: `https://www.inaturalist.org/observations/${o.id}`,
  }));
}
