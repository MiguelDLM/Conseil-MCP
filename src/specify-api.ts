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

  // Django's CSRF middleware on Specify requires a Referer header when it
  // sees the connection as HTTPS (which it does behind any TLS-terminating
  // ingress). We pre-bake the Referer to the base URL on every request.
  client = axios.create({
    baseURL: config.specify.url,
    withCredentials: true,
    headers: {
      'Content-Type': 'application/json',
      Referer: config.specify.url,
    },
  });

  // Persist cookies across requests (axios does not by default in Node).
  const jar = new Map<string, string>();
  client.interceptors.response.use(resp => {
    const sc = resp.headers['set-cookie'];
    if (sc) {
      for (const c of sc) {
        const [cookie] = c.split(';');
        const [name, ...valueParts] = cookie.split('=');
        jar.set(name.trim(), valueParts.join('='));
      }
    }
    return resp;
  });
  client.interceptors.request.use(req => {
    if (jar.size > 0) {
      req.headers.Cookie = Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    // Ensure Referer and Origin are set to the baseURL to satisfy Django's CSRF
    req.headers.Referer = config.specify.url;
    req.headers.Origin = new URL(config.specify.url).origin;
    return req;
  });

  try {
    // 1. Prime the CSRF cookie by hitting the login endpoint.
    const loginResp = await client.get('/context/login/');
    const setCookie = loginResp.headers['set-cookie'];
    const csrfCookie = setCookie?.find((c: string) => c.includes('csrftoken'));
    csrfToken = csrfCookie?.match(/csrftoken=([^;]+)/)?.[1] ?? null;
    if (!csrfToken) throw new Error('Could not get CSRF token from /context/login/');

    // 2. Authenticate.
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
    const detail = err.response?.status ? ` (HTTP ${err.response.status})` : '';
    throw new Error(`Specify API Login failed${detail}: ${err.message}`);
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

export async function apiDelete(path: string): Promise<unknown> {
  const c = await getClient();
  // For DELETE, Specify requires the version in the If-Match header usually,
  // but for generic API pass-through we will expose a method that takes headers if needed.
  // We'll handle this generically in the universal wrapper.
  const { data } = await c.delete(path, {
    headers: { 'X-CSRFToken': csrfToken! },
  });
  return data;
}

export async function executeSpecifyApi(method: string, path: string, body?: any, queryParams?: Record<string, string>, extraHeaders?: Record<string, string>): Promise<any> {
  const c = await getClient();
  const reqMethod = method.toUpperCase();
  
  const configOpts: any = {
    method: reqMethod,
    url: path,
    headers: { 'X-CSRFToken': csrfToken!, ...(extraHeaders || {}) }
  };

  if (queryParams) {
    configOpts.params = queryParams;
  }

  if (body && ['POST', 'PUT', 'PATCH'].includes(reqMethod)) {
    configOpts.data = body;
  }

  try {
    const response = await c.request(configOpts);
    return response.data;
  } catch (error: any) {
    const status = error.response?.status || 'Unknown';
    const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Specify API ${reqMethod} ${path} failed (HTTP ${status}): ${errorData}`);
  }
}

export function setCollection(id: number): void {
  collectionId = id;
  client = null; // force re-login with new collection
}
