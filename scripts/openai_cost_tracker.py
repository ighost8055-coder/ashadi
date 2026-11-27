#!/usr/bin/env python3
"""
openai_cost_tracker.py — shared wrapper for every OpenAI chat completion call
across this project, so actual token usage and $ cost are logged from the
API's own response (usage.prompt_tokens / usage.completion_tokens), never
estimated. Every script that calls OpenAI (discover_seo_profiles.py,
keyword_demand_finder.py, competitor_keyword_bank.py, refresh_domain_knowledge.py,
rescore_relevance_llm.py) should call `call_openai_chat()` here instead of
requests.post()'ing OPENAI_URL directly.

Appends one line per call to data/openai_cost_log.jsonl (caller tag, model,
tokens, cost, timestamp) and updates a running total in
data/openai_cost_summary.json — read either any time via `summary()` or
`python scripts/openai_cost_tracker.py status`.

Pricing table below is per-model, USD per 1M tokens (input/output) — update
PRICING if OpenAI changes rates or a script switches model. Unknown models
log token counts but cost as null rather than guessing.
"""
from __future__ import annotations
import json, threading, time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LOG_PATH = DATA / "openai_cost_log.jsonl"
SUMMARY_PATH = DATA / "openai_cost_summary.json"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# USD per 1,000,000 tokens — (input, output). Confirm against
# https://openai.com/api/pricing if a script starts using a different model.
PRICING = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
}
# 2026-10-06, user: "can cache the token to reduce the token costs" — OpenAI
# auto-caches any repeated prompt PREFIX >=1024 tokens with no code/flag
# needed (confirmed: Kogul's prompts already put the ~4000-token KOGUL.md
# brief as a stable early block, see brain.py's builders), and bills cached
# input tokens at a flat 50% discount vs. the normal input rate. The API
# reports the hit in usage.prompt_tokens_details.cached_tokens — this was
# previously read nowhere, so every cache hit was silently costed as if it
# never happened (cost OVERSTATED, not understated — the real bill is lower
# than this tracker used to report). Per-model discount; OpenAI has not
# published a different cache rate for gpt-4.1 family as of this writing, so
# the same 50% is applied until/unless they do.
CACHED_INPUT_DISCOUNT = 0.5

_lock = threading.Lock()


def _cost(model: str, prompt_tokens: int, completion_tokens: int, cached_tokens: int = 0) -> float | None:
    rates = PRICING.get(model)
    if not rates:
        return None
    in_rate, out_rate = rates
    cached_tokens = min(cached_tokens, prompt_tokens)  # defensive — never let a bad value go negative below
    uncached_tokens = prompt_tokens - cached_tokens
    input_cost = (uncached_tokens * in_rate + cached_tokens * in_rate * CACHED_INPUT_DISCOUNT) / 1_000_000
    return round(input_cost + completion_tokens * out_rate / 1_000_000, 6)


def _log_call(caller: str, model: str, prompt_tokens: int, completion_tokens: int, cost,
              cached_tokens: int = 0) -> None:
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "caller": caller, "model": model,
        "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens, "cost_usd": cost,
        "cached_tokens": cached_tokens,
    }
    with _lock:
        DATA.mkdir(exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        summary = {}
        if SUMMARY_PATH.exists():
            try:
                summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
            except Exception:
                summary = {}
        summary.setdefault("total_calls", 0)
        summary.setdefault("total_prompt_tokens", 0)
        summary.setdefault("total_completion_tokens", 0)
        summary.setdefault("total_cached_tokens", 0)
        summary.setdefault("total_cost_usd", 0.0)
        summary.setdefault("by_caller", {})
        summary["total_calls"] += 1
        summary["total_prompt_tokens"] += prompt_tokens
        summary["total_completion_tokens"] += completion_tokens
        summary["total_cached_tokens"] += cached_tokens
        summary["total_cost_usd"] = round(summary["total_cost_usd"] + (cost or 0), 6)
        by_caller = summary["by_caller"].setdefault(
            caller, {"calls": 0, "tokens": 0, "cached_tokens": 0, "cost_usd": 0.0})
        by_caller["calls"] += 1
        by_caller["tokens"] += prompt_tokens + completion_tokens
        by_caller["cached_tokens"] = by_caller.get("cached_tokens", 0) + cached_tokens
        by_caller["cost_usd"] = round(by_caller["cost_usd"] + (cost or 0), 6)
        summary["updated_at"] = entry["ts"]
        SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def call_openai_chat(api_key: str, model: str, messages: list[dict], caller: str,
                     temperature: float = 0.2, response_format: dict | None = None,
                     timeout: int = 60) -> dict:
    """Drop-in replacement for requests.post(OPENAI_URL, ...) — same request
    shape, but logs real usage from the response before returning it.
    `caller` should be a short tag identifying which script/function made
    the call (e.g. 'discover_seo_profiles.call_openai') so cost is
    attributable per feature, not just a single grand total."""
    payload = {"model": model, "messages": messages, "temperature": temperature}
    if response_format:
        payload["response_format"] = response_format
    r = requests.post(OPENAI_URL,
                      headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                      json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    usage = data.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    # cached_tokens is OpenAI's own report of how much of this prompt hit its
    # automatic prefix cache (see CACHED_INPUT_DISCOUNT above) — 0 whenever
    # the prompt is new/changed/or under the ~1024-token cache floor.
    cached_tokens = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
    cost = _cost(model, prompt_tokens, completion_tokens, cached_tokens)
    _log_call(caller, model, prompt_tokens, completion_tokens, cost, cached_tokens)
    return data


def summary() -> dict:
    if SUMMARY_PATH.exists():
        try:
            return json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def main():
    s = summary()
    if not s:
        print("[i] no OpenAI calls logged yet")
        return
    print(f"Total calls: {s.get('total_calls', 0)}")
    print(f"Total tokens: {s.get('total_prompt_tokens', 0) + s.get('total_completion_tokens', 0):,} "
          f"({s.get('total_prompt_tokens', 0):,} in / {s.get('total_completion_tokens', 0):,} out)")
    print(f"Total cost: ${s.get('total_cost_usd', 0):.4f}")
    print(f"Last updated: {s.get('updated_at', '?')}")
    print("\nBy caller:")
    for caller, d in sorted(s.get("by_caller", {}).items(), key=lambda x: -x[1]["cost_usd"]):
        print(f"  {caller:45s} {d['calls']:>4d} calls  {d['tokens']:>10,} tokens  ${d['cost_usd']:.4f}")


if __name__ == "__main__":
    main()
