/**
 * Plazi API Client for Taxonomic Treatments and Material Citations.
 */
import axios from 'axios';

const PLAZI_BASE = 'https://api.plazi.org/v1';

export interface PlaziTreatment {
  documentId: string;
  title: string;
  author: string;
  year: string;
  journal: string;
  fullText?: string;
}

export async function searchPlaziTreatments(genus: string, species?: string): Promise<any[]> {
  const params: any = { genus, format: 'Json' };
  if (species) params.species = species;
  
  const { data } = await axios.get(`${PLAZI_BASE}/Treatments/search`, { params });
  return data || [];
}

export async function getPlaziTreatmentSummary(uuid: string): Promise<any> {
  const { data } = await axios.get(`${PLAZI_BASE}/Treatments/summary`, {
    params: { UUID: uuid, format: 'Json' }
  });
  return data;
}

export async function getPlaziMaterialCitations(genus: string, species?: string): Promise<any[]> {
  const params: any = { genus, format: 'Json' };
  if (species) params.species = species;
  
  const { data } = await axios.get(`${PLAZI_BASE}/Taxon/MaterialCitations`, { params });
  return data || [];
}

/**
 * Search treatments by DOI to link literature.
 */
export async function searchPlaziByDOI(doi: string): Promise<any[]> {
  const { data } = await axios.get(`${PLAZI_BASE}/Treatments/searchByDOI`, {
    params: { DOI: doi, format: 'Json' }
  });
  return data || [];
}
