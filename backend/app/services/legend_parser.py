"""Use Claude to identify legend tables and schedules from extracted annotations."""
import os
import json
from typing import Optional

try:
    from anthropic import Anthropic  # type: ignore
except ImportError:  # pragma: no cover - optional dependency at runtime
    Anthropic = None  # type: ignore

_client: Optional["Anthropic"] = None


def _get_client():
    """Lazily construct (and cache) the Anthropic client. Returns None if unavailable."""
    global _client
    if Anthropic is None:
        return None
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    if _client is None:
        _client = Anthropic(api_key=api_key)
    return _client


SYSTEM_PROMPT = """You are an expert plumbing/hydraulic engineer analyzing CAD drawing annotations.

You will be given a list of TEXT entities extracted from a CAD drawing (plumbing plan), each with position (x, y), text content, and layer.

Your job:
1. Identify the LEGEND KEY (usually located at an edge of the drawing — shows symbol abbreviations mapped to descriptions, e.g., "WM = 20mm Water Meter", "BV = Ball Valve")
2. Identify SCHEDULE TABLES (tabular item lists with descriptions, sizes, quantities)
3. Identify GENERAL NOTES (context applicable to the whole drawing)

Return STRICT JSON ONLY (no markdown, no prose):
{
  "legend": [
    {"symbol": "WM", "description": "20mm Water Meter Brass", "size": "20mm", "material": "brass"},
    ...
  ],
  "schedules": [
    {"item_code": "P-001", "description": "PVC Stack 100mm", "size": "100mm", "qty": 4, "material": "PVC"},
    ...
  ],
  "notes": ["All pipework to AS/NZS 3500", "..."]
}

If no legend, schedules, or notes are found, return empty arrays. Do NOT invent data.
"""


def parse_legend(annotations: list[dict]) -> dict:
    """Call Claude to extract legend/schedule/notes from annotation list."""
    client = _get_client()
    if client is None:
        return {"legend": [], "schedules": [], "notes": [], "skipped_reason": "no_api_key"}

    if not annotations:
        return {"legend": [], "schedules": [], "notes": []}

    # Keep payload reasonable — cap at 500 annotations
    capped = annotations[:500]

    try:
        payload = "\n".join(
            f"[{a.get('layer', '')}] ({a['position'][0]:.0f},{a['position'][1]:.0f}) {a['text']}"
            for a in capped
            if a.get("text", "").strip() and a.get("position")
        )
    except (KeyError, TypeError, IndexError) as e:
        return {"legend": [], "schedules": [], "notes": [], "error": f"payload build failed: {e}"}

    if not payload:
        return {"legend": [], "schedules": [], "notes": []}

    try:
        model = "claude-opus-4-7"
        msg = client.messages.create(
            model=model,
            max_tokens=4000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": payload}],
        )
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        result = json.loads(text)
        # Attach usage info so the caller (Next.js API route) can log it
        # into the tenant-scoped llm_usage table. Shape matches the
        # SDK's usage object plus the model + purpose for accounting.
        usage = getattr(msg, "usage", None)
        if usage is not None:
            result["_usage"] = {
                "purpose": "legend_parser",
                "model": model,
                "input_tokens": getattr(usage, "input_tokens", 0) or 0,
                "output_tokens": getattr(usage, "output_tokens", 0) or 0,
                "cache_creation_input_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
                "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
                "request_id": getattr(msg, "id", None),
            }
        return result
    except json.JSONDecodeError as e:
        return {"legend": [], "schedules": [], "notes": [], "error": f"JSON parse failed: {e}"}
    except Exception as e:  # noqa: BLE001 — never break extraction
        return {"legend": [], "schedules": [], "notes": [], "error": str(e)}
