"""FinCore Python Financial Calculation Engine (Assessment 05).

All calculations strictly use decimal.Decimal (never binary IEEE-754 float)
with explicit quantization to 2 or 4 decimal places and configurable rounding rules
(default: ROUND_HALF_EVEN / banker's rounding).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, ROUND_HALF_UP
from typing import Dict, Iterable, List, Optional

QUANT_2 = Decimal("0.01")
QUANT_4 = Decimal("0.0001")

FEE_TIERS = {
    "standard": {"bps": Decimal("25"), "min_fee": Decimal("0.50"), "max_fee": Decimal("25.00")},
    "instant": {"bps": Decimal("75"), "min_fee": Decimal("1.00"), "max_fee": Decimal("50.00")},
    "enterprise": {"bps": Decimal("10"), "min_fee": Decimal("0.25"), "max_fee": Decimal("15.00")},
}


def to_decimal(value: str | int | Decimal, field: str = "amount") -> Decimal:
    if isinstance(value, float):
        raise ValueError(f"{field} must not be passed as binary float; use string or Decimal")
    try:
        dec = value if isinstance(value, Decimal) else Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Invalid decimal value for {field}: {value!r}") from exc
    if not dec.is_finite():
        raise ValueError(f"{field} must be finite")
    return dec


def calculate_transfer_fee(
    amount: str | Decimal,
    tier: str = "standard",
    rounding: str = ROUND_HALF_EVEN,
) -> Dict[str, str]:
    amt = to_decimal(amount, "amount")
    if amt <= Decimal("0"):
        raise ValueError("amount must be greater than zero")
    if tier not in FEE_TIERS:
        raise ValueError(f"Unknown fee tier: {tier!r}")
    cfg = FEE_TIERS[tier]
    raw_fee = (amt * cfg["bps"]) / Decimal("10000")
    rounded_fee = raw_fee.quantize(QUANT_2, rounding=rounding)
    capped_fee = max(cfg["min_fee"], min(cfg["max_fee"], rounded_fee))
    total_debit = (amt + capped_fee).quantize(QUANT_4, rounding=rounding)
    return {
        "amount": str(amt.quantize(QUANT_4)),
        "tier": tier,
        "fee": str(capped_fee.quantize(QUANT_4)),
        "total_debit": str(total_debit),
        "rounding_rule": rounding,
    }


def calculate_accrued_interest(
    principal: str | Decimal,
    annual_rate_pct: str | Decimal,
    days: int,
    day_count_basis: int = 365,
    rounding: str = ROUND_HALF_EVEN,
) -> Dict[str, str]:
    p = to_decimal(principal, "principal")
    rate_pct = to_decimal(annual_rate_pct, "annual_rate_pct")
    if p < Decimal("0"):
        raise ValueError("principal must be non-negative")
    if rate_pct < Decimal("0") or rate_pct > Decimal("100"):
        raise ValueError("annual_rate_pct must be between 0 and 100")
    if days < 0:
        raise ValueError("days must be non-negative")
    if day_count_basis not in (360, 365, 366):
        raise ValueError("day_count_basis must be 360, 365, or 366")

    raw_interest = p * (rate_pct / Decimal("100")) * Decimal(days) / Decimal(day_count_basis)
    interest = raw_interest.quantize(QUANT_4, rounding=rounding)
    ending_balance = (p + interest).quantize(QUANT_4, rounding=rounding)
    return {
        "principal": str(p.quantize(QUANT_4)),
        "annual_rate_pct": str(rate_pct),
        "days": str(days),
        "day_count_basis": str(day_count_basis),
        "interest_accrued": str(interest),
        "ending_balance": str(ending_balance),
    }


def compute_statement(
    opening_balance: str | Decimal,
    entries: Iterable[Dict[str, str]],
) -> Dict[str, str]:
    opening = to_decimal(opening_balance, "opening_balance")
    total_credits = Decimal("0.0000")
    total_debits = Decimal("0.0000")
    total_fees = Decimal("0.0000")
    total_interest = Decimal("0.0000")

    for row in entries:
        direction = row.get("direction")
        amt = to_decimal(row.get("amount", "0"), "entry.amount")
        if amt <= Decimal("0"):
            raise ValueError("Statement entry amount must be positive")
        category = row.get("category", "transfer")
        if direction == "credit":
            total_credits += amt
            if category == "interest":
                total_interest += amt
        elif direction == "debit":
            total_debits += amt
            if category == "fee":
                total_fees += amt
        else:
            raise ValueError(f"Invalid entry direction: {direction!r}")

    closing = (opening + total_credits - total_debits).quantize(QUANT_4)
    return {
        "opening_balance": str(opening.quantize(QUANT_4)),
        "total_credits": str(total_credits.quantize(QUANT_4)),
        "total_debits": str(total_debits.quantize(QUANT_4)),
        "total_fees": str(total_fees.quantize(QUANT_4)),
        "total_interest": str(total_interest.quantize(QUANT_4)),
        "closing_balance": str(closing),
    }


def reconcile_batches(
    internal_records: List[Dict[str, str]],
    provider_records: List[Dict[str, str]],
) -> Dict[str, object]:
    internal_map = {r["event_id"]: to_decimal(r["amount"], "internal.amount") for r in internal_records}
    provider_map = {r["event_id"]: to_decimal(r["amount"], "provider.amount") for r in provider_records}

    all_ids = sorted(set(internal_map) | set(provider_map))
    matched = 0
    mismatches = []
    total_discrepancy = Decimal("0.0000")

    for eid in all_ids:
        in_amt = internal_map.get(eid)
        pr_amt = provider_map.get(eid)
        if in_amt is None:
            diff = pr_amt
            total_discrepancy += diff
            mismatches.append({"event_id": eid, "issue": "missing_in_ledger", "provider_amount": str(pr_amt.quantize(QUANT_4)), "discrepancy": str(diff.quantize(QUANT_4))})
        elif pr_amt is None:
            diff = -in_amt
            total_discrepancy += diff
            mismatches.append({"event_id": eid, "issue": "missing_in_provider", "internal_amount": str(in_amt.quantize(QUANT_4)), "discrepancy": str(diff.quantize(QUANT_4))})
        elif in_amt != pr_amt:
            diff = pr_amt - in_amt
            total_discrepancy += diff
            mismatches.append({
                "event_id": eid,
                "issue": "amount_mismatch",
                "internal_amount": str(in_amt.quantize(QUANT_4)),
                "provider_amount": str(pr_amt.quantize(QUANT_4)),
                "discrepancy": str(diff.quantize(QUANT_4)),
            })
        else:
            matched += 1

    return {
        "total_checked": len(all_ids),
        "matched_count": matched,
        "mismatch_count": len(mismatches),
        "total_discrepancy": str(total_discrepancy.quantize(QUANT_4)),
        "mismatches": mismatches,
    }


def run_precision_benchmark(iterations: int = 5000) -> Dict[str, object]:
    start = time.perf_counter()
    acc = Decimal("0.0000")
    for _ in range(iterations):
        res = calculate_transfer_fee("199.99", tier="standard", rounding=ROUND_HALF_EVEN)
        acc += Decimal(res["fee"])
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "iterations": iterations,
        "elapsed_ms": round(elapsed_ms, 2),
        "total_fee_sum": str(acc.quantize(QUANT_4)),
        "expected_exact_sum": str((Decimal("0.5000") * iterations).quantize(QUANT_4)),
        "exact_match": acc == Decimal("0.5000") * iterations,
    }
