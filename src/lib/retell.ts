// Server-only: talks directly to the Retell REST API (https://api.retellai.com).
// Mirrors retell-scripts/export_calls.py's flatten/aggregate logic, minus the
// columns/sheets that script no longer exports (agent_version, cost_usd,
// num_tool_calls per-call, public_log_url, pcap_url, Tool_Calls, Cost_Breakdown).
// Client-specific wiring (tool -> category map, KB categories) comes from the
// active client config in src/clients.

import { getActiveClient } from '@/clients';

const RETELL_BASE_URL = process.env.RETELL_BASE_URL || 'https://api.retellai.com';

function apiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) {
    throw new Error('RETELL_API_KEY is not set. Add it to .env.local.');
  }
  return key;
}

function defaultAgentId(): string | undefined {
  return process.env.AGENT_ID || undefined;
}

// Retell occasionally 502s or stalls on individual requests (seen on
// update-retell-llm and the heavier list/get-call endpoints) even though the
// account/API key are fine - a short timeout + retry smooths over those
// transient upstream hiccups instead of hanging the request or dead-ending
// the caller with a one-shot 502.
const RETELL_TIMEOUT_MS = 20_000;
const RETELL_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Backoff before the next attempt; honors Retry-After (seconds) on 429s, capped at 10s. */
function retryDelayMs(res: Response | null, attempt: number): number {
  const header = res?.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return (res?.status === 429 ? 1000 : 500) * attempt;
}

interface RetellFetchOptions {
  /**
   * Set to false for requests whose side effect isn't safe to repeat if the
   * response is merely slow (e.g. adding a file to the knowledge base) -
   * a retry there could create a duplicate rather than recover a failure.
   */
  retry?: boolean;
  timeoutMs?: number;
}

async function retellFetch<T>(path: string, init?: RequestInit, opts?: RetellFetchOptions): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? RETELL_TIMEOUT_MS;
  const maxAttempts = opts?.retry === false ? 1 : RETELL_MAX_RETRIES + 1;
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${RETELL_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          // A FormData body needs fetch to set its own multipart boundary -
          // forcing a Content-Type here would break the upload.
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers || {}),
        },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      const message = timedOut
        ? `Retell API ${path} timed out after ${timeoutMs / 1000}s`
        : `Retell API ${path} request failed: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => '');
    if (isRetryableStatus(res.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    throw new Error(`Retell API ${path} failed (${res.status}): ${body.slice(0, 500)}`);
  }

  throw new Error(`Retell API ${path} failed after ${maxAttempts} attempts`);
}

interface RetellLatencyBucket {
  p50?: number | null;
  p90?: number | null;
}

interface RetellToolCall {
  name?: string | null;
  type?: string | null;
  success?: boolean | null;
  start_time_sec?: number | null;
  latency_ms?: number | null;
  tool_call_id?: string | null;
}

interface RetellProductCost {
  product: string;
  cost: number;
  unit_price?: number | null;
  is_transfer_leg_cost?: boolean | null;
}

export interface RetellRawCall {
  call_id: string;
  agent_id?: string | null;
  agent_name?: string | null;
  call_type?: string | null;
  direction?: string | null;
  call_status?: string | null;
  disconnection_reason?: string | null;
  transfer_destination?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
  duration_ms?: number | null;
  call_analysis?: {
    call_successful?: boolean | null;
    call_summary?: string | null;
    in_voicemail?: boolean | null;
    user_sentiment?: string | null;
  } | null;
  call_cost?: {
    combined_cost?: number | null;
    product_costs?: RetellProductCost[] | null;
  } | null;
  latency?: {
    asr?: RetellLatencyBucket | null;
    e2e?: RetellLatencyBucket | null;
    llm?: RetellLatencyBucket | null;
    tts?: RetellLatencyBucket | null;
  } | null;
  llm_token_usage?: { average?: number | null } | null;
  recording_url?: string | null;
  recording_multi_channel_url?: string | null;
  transcript?: string | null;
  transcript_object?:
    | {
        role: string;
        content: string;
        words?: { start?: number; end?: number }[];
      }[]
    | null;
  // Present in the live API response for calls that invoked tools; used to
  // derive the UI category and transfer detection, same as the Python export.
  tool_calls?: RetellToolCall[] | null;
  // get-call's documented home for tool invocations (role "tool_call_invocation").
  transcript_with_tool_calls?: { role: string; name?: string | null }[] | null;
}

interface ListCallsResponse {
  items?: RetellRawCall[];
  has_more?: boolean;
  pagination_key?: string;
}

/** Longest window one request may cover (a max-length range plus its comparison period); bounds Retell usage. */
export const MAX_WINDOW_DAYS = 800;

export interface CallWindow {
  /** Epoch ms, inclusive. */
  from: number;
  /** Epoch ms, inclusive. */
  to: number;
}

async function fetchCallsInWindow(window: CallWindow, agentId?: string): Promise<RetellRawCall[]> {
  const calls: RetellRawCall[] = [];
  let paginationKey: string | undefined;
  const filterCriteria: Record<string, unknown> = {
    start_timestamp: { type: 'range', op: 'bt', value: [window.from, window.to] },
  };
  if (agentId) filterCriteria.agent = [{ agent_id: agentId }];

  for (;;) {
    const body: Record<string, unknown> = { limit: 1000, sort_order: 'descending', filter_criteria: filterCriteria };
    if (paginationKey) body.pagination_key = paginationKey;

    const resp = await retellFetch<ListCallsResponse>('/v3/list-calls', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    calls.push(...(resp.items || []));
    if (!resp.has_more || !resp.pagination_key) break;
    paginationKey = resp.pagination_key;
  }
  return calls;
}

// v3/list-calls omits transcripts and tool calls, so each call's full detail
// comes from get-call. A finished call never changes once its post-call
// analysis is in, so details are cached per call ID for the life of the
// server instance - after the first load, a refresh costs one list request
// plus details for new calls only. (Best-effort: each serverless instance
// has its own cache.)
const DETAIL_CACHE_MAX = 5000;
const detailCache = new Map<string, RetellRawCall>();

function isSettled(call: RetellRawCall): boolean {
  if (call.call_status === 'ongoing' || call.call_status === 'registered') return false;
  // Analysis lands a little after the call ends; don't cache a call without it
  // unless it ended long enough ago that none is coming.
  const endedLongAgo = call.end_timestamp != null && Date.now() - call.end_timestamp > 15 * 60_000;
  return Boolean(call.call_analysis) || endedLongAgo;
}

function rememberDetail(call: RetellRawCall) {
  if (!isSettled(call)) return;
  detailCache.delete(call.call_id);
  detailCache.set(call.call_id, call);
  if (detailCache.size > DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value;
    if (oldest) detailCache.delete(oldest);
  }
}

async function fetchFullDetail(callId: string): Promise<RetellRawCall> {
  const cached = detailCache.get(callId);
  if (cached) return cached;
  const call = await retellFetch<RetellRawCall>(`/v2/get-call/${callId}`, { method: 'GET' });
  rememberDetail(call);
  return call;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function enrichAllWithFullDetail(calls: RetellRawCall[]): Promise<RetellRawCall[]> {
  return mapWithConcurrency(calls, 8, async (c) => {
    try {
      return await fetchFullDetail(c.call_id);
    } catch {
      // Keep the list-level data (no transcript/tools) rather than failing the whole load.
      return c;
    }
  });
}

/**
 * Recording URL for one of this agent's calls, as reported by Retell. The
 * download route proxies only URLs obtained this way, never one supplied by
 * the browser.
 */
export async function getCallRecordingUrl(callId: string): Promise<string | null> {
  const call = await fetchFullDetail(callId);
  const agentId = defaultAgentId();
  if (agentId && call.agent_id !== agentId) return null;
  return call.recording_url ?? null;
}

function deriveCategory(toolNames: string[], toolCategories: Record<string, string>): string {
  for (const name of toolNames) {
    if (toolCategories[name]) return toolCategories[name];
  }
  if (toolNames.includes('transfer_call')) return 'transfer_only';
  return 'general';
}

function msToIso(ms?: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export interface FlatCallRow {
  call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  call_type: string | null;
  direction: string | null;
  call_status: string | null;
  disconnection_reason: string | null;
  transfer_destination: string | null;
  from_number: string | null;
  to_number: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_sec: number | null;
  primary_category: string;
  tools_used: string | null;
  had_transfer: boolean;
  user_sentiment: string | null;
  call_successful: boolean | null;
  in_voicemail: boolean | null;
  call_summary: string | null;
  latency_e2e_p50_ms: number | null;
  latency_e2e_p90_ms: number | null;
  latency_asr_p50_ms: number | null;
  latency_llm_p50_ms: number | null;
  latency_tts_p50_ms: number | null;
  llm_token_avg: number | null;
  recording_url: string | null;
  recording_multi_channel_url: string | null;
  transcript: string | null;
  /** Internal-only, used for Summary aggregates - intentionally not a Calls-sheet/table column. */
  cost_usd: number | null;
}

function flattenCall(call: RetellRawCall, toolCategories: Record<string, string>): FlatCallRow {
  const analysis = call.call_analysis;
  const cost = call.call_cost;
  const latency = call.latency;
  const tokenUsage = call.llm_token_usage;
  const toolCalls = call.tool_calls || [];

  const start = call.start_timestamp ?? null;
  const end = call.end_timestamp ?? null;
  let durationMs = call.duration_ms ?? null;
  if (durationMs == null && start != null && end != null) durationMs = end - start;

  const toolNames = toolCalls.length
    ? toolCalls.map((tc) => tc.name || tc.type).filter((n): n is string => Boolean(n))
    : (call.transcript_with_tool_calls || [])
        .filter((e) => e.role === 'tool_call_invocation' && e.name)
        .map((e) => e.name as string);
  const hadTransfer = call.disconnection_reason === 'call_transfer' || toolNames.includes('transfer_call');

  return {
    call_id: call.call_id,
    agent_id: call.agent_id ?? null,
    agent_name: call.agent_name ?? null,
    call_type: call.call_type ?? null,
    direction: call.direction ?? null,
    call_status: call.call_status ?? null,
    disconnection_reason: call.disconnection_reason ?? null,
    transfer_destination: call.transfer_destination ?? null,
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? null,
    start_time: msToIso(start),
    end_time: msToIso(end),
    duration_sec: durationMs != null ? round(durationMs / 1000, 1) : null,
    primary_category: deriveCategory(toolNames, toolCategories),
    tools_used: toolNames.length ? toolNames.join(', ') : null,
    had_transfer: hadTransfer,
    user_sentiment: analysis?.user_sentiment ?? null,
    call_successful: analysis?.call_successful ?? null,
    in_voicemail: analysis?.in_voicemail ?? null,
    call_summary: analysis?.call_summary ?? null,
    latency_e2e_p50_ms: latency?.e2e?.p50 ?? null,
    latency_e2e_p90_ms: latency?.e2e?.p90 ?? null,
    latency_asr_p50_ms: latency?.asr?.p50 ?? null,
    latency_llm_p50_ms: latency?.llm?.p50 ?? null,
    latency_tts_p50_ms: latency?.tts?.p50 ?? null,
    llm_token_avg: tokenUsage?.average ?? null,
    recording_url: call.recording_url ?? null,
    recording_multi_channel_url: call.recording_multi_channel_url ?? null,
    transcript: call.transcript ?? null,
    cost_usd: cost?.combined_cost != null ? round(cost.combined_cost / 100, 4) : null,
  };
}

export interface CostRow {
  call_id: string;
  product: string;
  cost_usd: number | null;
}

function costRowsFor(call: RetellRawCall): CostRow[] {
  const productCosts = call.call_cost?.product_costs || [];
  return productCosts.map((pc) => ({
    call_id: call.call_id,
    product: pc.product,
    cost_usd: pc.cost != null ? round(pc.cost / 100, 5) : null,
  }));
}

function countBy(rows: FlatCallRow[], key: 'user_sentiment' | 'call_status' | 'direction' | 'disconnection_reason' | 'primary_category'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const v = r[key] || 'Unknown';
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export interface DashboardSummary {
  agent_id: string;
  generated_at: string;
  total_calls: number;
  total_duration_sec: number;
  avg_duration_sec: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  call_successful_rate_pct: number;
  transfer_rate_pct: number;
  breakdowns: {
    user_sentiment: Record<string, number>;
    call_status: Record<string, number>;
    direction: Record<string, number>;
    disconnection_reason: Record<string, number>;
    primary_category: Record<string, number>;
  };
  cost_by_product: { product: string; total_usd: number; occurrences: number }[];
}

function buildSummary(rows: FlatCallRow[], costRows: CostRow[], agentId?: string): DashboardSummary {
  const total = rows.length;
  const durations = rows.map((r) => r.duration_sec).filter((v): v is number => v != null);
  const costs = rows.map((r) => r.cost_usd).filter((v): v is number => v != null);
  const successCount = rows.filter((r) => r.call_successful === true).length;
  const transferCount = rows.filter((r) => r.had_transfer).length;

  const costTotals = new Map<string, { total: number; count: number }>();
  for (const cr of costRows) {
    const entry = costTotals.get(cr.product) || { total: 0, count: 0 };
    entry.total += cr.cost_usd ?? 0;
    entry.count += 1;
    costTotals.set(cr.product, entry);
  }

  return {
    agent_id: agentId || '(all agents)',
    generated_at: new Date().toISOString(),
    total_calls: total,
    total_duration_sec: round(sum(durations), 1),
    avg_duration_sec: durations.length ? round(sum(durations) / durations.length, 1) : 0,
    total_cost_usd: round(sum(costs), 4),
    avg_cost_usd: costs.length ? round(sum(costs) / costs.length, 4) : 0,
    call_successful_rate_pct: total ? round((100 * successCount) / total, 1) : 0,
    transfer_rate_pct: total ? round((100 * transferCount) / total, 1) : 0,
    breakdowns: {
      user_sentiment: countBy(rows, 'user_sentiment'),
      call_status: countBy(rows, 'call_status'),
      direction: countBy(rows, 'direction'),
      disconnection_reason: countBy(rows, 'disconnection_reason'),
      primary_category: countBy(rows, 'primary_category'),
    },
    cost_by_product: [...costTotals.entries()]
      .map(([product, { total: t, count }]) => ({ product, total_usd: round(t, 4), occurrences: count }))
      .sort((a, b) => b.total_usd - a.total_usd),
  };
}

export interface DailyTrendPoint {
  date: string;
  call_count: number;
  transfer_count: number;
  avg_duration_sec: number;
  positive: number;
  neutral: number;
  negative: number;
  unknown: number;
}

function buildDailyTrend(rows: FlatCallRow[]): DailyTrendPoint[] {
  const byDay = new Map<string, FlatCallRow[]>();
  for (const r of rows) {
    if (!r.start_time) continue;
    const day = r.start_time.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(r);
    else byDay.set(day, [r]);
  }

  return [...byDay.keys()].sort().map((day) => {
    const dayRows = byDay.get(day)!;
    const durations = dayRows.map((r) => r.duration_sec).filter((v): v is number => v != null);
    const sentiments: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0, Unknown: 0 };
    for (const r of dayRows) {
      const s = r.user_sentiment || 'Unknown';
      sentiments[s] = (sentiments[s] || 0) + 1;
    }
    return {
      date: day,
      call_count: dayRows.length,
      transfer_count: dayRows.filter((r) => r.had_transfer).length,
      avg_duration_sec: durations.length ? round(sum(durations) / durations.length, 1) : 0,
      positive: sentiments.Positive,
      neutral: sentiments.Neutral,
      negative: sentiments.Negative,
      unknown: sentiments.Unknown,
    };
  });
}

export interface CallsDashboardData {
  generated_at: string;
  agent_id: string | null;
  summary: DashboardSummary;
  daily_trend: DailyTrendPoint[];
  calls: FlatCallRow[];
}

export async function getCallsDashboard(window: CallWindow): Promise<{
  data: CallsDashboardData;
  costRows: CostRow[];
  raw: RetellRawCall[];
}> {
  const agentId = defaultAgentId();
  const rawCalls = await fetchCallsInWindow(window, agentId);
  const detailed = await enrichAllWithFullDetail(rawCalls);
  return buildCallsDashboard(detailed, agentId);
}

/** Flattens and aggregates raw Retell calls (live, or demo fixtures from lib/demo). */
export function buildCallsDashboard(
  detailed: RetellRawCall[],
  agentId?: string
): { data: CallsDashboardData; costRows: CostRow[]; raw: RetellRawCall[] } {
  const { toolCategories } = getActiveClient().integrations.retell;
  const rows = detailed.map((c) => flattenCall(c, toolCategories));
  const costRows = detailed.flatMap(costRowsFor);
  const summary = buildSummary(rows, costRows, agentId);
  const dailyTrend = buildDailyTrend(rows);

  return {
    data: {
      generated_at: new Date().toISOString(),
      agent_id: agentId ?? null,
      summary,
      daily_trend: dailyTrend,
      calls: rows,
    },
    costRows,
    raw: detailed,
  };
}

// --- Department call-transfer sync -----------------------------------------
// Writes the Settings screen's department phone/keyword list into the live
// Retell agent's "transfer_call" tool, so a number added in the UI actually
// changes where the agent transfers callers. The transfer_call tool only
// supports a single destination per tool, so multiple departments are
// expressed as one "inferred" destination: a prompt listing each department's
// number and trigger keywords, letting the agent's LLM pick the right number
// at call time based on what the caller needs.

interface RetellAgentSummary {
  agent_id: string;
  response_engine: { type: string; llm_id?: string | null };
}

interface RetellLlmTransferDestination {
  type: 'predefined' | 'inferred';
  number?: string | null;
  extension?: string | null;
  prompt?: string | null;
}

export interface RetellTransferCallTool {
  name: string;
  type: 'transfer_call';
  transfer_destination: RetellLlmTransferDestination;
  transfer_option?: Record<string, unknown>;
  description?: string | null;
  execution_message_description?: string | null;
  execution_message_type?: string | null;
  custom_sip_headers?: Record<string, string> | null;
  ignore_e164_validation?: boolean | null;
  speak_during_execution?: boolean | null;
  speak_after_execution?: boolean | null;
  [key: string]: unknown;
}

interface RetellGeneralTool {
  name: string;
  type: string;
  [key: string]: unknown;
}

interface RetellLlmResponse {
  llm_id: string;
  general_tools?: RetellGeneralTool[] | null;
}

export interface DepartmentTransferInput {
  name: string;
  description?: string;
  phone: string;
  keywords: string[];
}

async function getAgentLlmId(agentId: string): Promise<string> {
  const agent = await retellFetch<RetellAgentSummary>(`/get-agent/${agentId}`);
  if (agent.response_engine?.type !== 'retell-llm' || !agent.response_engine.llm_id) {
    throw new Error(`Agent ${agentId} is not backed by a Retell LLM; cannot sync the transfer_call tool.`);
  }
  return agent.response_engine.llm_id;
}

function isTransferCallTool(tool: RetellGeneralTool): tool is RetellTransferCallTool {
  return tool.type === 'transfer_call';
}

export async function getCurrentTransferTool(): Promise<RetellTransferCallTool | null> {
  const agentId = defaultAgentId();
  if (!agentId) throw new Error('AGENT_ID is not set. Add it to .env.local.');
  const llmId = await getAgentLlmId(agentId);
  const llm = await retellFetch<RetellLlmResponse>(`/get-retell-llm/${llmId}`);
  return (llm.general_tools || []).find(isTransferCallTool) ?? null;
}

// The prompt below is also the source of truth that Call Routing reads back
// (parseTransferPrompt), so the line format must stay parseable:
//   - <name>[ (<description>)] -> <phone>.[ Trigger keywords: <a>, <b>.]
const TRANSFER_PROMPT_HEADER =
  "Pick the phone number for the department that matches what the caller needs, using the caller's stated reason for calling and these department trigger keywords as a guide:";
const TRANSFER_PROMPT_FOOTER = 'If no department clearly matches, ask the caller to clarify what they need before transferring.';
const KEYWORDS_MARKER = '. Trigger keywords: ';

function buildTransferPrompt(departments: DepartmentTransferInput[]): string {
  const usable = departments.filter((d) => d.phone && d.phone.trim().length > 0);
  const lines = usable.map((d) => {
    const kw = d.keywords.length ? `${KEYWORDS_MARKER}${d.keywords.join(', ')}.` : '.';
    const desc = d.description ? ` (${d.description})` : '';
    return `- ${d.name}${desc} -> ${d.phone}${kw}`;
  });
  return [TRANSFER_PROMPT_HEADER, ...lines, TRANSFER_PROMPT_FOOTER].join('\n');
}

/** Reverses buildTransferPrompt; returns null if the prompt wasn't written by this console. */
export function parseTransferPrompt(prompt: string): DepartmentTransferInput[] | null {
  const lines = prompt.split('\n').map((l) => l.trim());
  if (lines[0] !== TRANSFER_PROMPT_HEADER) return null;

  const departments: DepartmentTransferInput[] = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith('- ')) continue;
    const arrow = line.indexOf(' -> ');
    if (arrow < 0) return null;
    const head = line.slice(2, arrow);
    const tail = line.slice(arrow + 4);

    const descMatch = head.match(/^(.*?) \((.*)\)$/);
    const name = (descMatch ? descMatch[1] : head).trim();
    const description = descMatch ? descMatch[2].trim() : undefined;

    const kwAt = tail.indexOf(KEYWORDS_MARKER);
    const phone = (kwAt >= 0 ? tail.slice(0, kwAt) : tail.replace(/\.$/, '')).trim();
    const keywords =
      kwAt >= 0
        ? tail
            .slice(kwAt + KEYWORDS_MARKER.length)
            .replace(/\.$/, '')
            .split(', ')
            .map((k) => k.trim())
            .filter(Boolean)
        : [];
    if (!name || !phone) return null;
    departments.push({ name, description, phone, keywords });
  }
  return departments;
}

export type LiveRoutingStatus =
  /** The agent's transfer_call tool was written by this console and parsed cleanly. */
  | 'managed'
  /** A transfer_call tool exists but was set up elsewhere (e.g. the Retell dashboard). */
  | 'unmanaged'
  /** The agent has no transfer_call tool yet. */
  | 'missing';

export interface LiveRouting {
  status: LiveRoutingStatus;
  departments: DepartmentTransferInput[];
  /** Human-readable description of an unmanaged destination, for the warning banner. */
  summary: string | null;
}

export async function getLiveRouting(): Promise<LiveRouting> {
  const tool = await getCurrentTransferTool();
  if (!tool) return { status: 'missing', departments: [], summary: null };

  const dest = tool.transfer_destination;
  const parsed = dest?.type === 'inferred' && dest.prompt ? parseTransferPrompt(dest.prompt) : null;
  if (parsed) return { status: 'managed', departments: parsed, summary: null };

  const summary =
    dest?.type === 'predefined'
      ? `Transfers every call to ${dest.number ?? 'a fixed number'}${dest.extension ? ` ext. ${dest.extension}` : ''}.`
      : dest?.prompt
        ? `Uses a custom routing prompt: "${dest.prompt.slice(0, 160)}${dest.prompt.length > 160 ? '…' : ''}"`
        : 'Uses a transfer setup this console can\'t read.';
  return { status: 'unmanaged', departments: [], summary };
}

export async function syncDepartmentTransfers(
  departments: DepartmentTransferInput[]
): Promise<RetellTransferCallTool> {
  const agentId = defaultAgentId();
  if (!agentId) throw new Error('AGENT_ID is not set. Add it to .env.local.');
  const llmId = await getAgentLlmId(agentId);
  const llm = await retellFetch<RetellLlmResponse>(`/get-retell-llm/${llmId}`);
  const tools = llm.general_tools ? [...llm.general_tools] : [];

  const existingIdx = tools.findIndex(isTransferCallTool);
  const existing = existingIdx >= 0 ? (tools[existingIdx] as RetellTransferCallTool) : null;

  const updatedTool: RetellTransferCallTool = {
    ...(existing ?? {
      transfer_option: { type: 'cold_transfer' },
      description: 'Transfer the call to the right department based on the caller’s need.',
      speak_during_execution: true,
      speak_after_execution: true,
    }),
    name: 'transfer_call',
    type: 'transfer_call',
    transfer_destination: {
      type: 'inferred',
      prompt: buildTransferPrompt(departments),
    },
  };

  if (existingIdx >= 0) tools[existingIdx] = updatedTool;
  else tools.push(updatedTool);

  await retellFetch(`/update-retell-llm/${llmId}`, {
    method: 'PATCH',
    body: JSON.stringify({ general_tools: tools }),
  });

  return updatedTool;
}

// --- Knowledge base sync -----------------------------------------------
// Each client KB category (for Seabury: menu, community, events) is its own
// Retell knowledge base, whose ID comes from the RETELL_KB_<KEY> env var
// (e.g. RETELL_KB_MENU). A source's category is simply the KB it lives in.
// Files uploaded before the split were tagged with a "[category] " filename
// prefix; that prefix is stripped for display but no longer means anything.

/** A client KB category key (see ClientConfig.knowledgeBase). */
export type KbCategory = string;

export function kbCategoryKeys(): string[] {
  return getActiveClient().knowledgeBase.categories.map((c) => c.key);
}

export interface KnowledgeBaseSourceInfo {
  sourceId: string;
  category: KbCategory;
  displayName: string;
  fileUrl: string | null;
  fileSize: number | null;
}

interface RetellKnowledgeBaseSource {
  source_id: string;
  type: 'document' | 'text' | 'url';
  filename?: string;
  title?: string;
  url?: string;
  file_url?: string | null;
  file_size?: number | null;
}

interface RetellKnowledgeBaseResponse {
  knowledge_base_id: string;
  knowledge_base_name: string;
  status: string;
  knowledge_base_sources?: RetellKnowledgeBaseSource[] | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drops a legacy "[category] " prefix from files uploaded when all categories shared one KB. */
function stripLegacyPrefix(rawName: string): string {
  const prefixRe = new RegExp(`^\\[(${kbCategoryKeys().map(escapeRegExp).join('|')})\\]\\s*`, 'i');
  return rawName.replace(prefixRe, '') || rawName;
}

function sourceName(s: RetellKnowledgeBaseSource): string {
  return s.filename || s.title || s.url || s.source_id;
}

function mapKbSource(category: KbCategory, s: RetellKnowledgeBaseSource): KnowledgeBaseSourceInfo {
  return {
    sourceId: s.source_id,
    category,
    displayName: stripLegacyPrefix(sourceName(s)),
    fileUrl: s.file_url ?? null,
    fileSize: s.file_size ?? null,
  };
}

function knowledgeBaseIdFor(category: KbCategory): string {
  if (!kbCategoryKeys().includes(category)) throw new Error(`Unknown knowledge base category "${category}".`);
  const envName = `RETELL_KB_${category.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const kbId = process.env[envName];
  if (!kbId) throw new Error(`${envName} is not set. Add the "${category}" knowledge base ID to .env.local.`);
  return kbId;
}

async function listCategorySources(category: KbCategory): Promise<KnowledgeBaseSourceInfo[]> {
  const kb = await retellFetch<RetellKnowledgeBaseResponse>(`/get-knowledge-base/${knowledgeBaseIdFor(category)}`);
  return (kb.knowledge_base_sources || []).map((s) => mapKbSource(category, s));
}

export async function listKnowledgeBaseSources(): Promise<KnowledgeBaseSourceInfo[]> {
  const perCategory = await Promise.all(kbCategoryKeys().map(listCategorySources));
  return perCategory.flat();
}

/** Uploads into the category's KB and returns that category's sources (not the other categories'). */
export async function addKnowledgeBaseFiles(category: KbCategory, files: File[]): Promise<KnowledgeBaseSourceInfo[]> {
  const kbId = knowledgeBaseIdFor(category);
  const form = new FormData();
  const uploadedNames = new Set<string>();
  for (const file of files) {
    form.append('knowledge_base_files', file, file.name);
    uploadedNames.add(file.name);
  }
  await retellFetch<RetellKnowledgeBaseResponse>(
    `/add-knowledge-base-sources/${kbId}`,
    { method: 'POST', body: form },
    // Uploads aren't idempotent and can legitimately take a while to process
    // large files - don't auto-retry a slow-but-succeeding request.
    { retry: false, timeoutMs: 60_000 }
  );

  // The add-sources response body reflects a stale pre-upload snapshot, not
  // the files just added - poll get-knowledge-base briefly until they show
  // up rather than handing the caller a list that's missing their upload.
  let sources: RetellKnowledgeBaseSource[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const kb = await retellFetch<RetellKnowledgeBaseResponse>(`/get-knowledge-base/${kbId}`);
    sources = kb.knowledge_base_sources || [];
    const names = new Set(sources.map(sourceName));
    if ([...uploadedNames].every((n) => names.has(n))) break;
    if (attempt < 5) await sleep(1000 * attempt);
  }
  // If indexing is still catching up, return whatever the last poll saw
  // rather than fail a request whose upload did work.
  return sources.map((s) => mapKbSource(category, s));
}

export const KB_LAST_SOURCE_MESSAGE =
  "This is the only document in this section, and Retell doesn't allow an empty knowledge base. Upload its replacement first, then remove this one.";

export async function deleteKnowledgeBaseSource(category: KbCategory, sourceId: string): Promise<void> {
  const kbId = knowledgeBaseIdFor(category);
  try {
    await retellFetch(`/delete-knowledge-base-source/${kbId}/source/${sourceId}`, { method: 'DELETE' });
  } catch (err) {
    // Retell won't let a knowledge base go empty.
    if (err instanceof Error && err.message.includes('cannot delete the last source')) {
      throw new Error(KB_LAST_SOURCE_MESSAGE);
    }
    throw err;
  }
}
