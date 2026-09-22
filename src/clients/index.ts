// Client registry. Each deployment serves exactly one client, chosen by the
// CLIENT_ID env var. To onboard a new community: add src/clients/<id>.ts,
// drop its logos in public/clients/<id>/, register it below, and deploy with
// CLIENT_ID=<id> plus that community's RETELL_API_KEY / AGENT_ID.

import type { ClientConfig } from './types';
import { seabury } from './seabury';

const CLIENTS: Record<string, ClientConfig> = {
  [seabury.id]: seabury,
};

const DEFAULT_CLIENT_ID = seabury.id;

/** Server-only: reads CLIENT_ID. Client components get the config from ClientConfigProvider. */
export function getActiveClient(): ClientConfig {
  const id = process.env.CLIENT_ID || DEFAULT_CLIENT_ID;
  const client = CLIENTS[id];
  if (!client) {
    throw new Error(`Unknown CLIENT_ID "${id}". Known clients: ${Object.keys(CLIENTS).join(', ')}`);
  }
  return client;
}

export type { ClientConfig } from './types';
