"""Static per-model $/token pricing for the usage ledger
(``agent/memory/conversation_store.py``'s ``usage_events`` table).

Hand-maintained on purpose -- no live pricing service exists anywhere in this
codebase (``models/model_catalog.py`` only has ``context_window``/
``capabilities``), and one is not worth building for a table whose job is
"roughly how much did this cost", not billing-grade accounting. An unknown
model returns ``None`` rather than raising or defaulting to 0 -- a missing
price entry must never look like "this call was free", and it must never
break usage recording either (see ``ConversationStore.record_usage``).

Prices are USD per 1,000 tokens, input/output priced separately since they
usually differ. Update this table by hand as models/prices change.
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

# model id -> (input $/1K tokens, output $/1K tokens)
_PRICING_PER_1K: Dict[str, Tuple[float, float]] = {
    "claude-opus-5-5": (0.015, 0.075),
    "claude-sonnet-5": (0.003, 0.015),
    "claude-haiku-4-5-20251001": (0.001, 0.005),
    "gpt-4o": (0.0025, 0.010),
    "gpt-4o-mini": (0.00015, 0.0006),
    "deepseek-chat": (0.00027, 0.0011),
    "glm-4": (0.0005, 0.0005),
}


def estimate_cost(model: str, usage: Dict[str, int]) -> Optional[float]:
    """USD cost of one LLM call from its usage dict, or None if this model's
    price is not in the table -- callers must persist usage either way and
    simply leave cost_usd null rather than skip the row."""
    prices = _PRICING_PER_1K.get(model or "")
    if prices is None:
        return None
    input_price, output_price = prices
    prompt_tokens = usage.get("prompt_tokens", 0) or 0
    completion_tokens = usage.get("completion_tokens", 0) or 0
    return round(
        (prompt_tokens / 1000.0) * input_price + (completion_tokens / 1000.0) * output_price,
        6,
    )
