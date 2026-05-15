/**
 * Specify 7 REST API client.
 */
import axios, { AxiosInstance } from 'axios';
import { config } from './config.js';

let client: AxiosInstance | null = null;
let csrfToken: string | null = null;
let collectionId: number = config.specify.collectionId;

export async function getClient(): Promise<AxiosInstance> {
  if (client) return client;

  client = axios.create({
    baseURL: config.specify.url,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    // Get CSRF token
    const loginResp = await client.get('/context/login/');
    const setCookie = loginResp.headers['set-cookie'];
    const csrfCookie = setCookie?.find((c: string) => c.includes('csrftoken'));
    csrfToken = csrfCookie?.match(/csrftoken=([^;]+)/)?.[1] ?? null;

    if (!csrfToken) throw new Error('Could not get CSRF token');

    // Login
    await client.put('/context/login/', {
      username: config.specify.username,
      password: config.specify.password,
      collection: collectionId,
    }, {
      headers: { 'X-CSRFToken': csrfToken },
    });

    client.defaults.headers.common['X-CSRFToken'] = csrfToken;
  } catch (err: any) {
    client = null;
    throw new Error(`Specify API Login failed: ${err.message}`);
  }

  return client;
}

export async function apiGet(path: string): Promise<unknown> {
  const c = await getClient();
  const { data } = await c.get(path);
  return data;
}

export async function apiPut(path: string, body: unknown): Promise<unknown> {
  const c = await getClient();
  const { data } = await c.put(path, body, {
    headers: { 'X-CSRFToken': csrfToken! },
  });
  return data;
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const c = await getClient();
  const { data } = await c.patch(path, body, {
    headers: { 'X-CSRFToken': csrfToken! },
  });
  return data;
}

export async function apiPost(path: string, body: unknown): Promise<unknown> {
  const c = await getClient();
  const { data } = await c.post(path, body, {
    headers: { 'X-CSRFToken': csrfToken! },
  });
  return data;
}

export function setCollection(id: number): void {
  collectionId = id;
  client = null; // force re-login with new collection
}
