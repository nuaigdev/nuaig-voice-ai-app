#!/usr/bin/env python3
"""Fetch the next 7 days of Catie events and write them to a text file.

Standalone: nothing in the Next.js app imports this, and it imports nothing
from the app. Run it by hand or from a scheduled task.

Credentials come from the environment (CATIE_USER / CATIE_PASS), falling back
to the gitignored .env.local beside this script, which may name them either
CATIE_USER / CATIE_PASS or loginId / password. The environment wins when both
are present. The login token lives only in memory for the duration of the run;
neither the password nor the token is ever printed or written to disk.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://seabury.mycatie.com/catieweb-v2"
TIMEOUT = 30              # seconds, applied to every HTTP call
DAYS_AHEAD = 7            # toDate = today + 7 days
NO_END_TIME = "11:59 PM"  # Catie's sentinel for "no set end time"

# viewFlag is the view mode, and it decides whether toDate is honored at all:
#   0 -> returns nothing          1 -> single day, toDate ignored
#   2 -> fixed 7-day week from fromDate, toDate ignored
#   3 -> the exact fromDate..toDate range    omitted -> status 0, no data
# Only 3 respects the window, so only 3 can return a multi-day range.
VIEW_FLAG = 3

OUTPUT_DIR = Path(__file__).resolve().parent
DATED_RE = re.compile(r"^events_\d{4}-\d{2}-\d{2}\.txt$")

# Credentials: checked in this order, environment before file. The second pair
# matches the names the Catie API itself uses, which is how .env.local spells them.
ENV_FILE = OUTPUT_DIR / ".env.local"
CREDENTIAL_KEYS = (("CATIE_USER", "CATIE_PASS"), ("loginId", "password"))

# --- Retell knowledge base -----------------------------------------------
# The export is uploaded to the events knowledge base, then this run's older
# exports are deleted. Deletion is limited to filenames matching DATED_RE, so
# a document somebody uploaded by hand through the console is never removed.
# Order matters: Retell refuses to delete a knowledge base's last source, so
# the replacement has to go up before the old one comes down.
RETELL_BASE_DEFAULT = "https://api.retellai.com"
RETELL_KB_KEY = "RETELL_KB_EVENTS"
RETELL_UPLOAD_TIMEOUT = 60   # uploads are slower than reads and are not retried
RETELL_POLL_ATTEMPTS = 5     # add-sources returns a stale body; poll until the file shows
UPLOAD_ENABLED = True        # tests set this False to exercise the write path alone

# Formats accepted when parsing a time. Catie sends "10:00 AM"; the rest are
# tolerated so an upstream format change degrades instead of crashing.
TIME_FORMATS = ("%I:%M %p", "%I %p", "%H:%M", "%H:%M:%S")


class CatieError(Exception):
    """An API call failed in a way the run cannot recover from."""


class AuthExpired(CatieError):
    """The API rejected our credentials or token (401/403)."""


# --- small helpers -----------------------------------------------------

def _text(value: Any) -> str:
    """A trimmed string for any field; blank for null/missing."""
    if value is None:
        return ""
    return str(value).strip()


def _snippet(resp: requests.Response, limit: int = 200) -> str:
    """A short, safe excerpt of a response body, for error messages."""
    body = (resp.text or "").strip().replace("\n", " ")
    return body[:limit] if body else "<empty body>"


def _minutes(value: str) -> int | None:
    """Minutes since midnight, or None if the time cannot be parsed."""
    if not value:
        return None
    cleaned = " ".join(value.upper().split())
    for fmt in TIME_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
        return parsed.hour * 60 + parsed.minute
    return None


def _is_no_end_time(end: str) -> bool:
    """True when endTime is missing or is Catie's no-set-end-time sentinel."""
    if not end:
        return True
    sentinel = _minutes(NO_END_TIME)
    parsed = _minutes(end)
    if parsed is not None and sentinel is not None:
        return parsed == sentinel
    return end.upper() == NO_END_TIME.upper()


def _payload(resp: requests.Response, what: str) -> dict[str, Any]:
    """Validate the HTTP status *and* the body status, then return `data`."""
    if resp.status_code in (401, 403):
        raise AuthExpired(f"{what} was refused as unauthorized (HTTP {resp.status_code}).")
    if not resp.ok:
        raise CatieError(f"{what} failed with HTTP {resp.status_code}: {_snippet(resp)}")

    try:
        body = resp.json()
    except ValueError:
        raise CatieError(f"{what} returned a non-JSON response: {_snippet(resp)}") from None
    if not isinstance(body, dict):
        raise CatieError(f"{what} returned JSON that is not an object: {_snippet(resp)}")

    status = body.get("status")
    if status != "success":
        detail = _text(body.get("message")) or _snippet(resp)
        raise CatieError(f"{what} returned status {status!r}: {detail}")

    data = body.get("data")
    if not isinstance(data, dict):
        raise CatieError(f"{what} succeeded but carried no data object.")
    return data


# --- step 1: authenticate ----------------------------------------------

def _load_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines from a .env file. Blank lines and # comments are
    skipped; an `export ` prefix, whitespace around the =, and one layer of
    surrounding quotes are all tolerated. Never logs a value."""
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return values

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep:
            continue
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def _credentials() -> tuple[str, str]:
    """The login id and password, from the environment or .env.local."""
    from_file = _load_env_file(ENV_FILE)

    def lookup(key: str) -> str:
        # os.environ first, so a real environment variable always overrides the file.
        return _text(os.environ.get(key) or from_file.get(key, ""))

    for user_key, password_key in CREDENTIAL_KEYS:
        user, password = lookup(user_key), lookup(password_key)
        if user and password:
            return user, password

    raise CatieError(
        "No Catie credentials found. Set CATIE_USER and CATIE_PASS in the environment, "
        f"or add CATIE_USER/CATIE_PASS (or loginId/password) to {ENV_FILE.name}."
    )


def _setting(key: str) -> str:
    """A config value from the environment, else from .env.local."""
    return _text(os.environ.get(key) or _load_env_file(ENV_FILE).get(key, ""))


def _retell(path: str, method: str = "GET", **kwargs: Any) -> dict[str, Any]:
    """One Retell REST call. Retries idempotent reads on transient upstream
    errors; a POST upload is never retried, since it is not idempotent."""
    api_key = _setting("RETELL_API_KEY")
    if not api_key:
        raise CatieError(f"RETELL_API_KEY is not set. Add it to {ENV_FILE.name}.")

    base = _setting("RETELL_BASE_URL") or RETELL_BASE_DEFAULT
    url = f"{base}{path}"
    headers = {"Authorization": f"Bearer {api_key}"}
    # Content-Type is deliberately unset: requests must pick the multipart
    # boundary itself, and forcing a value here breaks the upload.
    attempts = 1 if method == "POST" else 3

    for attempt in range(1, attempts + 1):
        resp = requests.request(method, url, headers=headers, **kwargs)
        if resp.status_code in (429, 502, 503, 504) and attempt < attempts:
            time.sleep(min(2 ** attempt, 8))
            continue
        if not resp.ok:
            raise CatieError(
                f"Retell {method} {path} failed with HTTP {resp.status_code}: {_snippet(resp)}"
            )
        if not resp.content:
            return {}
        try:
            body = resp.json()
        except ValueError:
            raise CatieError(f"Retell {method} {path} returned non-JSON: {_snippet(resp)}") from None
        return body if isinstance(body, dict) else {}
    raise CatieError(f"Retell {method} {path} did not succeed after {attempts} attempts.")


def _source_name(source: dict[str, Any]) -> str:
    """Retell names a source by filename, title or url depending on its type."""
    for field in ("filename", "title", "url", "source_id"):
        value = _text(source.get(field))
        if value:
            return value
    return ""


def _kb_sources(kb_id: str) -> list[dict[str, Any]]:
    kb = _retell(f"/get-knowledge-base/{kb_id}", timeout=TIMEOUT)
    sources = kb.get("knowledge_base_sources") or []
    return [s for s in sources if isinstance(s, dict)]


def upload_to_knowledge_base(path: Path) -> None:
    """Upload `path` to the events knowledge base, then delete this script's
    older exports. Raises CatieError on failure."""
    kb_id = _setting(RETELL_KB_KEY)
    if not kb_id:
        raise CatieError(f"{RETELL_KB_KEY} is not set. Add it to {ENV_FILE.name}.")

    # Snapshot the ids already there, so the new upload can be told apart from a
    # same-named file left by an earlier run on the same day.
    before_ids = {_text(s.get("source_id")) for s in _kb_sources(kb_id)}

    print(f"Uploading {path.name} to knowledge base {kb_id}")
    with path.open("rb") as handle:
        _retell(
            f"/add-knowledge-base-sources/{kb_id}",
            method="POST",
            files={"knowledge_base_files": (path.name, handle, "text/plain")},
            timeout=RETELL_UPLOAD_TIMEOUT,
        )

    # The add-sources response reflects a pre-upload snapshot, so poll until
    # the new file actually appears rather than trusting that body.
    sources: list[dict[str, Any]] = []
    for attempt in range(1, RETELL_POLL_ATTEMPTS + 1):
        sources = _kb_sources(kb_id)
        if any(_source_name(s) == path.name and _text(s.get("source_id")) not in before_ids
               for s in sources):
            print(f"Confirmed {path.name} is in the knowledge base")
            break
        if attempt < RETELL_POLL_ATTEMPTS:
            time.sleep(attempt)
    else:
        # The upload itself may well have worked and only indexing is behind;
        # say so plainly instead of deleting the old file on that assumption.
        raise CatieError(
            f"{path.name} did not appear in the knowledge base after "
            f"{RETELL_POLL_ATTEMPTS} checks. The old export was left in place."
        )

    # Only this script's own dated exports are eligible for deletion. A source
    # with today's name is replaced too, but only if it was there before this
    # upload (its id is in before_ids), so the new file is never removed.
    for source in sources:
        name = _source_name(source)
        source_id = _text(source.get("source_id"))
        if not source_id or not DATED_RE.match(name):
            continue
        if name == path.name and source_id not in before_ids:
            continue
        try:
            _retell(f"/delete-knowledge-base-source/{kb_id}/source/{source_id}",
                    method="DELETE", timeout=TIMEOUT)
            print(f"Removed previous knowledge base source {name}")
        except CatieError as exc:
            # Never fail the run over cleanup: the current export is already live.
            print(f"Warning: could not remove {name}: {exc}", file=sys.stderr)


def login() -> tuple[str, str]:
    """Log in and return (token, user_id). Fresh every call; never cached."""
    user, password = _credentials()

    resp = requests.post(
        f"{BASE_URL}/authenticate",
        json={"loginId": user, "password": password},
        timeout=TIMEOUT,
    )
    data = _payload(resp, "Login")

    token = _text(data.get("token"))
    user_id = _text(data.get("userId"))
    if not token or not user_id:
        raise CatieError("Login succeeded but the response had no token or userId.")
    return token, user_id


# --- step 2: fetch the events ------------------------------------------

def fetch_events(token: str, user_id: str) -> dict[str, Any]:
    """Return calendarEvent: a dict of "YYYY-MM-DD" -> list of events."""
    today = date.today()
    resp = requests.get(
        f"{BASE_URL}/services/device/event/getEventList",
        params={
            "userId": user_id,
            "fromDate": today.isoformat(),
            "toDate": (today + timedelta(days=DAYS_AHEAD)).isoformat(),
            "viewFlag": VIEW_FLAG,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=TIMEOUT,
    )
    data = _payload(resp, "Event fetch")

    calendar = data.get("calendarEvent")
    if calendar is None:
        return {}
    if not isinstance(calendar, dict):
        raise CatieError("calendarEvent was not an object keyed by date.")
    return calendar


# --- step 3: write the file --------------------------------------------

def _day_heading(day_key: str) -> str:
    try:
        parsed = datetime.strptime(day_key, "%Y-%m-%d").date()
    except ValueError:
        return f"=== {day_key} ==="
    return f"=== {parsed.strftime('%A')}, {parsed.isoformat()} ==="


def _time_range(event: dict[str, Any]) -> str:
    """"10:00 AM - 12:00 PM", or just the start when there is no set end."""
    start = _text(event.get("startTime"))
    end = _text(event.get("endTime"))
    if _is_no_end_time(end):
        return start
    if not start:
        return end
    return f"{start} - {end}"


def _event_fields(event: dict[str, Any]) -> list[str]:
    """The pipe-separated fields that follow the time column."""
    name = _text(event.get("eventName"))
    location = _text(event.get("eventLocation"))

    types = event.get("eventTypes")
    if isinstance(types, (list, tuple)):
        type_label = ", ".join(_text(t) for t in types if _text(t))
    else:
        type_label = _text(types)

    fields = [name, location, type_label]

    # Description is dropped when it only repeats the name, which Catie does often.
    description = _text(event.get("eventDescription"))
    if description and description.casefold() != name.casefold():
        fields.append(description)
    return fields


def _sort_key(event: dict[str, Any]) -> tuple[bool, int, str]:
    minutes = _minutes(_text(event.get("startTime")))
    return (
        minutes is None,                      # unparseable or missing times last
        minutes if minutes is not None else 0,
        _text(event.get("eventName")).casefold(),
    )


def _sorted_events(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, (list, tuple)):
        return []
    return sorted((e for e in raw if isinstance(e, dict)), key=_sort_key)


def _render(calendar: dict[str, Any], generated: datetime, window: tuple[date, date]) -> str:
    # Build every row first, so the time column can be padded to one width.
    days: list[tuple[str, list[tuple[str, list[str]]]]] = []
    for day_key in sorted(calendar):
        rows = [(_time_range(e), _event_fields(e)) for e in _sorted_events(calendar[day_key])]
        if rows:
            days.append((day_key, rows))

    width = max((len(time_range) for _, rows in days for time_range, _ in rows), default=0)

    from_date, to_date = window
    lines = [
        f"Catie events for {from_date.isoformat()} to {to_date.isoformat()}"
        f" - generated {generated.strftime('%Y-%m-%d %H:%M')}",
        "",
    ]
    if not days:
        lines.append("No events scheduled in this window.")
        return "\n".join(lines) + "\n"

    for day_key, rows in days:
        lines.append(_day_heading(day_key))
        for time_range, fields in rows:
            lines.append(" | ".join([time_range.ljust(width), *fields]).rstrip())
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def _write_atomic(path: Path, text: str) -> None:
    """Write to a temp file in the same directory, then replace in one step, so
    a reader never sees a half-written file."""
    handle, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".events-", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _prune_older(output_dir: Path, keep: str) -> list[str]:
    """Delete earlier runs' events_YYYY-MM-DD.txt files, keeping only `keep`."""
    removed: list[str] = []
    for item in sorted(output_dir.iterdir()):
        if item.is_file() and DATED_RE.match(item.name) and item.name != keep:
            try:
                item.unlink()
                removed.append(item.name)
            except OSError as exc:
                print(f"Warning: could not remove {item.name}: {exc}", file=sys.stderr)
    return removed


def write_txt(events: dict[str, Any], path: str | os.PathLike[str]) -> Path:
    """Write the dated file at `path` and prune older dated files, so the only
    export on disk is this run's."""
    dated = Path(path)
    today = date.today()
    text = _render(events, datetime.now(), (today, today + timedelta(days=DAYS_AHEAD)))

    dated.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(dated, text)

    for name in _prune_older(dated.parent, dated.name):
        print(f"Removed previous export {name}")
    return dated


# --- entry point -------------------------------------------------------

def main() -> int:
    try:
        token, user_id = login()
        try:
            calendar = fetch_events(token, user_id)
        except AuthExpired:
            # Token refused mid-run: log in again and retry the fetch once.
            print("Session was refused; logging in again and retrying once.", file=sys.stderr)
            token, user_id = login()
            calendar = fetch_events(token, user_id)
    except CatieError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except requests.Timeout:
        print(f"Error: Catie did not respond within {TIMEOUT} seconds.", file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"Error: could not reach Catie: {exc}", file=sys.stderr)
        return 1

    dated = OUTPUT_DIR / f"events_{date.today().isoformat()}.txt"
    try:
        written = write_txt(calendar, dated)
    except OSError as exc:
        print(f"Error: could not write the events file: {exc}", file=sys.stderr)
        return 1

    total = sum(len(v) for v in calendar.values() if isinstance(v, (list, tuple)))
    print(f"Wrote {total} event(s) across {len(calendar)} day(s) to {written}")

    if not UPLOAD_ENABLED or "--no-upload" in sys.argv:
        print("Skipping the knowledge base upload (--no-upload)")
        return 0

    try:
        upload_to_knowledge_base(written)
    except CatieError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(f"The export is still on disk at {written}", file=sys.stderr)
        return 1
    except requests.Timeout:
        print(f"Error: Retell did not respond within {RETELL_UPLOAD_TIMEOUT} seconds.",
              file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"Error: could not reach Retell: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
