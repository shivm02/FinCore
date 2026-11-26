"""FinCore FastAPI Risk Analytics & Financial Calculations Service (Assessments 05 & 06)."""
from __future__ import annotations

import os
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.calculations.engine import (
    calculate_accrued_interest,
    calculate_transfer_fee,
    reconcile_batches,
    to_decimal,
)
from app.risk.scoring import evaluate_transaction_risk, summarize_operations_risk

SERVICE_TOKEN = os.getenv("ANALYTICS_SERVICE_TOKEN", "dev-internal-analytics-token")

app = FastAPI(
    title="FinCore Risk Analytics & Financial Calculations Service",
    version="1.0.0",
    description="Bounded Python/FastAPI service for Decimal calculations and synthetic risk decision-support analytics.",
)

EVALUATION_HISTORY: List[Dict[str, object]] = []


def verify_service_token(x_service_token: Optional[str] = Header(default=None)) -> None:
    if x_service_token != SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing internal service token")


class FeeRequest(BaseModel):
    amount: str = Field(..., example="250.00")
    tier: str = Field(default="standard", example="standard")


class InterestRequest(BaseModel):
    principal: str = Field(..., example="10000.00")
    annual_rate_pct: str = Field(..., example="4.25")
    days: int = Field(..., ge=0, le=3660)
    day_count_basis: int = Field(default=365)


class ReconcileItem(BaseModel):
    event_id: str
    amount: str


class ReconcileRequest(BaseModel):
    internal_records: List[ReconcileItem]
    provider_records: List[ReconcileItem]


class RiskEvaluateRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    amount: str = Field(..., example="1500.00")
    recent_tx_count_1h: int = Field(default=0, ge=0)
    recent_volume_24h: str = Field(default="0.00")
    is_new_beneficiary: bool = Field(default=False)
    off_hours_utc: bool = Field(default=False)
    failed_attempts_1h: int = Field(default=0, ge=0)


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError):
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": str(exc)}})


@app.get("/health/live")
def health_live():
    return {"status": "alive", "service": "fincore-analytics"}


@app.get("/health/ready")
def health_ready():
    return {"status": "ready", "service": "fincore-analytics", "decimal_precision": True}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    return f"fincore_risk_evaluations_total {len(EVALUATION_HISTORY)}\n"


@app.post("/api/v1/calculations/fee", dependencies=[Depends(verify_service_token)])
def api_calculate_fee(req: FeeRequest):
    return calculate_transfer_fee(req.amount, tier=req.tier)


@app.post("/api/v1/calculations/interest", dependencies=[Depends(verify_service_token)])
def api_calculate_interest(req: InterestRequest):
    return calculate_accrued_interest(req.principal, req.annual_rate_pct, req.days, req.day_count_basis)


@app.post("/api/v1/calculations/reconcile", dependencies=[Depends(verify_service_token)])
def api_reconcile(req: ReconcileRequest):
    return reconcile_batches(
        [r.dict() for r in req.internal_records],
        [r.dict() for r in req.provider_records],
    )


@app.post("/api/v1/risk/evaluate", dependencies=[Depends(verify_service_token)])
def api_evaluate_risk(req: RiskEvaluateRequest):
    amt = to_decimal(req.amount, "amount")
    if amt <= Decimal("0"):
        raise ValueError("amount must be greater than zero")
    vol24 = to_decimal(req.recent_volume_24h, "recent_volume_24h")
    result = evaluate_transaction_risk(
        user_id=req.user_id,
        amount=amt,
        recent_tx_count_1h=req.recent_tx_count_1h,
        recent_volume_24h=vol24,
        is_new_beneficiary=req.is_new_beneficiary,
        off_hours_utc=req.off_hours_utc,
        failed_attempts_1h=req.failed_attempts_1h,
    )
    EVALUATION_HISTORY.append(result)
    return result


@app.get("/api/v1/risk/report", dependencies=[Depends(verify_service_token)])
def api_risk_report():
    return summarize_operations_risk(EVALUATION_HISTORY)
