// Server-only: builds the raw-data Excel workbook (Summary, Daily_Trend,
// Calls, Transcripts, Transcript_Turns) in memory for /api/calls/export.

import ExcelJS from 'exceljs';
import type { CallsDashboardData, FlatCallRow, RetellRawCall } from './retell';

const CALL_COLUMNS: (keyof FlatCallRow)[] = [
  'call_id',
  'agent_id',
  'agent_name',
  'call_type',
  'direction',
  'call_status',
  'disconnection_reason',
  'transfer_destination',
  'from_number',
  'to_number',
  'start_time',
  'end_time',
  'duration_sec',
  'primary_category',
  'tools_used',
  'had_transfer',
  'user_sentiment',
  'call_successful',
  'in_voicemail',
  'call_summary',
  'latency_e2e_p50_ms',
  'latency_e2e_p90_ms',
  'latency_asr_p50_ms',
  'latency_llm_p50_ms',
  'latency_tts_p50_ms',
  'llm_token_avg',
  'recording_url',
  'recording_multi_channel_url',
];


function writeTable(ws: ExcelJS.Worksheet, headers: string[], rows: Record<string, unknown>[]) {
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? null));
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = headers.map((h) => ({ width: Math.max(12, Math.min(45, h.length + 4)) }));
}

export async function buildExcelExport(dashboard: CallsDashboardData, raw: RetellRawCall[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const { summary, daily_trend: dailyTrend, calls } = dashboard;

  // --- Summary ---
  const summaryWs = wb.addWorksheet('Summary');
  summaryWs.addRow(['Metric', 'Value']);
  summaryWs.addRow(['agent_id', summary.agent_id]);
  summaryWs.addRow(['generated_at', summary.generated_at]);
  summaryWs.addRow(['total_calls', summary.total_calls]);
  summaryWs.addRow(['total_duration_sec', summary.total_duration_sec]);
  summaryWs.addRow(['avg_duration_sec', summary.avg_duration_sec]);
  summaryWs.addRow(['total_cost_usd', summary.total_cost_usd]);
  summaryWs.addRow(['avg_cost_usd', summary.avg_cost_usd]);
  summaryWs.addRow(['call_successful_rate_pct', summary.call_successful_rate_pct]);
  summaryWs.addRow(['transfer_rate_pct', summary.transfer_rate_pct]);

  for (const [field, counts] of Object.entries(summary.breakdowns)) {
    summaryWs.addRow([]);
    summaryWs.addRow([`Breakdown: ${field}`, 'Count']);
    for (const [value, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      summaryWs.addRow([value, count]);
    }
  }

  if (summary.cost_by_product.length) {
    summaryWs.addRow([]);
    summaryWs.addRow(['Cost by product', 'Total USD', 'Occurrences']);
    for (const { product, total_usd, occurrences } of summary.cost_by_product) {
      summaryWs.addRow([product, total_usd, occurrences]);
    }
  }
  summaryWs.columns = [{ width: 32 }, { width: 20 }, { width: 16 }];

  // --- Daily_Trend ---
  const dailyWs = wb.addWorksheet('Daily_Trend');
  writeTable(
    dailyWs,
    ['date', 'call_count', 'transfer_count', 'avg_duration_sec', 'positive', 'neutral', 'negative', 'unknown'],
    dailyTrend as unknown as Record<string, unknown>[]
  );

  // --- Calls ---
  const callsWs = wb.addWorksheet('Calls');
  writeTable(callsWs, CALL_COLUMNS, calls as unknown as Record<string, unknown>[]);

  // --- Transcripts ---
  const transcriptsWs = wb.addWorksheet('Transcripts');
  const transcriptRows = raw
    .filter((c) => c.transcript)
    .map((c) => ({ call_id: c.call_id, start_time: c.start_timestamp ? new Date(c.start_timestamp).toISOString() : null, transcript: c.transcript }));
  writeTable(transcriptsWs, ['call_id', 'start_time', 'transcript'], transcriptRows);
  transcriptsWs.getColumn(3).width = 100;

  // --- Transcript_Turns ---
  const turnsWs = wb.addWorksheet('Transcript_Turns');
  const turnRows: Record<string, unknown>[] = [];
  for (const c of raw) {
    (c.transcript_object || []).forEach((turn, i) => {
      const words = turn.words || [];
      turnRows.push({
        call_id: c.call_id,
        turn_index: i,
        role: turn.role,
        content: turn.content,
        start_sec: words[0]?.start ?? null,
        end_sec: words[words.length - 1]?.end ?? null,
      });
    });
  }
  writeTable(turnsWs, ['call_id', 'turn_index', 'role', 'content', 'start_sec', 'end_sec'], turnRows);
  turnsWs.getColumn(4).width = 80;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
