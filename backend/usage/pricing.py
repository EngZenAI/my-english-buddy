from __future__ import annotations

from typing import Any

USD_PER_MILLION = 1_000_000

# IBM watsonx.ai pricing 기준: 2026-07-06.
TOKEN_COST_PROFILES = {
    "ibm/granite-4-h-small": {
        "input_per_million": 0.0636,
        "output_per_million": 0.265,
    },
    "openai/gpt-oss-120b": {
        "input_per_million": 0.159,
        "output_per_million": 0.636,
    },
    "meta-llama/llama-3-3-70b-instruct": {
        "total_per_million": 0.7526,
    },
}


def estimate_llm_cost_usd(item: dict[str, Any]) -> float:
    model = (item.get("model") or "").strip()
    profile = TOKEN_COST_PROFILES.get(model)
    if not profile:
        return 0.0

    input_tokens = int(item.get("input_tokens") or 0)
    output_tokens = int(item.get("output_tokens") or 0)
    total_tokens = int(item.get("total_tokens") or 0)

    if "total_per_million" in profile:
        if not total_tokens:
            total_tokens = input_tokens + output_tokens
        return round(total_tokens / USD_PER_MILLION * profile["total_per_million"], 6)

    input_cost = input_tokens / USD_PER_MILLION * profile["input_per_million"]
    output_cost = output_tokens / USD_PER_MILLION * profile["output_per_million"]
    return round(input_cost + output_cost, 6)
