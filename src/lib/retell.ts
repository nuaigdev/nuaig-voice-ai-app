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
  return status === 502 || status === 503 || status === 504;
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
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => '');
    if (isRetryableStatus(res.status) && attempt < maxAttempts) {
      await sleep(500 * attempt);
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
}

interface ListCallsResponse {
  items?: RetellRawCall[];
  has_more?: boolean;
  pagination_key?: string;
}

async function fetchAllCalls(agentId?: string): Promise<RetellRawCall[]> {
  const calls: RetellRawCall[] = [];
  let paginationKey: string | undefined;
  const pageSize = 1000;
  const filterCriteria: Record<string, unknown> = {};
  if (agentId) filterCriteria.agent = [{ agent_id: agentId }];

  for (;;) {
    const body: Record<string, unknown> = { limit: pageSize, sort_order: 'descending' };
    if (Object.keys(filterCriteria).length) body.filter_criteria = filterCriteria;
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

function fetchFullDetail(callId: string): Promise<RetellRawCall> {
  return retellFetch<RetellRawCall>(`/v2/get-call/${callId}`, { method: 'GET' });
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
      return c;
    }
  });
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

  const toolNames = toolCalls.map((tc) => tc.name || tc.type).filter((n): n is string => Boolean(n));
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

export async function getCallsDashboard(): Promise<{
  data: CallsDashboardData;
  costRows: CostRow[];
  raw: RetellRawCall[];
}> {
  const agentId = defaultAgentId();
  const rawCalls = await fetchAllCalls(agentId);
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

function buildTransferPrompt(departments: DepartmentTransferInput[]): string {
  const usable = departments.filter((d) => d.phone && d.phone.trim().length > 0);
  const lines = usable.map((d) => {
    const kw = d.keywords.length ? ` Trigger keywords: ${d.keywords.join(', ')}.` : '';
    const desc = d.description ? ` (${d.description})` : '';
    return `- ${d.name}${desc} -> ${d.phone}.${kw}`;
  });
  return [
    "Pick the phone number for the department that matches what the caller needs, using the caller's stated reason for calling and these department trigger keywords as a guide:",
    ...lines,
    'If no department clearly matches, ask the caller to clarify what they need before transferring.',
  ].join('\n');
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
// The Knowledge Base screen has one upload tab per client KB category (for
// Seabury: menu, community, events) but Retell's knowledge base is a single
// flat list of sources with no category field. Each upload is tagged with a
// "[category] " filename prefix so the UI can filter the live source list
// back into its tabs; sources without a recognized prefix (e.g. uploaded directly in the
// Retell dashboard) come back with category: null and are surfaced as
// "other" documents rather than silently hidden.

/** A client KB category key (see ClientConfig.knowledgeBase). */
export type KbCategory = string;

export function kbCategoryKeys(): string[] {
  return getActiveClient().knowledgeBase.categories.map((c) => c.key);
}

export interface KnowledgeBaseSourceInfo {
  sourceId: string;
  category: KbCategory | null;
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

function parseCategoryFromName(rawName: string): { category: KbCategory | null; displayName: string } {
  const prefixRe = new RegExp(`^\\[(${kbCategoryKeys().map(escapeRegExp).join('|')})\\]\\s*`, 'i');
  const match = rawName.match(prefixRe);
  if (!match) return { category: null, displayName: rawName };
  return { category: match[1].toLowerCase() as KbCategory, displayName: rawName.slice(match[0].length) || rawName };
}

function taggedFilename(category: KbCategory, filename: string): string {
  return `[${category}] ${filename}`;
}

function mapKbSource(s: RetellKnowledgeBaseSource): KnowledgeBaseSourceInfo {
  const rawName = s.filename || s.title || s.url || s.source_id;
  const { category, displayName } = parseCategoryFromName(rawName);
  return {
    sourceId: s.source_id,
    category,
    displayName,
    fileUrl: s.file_url ?? null,
    fileSize: s.file_size ?? null,
  };
}

async function getKnowledgeBaseId(): Promise<string> {
  const agentId = defaultAgentId();
  if (!agentId) throw new Error('AGENT_ID is not set. Add it to .env.local.');
  const llmId = await getAgentLlmId(agentId);
  const llm = await retellFetch<{ knowledge_base_ids?: string[] | null }>(`/get-retell-llm/${llmId}`);
  const kbId = llm.knowledge_base_ids?.[0];
  if (!kbId) throw new Error('This agent has no knowledge base linked (knowledge_base_ids is empty).');
  return kbId;
}

export async function listKnowledgeBaseSources(): Promise<KnowledgeBaseSourceInfo[]> {
  const kbId = await getKnowledgeBaseId();
  const kb = await retellFetch<RetellKnowledgeBaseResponse>(`/get-knowledge-base/${kbId}`);
  return (kb.knowledge_base_sources || []).map(mapKbSource);
}

export async function addKnowledgeBaseFiles(category: KbCategory, files: File[]): Promise<KnowledgeBaseSourceInfo[]> {
  const kbId = await getKnowledgeBaseId();
  const form = new FormData();
  const uploadedNames = new Set<string>();
  for (const file of files) {
    const name = taggedFilename(category, file.name);
    form.append('knowledge_base_files', file, name);
    uploadedNames.add(name);
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
  for (let attempt = 1; attempt <= 5; attempt++) {
    const kb = await retellFetch<RetellKnowledgeBaseResponse>(`/get-knowledge-base/${kbId}`);
    const sources = kb.knowledge_base_sources || [];
    const names = new Set(sources.map((s) => s.filename || s.title || s.url || s.source_id));
    if ([...uploadedNames].every((n) => names.has(n))) return sources.map(mapKbSource);
    if (attempt < 5) await sleep(1000 * attempt);
  }
  // Upload call itself succeeded; indexing is just still catching up. Return
  // whatever the last poll saw rather than fail a request that did work.
  return listKnowledgeBaseSources();
}

export async function deleteKnowledgeBaseSource(sourceId: string): Promise<void> {
  const kbId = await getKnowledgeBaseId();
  await retellFetch(`/delete-knowledge-base-source/${kbId}/source/${sourceId}`, { method: 'DELETE' });
}
