"""Iteration 11 regression + feature tests.

Covers:
- Decimal quantity on sale transactions (TransactionItem.quantity: float)
- sale_return admin_password enforcement (missing / wrong / correct)
- original_transaction_id -> marks original as returned=true
- Double-return rejection
- GET /transactions and /transactions/{id} expose `returned` / `returned_at` / `return_transaction_id`
- Reports (summary/products/customers/operators/sales-items) still work for period=daily|monthly|yearly|custom
"""
from __future__ import annotations

import os
import secrets
from datetime import date, timedelta
from typing import Any, Dict

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")

OWNER_PASSWORD = "password123"


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------


def _register_owner() -> Dict[str, Any]:
    suffix = secrets.token_hex(4)
    username = f"iter11_{suffix}"
    payload = {
        "username": username,
        "password": OWNER_PASSWORD,
        "business_name": f"TEST_Iter11 Toko {suffix}",
        "owner_name": "TEST_Iter11 Owner",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("token"), data
    return {"token": data["token"], "username": username, "user": data.get("user", {})}


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_product(token: str, name: str, price: int = 20000, stock: int = 100) -> Dict[str, Any]:
    r = requests.post(
        f"{BASE_URL}/api/products",
        json={
            "name": name,
            "price": price,
            "cost": price // 2,
            "stock": stock,
            "unit": "pcs",
        },
        headers=_auth(token),
        timeout=30,
    )
    assert r.status_code == 200, f"create product failed: {r.status_code} {r.text}"
    return r.json()


def _create_sale(token: str, product: Dict[str, Any], quantity: float, paid: int | None = None) -> Dict[str, Any]:
    total_expected = int(round(product["price"] * quantity))
    if paid is None:
        paid = total_expected
    payload = {
        "transaction_type": "sale",
        "payment_method": "cash",
        "payment_method_label": "Tunai",
        "items": [
            {
                "product_id": product["id"],
                "name": product["name"],
                "quantity": quantity,
                "price": product["price"],
                "cost": product.get("cost", 0),
                "unit": product.get("unit", "pcs"),
                "unit_factor": 1.0,
                "product_type": "goods",
            }
        ],
        "paid_amount": paid,
        "customer_name": "TEST_Iter11 Customer",
    }
    r = requests.post(f"{BASE_URL}/api/transactions", json=payload, headers=_auth(token), timeout=30)
    assert r.status_code == 200, f"sale failed: {r.status_code} {r.text}"
    return r.json()


def _return_payload(product: Dict[str, Any], quantity: float, *, admin_password: str | None, original_id: str | None) -> Dict[str, Any]:
    p: Dict[str, Any] = {
        "transaction_type": "sale_return",
        "payment_method": "cash",
        "payment_method_label": "Tunai",
        "items": [
            {
                "product_id": product["id"],
                "name": product["name"],
                "quantity": quantity,
                "price": product["price"],
                "cost": product.get("cost", 0),
                "unit": product.get("unit", "pcs"),
                "unit_factor": 1.0,
                "product_type": "goods",
            }
        ],
        "paid_amount": 0,
        "customer_name": "TEST_Iter11 Customer",
    }
    if admin_password is not None:
        p["admin_password"] = admin_password
    if original_id is not None:
        p["original_transaction_id"] = original_id
    return p


@pytest.fixture(scope="module")
def owner_ctx():
    ctx = _register_owner()
    product = _create_product(ctx["token"], f"TEST_Iter11 Kopi {secrets.token_hex(3)}", price=20000, stock=200)
    ctx["product"] = product
    return ctx


# ---------------------------------------------------------------------------
# Tests: decimal quantity on sale
# ---------------------------------------------------------------------------


class TestDecimalQuantity:
    def test_sale_accepts_decimal_quantity(self, owner_ctx):
        """quantity=0.5 should be accepted and total computed correctly."""
        product = owner_ctx["product"]
        tx = _create_sale(owner_ctx["token"], product, quantity=0.5)
        # subtotal/total math: 20000 * 0.5 = 10000
        assert tx["total"] == 10000, tx
        assert tx["subtotal"] == 10000, tx
        # Returned float quantity on the stored item
        assert tx["items"][0]["quantity"] == 0.5

    def test_sale_accepts_fractional_quantity_2p5(self, owner_ctx):
        product = owner_ctx["product"]
        tx = _create_sale(owner_ctx["token"], product, quantity=2.5)
        assert tx["total"] == int(round(product["price"] * 2.5))
        assert tx["items"][0]["quantity"] == 2.5


# ---------------------------------------------------------------------------
# Tests: sale_return admin_password enforcement + double-return
# ---------------------------------------------------------------------------


class TestSaleReturnAdminPassword:
    def test_return_without_admin_password_returns_400(self, owner_ctx):
        product = owner_ctx["product"]
        sale = _create_sale(owner_ctx["token"], product, quantity=1)
        body = _return_payload(product, 1, admin_password=None, original_id=sale["id"])
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "password" in detail.lower(), detail

    def test_return_with_wrong_admin_password_returns_401(self, owner_ctx):
        product = owner_ctx["product"]
        sale = _create_sale(owner_ctx["token"], product, quantity=1)
        body = _return_payload(product, 1, admin_password="definitely_wrong_pw", original_id=sale["id"])
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "salah" in detail.lower() or "password" in detail.lower(), detail

    def test_return_with_correct_admin_password_succeeds_and_marks_original(self, owner_ctx):
        product = owner_ctx["product"]
        sale = _create_sale(owner_ctx["token"], product, quantity=2)
        assert sale["total"] == product["price"] * 2
        body = _return_payload(product, 1, admin_password=OWNER_PASSWORD, original_id=sale["id"])
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        ret_tx = r.json()
        assert ret_tx["transaction_type"] == "sale_return"
        assert ret_tx["total"] == product["price"] * 1

        # Verify original is marked returned=true + has returned_at + return_transaction_id
        g = requests.get(
            f"{BASE_URL}/api/transactions/{sale['id']}",
            headers=_auth(owner_ctx["token"]),
            timeout=30,
        )
        assert g.status_code == 200, g.text
        original = g.json()
        assert original.get("returned") is True, original
        assert original.get("returned_at"), original
        assert original.get("return_transaction_id") == ret_tx["id"], original

    def test_double_return_returns_400(self, owner_ctx):
        product = owner_ctx["product"]
        sale = _create_sale(owner_ctx["token"], product, quantity=3)
        # First return — should succeed
        body = _return_payload(product, 1, admin_password=OWNER_PASSWORD, original_id=sale["id"])
        r1 = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r1.status_code == 200, r1.text
        # Second return on the SAME original — should 400
        body2 = _return_payload(product, 1, admin_password=OWNER_PASSWORD, original_id=sale["id"])
        r2 = requests.post(f"{BASE_URL}/api/transactions", json=body2, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r2.status_code == 400, f"expected 400, got {r2.status_code} {r2.text}"
        detail = (r2.json() or {}).get("detail", "")
        assert "retur" in detail.lower(), detail

    def test_return_on_unknown_original_returns_404(self, owner_ctx):
        product = owner_ctx["product"]
        body = _return_payload(product, 1, admin_password=OWNER_PASSWORD, original_id="nonexistent-tx-id")
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# Tests: list_transactions exposes `returned` flag
# ---------------------------------------------------------------------------


class TestListTransactionsReturnedFlag:
    def test_list_sales_exposes_returned_flag(self, owner_ctx):
        product = owner_ctx["product"]
        sale = _create_sale(owner_ctx["token"], product, quantity=1)
        # retur
        body = _return_payload(product, 1, admin_password=OWNER_PASSWORD, original_id=sale["id"])
        r = requests.post(f"{BASE_URL}/api/transactions", json=body, headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 200, r.text
        ret_id = r.json()["id"]

        # GET /transactions?kind=sale
        r2 = requests.get(f"{BASE_URL}/api/transactions?kind=sale&limit=500", headers=_auth(owner_ctx["token"]), timeout=30)
        assert r2.status_code == 200, r2.text
        docs = r2.json()
        matched = next((d for d in docs if d["id"] == sale["id"]), None)
        assert matched is not None, "sale not found in list"
        assert matched.get("returned") is True
        assert matched.get("return_transaction_id") == ret_id
        assert matched.get("returned_at")


# ---------------------------------------------------------------------------
# Regression: reports still work across periods
# ---------------------------------------------------------------------------


class TestReportsRegression:
    REPORT_ENDPOINTS = [
        "/api/reports/summary",
        "/api/reports/products",
        "/api/reports/customers",
        "/api/reports/operators",
        "/api/reports/sales-items",
    ]

    @pytest.mark.parametrize("period", ["daily", "monthly", "yearly"])
    @pytest.mark.parametrize("endpoint", REPORT_ENDPOINTS)
    def test_period_builtin(self, owner_ctx, endpoint, period):
        r = requests.get(f"{BASE_URL}{endpoint}?period={period}", headers=_auth(owner_ctx["token"]), timeout=30)
        assert r.status_code == 200, f"{endpoint} period={period} -> {r.status_code} {r.text}"
        # No mongo _id leaks
        body_text = r.text
        assert '"_id"' not in body_text, f"{endpoint} leaks _id"

    @pytest.mark.parametrize("endpoint", REPORT_ENDPOINTS)
    def test_period_custom(self, owner_ctx, endpoint):
        today = date.today()
        start = (today - timedelta(days=7)).isoformat()
        end = today.isoformat()
        r = requests.get(
            f"{BASE_URL}{endpoint}?period=custom&start={start}&end={end}",
            headers=_auth(owner_ctx["token"]),
            timeout=30,
        )
        assert r.status_code == 200, f"{endpoint} custom -> {r.status_code} {r.text}"
        assert '"_id"' not in r.text
