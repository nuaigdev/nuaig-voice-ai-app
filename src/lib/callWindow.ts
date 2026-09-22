// Server-only: parses the ?from=&to= (epoch ms) window shared by /api/calls
// and /api/calls/export.

import { MAX_WINDOW_DAYS, type CallWindow } from './retell';

const DAY_MS = 86_400_000;

export function parseCallWindow(params: URLSearchParams): CallWindow | { error: string } {
  const now = Date.now();
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const to = rawTo ? Number(rawTo) : now;
  const from = rawFrom ? Number(rawFrom) : to - 30 * DAY_MS;

  if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: '"from" and "to" must be epoch milliseconds' };
  if (from > to) return { error: '"from" must be before "to"' };
  if (to - from > MAX_WINDOW_DAYS * DAY_MS) return { error: `The date range can cover at most ${MAX_WINDOW_DAYS} days` };
  return { from, to };
}
