"""FinCore Risk Analytics & Operations Reporting Engine (Assessment 06).

Evaluates synthetic transaction velocity, unusual patterns, and risk flags.
IMPORTANT: Risk scores are decision-support signals for human operations analysts,
NEVER automated proof of fraud.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List

DECISION_SUPPORT_DISCLAIMER = (
    "Risk scores and flags are decision-support indicators based on synthetic rules "
    "and historical velocity; they require human analyst review and are NOT proof of fraud."
)


def evaluate_transaction_risk(
    *,
    user_id: str,
    amount: Decimal,
    recent_tx_count_1h: int,
    recent_volume_24h: Decimal,
    is_new_beneficiary: bool = False,
    off_hours_utc: bool = False,
    failed_attempts_1h: int = 0,
) -> Dict[str, object]:
    score = Decimal("0")
    flags: List[str] = []

    if amount >= Decimal("5000"):
        score += Decimal("30")
        flags.append("HIGH_SINGLE_AMOUNT")
    elif amount >= Decimal("1000"):
        score += Decimal("15")
        flags.append("ELEVATED_SINGLE_AMOUNT")

    if recent_tx_count_1h >= 8:
        score += Decimal("30")
        flags.append("HIGH_HOURLY_VELOCITY")
    elif recent_tx_count_1h >= 4:
        score += Decimal("15")
        flags.append("ELEVATED_HOURLY_VELOCITY")

    if recent_volume_24h + amount >= Decimal("10000"):
        score += Decimal("20")
        flags.append("HIGH_24H_CUMULATIVE_VOLUME")

    if is_new_beneficiary and amount >= Decimal("1000"):
        score += Decimal("15")
        flags.append("NEW_BENEFICIARY_LARGE_TRANSFER")

    if off_hours_utc:
        score += Decimal("5")
        flags.append("OFF_HOURS_ACTIVITY")

    if failed_attempts_1h >= 3:
        score += Decimal("15")
        flags.append("REPEATED_FAILED_ATTEMPTS")

    capped_score = min(score, Decimal("100"))
    if capped_score >= Decimal("75"):
        severity = "critical"
        recommendation = "hold_for_analyst_review"
    elif capped_score >= Decimal("50"):
        severity = "high"
        recommendation = "require_step_up_mfa_and_review"
    elif capped_score >= Decimal("25"):
        severity = "medium"
        recommendation = "monitor_and_log"
    else:
        severity = "low"
        recommendation = "allow"

    return {
        "user_id": user_id,
        "risk_score": float(capped_score),
        "severity": severity,
        "flags": flags,
        "recommendation": recommendation,
        "decision_support_notice": DECISION_SUPPORT_DISCLAIMER,
        "synthetic_data": True,
    }


def summarize_operations_risk(evaluations: List[Dict[str, object]]) -> Dict[str, object]:
    counts = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    flag_freq: Dict[str, int] = {}
    for ev in evaluations:
        sev = str(ev.get("severity", "low"))
        if sev in counts:
            counts[sev] += 1
        for fl in ev.get("flags", []):
            flag_freq[fl] = flag_freq.get(fl, 0) + 1
    return {
        "total_evaluated": len(evaluations),
        "severity_breakdown": counts,
        "top_flags": sorted(flag_freq.items(), key=lambda x: x[1], reverse=True),
        "decision_support_notice": DECISION_SUPPORT_DISCLAIMER,
    }
