// Shape of a client (community) configuration. One file per client in this
// folder; the active one is picked by the CLIENT_ID env var (see ./index.ts).
// Everything here is plain serializable data so it can be handed from the
// server layout to client components as-is.

import type { IconName } from '@/components/icons';

/** Visual tone keys, mapped to palette colors in globals.css (.tone-*). */
export type Tone = 'brand' | 'indigo' | 'amber' | 'rose' | 'emerald' | 'slate';

export interface ClientLogo {
  /** Logo for light backgrounds (path under /public). */
  light: string;
  /** Optional logo for dark backgrounds; falls back to `light` on a light plate. */
  dark?: string;
  /** Intrinsic pixel size of the logo files, used for aspect ratio. */
  width: number;
  height: number;
}

export interface DepartmentSeed {
  id: string;
  name: string;
  description: string;
  phone: string;
  keywords: string[];
  icon: IconName;
  tone: Tone;
}

export interface KnowledgeBaseCategory {
  /** Stored as a "[key] " filename prefix on Retell KB sources - don't rename once live. */
  key: string;
  label: string;
  uploadTitle: string;
  uploadDescription: string;
  icon: IconName;
}

export interface CallCategory {
  label: string;
  tone: Tone;
}

export interface ClientConfig {
  id: string;
  name: string;
  /** e.g. "Life Plan Community" - shown under the name where there's room. */
  descriptor?: string;
  logo: ClientLogo;
  /** Browser tab icon (path under /public). */
  icon?: string;
  contact: {
    website?: string;
    phone?: string;
    address?: string;
  };
  /** Placeholder shown in the sign-in email field. */
  loginEmailHint: string;
  /** How residents are referred to in copy ("residents", "members", ...). */
  audience: string;
  /**
   * IANA time zone of the community (e.g. "America/New_York"). Days, charts and
   * timestamps are shown in this zone for every viewer.
   */
  timezone: string;

  /**
   * Client-specific wiring into this community's Retell agent. Tool names
   * must match the tools configured on the live agent exactly.
   */
  integrations: {
    retell: {
      /** Retell tool name -> call category key (first match wins, in call order). */
      toolCategories: Record<string, string>;
    };
  };
  /** Labels for the category keys produced by `toolCategories`. */
  callCategories: Record<string, CallCategory>;
  knowledgeBase: { categories: KnowledgeBaseCategory[] };
  /** Starting department list for Call Routing; saving pushes it to the agent's transfer_call tool. */
  departments: DepartmentSeed[];
}
