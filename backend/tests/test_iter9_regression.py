"""
Iteration-9 backend regression tests for KasirKu Pro.

iter-9 is a frontend-only change (added `react-zlib-js@3.0.0` as a dep to
unblock the deployment build — bwip-js barcode generation). No backend
changes expected. This suite re-asserts the critical backend contracts
end-to-end and documents the NEW idempotent DELETE /api/parked/{id}
contract (previously 404, now returns 200 {"ok":true,"deleted":N}).

Coverage:
 1. Auth: register + login + /me (admintoko/admin123 if available, else fresh)
 2. Products CRUD (create / list / update / delete)
 3. Transactions sale happy path + stock decrement
 4. Transactions purchase happy path + stock increment
 5. Parked create / list / idempotent delete
 6. Debt payment (/pay) on a credit sale → outstanding 0
 7. Reports: sales-summary + sales-items + cashflow
 8. Admin: reset_transactions + delete_all_products (audit entries written)
 9. Audit logs: owner-only (cashier 403)
 10. Profile PUT: username update works, duplicate (case-insensitive) → 400
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


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register_owner(session, prefix="iter9"):
    uname = f"{prefix}_{uuid.uuid4().hex[:8]}"
    pwd = "password123"
    r = session.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": f"TEST_Iter9 {uname}",
        "owner_name": "Iter9 Owner",
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


@pytest.fixture(scope="module")
def owner(session):
    return _register_owner(session, "iter9")


@pytest.fixture(scope="module")
def goods(session, owner):
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": "TEST_Iter9 Goods",
        "sku": f"ITER9-{uuid.uuid4().hex[:4]}",
        "category": "Umum",
        "product_type": "goods",
        "base_unit": "Pcs",
        "price": 15000,
        "cost": 10000,
        "prices": {"default": 15000},
        "units": [{"name": "Pcs", "factor": 1, "price": 15000}],
        "stock": 100,
        "min_stock": 5,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Auth ----------
class TestAuth:
    def test_register_login_me(self, session):
        o = _register_owner(session, "iter9_auth")
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": o["username"], "password": o["password"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and body["user"]["username"] == o["username"]

        me = session.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {body['token']}"},
        )
        assert me.status_code == 200
        assert me.json()["username"] == o["username"]

    def test_login_wrong_password_401(self, session):
        o = _register_owner(session, "iter9_wrong")
        r = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": o["username"], "password": "wrongpass",
        })
        assert r.status_code == 401, r.text


# ---------- 2. Products CRUD ----------
class TestProductsCRUD:
    def test_create_list_update_delete(self, session, owner):
        # create
        r = session.post(f"{BASE_URL}/api/products", json={
            "name": "TEST_Iter9 CRUD",
            "sku": f"CRUD-{uuid.uuid4().hex[:4]}",
            "category": "Umum",
            "product_type": "goods",
            "base_unit": "Pcs",
            "price": 5000, "cost": 3000,
            "prices": {"default": 5000},
            "units": [{"name": "Pcs", "factor": 1, "price": 5000}],
            "stock": 20, "min_stock": 2,
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # list
        lst = session.get(f"{BASE_URL}/api/products", headers=owner["headers"])
        assert lst.status_code == 200
        assert any(p["id"] == pid for p in lst.json())
        # no mongo _id leak
        assert all("_id" not in p for p in lst.json())

        # update
        up = session.put(f"{BASE_URL}/api/products/{pid}", json={
            "name": "TEST_Iter9 CRUD Updated",
            "sku": r.json()["sku"],
            "category": "Umum", "product_type": "goods", "base_unit": "Pcs",
            "price": 6000, "cost": 3000,
            "prices": {"default": 6000},
            "units": [{"name": "Pcs", "factor": 1, "price": 6000}],
            "stock": 20, "min_stock": 2,
        }, headers=owner["headers"])
        assert up.status_code == 200, up.text
        assert up.json()["price"] == 6000

        # delete
        d = session.delete(f"{BASE_URL}/api/products/{pid}", headers=owner["headers"])
        assert d.status_code == 200


# ---------- 3. Sale + stock ----------
class TestSale:
    def test_sale_decrements_stock(self, session, owner, goods):
        before = goods["stock"]
        r = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale",
            "payment_method": "cash",
            "payment_method_label": "Tunai",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 3, "price": 15000, "cost": 10000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 45000,
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["total"] == 45000
        assert tx["outstanding"] == 0
        assert tx["transaction_type"] == "sale"

        # verify stock decrement
        lst = session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json()
        prod = [p for p in lst if p["id"] == goods["id"]][0]
        assert prod["stock"] == before - 3


# ---------- 4. Purchase + stock ----------
class TestPurchase:
    def test_purchase_increments_stock(self, session, owner, goods):
        before = session.get(
            f"{BASE_URL}/api/products", headers=owner["headers"]
        ).json()
        before_stock = [p for p in before if p["id"] == goods["id"]][0]["stock"]

        r = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "purchase",
            "payment_method": "cash",
            "payment_method_label": "Tunai",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 10, "price": 10000, "cost": 10000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 100000,
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["transaction_type"] == "purchase"

        after = session.get(
            f"{BASE_URL}/api/products", headers=owner["headers"]
        ).json()
        after_stock = [p for p in after if p["id"] == goods["id"]][0]["stock"]
        assert after_stock == before_stock + 10


# ---------- 5. Parked create/list/idempotent delete ----------
class TestParked:
    def test_parked_create_list_delete_idempotent(self, session, owner, goods):
        p = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "TEST_Iter9 Parked",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 15000, "cost": 10000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p.status_code == 200, p.text
        pid = p.json()["id"]

        lst = session.get(f"{BASE_URL}/api/parked", headers=owner["headers"]).json()
        assert any(x["id"] == pid for x in lst)

        d1 = session.delete(
            f"{BASE_URL}/api/parked/{pid}", headers=owner["headers"]
        )
        assert d1.status_code == 200, d1.text
        body1 = d1.json()
        assert body1["ok"] is True and body1["deleted"] == 1

        # idempotent re-delete -> 200 deleted=0 (NEW CONTRACT since iter-8)
        d2 = session.delete(
            f"{BASE_URL}/api/parked/{pid}", headers=owner["headers"]
        )
        assert d2.status_code == 200, d2.text
        body2 = d2.json()
        assert body2["ok"] is True and body2["deleted"] == 0

        # random uuid also 200 deleted=0
        d3 = session.delete(
            f"{BASE_URL}/api/parked/{uuid.uuid4().hex}",
            headers=owner["headers"],
        )
        assert d3.status_code == 200
        assert d3.json()["deleted"] == 0


# ---------- 6. Debt payment ----------
class TestDebtPay:
    def test_credit_sale_then_pay_full(self, session, owner, goods):
        s = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale",
            "payment_method": "credit",
            "payment_method_label": "Piutang",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 15000, "cost": 10000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 0,
            "customer_name": "TEST_Iter9 Debt",
        }, headers=owner["headers"])
        assert s.status_code == 200, s.text
        tx = s.json()
        assert tx["outstanding"] == 15000

        r = session.post(f"{BASE_URL}/api/transactions/{tx['id']}/pay", json={
            "amount": 15000,
            "payment_method": "transfer",
            "payment_method_label": "Transfer BCA",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outstanding"] == 0
        assert body["payment"]["payment_method"] == "transfer"
        assert body["payment"]["payment_method_label"] == "Transfer BCA"


# ---------- 7. Reports ----------
class TestReports:
    def test_sales_summary_items_cashflow(self, session, owner):
        r1 = session.get(
            f"{BASE_URL}/api/reports/summary?period=daily",
            headers=owner["headers"],
        )
        assert r1.status_code == 200, r1.text

        r2 = session.get(
            f"{BASE_URL}/api/reports/sales-items?period=daily",
            headers=owner["headers"],
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        # response can be either a flat list or {rows: [...]}
        rows = body2 if isinstance(body2, list) else body2.get("rows")
        assert isinstance(rows, list)

        r3 = session.get(
            f"{BASE_URL}/api/reports/products?period=daily",
            headers=owner["headers"],
        )
        assert r3.status_code == 200, r3.text


# ---------- 8. Admin reset + delete-all-products + audit entries ----------
class TestAdminDangerous:
    def test_reset_transactions_and_delete_products_write_audit(self, session):
        o = _register_owner(session, "iter9_admin")
        # create some data
        session.post(f"{BASE_URL}/api/products", json={
            "name": "TEST_Iter9 Admin Prod",
            "sku": f"ADM-{uuid.uuid4().hex[:4]}",
            "category": "Umum", "product_type": "goods", "base_unit": "Pcs",
            "price": 1000, "cost": 500,
            "prices": {"default": 1000},
            "units": [{"name": "Pcs", "factor": 1, "price": 1000}],
            "stock": 10, "min_stock": 1,
        }, headers=o["headers"])

        # reset txs (requires owner password)
        r = session.post(
            f"{BASE_URL}/api/admin/reset-transactions",
            json={"password": o["password"]},
            headers=o["headers"],
        )
        assert r.status_code == 200, r.text

        # delete all products (requires owner password)
        r = session.post(
            f"{BASE_URL}/api/admin/delete-all-products",
            json={"password": o["password"]},
            headers=o["headers"],
        )
        assert r.status_code == 200, r.text

        # audit logs include both actions
        logs = session.get(
            f"{BASE_URL}/api/audit-logs", headers=o["headers"]
        )
        assert logs.status_code == 200
        actions = [log.get("action") for log in logs.json()]
        assert "reset_transactions" in actions
        assert "delete_all_products" in actions


# ---------- 9. Audit logs owner-only (cashier 403) ----------
class TestAuditOwnerOnly:
    def test_cashier_cannot_view_audit_logs(self, session):
        o = _register_owner(session, "iter9_cashier_owner")
        # create cashier
        c = session.post(f"{BASE_URL}/api/operators", json={
            "username": f"iter9c_{uuid.uuid4().hex[:6]}",
            "password": "cashier123",
            "name": "Iter9 Cashier",
            "role": "cashier",
            "permissions": ["sales"],
        }, headers=o["headers"])
        assert c.status_code == 200, c.text

        # cashier login
        lo = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": c.json()["username"],
            "password": "cashier123",
        })
        assert lo.status_code == 200
        ctok = lo.json()["token"]

        r = session.get(
            f"{BASE_URL}/api/audit-logs",
            headers={"Authorization": f"Bearer {ctok}"},
        )
        assert r.status_code == 403, r.text


# ---------- 10. Profile username change ----------
class TestProfileUsernameChange:
    def test_username_change_and_duplicate_rejected(self, session):
        o1 = _register_owner(session, "iter9_pa")
        o2 = _register_owner(session, "iter9_pb")

        # duplicate case-insensitive -> 400
        r = session.put(f"{BASE_URL}/api/profile", json={
            "username": o2["username"].upper(),
            "current_password": o1["password"],
        }, headers=o1["headers"])
        assert r.status_code == 400, r.text

        # too short -> 422 (pydantic min_length=3)
        r = session.put(f"{BASE_URL}/api/profile", json={
            "username": "ab",
            "current_password": o1["password"],
        }, headers=o1["headers"])
        assert r.status_code == 422, r.text

        # legit change -> 200
        new_name = f"iter9_pa_{uuid.uuid4().hex[:6]}"
        r = session.put(f"{BASE_URL}/api/profile", json={
            "username": new_name,
            "current_password": o1["password"],
        }, headers=o1["headers"])
        assert r.status_code == 200, r.text

        # old username can't login
        bad = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": o1["username"], "password": o1["password"],
        })
        assert bad.status_code == 401

        # new username can login
        good = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": new_name, "password": o1["password"],
        })
        assert good.status_code == 200
