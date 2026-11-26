"""Automated tests for Assessment 05 (Python Decimal Calculations) & Assessment 06 (FastAPI Risk Analytics).
Compatible with both `python3 -m unittest` and `pytest`.
"""
import unittest
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from fastapi.testclient import TestClient

from app.calculations.engine import (
    calculate_accrued_interest,
    calculate_transfer_fee,
    compute_statement,
    reconcile_batches,
    run_precision_benchmark,
)
from app.main import EVALUATION_HISTORY, SERVICE_TOKEN, app


class TestFinancialCalculations(unittest.TestCase):
    def test_rejects_binary_float_input(self):
        with self.assertRaises(ValueError):
            calculate_transfer_fee(100.10)  # type: ignore[arg-type]

    def test_bankers_rounding_boundary(self):
        # 25 bps of $22.00 = $0.055 -> HALF_EVEN rounds to 0.06, clamped to min $0.50
        # 25 bps of $1002.00 = $2.505 -> HALF_EVEN rounds to $2.50; HALF_UP rounds to $2.51
        even_res = calculate_transfer_fee("1002.00", tier="standard", rounding=ROUND_HALF_EVEN)
        up_res = calculate_transfer_fee("1002.00", tier="standard", rounding=ROUND_HALF_UP)
        self.assertEqual(even_res["fee"], "2.5000")
        self.assertEqual(up_res["fee"], "2.5100")

    def test_fee_min_and_max_caps(self):
        small = calculate_transfer_fee("10.00", tier="standard")
        large = calculate_transfer_fee("50000.00", tier="standard")
        self.assertEqual(small["fee"], "0.5000")
        self.assertEqual(large["fee"], "25.0000")

    def test_accrued_interest_exact_decimal(self):
        res = calculate_accrued_interest("10000.00", "3.65", days=30, day_count_basis=365)
        self.assertEqual(res["interest_accrued"], "30.0000")
        self.assertEqual(res["ending_balance"], "10030.0000")

    def test_statement_zero_drift_sum(self):
        stmt = compute_statement("0.00", [
            {"direction": "credit", "amount": "0.10", "category": "transfer"},
            {"direction": "credit", "amount": "0.20", "category": "transfer"},
        ])
        self.assertEqual(stmt["closing_balance"], "0.3000")

    def test_reconcile_detects_mismatches_and_missing(self):
        out = reconcile_batches(
            internal_records=[
                {"event_id": "evt_1", "amount": "100.00"},
                {"event_id": "evt_2", "amount": "200.00"},
                {"event_id": "evt_3", "amount": "50.00"},
            ],
            provider_records=[
                {"event_id": "evt_1", "amount": "100.00"},
                {"event_id": "evt_2", "amount": "195.00"},
                {"event_id": "evt_4", "amount": "75.00"},
            ],
        )
        self.assertEqual(out["matched_count"], 1)
        self.assertEqual(out["mismatch_count"], 3)
        self.assertEqual(out["total_discrepancy"], "20.0000")

    def test_precision_benchmark(self):
        bench = run_precision_benchmark(iterations=2000)
        self.assertTrue(bench["exact_match"])
        self.assertEqual(bench["total_fee_sum"], "1000.0000")


class TestFastApiRiskAnalytics(unittest.TestCase):
    def setUp(self):
        EVALUATION_HISTORY.clear()
        self.client = TestClient(app)
        self.headers = {"X-Service-Token": SERVICE_TOKEN}

    def test_health_endpoints(self):
        self.assertEqual(self.client.get("/health/live").status_code, 200)
        self.assertEqual(self.client.get("/health/ready").json()["decimal_precision"], True)

    def test_unauthorized_without_service_token(self):
        resp = self.client.post("/api/v1/risk/evaluate", json={"user_id": "u1", "amount": "100.00"})
        self.assertEqual(resp.status_code, 401)

    def test_high_risk_velocity_and_disclaimer(self):
        resp = self.client.post(
            "/api/v1/risk/evaluate",
            headers=self.headers,
            json={
                "user_id": "user-synth-01",
                "amount": "5500.00",
                "recent_tx_count_1h": 9,
                "recent_volume_24h": "9000.00",
                "is_new_beneficiary": True,
                "failed_attempts_1h": 4,
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["severity"], "critical")
        self.assertIn("HIGH_HOURLY_VELOCITY", body["flags"])
        self.assertIn("NOT proof of fraud", body["decision_support_notice"])

    def test_invalid_negative_amount_returns_422(self):
        resp = self.client.post(
            "/api/v1/risk/evaluate",
            headers=self.headers,
            json={"user_id": "u1", "amount": "-50.00"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_operations_report_aggregation(self):
        self.client.post("/api/v1/risk/evaluate", headers=self.headers, json={"user_id": "u1", "amount": "50.00"})
        self.client.post(
            "/api/v1/risk/evaluate",
            headers=self.headers,
            json={"user_id": "u2", "amount": "6000.00", "recent_tx_count_1h": 10, "recent_volume_24h": "12000.00"},
        )
        report = self.client.get("/api/v1/risk/report", headers=self.headers).json()
        self.assertEqual(report["total_evaluated"], 2)
        self.assertEqual(report["severity_breakdown"]["low"], 1)
        self.assertEqual(report["severity_breakdown"]["critical"], 1)


if __name__ == "__main__":
    unittest.main()
