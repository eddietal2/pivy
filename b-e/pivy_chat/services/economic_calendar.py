import logging
import re
from datetime import date, datetime, timezone

import requests

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

_YF_URL = "https://finance.yahoo.com/calendar/economic"

# ------------------------------------------------------------------ #
#  Known high-impact event keywords (case-insensitive)               #
# ------------------------------------------------------------------ #
_HIGH_IMPACT_KEYWORDS = {
    "nonfarm", "non-farm", "payroll",
    "cpi", "consumer price",
    "ppi", "producer price",
    "fed funds", "federal funds", "fomc", "interest rate decision",
    "gdp",
    "retail sales",
    "unemployment claims", "initial claims", "jobless claims",
    "ism manufacturing", "ism services", "ism non-manufacturing",
    "trade balance",
    "industrial production",
    "housing starts",
    "consumer confidence",
    "personal income", "personal spending",
    "pce",
    "durable goods",
    "building permits",
    "michigan sentiment",
    "afa employment",
    "adp employment",
    "jolts",
    "beige book",
}

_MEDIUM_IMPACT_KEYWORDS = {
    "mortgage", "mba",
    "existing home", "new home",
    "factory orders",
    "business inventories",
    "wholesale inventories",
    "crude oil inventories",
    "natural gas",
    "chicago pmi",
    "philly fed",
    "empire state",
    "capacity utilization",
    "redbook",
    "challenger",
}


class EconomicCalendarService:
    """
    Fetches the US economic calendar by scraping Yahoo Finance's
    economic calendar HTML table.

    No API key required.  Falls back gracefully to an empty list on any
    failure so morning-brief generation continues uninterrupted.
    """

    def get_events_for_date(self, target_date: date, min_impact: str = 'Medium') -> list:
        """
        Return US economic events for target_date, sorted by ET time.

        Args:
            target_date: The date to fetch events for.
            min_impact:  'High' = only high-impact; 'Medium' = high + medium.

        Returns:
            List of dicts:
                {time (str "8:30 AM ET"), event (str), actual, estimate,
                 previous, impact ('High'|'Medium'|'Low'), unit (str)}
        """
        date_str = target_date.isoformat()

        try:
            resp = requests.get(
                _YF_URL,
                params={"from": date_str, "to": date_str},
                headers=_HEADERS,
                timeout=15,
            )
        except requests.exceptions.RequestException as ex:
            logger.warning("Economic calendar: HTTP request failed: %s", ex)
            return []

        if resp.status_code != 200:
            logger.warning(
                "Economic calendar: unexpected HTTP %d from Yahoo Finance",
                resp.status_code,
            )
            return []

        # ── Locate tbody ──────────────────────────────────────────────
        tbody_match = re.search(r'<tbody[^>]*>(.*?)</tbody>', resp.text, re.DOTALL)
        if not tbody_match:
            logger.warning(
                "Economic calendar: <tbody> not found in Yahoo Finance response — "
                "page structure may have changed"
            )
            return []

        tbody = tbody_match.group(1)

        # ── Parse rows ────────────────────────────────────────────────
        rows = re.findall(
            r'<tr[^>]*data-testid="data-table-v2-row"[^>]*>(.*?)</tr>',
            tbody,
            re.DOTALL,
        )
        if not rows:
            logger.info("Economic calendar: no event rows found for %s", target_date)
            return []

        events = []
        for row_html in rows:
            cells = _extract_cells(row_html)

            country = cells.get("country_code", "").strip().upper()
            if country != "US":
                continue

            event_name = cells.get("econ_release", "").strip()
            impact = _classify_impact(event_name)

            allowed = {"High"} if min_impact == "High" else {"High", "Medium"}
            if impact not in allowed:
                continue

            time_utc_str = cells.get("startdatetime", "").strip()
            time_et = _utc_display_to_et(time_utc_str)

            events.append({
                "time": time_et,
                "event": event_name,
                "actual": _clean_val(cells.get("after_release_actual")),
                "estimate": _clean_val(cells.get("consensus_estimate")),
                "previous": _clean_val(cells.get("prior_release_actual")),
                "impact": impact,
                "unit": "",
            })

        events.sort(key=lambda x: _sort_key(x["time"]))
        logger.info("Economic calendar: %d US events for %s", len(events), target_date)
        return events


# ------------------------------------------------------------------ #
#  Internal helpers                                                    #
# ------------------------------------------------------------------ #

def _extract_cells(row_html: str) -> dict:
    """Extract {testid: text} from a table row's <td> elements."""
    cells = {}
    for m in re.finditer(
        r'data-testid-cell="([^"]+)"[^>]*>(.*?)</td>',
        row_html,
        re.DOTALL,
    ):
        key = m.group(1)
        raw_html = m.group(2)
        # Strip inner HTML tags
        text = re.sub(r'<[^>]+>', '', raw_html).strip()
        cells[key] = text
    return cells


def _classify_impact(event_name: str) -> str:
    """Return 'High', 'Medium', or 'Low' based on event name keywords."""
    lower = event_name.lower()
    for kw in _HIGH_IMPACT_KEYWORDS:
        if kw in lower:
            return "High"
    for kw in _MEDIUM_IMPACT_KEYWORDS:
        if kw in lower:
            return "Medium"
    return "Low"


def _clean_val(val: str | None) -> str | None:
    """Return None for empty/dash placeholders, else the string."""
    if not val or val.strip() in ("-", "", "N/A", "—"):
        return None
    return val.strip()


def _utc_display_to_et(time_str: str) -> str:
    """
    Convert Yahoo Finance's display time string to ET.

    Possible formats:
      "11:00 AM UTC"   → parsed as UTC, converted to ET
      "7:30 AM EDT"    → already ET-like, return as-is with 'ET' suffix
      "8:30 AM ET"     → pass-through
    """
    if not time_str:
        return ""

    upper = time_str.upper()

    # Already Eastern
    if "ET" in upper or "EDT" in upper or "EST" in upper:
        # Normalise suffix to ET
        cleaned = re.sub(r'\b(EDT|EST|ET)\b', 'ET', time_str, flags=re.IGNORECASE).strip()
        return cleaned

    # Contains UTC → convert
    if "UTC" in upper:
        time_part = re.sub(r'\s*UTC\s*', '', time_str, flags=re.IGNORECASE).strip()
        try:
            # e.g. "11:00 AM"
            dt = datetime.strptime(time_part, "%I:%M %p").replace(
                tzinfo=timezone.utc
            )
            # Determine offset: EDT = -4, EST = -5
            # Use -4 (EDT) for Mar–Nov, -5 (EST) for Nov–Mar
            # Simple heuristic: check current month
            from datetime import date as _date
            today = _date.today()
            offset = -4 if 3 <= today.month <= 11 else -5
            et_hour = (dt.hour + offset) % 24
            ampm = "AM" if et_hour < 12 else "PM"
            h12 = et_hour % 12 or 12
            return f"{h12}:{dt.minute:02d} {ampm} ET"
        except ValueError:
            pass

    return time_str  # Return original if we can't parse it


def _sort_key(time_str: str) -> tuple:
    """Return (hour_24, minute) for chronological sorting. Unknown → last."""
    try:
        # "8:30 AM ET" or "8:30 AM"
        parts = time_str.split()
        h, m = map(int, parts[0].split(":"))
        if parts[1] == "PM" and h != 12:
            h += 12
        elif parts[1] == "AM" and h == 12:
            h = 0
        return (h, m)
    except Exception:
        return (99, 99)
