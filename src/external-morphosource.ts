/**
 * Morphosource API Client.
 */
import axios from 'axios';
import { config } from './config.js';

const MORPHOSOURCE_BASE = 'https://www.morphosource.org/api';

const client = axios.create({
  baseURL: MORPHOSOURCE_BASE,
  headers: config.morphosourceApiKey ? {
    'Authorization': config.morphosourceApiKey
  } : {}
});

export interface MorphosourceMedia {
  id: string;
  title: string;
  media_type: string;
  thumbnail_url?: string;
  physical_object_id?: string;
}

export interface MorphosourcePhysicalObject {
  id: string;
  taxonomy_name?: string;
  institution_code?: string;
  collection_code?: string;
  catalog_number?: string;
}

export async function searchMorphosourceMedia(query: string, filters: Record<string, string> = {}): Promise<any[]> {
  const params: any = { q: query };
  for (const [key, value] of Object.entries(filters)) {
    params[`f.${key}`] = value;
  }
  
  const { data } = await client.get(`/media`, { params });
  return data.response?.media || [];
}

export async function searchMorphosourcePhysicalObjects(query: string, filters: Record<string, string> = {}): Promise<any[]> {
  const params: any = { q: query };
  for (const [key, value] of Object.entries(filters)) {
    params[`f.${key}`] = value;
  }
  
  const { data } = await client.get(`/physical-objects`, { params });
  return data.response?.physical_objects || [];
}

export async function getMorphosourceMediaDetails(id: string): Promise<any> {
  const { data } = await client.get(`/media/${id}`);
  return data;
}

export async function getMorphosourcePhysicalObjectDetails(id: string): Promise<any> {
  const { data } = await client.get(`/physical-objects/${id}`);
  return data;
}

export async function getMorphosourceDownloadUrl(mediaId: string, useStatement: string, useCategory: string = 'Research'): Promise<string> {
  if (useStatement.length < 50) {
    throw new Error('Morphosource requires a use statement of at least 50 characters.');
  }

  const { data } = await client.post(`/media/${mediaId}/download`, {
    use_statement: useStatement,
    use_category: useCategory,
    terms_agreed: true
  });
  
  // The API returns a direct S3 or temporary URL
  return data.download_url || data.url || (data.file_metadata && data.file_metadata.url);
}
