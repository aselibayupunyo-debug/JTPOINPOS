"""
Iteration-4 backend tests for KasirKu Pro.

Scope (bug-fix retest):
- POST /api/transactions with payment_method='pm_credit' and paid < grand_total
  must resolve id -> kind='credit' and set outstanding = grand_total - paid (not 0).
- DELETE /api/payment-methods/{pm_cash|pm_credit|pm_qris} must return 400.
- DELETE /api/payment-methods/{custom_uuid} must still succeed.
- GET /api/debts (receivable) must include credit transactions created via pm_credit
  (filter uses outstanding>0, not payment_method=='credit').
- /api/reports/summary.receivable must be > 0 when a pm_credit sale has outstanding.
- /api/contacts/customers?include_stats=true should attribute outstanding to the
  customer (filter now uses outstanding>0, not payment_method=='credit').
"""
import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")
).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    uniq = uuid.uuid4().hex[:8]
    owner_user = f"iter4owner_{uniq}"
    r = s.post(
        f"{API}/auth/register",
        json={
            "business_name": "TEST_Iter4 Shop",
            "owner_name": "TEST_Owner4",
            "username": owner_user,
            "password": "owner123",
        },
    )
    assert r.status_code == 200, r.text
    owner_token = r.json()["token"]
    owner_hdr = {"Authorization": f"Bearer {owner_token}"}

    # Trigger payment-method autoseed
    r = s.get(f"{API}/payment-methods", headers=owner_hdr)
    assert r.status_code == 200
    ids = {p["id"] for p in r.json()}
    assert {"pm_cash", "pm_credit", "pm_qris"}.issubset(ids)

    # Create a product
    rp = s.post(
        f"{API}/products",
        headers=owner_hdr,
        json={
            "name": "TEST_Iter4 Prod",
            "sku": f"IT4_{uniq}",
            "category": "Umum",
            "price": 20000,
            "cost": 15000,
            "stock": 500,
            "min_stock": 10,
        },
    )
    assert rp.status_code == 200, rp.text
    prod_id = rp.json()["id"]

    # Create a customer
    rc = s.post(
        f"{API}/customers",
        headers=owner_hdr,
        json={"name": f"TEST_Iter4_Customer_{uniq}", "phone": "0812"},
    )
    assert rc.status_code == 200, rc.text
    cust_id = rc.json()["id"]
    cust_name = rc.json()["name"]

    return {
        "s": s,
        "owner": owner_hdr,
        "uniq": uniq,
        "prod_id": prod_id,
        "cust_id": cust_id,
        "cust_name": cust_name,
    }


class TestIter4PaymentMethodResolution:
    # ------- Credit outstanding via pm_credit id -------
    def test_01_pm_credit_sale_outstanding_resolves_from_id(self, ctx):
        """payment_method='pm_credit' with paid < grand_total -> outstanding = grand - paid."""
        payload = {
            "transaction_type": "sale",
            "payment_method": "pm_credit",
            "payment_method_label": "Kredit",
            "items": [
                {
                    "product_id": ctx["prod_id"],
                    "name": "TEST_Iter4 Prod",
                    "quantity": 5,
                    "price": 20000,
                    "cost": 15000,
                    "discount": 0,
                }
            ],
            "paid_amount": 40000,
            "customer_id": ctx["cust_id"],
            "customer_name": ctx["cust_name"],
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["owner"], json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["total"] == 100000, t
        assert t["outstanding"] == 60000, t
        assert t["payment_method"] == "pm_credit"
        pytest.iter4_tx_id = t["id"]
        pytest.iter4_outstanding = 60000

    def test_02_pm_cash_insufficient_still_blocked(self, ctx):
        """Regression: pm_cash insufficient paid still returns 400."""
        payload = {
            "transaction_type": "sale",
            "payment_method": "pm_cash",
            "payment_method_label": "Tunai",
            "items": [
                {
                    "product_id": ctx["prod_id"],
                    "name": "TEST_Iter4 Prod",
                    "quantity": 1,
                    "price": 20000,
                    "cost": 15000,
                    "discount": 0,
                }
            ],
            "paid_amount": 20000,
            "tax_percent": 11,
            "shipping": 3000,
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["owner"], json=payload)
        assert r.status_code == 400, r.text

    # ------- Protected default payment methods -------
    def test_03_delete_pm_cash_forbidden(self, ctx):
        r = ctx["s"].delete(f"{API}/payment-methods/pm_cash", headers=ctx["owner"])
        assert r.status_code == 400, r.text

    def test_04_delete_pm_credit_forbidden(self, ctx):
        r = ctx["s"].delete(f"{API}/payment-methods/pm_credit", headers=ctx["owner"])
        assert r.status_code == 400, r.text

    def test_05_delete_pm_qris_forbidden(self, ctx):
        r = ctx["s"].delete(f"{API}/payment-methods/pm_qris", headers=ctx["owner"])
        assert r.status_code == 400, r.text

    def test_06_delete_custom_payment_method_allowed(self, ctx):
        # Create a custom payment method, then delete it
        rc = ctx["s"].post(
            f"{API}/payment-methods",
            headers=ctx["owner"],
            json={
                "name": "TEST_Iter4_Transfer",
                "kind": "custom",
                "enabled": True,
                "sort_order": 9,
            },
        )
        assert rc.status_code == 200, rc.text
        pm_id = rc.json()["id"]
        # Must be a UUID (not a protected default)
        assert pm_id not in {"pm_cash", "pm_credit", "pm_qris"}

        rd = ctx["s"].delete(f"{API}/payment-methods/{pm_id}", headers=ctx["owner"])
        assert rd.status_code == 200, rd.text

        # Verify removed
        rl = ctx["s"].get(f"{API}/payment-methods", headers=ctx["owner"])
        ids = {p["id"] for p in rl.json()}
        assert pm_id not in ids

    # ------- Debts filter uses outstanding>0 (includes pm_credit) -------
    def test_07_debts_receivable_includes_pm_credit_tx(self, ctx):
        r = ctx["s"].get(f"{API}/debts?kind=receivable", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        body = r.json()
        tx_ids = [d["id"] for d in body["items"]]
        assert pytest.iter4_tx_id in tx_ids, body
        assert body["total"] >= pytest.iter4_outstanding

    # ------- Reports summary receivable reflects outstanding -------
    def test_08_reports_summary_receivable_reflects_outstanding(self, ctx):
        r = ctx["s"].get(f"{API}/reports/summary", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert "receivable" in body
        assert body["receivable"] >= pytest.iter4_outstanding, body

    # ------- Contact stats attribute outstanding to the customer -------
    def test_09_customer_stats_outstanding_matches(self, ctx):
        r = ctx["s"].get(f"{API}/customers", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        rows = r.json()
        row = next((c for c in rows if c["id"] == ctx["cust_id"]), None)
        assert row is not None, rows
        # outstanding should be at least our pm_credit sale amount
        assert row.get("outstanding", 0) >= pytest.iter4_outstanding, row
