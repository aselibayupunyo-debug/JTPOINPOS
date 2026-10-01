"""
Iteration-8 backend regression tests for KasirKu Pro (session 2026-10 iter-8).

iter-8 is a frontend-only polish release (no new backend endpoints). This suite
re-asserts the backend behaviors that the frontend fixes depend on:

  1. Parked edit flow — DELETE old parked then POST new one preserves
     price_level_id and customer_id (atomic from client's perspective).
  2. DELETE /api/parked/{id} on a stale/consumed parked returns 404
     'Antrian tidak ditemukan' (frontend consumedParkedRef must suppress this
     spurious error after sale completion).
  3. Sale completion from a parked resume does NOT auto-delete the parked row
     (the frontend is still responsible for calling DELETE /api/parked/{id}
     and must be idempotent against 404).
  4. Debt payment /pay still works with payment_method & label (iter-7 carry).
"""
import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
)
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"


def _register_owner(session, prefix="iter8"):
    uname = f"{prefix}_{uuid.uuid4().hex[:8]}"
    pwd = "password123"
    r = session.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": f"TEST_Iter8 {uname}",
        "owner_name": "Iter8 Owner",
        "username": uname,
        "password": pwd,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "username": uname,
        "password": pwd,
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


def _create_goods(session, owner, name="TEST_Iter8 Goods", stock=50):
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": name, "sku": f"ITER8-{uuid.uuid4().hex[:4]}",
        "category": "Umum", "product_type": "goods", "base_unit": "Pcs",
        "price": 10000, "cost": 7000,
        "prices": {"default": 10000, "grosir": 9000},
        "units": [{"name": "Pcs", "factor": 1, "price": 10000}],
        "stock": stock, "min_stock": 5,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def _create_customer(session, owner, price_level_id="grosir"):
    r = session.post(f"{BASE_URL}/api/customers", json={
        "name": f"TEST_Iter8 Cust {uuid.uuid4().hex[:4]}",
        "phone": "0812",
        "price_level_id": price_level_id,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def owner(session):
    return _register_owner(session, "iter8")


@pytest.fixture(scope="module")
def goods(session, owner):
    return _create_goods(session, owner)


# ---------- 1. Parked edit flow: DELETE old + POST new w/ customer_id + price_level_id ----------
class TestParkedEditFlow:
    def test_parked_edit_delete_then_create_persists_customer_and_price_level(
        self, session, owner, goods
    ):
        cust = _create_customer(session, owner, price_level_id="grosir")
        # Initial parked (default price level, no customer_id)
        p1 = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "Walk-in",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p1.status_code == 200, p1.text
        parked1 = p1.json()
        assert parked1["price_level_id"] == "default"
        assert parked1.get("customer_id") in (None, "")

        # Simulate edit: DELETE old, POST new with customer_id + price_level_id
        d1 = session.delete(
            f"{BASE_URL}/api/parked/{parked1['id']}", headers=owner["headers"]
        )
        assert d1.status_code == 200, d1.text

        p2 = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": cust["name"],
            "customer_id": cust["id"],
            "price_level_id": "grosir",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 2, "price": 9000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p2.status_code == 200, p2.text
        parked2 = p2.json()
        assert parked2["customer_id"] == cust["id"]
        assert parked2["customer_name"] == cust["name"]
        assert parked2["price_level_id"] == "grosir"
        assert parked2["id"] != parked1["id"]

        # Verify LIST reflects only the new parked
        lst = session.get(f"{BASE_URL}/api/parked", headers=owner["headers"]).json()
        ids = [p["id"] for p in lst]
        assert parked2["id"] in ids
        assert parked1["id"] not in ids
        matching = [p for p in lst if p["id"] == parked2["id"]][0]
        assert matching["price_level_id"] == "grosir"
        assert matching["customer_id"] == cust["id"]

        # cleanup
        session.delete(f"{BASE_URL}/api/parked/{parked2['id']}", headers=owner["headers"])


# ---------- 2. Delete already-consumed parked returns 404 'Antrian tidak ditemukan' ----------
class TestParkedConsumedDelete:
    def test_delete_nonexistent_parked_returns_404_antrian_tidak_ditemukan(
        self, session, owner, goods
    ):
        # create & delete
        p = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "Will-Consume",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p.status_code == 200
        pid = p.json()["id"]
        d1 = session.delete(
            f"{BASE_URL}/api/parked/{pid}", headers=owner["headers"]
        )
        assert d1.status_code == 200

        # DELETE again -> NEW CONTRACT (iter-9): idempotent 200 {deleted:0}
        # Previously returned 404 'Antrian tidak ditemukan'. The frontend
        # consumedParkedRef guard remains valid but is no longer strictly
        # required (backend now swallows the double-delete).
        d2 = session.delete(
            f"{BASE_URL}/api/parked/{pid}", headers=owner["headers"]
        )
        assert d2.status_code == 200, d2.text
        assert d2.json() == {"ok": True, "deleted": 0}

        # And a random uuid parked_id -> same idempotent 200 {deleted:0}
        d3 = session.delete(
            f"{BASE_URL}/api/parked/{uuid.uuid4().hex}", headers=owner["headers"]
        )
        assert d3.status_code == 200
        assert d3.json()["deleted"] == 0


# ---------- 3. Sale completion from a parked resume does NOT touch parked row ----------
class TestParkedResumeDoesNotAutoDelete:
    def test_sale_completion_does_not_delete_parked(self, session, owner, goods):
        """Backend has no auto-cleanup; frontend owns DELETE /parked/{id}.

        This test proves the parked row still exists after a sale is created
        from its items — therefore the FE *must* call DELETE after sale, and
        must guard against double-DELETE (iter-8 fix).
        """
        p = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "Resume Test",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p.status_code == 200
        parked = p.json()

        tx = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale",
            "payment_method": "cash",
            "payment_method_label": "Tunai",
            "items": parked["items"],
            "paid_amount": 10000,
            "customer_name": parked["customer_name"],
        }, headers=owner["headers"])
        assert tx.status_code == 200, tx.text

        # Parked still exists
        lst = session.get(f"{BASE_URL}/api/parked", headers=owner["headers"]).json()
        assert any(x["id"] == parked["id"] for x in lst), (
            "Parked unexpectedly removed on sale creation"
        )

        # Simulate FE finalization: DELETE parked after sale success
        d = session.delete(
            f"{BASE_URL}/api/parked/{parked['id']}", headers=owner["headers"]
        )
        assert d.status_code == 200

        # Re-delete (simulating the double-trigger that iter-8 consumedParkedRef
        # suppresses on client side) -> backend now returns idempotent 200
        # {deleted:0} (iter-9 contract — previously 404).
        d2 = session.delete(
            f"{BASE_URL}/api/parked/{parked['id']}", headers=owner["headers"]
        )
        assert d2.status_code == 200
        assert d2.json()["deleted"] == 0


# ---------- 4. Debt payment /pay still accepts payment_method + label (iter-7 carry) ----------
class TestDebtPaymentIter7Carry:
    def test_pay_with_method_and_label(self, session, owner, goods):
        # credit sale -> outstanding 20000
        s = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale",
            "payment_method": "credit",
            "payment_method_label": "Piutang",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 2, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 0,
            "customer_name": "TEST_Iter8 Debt",
        }, headers=owner["headers"])
        assert s.status_code == 200, s.text
        tx = s.json()
        assert tx["outstanding"] == 20000

        r = session.post(f"{BASE_URL}/api/transactions/{tx['id']}/pay", json={
            "amount": 20000,
            "payment_method": "transfer",
            "payment_method_label": "Transfer BCA",
            "note": "lunas",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outstanding"] == 0
        assert body["payment"]["payment_method"] == "transfer"
        assert body["payment"]["payment_method_label"] == "Transfer BCA"
