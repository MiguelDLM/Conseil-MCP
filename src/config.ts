import { z } from 'zod';

const ConnectionModeSchema = z.enum(['direct', 'kubectl', 'docker']);

export const ConfigSchema = z.object({
  // Connection mode
  mode: ConnectionModeSchema.default('direct'),

  // Database credentials
  db: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(3306),
    user: z.string().default('master'),
    password: z.string().default('master'),
    database: z.string().default('specify'),
  }),

  // Kubernetes specific
  kubectl: z.object({
    namespace: z.string().default('specify7'),
    mariadbPod: z.string().default('mariadb-0'),
    webPod: z.string().default('deploy/specify7-web'),
    webContainer: z.string().default('gunicorn'),
  }),

  // Docker specific
  docker: z.object({
    mariadbContainer: z.string().default('specify7-mariadb'),
    webContainer: z.string().default('specify7-web'),
  }),

  // Specify 7 specific
  specify: z.object({
    // Internal URL used for HTTP calls (typically a k8s service like
    // http://specify7-web).
    url: z.string().default('http://localhost:8080'),
    // Public URL Django expects in the Referer header (must match one of the
    // entries in CSRF_TRUSTED_ORIGINS). Defaults to `url`.
    referer: z.string().default(''),
    appDir: z.string().default('/opt/specify7'),
    collectionId: z.number().default(4),
    userId: z.number().default(1),
    username: z.string().default('master'),
    password: z.string().default(''),
  }),
  bhlApiKey: z.string().optional().default(''),
  morphosourceApiKey: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const env = process.env;
  
  return ConfigSchema.parse({
    mode: env.SPECIFY_CONNECTION_MODE,
    db: {
      host: env.SPECIFY_DB_HOST,
      port: env.SPECIFY_DB_PORT ? parseInt(env.SPECIFY_DB_PORT) : undefined,
      user: env.SPECIFY_DB_USER,
      password: env.SPECIFY_DB_PASSWORD,
      database: env.SPECIFY_DB_NAME,
    },
    kubectl: {
      namespace: env.SPECIFY_K8S_NAMESPACE,
      mariadbPod: env.SPECIFY_K8S_MARIADB_POD,
      webPod: env.SPECIFY_K8S_WEB_POD,
      webContainer: env.SPECIFY_K8S_WEB_CONTAINER,
    },
    docker: {
      mariadbContainer: env.SPECIFY_DOCKER_MARIADB_CONTAINER,
      webContainer: env.SPECIFY_DOCKER_WEB_CONTAINER,
    },
    specify: {
      url: env.SPECIFY_URL,
      referer: env.SPECIFY_REFERER || env.SPECIFY_URL,
      appDir: env.SPECIFY_APP_DIR,
      collectionId: env.SPECIFY_COLLECTION_ID ? parseInt(env.SPECIFY_COLLECTION_ID) : undefined,
      userId: env.SPECIFY_USER_ID ? parseInt(env.SPECIFY_USER_ID) : undefined,
      username: env.SPECIFY_USER || env.SPECIFY_USERNAME,
      password: env.SPECIFY_PASSWORD || env.SPECIFY_PASS,
    },
    bhlApiKey: env.BHL_API_KEY,
    morphosourceApiKey: env.MORPHOSOURCE_API_KEY,
  });
}

export const config = loadConfig();
