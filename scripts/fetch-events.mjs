#!/usr/bin/env node
// Fetch the next 7 days of Catie events, write them to events_<date>.txt in
// the project root, and upload that file to the events knowledge base.
//
// Standalone: nothing in the Next.js app imports this, and it imports nothing
// from the app; it needs only Node 20+ (built-in fetch/FormData). Run it by
// hand (`npm run fetch-events`, add `-- --no-upload` to skip Retell) or from
// the scheduled task (fetch_events_task.cmd).
//
// Credentials come from the environment (CATIE_USER / CATIE_PASS), falling back
// to the gitignored .env.local in the project root, which may name them either
// CATIE_USER / CATIE_PASS or loginId / password. The environment wins when both
// are present. The login token lives only in memory for the duration of the run;
// neither the password nor the token is ever printed or written to disk.

import { readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://seabury.mycatie.com/catieweb-v2';
const TIMEOUT = 30; // seconds, applied to every HTTP call
const DAYS_AHEAD = 7; // toDate = today + 7 days
const NO_END_TIME = '11:59 PM'; // Catie's sentinel for "no set end time"

// viewFlag is the view mode, and it decides whether toDate is honored at all:
//   0 -> returns nothing          1 -> single day, toDate ignored
//   2 -> fixed 7-day week from fromDate, toDate ignored
//   3 -> the exact fromDate..toDate range    omitted -> status 0, no data
// Only 3 respects the window, so only 3 can return a multi-day range.
const VIEW_FLAG = 3;

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATED_RE = /^events_\d{4}-\d{2}-\d{2}\.txt$/;

// Credentials: checked in this order, environment before file. The second pair
// matches the names the Catie API itself uses, which is how .env.local spells them.
const ENV_FILE = path.join(OUTPUT_DIR, '.env.local');
const CREDENTIAL_KEYS = [
  ['CATIE_USER', 'CATIE_PASS'],
  ['loginId', 'password'],
];

// --- Retell knowledge base -----------------------------------------------
// The export is uploaded to the events knowledge base, then this run's older
// exports are deleted. Deletion is limited to filenames matching DATED_RE, so
// a document somebody uploaded by hand through the console is never removed.
// Order matters: Retell refuses to delete a knowledge base's last source, so
// the replacement has to go up before the old one comes down.
const RETELL_BASE_DEFAULT = 'https://api.retellai.com';
const RETELL_KB_KEY = 'RETELL_KB_EVENTS';
const RETELL_UPLOAD_TIMEOUT = 60; // uploads are slower than reads and are not retried
const RETELL_POLL_ATTEMPTS = 5; // add-sources returns a stale body; poll until the file shows

class CatieError extends Error {}

/** The API rejected our credentials or token (401/403). */
class AuthExpired extends CatieError {}

// --- small helpers -----------------------------------------------------

/** A trimmed string for any field; blank for null/missing. */
function text(value) {
  return value == null ? '' : String(value).trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** A short, safe excerpt of a response body, for error messages. */
function snippet(body, limit = 200) {
  const cleaned = (body || '').trim().replace(/\n/g, ' ');
  return cleaned ? cleaned.slice(0, limit) : '<empty body>';
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD of a local date. */
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayPlus(days) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

// Formats accepted when parsing a time. Catie sends "10:00 AM"; the rest are
// tolerated so an upstream format change degrades instead of crashing.
const TIME_FORMATS = [
  [/^(\d{1,2}):(\d{2}) (AM|PM)$/, true],
  [/^(\d{1,2}) (AM|PM)$/, true],
  [/^(\d{1,2}):(\d{2})$/, false],
  [/^(\d{1,2}):(\d{2}):(\d{2})$/, false],
];

/** Minutes since midnight, or null if the time cannot be parsed. */
function minutes(value) {
  if (!value) return null;
  const cleaned = value.toUpperCase().split(/\s+/).filter(Boolean).join(' ');
  for (const [re, twelveHour] of TIME_FORMATS) {
    const m = cleaned.match(re);
    if (!m) continue;
    let hour = Number(m[1]);
    const minute = twelveHour && m.length === 3 ? 0 : Number(m[2]);
    if (minute > 59) continue;
    if (twelveHour) {
      if (hour < 1 || hour > 12) continue;
      const meridiem = m[m.length - 1];
      hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
    } else if (hour > 23) {
      continue;
    }
    return hour * 60 + minute;
  }
  return null;
}

/** True when endTime is missing or is Catie's no-set-end-time sentinel. */
function isNoEndTime(end) {
  if (!end) return true;
  const sentinel = minutes(NO_END_TIME);
  const parsed = minutes(end);
  if (parsed !== null && sentinel !== null) return parsed === sentinel;
  return end.toUpperCase() === NO_END_TIME.toUpperCase();
}

/** fetch with a timeout; network failures and timeouts become CatieErrors naming `service`. */
async function request(service, url, init, timeoutSec) {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutSec * 1000) });
    return { resp, body: await resp.text() };
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new CatieError(`${service} did not respond within ${timeoutSec} seconds.`);
    const cause = err?.cause?.message || err?.message || String(err);
    throw new CatieError(`could not reach ${service}: ${cause}`);
  }
}

/** Validate the HTTP status *and* the body status, then return `data`. */
function payload({ resp, body }, what) {
  if (resp.status === 401 || resp.status === 403) {
    throw new AuthExpired(`${what} was refused as unauthorized (HTTP ${resp.status}).`);
  }
  if (!resp.ok) throw new CatieError(`${what} failed with HTTP ${resp.status}: ${snippet(body)}`);

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new CatieError(`${what} returned a non-JSON response: ${snippet(body)}`);
  }
  if (!isObject(json)) throw new CatieError(`${what} returned JSON that is not an object: ${snippet(body)}`);

  if (json.status !== 'success') {
    const detail = text(json.message) || snippet(body);
    throw new CatieError(`${what} returned status ${JSON.stringify(json.status ?? null)}: ${detail}`);
  }
  if (!isObject(json.data)) throw new CatieError(`${what} succeeded but carried no data object.`);
  return json.data;
}

// --- settings ----------------------------------------------------------

/**
 * Parse KEY=VALUE lines from a .env file. Blank lines and # comments are
 * skipped; an `export ` prefix, whitespace around the =, and one layer of
 * surrounding quotes are all tolerated. Never logs a value.
 */
function loadEnvFile(file) {
  const values = {};
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (let line of content.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && `"'`.includes(value[0])) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

const fileSettings = loadEnvFile(ENV_FILE);

/** A config value from the environment, else from .env.local. */
function setting(key) {
  return text(process.env[key] || fileSettings[key] || '');
}

/** The login id and password, from the environment or .env.local. */
function credentials() {
  for (const [userKey, passwordKey] of CREDENTIAL_KEYS) {
    const user = setting(userKey);
    const password = setting(passwordKey);
    if (user && password) return [user, password];
  }
  throw new CatieError(
    'No Catie credentials found. Set CATIE_USER and CATIE_PASS in the environment, ' +
      `or add CATIE_USER/CATIE_PASS (or loginId/password) to ${path.basename(ENV_FILE)}.`
  );
}

// --- Retell --------------------------------------------------------------

/**
 * One Retell REST call. Retries idempotent reads on transient upstream
 * errors; a POST upload is never retried, since it is not idempotent.
 */
async function retell(apiPath, { method = 'GET', body, timeout = TIMEOUT } = {}) {
  const apiKey = setting('RETELL_API_KEY');
  if (!apiKey) throw new CatieError(`RETELL_API_KEY is not set. Add it to ${path.basename(ENV_FILE)}.`);

  const base = setting('RETELL_BASE_URL') || RETELL_BASE_DEFAULT;
  // Content-Type is deliberately unset: fetch must pick the multipart
  // boundary itself, and forcing a value here breaks the upload.
  const headers = { Authorization: `Bearer ${apiKey}` };
  const attempts = method === 'POST' ? 1 : 3;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await request('Retell', `${base}${apiPath}`, { method, headers, body }, timeout);
    if ([429, 502, 503, 504].includes(res.resp.status) && attempt < attempts) {
      await sleep(Math.min(2 ** attempt, 8));
      continue;
    }
    if (!res.resp.ok) {
      throw new CatieError(`Retell ${method} ${apiPath} failed with HTTP ${res.resp.status}: ${snippet(res.body)}`);
    }
    if (!res.body) return {};
    try {
      const json = JSON.parse(res.body);
      return isObject(json) ? json : {};
    } catch {
      throw new CatieError(`Retell ${method} ${apiPath} returned non-JSON: ${snippet(res.body)}`);
    }
  }
  throw new CatieError(`Retell ${method} ${apiPath} did not succeed after ${attempts} attempts.`);
}

/** Retell names a source by filename, title or url depending on its type. */
function sourceName(source) {
  for (const field of ['filename', 'title', 'url', 'source_id']) {
    const value = text(source[field]);
    if (value) return value;
  }
  return '';
}

async function kbSources(kbId) {
  const kb = await retell(`/get-knowledge-base/${kbId}`);
  const sources = Array.isArray(kb.knowledge_base_sources) ? kb.knowledge_base_sources : [];
  return sources.filter(isObject);
}

/** Upload `file` to the events knowledge base, then delete this script's older exports. */
async function uploadToKnowledgeBase(file) {
  const kbId = setting(RETELL_KB_KEY);
  if (!kbId) throw new CatieError(`${RETELL_KB_KEY} is not set. Add it to ${path.basename(ENV_FILE)}.`);
  const name = path.basename(file);

  // Snapshot the ids already there, so the new upload can be told apart from a
  // same-named file left by an earlier run on the same day.
  const beforeIds = new Set((await kbSources(kbId)).map((s) => text(s.source_id)));

  console.log(`Uploading ${name} to knowledge base ${kbId}`);
  const form = new FormData();
  form.append('knowledge_base_files', new Blob([readFileSync(file)], { type: 'text/plain' }), name);
  await retell(`/add-knowledge-base-sources/${kbId}`, { method: 'POST', body: form, timeout: RETELL_UPLOAD_TIMEOUT });

  // The add-sources response reflects a pre-upload snapshot, so poll until
  // the new file actually appears rather than trusting that body.
  let sources = [];
  let confirmed = false;
  for (let attempt = 1; attempt <= RETELL_POLL_ATTEMPTS; attempt++) {
    sources = await kbSources(kbId);
    if (sources.some((s) => sourceName(s) === name && !beforeIds.has(text(s.source_id)))) {
      console.log(`Confirmed ${name} is in the knowledge base`);
      confirmed = true;
      break;
    }
    if (attempt < RETELL_POLL_ATTEMPTS) await sleep(attempt);
  }
  if (!confirmed) {
    // The upload itself may well have worked and only indexing is behind;
    // say so plainly instead of deleting the old file on that assumption.
    throw new CatieError(
      `${name} did not appear in the knowledge base after ${RETELL_POLL_ATTEMPTS} checks. The old export was left in place.`
    );
  }

  // Only this script's own dated exports are eligible for deletion. A source
  // with today's name is replaced too, but only if it was there before this
  // upload (its id is in beforeIds), so the new file is never removed.
  for (const source of sources) {
    const existing = sourceName(source);
    const sourceId = text(source.source_id);
    if (!sourceId || !DATED_RE.test(existing)) continue;
    if (existing === name && !beforeIds.has(sourceId)) continue;
    try {
      await retell(`/delete-knowledge-base-source/${kbId}/source/${sourceId}`, { method: 'DELETE' });
      console.log(`Removed previous knowledge base source ${existing}`);
    } catch (err) {
      // Never fail the run over cleanup: the current export is already live.
      console.error(`Warning: could not remove ${existing}: ${err.message}`);
    }
  }
}

// --- step 1: authenticate ----------------------------------------------

/** Log in and return [token, userId]. Fresh every call; never cached. */
async function login() {
  const [user, password] = credentials();
  const res = await request(
    'Catie',
    `${BASE_URL}/authenticate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: user, password }) },
    TIMEOUT
  );
  const data = payload(res, 'Login');

  const token = text(data.token);
  const userId = text(data.userId);
  if (!token || !userId) throw new CatieError('Login succeeded but the response had no token or userId.');
  return [token, userId];
}

// --- step 2: fetch the events ------------------------------------------

/** Return calendarEvent: an object of "YYYY-MM-DD" -> list of events. */
async function fetchEvents(token, userId) {
  const params = new URLSearchParams({
    userId,
    fromDate: isoDate(todayPlus(0)),
    toDate: isoDate(todayPlus(DAYS_AHEAD)),
    viewFlag: String(VIEW_FLAG),
  });
  const res = await request(
    'Catie',
    `${BASE_URL}/services/device/event/getEventList?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
    TIMEOUT
  );
  const data = payload(res, 'Event fetch');

  const calendar = data.calendarEvent;
  if (calendar == null) return {};
  if (!isObject(calendar)) throw new CatieError('calendarEvent was not an object keyed by date.');
  return calendar;
}

// --- step 3: write the file --------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayHeading(dayKey) {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!d || d.getUTCDate() !== Number(m[3])) return `=== ${dayKey} ===`;
  return `=== ${WEEKDAYS[d.getUTCDay()]}, ${dayKey} ===`;
}

/** "10:00 AM - 12:00 PM", or just the start when there is no set end. */
function timeRange(event) {
  const start = text(event.startTime);
  const end = text(event.endTime);
  if (isNoEndTime(end)) return start;
  if (!start) return end;
  return `${start} - ${end}`;
}

/** The pipe-separated fields that follow the time column. */
function eventFields(event) {
  const name = text(event.eventName);
  const location = text(event.eventLocation);
  const types = event.eventTypes;
  const typeLabel = Array.isArray(types) ? types.map(text).filter(Boolean).join(', ') : text(types);

  const fields = [name, location, typeLabel];
  // Description is dropped when it only repeats the name, which Catie does often.
  const description = text(event.eventDescription);
  if (description && description.toLowerCase() !== name.toLowerCase()) fields.push(description);
  return fields;
}

/** By start time (unparseable or missing times last), then by name. */
function compareEvents(a, b) {
  const ma = minutes(text(a.startTime));
  const mb = minutes(text(b.startTime));
  if ((ma === null) !== (mb === null)) return ma === null ? 1 : -1;
  if ((ma ?? 0) !== (mb ?? 0)) return (ma ?? 0) - (mb ?? 0);
  const na = text(a.eventName).toLowerCase();
  const nb = text(b.eventName).toLowerCase();
  return na < nb ? -1 : na > nb ? 1 : 0;
}

function sortedEvents(raw) {
  return Array.isArray(raw) ? raw.filter(isObject).sort(compareEvents) : [];
}

function render(calendar, generated, [fromDate, toDate]) {
  // Build every row first, so the time column can be padded to one width.
  const days = [];
  for (const dayKey of Object.keys(calendar).sort()) {
    const rows = sortedEvents(calendar[dayKey]).map((e) => [timeRange(e), eventFields(e)]);
    if (rows.length) days.push([dayKey, rows]);
  }
  const width = Math.max(0, ...days.flatMap(([, rows]) => rows.map(([range]) => range.length)));

  const stamp = `${isoDate(generated)} ${pad(generated.getHours())}:${pad(generated.getMinutes())}`;
  const lines = [`Catie events for ${isoDate(fromDate)} to ${isoDate(toDate)} - generated ${stamp}`, ''];
  if (!days.length) {
    lines.push('No events scheduled in this window.');
    return lines.join('\n') + '\n';
  }
  for (const [dayKey, rows] of days) {
    lines.push(dayHeading(dayKey));
    for (const [range, fields] of rows) lines.push([range.padEnd(width), ...fields].join(' | ').trimEnd());
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

/** Write to a temp file in the same directory, then replace in one step, so a reader never sees a half-written file. */
function writeAtomic(file, content) {
  const tmp = path.join(path.dirname(file), `.events-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

/** Delete earlier runs' events_YYYY-MM-DD.txt files, keeping only `keep`. */
function pruneOlder(dir, keep) {
  const removed = [];
  for (const name of readdirSync(dir).sort()) {
    if (!DATED_RE.test(name) || name === keep) continue;
    const full = path.join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
      unlinkSync(full);
      removed.push(name);
    } catch (err) {
      console.error(`Warning: could not remove ${name}: ${err.message}`);
    }
  }
  return removed;
}

/** Write the dated file and prune older dated files, so the only export on disk is this run's. */
function writeTxt(calendar, file) {
  const content = render(calendar, new Date(), [todayPlus(0), todayPlus(DAYS_AHEAD)]);
  writeAtomic(file, content);
  for (const name of pruneOlder(path.dirname(file), path.basename(file))) console.log(`Removed previous export ${name}`);
  return file;
}

// --- entry point -------------------------------------------------------

async function main() {
  let calendar;
  try {
    let [token, userId] = await login();
    try {
      calendar = await fetchEvents(token, userId);
    } catch (err) {
      if (!(err instanceof AuthExpired)) throw err;
      // Token refused mid-run: log in again and retry the fetch once.
      console.error('Session was refused; logging in again and retrying once.');
      [token, userId] = await login();
      calendar = await fetchEvents(token, userId);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }

  const dated = path.join(OUTPUT_DIR, `events_${isoDate(todayPlus(0))}.txt`);
  let written;
  try {
    written = writeTxt(calendar, dated);
  } catch (err) {
    console.error(`Error: could not write the events file: ${err.message}`);
    return 1;
  }

  const days = Object.values(calendar);
  const total = days.reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
  console.log(`Wrote ${total} event(s) across ${days.length} day(s) to ${written}`);

  if (process.argv.includes('--no-upload')) {
    console.log('Skipping the knowledge base upload (--no-upload)');
    return 0;
  }

  try {
    await uploadToKnowledgeBase(written);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(`The export is still on disk at ${written}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
