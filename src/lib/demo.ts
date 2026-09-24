// Server-only: optional fixture mode (`npm run dev:demo`), for clicking through
// the console with generated sample data instead of a live Retell agent.
// Enabled by NUVA_DEMO=1 and ONLY under `next dev` - Next sets NODE_ENV to
// "production" for builds, so a deployed app can never turn this on. Sign-in is
// the same as always (lib/auth); this only swaps the data source. Route handlers
// check isDemoMode() before calling Retell and serve the fixtures below instead.

import { getActiveClient } from '@/clients';
import { DEFAULT_LOGIN } from './auth';
import type { CallWindow, DepartmentTransferInput, KnowledgeBaseSourceInfo, LiveRouting, RetellRawCall } from './retell';

export const DEMO_CREDENTIALS = DEFAULT_LOGIN;

export function isDemoMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.NUVA_DEMO === '1';
}

// --- Sample calls -----------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pickWeighted<T>(rand: () => number, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    if ((r -= w) <= 0) return item;
  }
  return items[items.length - 1][0];
}

/** Conversation templates keyed by call category (see ClientConfig.callCategories). */
const SCRIPTS: Record<string, { summary: string; turns: [string, string][] }[]> = {
  meal: [
    {
      summary: 'Resident asked about tonight’s dinner menu and chose the herb-roasted salmon with a side salad.',
      turns: [
        ['User', 'Hi, what’s for dinner tonight?'],
        ['Agent', 'Tonight’s dinner features herb-roasted salmon, a vegetable lasagna, or a chef’s salad. Would you like to hear the sides?'],
        ['User', 'The salmon sounds lovely. Can I get a side salad with it?'],
        ['Agent', 'Of course. I’ve noted the salmon with a side salad. Dinner service starts at 5 PM in the main dining room.'],
      ],
    },
    {
      summary: 'Resident confirmed a low-sodium option for lunch and asked about dessert.',
      turns: [
        ['User', 'Is there a low-salt option at lunch today?'],
        ['Agent', 'Yes, the grilled chicken with steamed vegetables is prepared low-sodium today.'],
        ['User', 'And dessert?'],
        ['Agent', 'Dessert is a fresh berry parfait or sugar-free lemon cookies.'],
      ],
    },
  ],
  grocery: [
    {
      summary: 'Resident asked when the next grocery shuttle runs and signed up for Thursday.',
      turns: [
        ['User', 'When is the next grocery trip?'],
        ['Agent', 'The grocery shuttle leaves Thursday at 10 AM from the front entrance. Would you like me to add you to the list?'],
        ['User', 'Yes please.'],
        ['Agent', 'You’re on the list for Thursday at 10 AM.'],
      ],
    },
  ],
  service: [
    {
      summary: 'Resident reported a leaking kitchen faucet; a maintenance request was created.',
      turns: [
        ['User', 'My kitchen faucet has been dripping since this morning.'],
        ['Agent', 'I’m sorry about that. I’ve created a maintenance request for a leaking kitchen faucet. Is your apartment number still 214?'],
        ['User', 'Yes, 214.'],
        ['Agent', 'Thank you. Maintenance will visit today between 1 and 4 PM.'],
      ],
    },
    {
      summary: 'Resident said the hallway light outside their door was out; maintenance was notified.',
      turns: [
        ['User', 'The light in the hallway by my door is out.'],
        ['Agent', 'Thanks for letting me know. I’ve logged a request to replace the hallway light near your apartment.'],
      ],
    },
  ],
  community: [
    {
      summary: 'Resident asked about the fitness center hours and this week’s chair yoga class.',
      turns: [
        ['User', 'What time does the fitness center open?'],
        ['Agent', 'The fitness center is open from 6 AM to 9 PM daily. Chair yoga is Tuesday and Friday at 10 AM.'],
        ['User', 'Great, thank you.'],
      ],
    },
    {
      summary: 'Resident asked about the guest parking policy for a weekend visit.',
      turns: [
        ['User', 'My daughter is visiting Saturday. Where can she park?'],
        ['Agent', 'Guests can park in the visitor lot by the main entrance. Please have her check in at the front desk.'],
      ],
    },
  ],
  transfer_only: [
    {
      summary: 'Resident felt dizzy and was transferred to the nursing staff.',
      turns: [
        ['User', 'I’m feeling a bit dizzy and I’m not sure what to do.'],
        ['Agent', 'I’m connecting you to the nursing staff right now. Please stay on the line.'],
      ],
    },
    {
      summary: 'Resident had a billing question and was transferred to the admin office.',
      turns: [
        ['User', 'I have a question about my last statement.'],
        ['Agent', 'Let me transfer you to the admin office, who can help with billing.'],
      ],
    },
  ],
  general: [
    {
      summary: 'Resident called to check what day it is and thanked the agent.',
      turns: [
        ['User', 'Hello, is anyone there?'],
        ['Agent', 'Hi, this is NuVA. How can I help you today?'],
        ['User', 'Oh, I just wanted to know what day it is.'],
        ['Agent', 'Today is a lovely day. Is there anything else I can help with?'],
      ],
    },
  ],
};

let cachedCalls: { day: string; calls: RetellRawCall[] } | null = null;

/** Sample calls whose start falls in the window (optional). */
export function getDemoCalls(window?: CallWindow): RetellRawCall[] {
  const all = allDemoCalls();
  if (!window) return all;
  return all.filter((c) => c.start_timestamp != null && c.start_timestamp >= window.from && c.start_timestamp <= window.to);
}

/** ~45 days of plausible calls, regenerated once per day so "today" always has data. */
function allDemoCalls(): RetellRawCall[] {
  const today = new Date().toISOString().slice(0, 10);
  if (cachedCalls?.day === today) return cachedCalls.calls;

  const client = getActiveClient();
  const rand = rng(20260922);
  const toolByCategory = new Map<string, string>();
  for (const [tool, cat] of Object.entries(client.integrations.retell.toolCategories)) {
    if (!toolByCategory.has(cat)) toolByCategory.set(cat, tool);
  }
  const categoryWeights: [string, number][] = [
    ...[...toolByCategory.keys()].map((c, i): [string, number] => [c, [30, 12, 22, 18][i] ?? 10]),
    ['transfer_only', 11],
    ['general', 7],
  ];
  const mainLine = `+1${(client.contact.phone ?? '5550100000').replace(/\D/g, '').slice(-10)}`;

  const calls: RetellRawCall[] = [];
  const now = Date.now();
  for (let d = 44; d >= 0; d--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - d);
    const weekend = dayStart.getDay() === 0 || dayStart.getDay() === 6;
    const count = Math.round((weekend ? 5 : 9) + rand() * 7 + (44 - d) * 0.08);

    for (let i = 0; i < count; i++) {
      const start = dayStart.getTime() + (7 + rand() * 13) * 3_600_000;
      if (start > now) continue;

      const category = pickWeighted(rand, categoryWeights);
      const scripts = SCRIPTS[category] ?? SCRIPTS.general;
      const script = scripts[Math.floor(rand() * scripts.length)];
      const outbound = rand() < 0.08;
      const voicemail = outbound && rand() < 0.4;
      const transfer = category === 'transfer_only' || (category !== 'general' && rand() < 0.07);
      const sentiment = pickWeighted(rand, [
        ['Positive', transfer ? 30 : 58],
        ['Neutral', 28],
        ['Negative', transfer ? 20 : 6],
        ['Unknown', 6],
      ]);
      const durationMs = Math.round((voicemail ? 20 : 45 + rand() * 190) * 1000);

      const tools: RetellRawCall['tool_calls'] = [];
      const toolName = toolByCategory.get(category);
      if (toolName) tools.push({ name: toolName, type: 'custom', success: true });
      if (transfer) tools.push({ name: 'transfer_call', type: 'transfer_call', success: true });

      const disconnection = voicemail
        ? 'voicemail_reached'
        : transfer
          ? 'call_transfer'
          : pickWeighted(rand, [
              ['user_hangup', 70],
              ['agent_hangup', 24],
              ['inactivity', 6],
            ]);

      const e2e = 820 + rand() * 780;
      const id = `call_demo_${d}_${i}_${Math.floor(rand() * 1e6).toString(36)}`;
      const caller = `+1860${String(2000000 + Math.floor(rand() * 7999999)).slice(0, 7)}`;
      const transcript = voicemail ? null : script.turns.map(([who, text]) => `${who}: ${text}`).join('\n');

      calls.push({
        call_id: id,
        agent_id: 'agent_demo',
        agent_name: `NuVA · ${client.name}`,
        call_type: 'phone_call',
        direction: outbound ? 'outbound' : 'inbound',
        call_status: 'ended',
        disconnection_reason: disconnection,
        transfer_destination: transfer ? '+15550192244' : null,
        from_number: outbound ? mainLine : caller,
        to_number: outbound ? caller : mainLine,
        start_timestamp: start,
        end_timestamp: start + durationMs,
        duration_ms: durationMs,
        call_analysis: {
          call_successful: voicemail ? false : sentiment !== 'Negative' && rand() < 0.9,
          call_summary: voicemail ? 'The call reached voicemail; no message was left.' : script.summary,
          in_voicemail: voicemail,
          user_sentiment: sentiment,
        },
        call_cost: { combined_cost: Math.round(durationMs / 1000 * 0.12 * 10) / 10, product_costs: [] },
        latency: {
          e2e: { p50: e2e, p90: e2e * 1.45 },
          asr: { p50: 140 + rand() * 120 },
          llm: { p50: 380 + rand() * 360 },
          tts: { p50: 190 + rand() * 170 },
        },
        llm_token_usage: { average: 900 + Math.round(rand() * 900) },
        recording_url: null,
        recording_multi_channel_url: null,
        transcript,
        tool_calls: tools,
      });
    }
  }

  calls.sort((a, b) => (b.start_timestamp ?? 0) - (a.start_timestamp ?? 0));
  cachedCalls = { day: today, calls };
  return calls;
}

// --- Knowledge base (in-memory, survives dev hot reloads) ----------------------

const globalStore = globalThis as unknown as { __nuvaDemoKb?: KnowledgeBaseSourceInfo[] };

function kbStore(): KnowledgeBaseSourceInfo[] {
  if (!globalStore.__nuvaDemoKb) {
    const samples: Record<string, string[]> = {
      menu: ['Weekly dining menu.pdf', 'Dietary options guide.docx'],
      community: ['Resident handbook 2026.pdf', 'Amenity hours.pdf'],
      events: ['September activities calendar.pdf'],
    };
    const seeded: KnowledgeBaseSourceInfo[] = [];
    for (const c of getActiveClient().knowledgeBase.categories) {
      for (const name of samples[c.key] ?? [`${c.label} overview.pdf`]) {
        seeded.push({ sourceId: `demo_${c.key}_${seeded.length}`, category: c.key, displayName: name, fileUrl: null, fileSize: 180_000 + seeded.length * 97_000 });
      }
    }
    seeded.push({ sourceId: 'demo_other_0', category: null, displayName: 'Emergency procedures.pdf', fileUrl: null, fileSize: 412_000 });
    globalStore.__nuvaDemoKb = seeded;
  }
  return globalStore.__nuvaDemoKb;
}

export function listDemoKb(): KnowledgeBaseSourceInfo[] {
  return [...kbStore()];
}

export function addDemoKb(category: string, files: File[]): KnowledgeBaseSourceInfo[] {
  const store = kbStore();
  for (const f of files) {
    store.push({ sourceId: `demo_${Date.now()}_${store.length}`, category, displayName: f.name, fileUrl: null, fileSize: f.size });
  }
  return [...store];
}

export function deleteDemoKb(sourceId: string): void {
  const store = kbStore();
  const i = store.findIndex((s) => s.sourceId === sourceId);
  if (i >= 0) store.splice(i, 1);
}

// --- Call routing (in-memory, survives dev hot reloads) ------------------------

const routingStore = globalThis as unknown as { __nuvaDemoRouting?: LiveRouting };

/** Starts "managed" with the client's configured departments, as if they'd been synced before. */
export function getDemoRouting(): LiveRouting {
  if (!routingStore.__nuvaDemoRouting) {
    routingStore.__nuvaDemoRouting = {
      status: 'managed',
      summary: null,
      departments: getActiveClient().departments.map(({ name, description, phone, keywords }) => ({ name, description, phone, keywords })),
    };
  }
  return routingStore.__nuvaDemoRouting;
}

export function setDemoRouting(departments: DepartmentTransferInput[]): LiveRouting {
  routingStore.__nuvaDemoRouting = { status: 'managed', summary: null, departments: departments.filter((d) => d.phone.trim()) };
  return routingStore.__nuvaDemoRouting;
}
