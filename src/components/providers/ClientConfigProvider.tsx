'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ClientConfig } from '@/clients/types';

const ClientConfigContext = createContext<ClientConfig | null>(null);

/** Receives the active client config from the server layout (CLIENT_ID is server-only). */
export function ClientConfigProvider({ client, children }: { client: ClientConfig; children: ReactNode }) {
  return <ClientConfigContext.Provider value={client}>{children}</ClientConfigContext.Provider>;
}

export function useClient(): ClientConfig {
  const client = useContext(ClientConfigContext);
  if (!client) throw new Error('useClient must be used inside ClientConfigProvider');
  return client;
}
