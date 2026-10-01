"""
Iteration-6 backend tests for KasirKu Pro (session 2026-10) covering:
  - PUT /api/profile (name/password changes, wrong current password)
  - POST /api/admin/reset-transactions (owner password, 403/400 paths, scope of deletes)
  - POST /api/admin/delete-all-products (owner password, 403/400 paths, scope of deletes)
  - Regression: PUT /api/settings strip empty header/footer lines + max 4
  - Regression: service product skip stock
  - Regression: multi-unit decrements by qty*unit_factor
  - Regression: POST /api/parked customer_name required
  - Regression: /api/reports/sales-items excludes cancelled
  - Regression: /api/products/export returns xlsx
  - Regression: health/auth/me/categories/transactions still work

Each test class owns a fresh owner (and operator for role checks) to avoid cross-worker races.
"""
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"


def _register_owner(session: requests.Session, prefix: str = "iter6"):
    uname = f"{prefix}_{uuid.uuid4().hex[:8]}"
    pwd = "password123"
    r = session.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": f"TEST_Iter6 {uname}",
        "owner_name": "Iter6 Owner",
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


def _create_goods(session, owner, name="TEST_Iter6 Goods", stock=100):
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": name, "sku": f"ITER6-{uuid.uuid4().hex[:4]}",
        "category": "Umum", "product_type": "goods", "base_unit": "Pcs",
        "price": 10000, "cost": 7000,
        "prices": {"default": 10000},
        "units": [
            {"name": "Pcs", "factor": 1, "price": 10000},
            {"name": "Dus", "factor": 12, "price": 110000},
        ],
        "stock": stock, "min_stock": 5,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def _create_service(session, owner, name="TEST_Iter6 Service"):
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": name, "category": "Jasa",
        "product_type": "service", "base_unit": "Jam",
        "price": 50000, "cost": 0, "stock": 0, "min_stock": 0,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ========== PUT /api/profile ==========
class TestProfile:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter6prof")

    def test_update_name_only(self, session, owner):
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"], "name": "Owner Baru",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        me = session.get(f"{BASE_URL}/api/auth/me", headers=owner["headers"]).json()
        assert me["name"] == "Owner Baru"

    def test_wrong_current_password_400(self, session, owner):
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": "WRONG", "name": "X",
        }, headers=owner["headers"])
        assert r.status_code == 400, r.text

    def test_update_password_and_relogin(self, session, owner):
        new_pwd = "newpass456"
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"], "new_password": new_pwd,
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        # old password login fails
        bad = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": owner["username"], "password": owner["password"],
        })
        assert bad.status_code in (400, 401), f"old pwd should fail, got {bad.status_code}"
        # new password login works
        good = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": owner["username"], "password": new_pwd,
        })
        assert good.status_code == 200, good.text
        owner["password"] = new_pwd  # persist for later tests in same class

    def test_empty_payload_returns_200_noop(self, session, owner):
        # name empty + no new_password = no changes, should still 200
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
        }, headers=owner["headers"])
        assert r.status_code == 200

    def test_short_new_password_422(self, session, owner):
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"], "new_password": "12345",  # <6
        }, headers=owner["headers"])
        assert r.status_code == 422, r.text


# ========== POST /api/admin/reset-transactions ==========
class TestResetTransactions:
    @pytest.fixture(scope="class")
    def owner(self, session):
        o = _register_owner(session, "iter6rst")
        return o

    @pytest.fixture(scope="class")
    def goods(self, session, owner):
        return _create_goods(session, owner, name="TEST_Iter6 Rst Goods")

    @pytest.fixture(scope="class")
    def seed_data(self, session, owner, goods):
        # Create a sale (transaction)
        tx = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 10000, "customer_name": "Umum",
        }, headers=owner["headers"])
        assert tx.status_code == 200, tx.text
        # Parked
        p = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "Bu Parked",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
        }, headers=owner["headers"])
        assert p.status_code == 200, p.text
        # Cashflow
        c = session.post(f"{BASE_URL}/api/cash-entries",
                         json={"entry_type": "income", "amount": 50000, "category": "TEST"},
                         headers=owner["headers"])
        assert c.status_code == 200
        # Customer (should NOT be deleted)
        cust = session.post(f"{BASE_URL}/api/customers",
                            json={"name": "TEST_Iter6 Keep Cust", "phone": "0812"},
                            headers=owner["headers"])
        assert cust.status_code == 200
        # Supplier (should NOT be deleted)
        sup = session.post(f"{BASE_URL}/api/suppliers",
                           json={"name": "TEST_Iter6 Keep Sup", "phone": "0813"},
                           headers=owner["headers"])
        assert sup.status_code == 200
        # Category (should NOT be deleted)
        cat = session.post(f"{BASE_URL}/api/categories", json={"name": "TEST_Iter6 Keep Cat"},
                           headers=owner["headers"])
        assert cat.status_code == 200
        # Shift (close first if open)
        cur = session.get(f"{BASE_URL}/api/shifts/current", headers=owner["headers"]).json()
        if cur and cur.get("id"):
            session.post(f"{BASE_URL}/api/shifts/{cur['id']}/close",
                         json={"closing_cash": 0}, headers=owner["headers"])
        sh = session.post(f"{BASE_URL}/api/shifts/open",
                          json={"opening_cash": 50000}, headers=owner["headers"])
        assert sh.status_code == 200
        return True

    def test_non_owner_forbidden_403(self, session, owner, seed_data):
        # Create operator (cashier) and attempt reset -> expect 403
        op_pwd = "operator123"
        op_create = session.post(f"{BASE_URL}/api/operators", json={
            "name": "Kasir Iter6", "username": f"op_{uuid.uuid4().hex[:6]}",
            "password": op_pwd, "role": "cashier", "permissions": ["sales"],
        }, headers=owner["headers"])
        assert op_create.status_code == 200, op_create.text
        op_login = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": op_create.json()["username"], "password": op_pwd,
        })
        assert op_login.status_code == 200
        op_headers = {"Authorization": f"Bearer {op_login.json()['token']}"}
        r = session.post(f"{BASE_URL}/api/admin/reset-transactions",
                         json={"password": op_pwd}, headers=op_headers)
        assert r.status_code == 403, r.text

    def test_wrong_password_400(self, session, owner, seed_data):
        r = session.post(f"{BASE_URL}/api/admin/reset-transactions",
                         json={"password": "WRONG"}, headers=owner["headers"])
        assert r.status_code == 400, r.text

    def test_missing_password_422(self, session, owner):
        r = session.post(f"{BASE_URL}/api/admin/reset-transactions",
                         json={}, headers=owner["headers"])
        assert r.status_code == 422

    def test_happy_path_deletes_correct_scope(self, session, owner, goods, seed_data):
        # Snapshot before
        tx_before = len(session.get(f"{BASE_URL}/api/transactions", headers=owner["headers"]).json())
        pk_before = len(session.get(f"{BASE_URL}/api/parked", headers=owner["headers"]).json())
        cf_before = len(session.get(f"{BASE_URL}/api/cash-entries", headers=owner["headers"]).json())
        assert tx_before >= 1 and pk_before >= 1 and cf_before >= 1

        r = session.post(f"{BASE_URL}/api/admin/reset-transactions",
                         json={"password": owner["password"]}, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        deleted = body.get("deleted", {})
        assert deleted.get("transactions", 0) >= 1
        assert deleted.get("parked", 0) >= 1
        assert deleted.get("cashflow", 0) >= 1
        # Shift may or may not have been open; just key existence
        assert "shifts" in deleted

        # Verify empty collections for this business
        tx_after = session.get(f"{BASE_URL}/api/transactions", headers=owner["headers"]).json()
        assert tx_after == []
        pk_after = session.get(f"{BASE_URL}/api/parked", headers=owner["headers"]).json()
        assert pk_after == []
        cf_after = session.get(f"{BASE_URL}/api/cash-entries", headers=owner["headers"]).json()
        assert cf_after == []
        # Current shift should be None after reset
        cur = session.get(f"{BASE_URL}/api/shifts/current", headers=owner["headers"]).json()
        assert cur in (None, {}, []) or (isinstance(cur, dict) and not cur.get("id"))

        # Products / customers / suppliers / categories still there
        pr = session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json()
        assert any(p["id"] == goods["id"] for p in pr), "products must be kept after reset"
        cust = session.get(f"{BASE_URL}/api/customers", headers=owner["headers"]).json()
        assert any(c["name"] == "TEST_Iter6 Keep Cust" for c in cust)
        sup = session.get(f"{BASE_URL}/api/suppliers", headers=owner["headers"]).json()
        assert any(s["name"] == "TEST_Iter6 Keep Sup" for s in sup)
        cats = session.get(f"{BASE_URL}/api/categories", headers=owner["headers"]).json()
        assert any(c["name"] == "TEST_Iter6 Keep Cat" for c in cats)
        # payment methods seed still there
        pms = session.get(f"{BASE_URL}/api/payment-methods", headers=owner["headers"]).json()
        kinds = {pm["kind"] for pm in pms}
        assert {"cash", "credit", "qris_static"}.issubset(kinds)


# ========== POST /api/admin/delete-all-products ==========
class TestDeleteAllProducts:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter6del")

    @pytest.fixture(scope="class")
    def seeds(self, session, owner):
        g1 = _create_goods(session, owner, name="TEST_Iter6 Del A")
        g2 = _create_goods(session, owner, name="TEST_Iter6 Del B")
        # a customer to prove it's kept
        session.post(f"{BASE_URL}/api/customers",
                     json={"name": "TEST_Iter6 Keep Cust2", "phone": "0812"},
                     headers=owner["headers"])
        # a sale to prove transactions kept
        session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{
                "product_id": g1["id"], "name": g1["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 10000, "customer_name": "Umum",
        }, headers=owner["headers"])
        return g1, g2

    def test_non_owner_forbidden_403(self, session, owner, seeds):
        op_pwd = "operator123"
        op_create = session.post(f"{BASE_URL}/api/operators", json={
            "name": "Kasir Iter6 Del", "username": f"opd_{uuid.uuid4().hex[:6]}",
            "password": op_pwd, "role": "cashier", "permissions": ["sales"],
        }, headers=owner["headers"])
        assert op_create.status_code == 200
        op_login = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": op_create.json()["username"], "password": op_pwd,
        })
        op_headers = {"Authorization": f"Bearer {op_login.json()['token']}"}
        r = session.post(f"{BASE_URL}/api/admin/delete-all-products",
                         json={"password": op_pwd}, headers=op_headers)
        assert r.status_code == 403

    def test_wrong_password_400(self, session, owner):
        r = session.post(f"{BASE_URL}/api/admin/delete-all-products",
                         json={"password": "WRONG"}, headers=owner["headers"])
        assert r.status_code == 400

    def test_happy_path_deletes_only_products(self, session, owner, seeds):
        before = len(session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json())
        assert before >= 2
        r = session.post(f"{BASE_URL}/api/admin/delete-all-products",
                         json={"password": owner["password"]}, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["deleted"] >= 2
        after = session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json()
        assert after == []
        # Customers and transactions untouched
        cust = session.get(f"{BASE_URL}/api/customers", headers=owner["headers"]).json()
        assert any(c["name"] == "TEST_Iter6 Keep Cust2" for c in cust)
        tx = session.get(f"{BASE_URL}/api/transactions", headers=owner["headers"]).json()
        assert len(tx) >= 1


# ========== Regression suite ==========
class TestRegression:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter6reg")

    def test_health(self, session):
        assert session.get(f"{BASE_URL}/api/health").status_code == 200

    def test_auth_me(self, session, owner):
        r = session.get(f"{BASE_URL}/api/auth/me", headers=owner["headers"])
        assert r.status_code == 200
        assert r.json()["role"] == "owner"

    def test_settings_strip_empty_lines(self, session, owner):
        payload = {
            "header_lines": ["TOKO", "", "   ", "Jl. Mawar"],
            "footer_lines": ["Terima kasih", "   ", "", "WA"],
            "receipt_width": "58mm",
        }
        r = session.put(f"{BASE_URL}/api/settings", json=payload, headers=owner["headers"])
        assert r.status_code == 200, r.text
        data = session.get(f"{BASE_URL}/api/settings", headers=owner["headers"]).json()
        # Must only contain non-empty, stripped strings
        assert data["header_lines"] == ["TOKO", "Jl. Mawar"], data["header_lines"]
        assert data["footer_lines"] == ["Terima kasih", "WA"], data["footer_lines"]

    def test_settings_max_4_enforced(self, session, owner):
        r = session.put(f"{BASE_URL}/api/settings",
                        json={"header_lines": ["a", "b", "c", "d", "e"], "footer_lines": []},
                        headers=owner["headers"])
        assert r.status_code == 422

    def test_service_sale_skips_stock(self, session, owner):
        svc = _create_service(session, owner, name="TEST_Iter6 Reg Service")
        before = svc["stock"]
        r = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{
                "product_id": svc["id"], "name": svc["name"],
                "quantity": 3, "price": 50000, "cost": 0,
                "unit": "Jam", "unit_factor": 1.0, "product_type": "service",
            }],
            "paid_amount": 150000, "customer_name": "Umum",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        pr = session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json()
        after = next(p for p in pr if p["id"] == svc["id"])["stock"]
        assert after == before

    def test_multi_unit_decrements_qty_times_factor(self, session, owner):
        g = _create_goods(session, owner, name="TEST_Iter6 Reg Goods")
        r = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{
                "product_id": g["id"], "name": g["name"],
                "quantity": 2, "price": 110000, "cost": 7000,
                "unit": "Dus", "unit_factor": 12.0, "product_type": "goods",
            }],
            "paid_amount": 300000, "customer_name": "Umum",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        pr = session.get(f"{BASE_URL}/api/products", headers=owner["headers"]).json()
        after = next(p for p in pr if p["id"] == g["id"])["stock"]
        assert after == g["stock"] - 24, f"expected {g['stock'] - 24}, got {after}"

    def test_parked_requires_customer_name(self, session, owner):
        g = _create_goods(session, owner, name="TEST_Iter6 Park Goods")
        bad = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "",
            "items": [{"product_id": g["id"], "name": g["name"], "quantity": 1,
                       "price": 10000, "cost": 7000, "unit": "Pcs",
                       "unit_factor": 1.0, "product_type": "goods"}],
        }, headers=owner["headers"])
        assert bad.status_code == 422

    def test_reports_sales_items_excludes_cancelled(self, session, owner):
        g = _create_goods(session, owner, name="TEST_Iter6 SI Goods")
        # Active sale
        sale = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{"product_id": g["id"], "name": g["name"], "quantity": 1,
                       "price": 10000, "cost": 7000, "unit": "Pcs",
                       "unit_factor": 1.0, "product_type": "goods"}],
            "paid_amount": 10000, "customer_name": "Keep Me",
        }, headers=owner["headers"]).json()
        # Cancellable sale
        cancel_me = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{"product_id": g["id"], "name": g["name"], "quantity": 5,
                       "price": 10000, "cost": 7000, "unit": "Pcs",
                       "unit_factor": 1.0, "product_type": "goods"}],
            "paid_amount": 50000, "customer_name": "Cancel Me",
        }, headers=owner["headers"]).json()
        c = session.post(f"{BASE_URL}/api/transactions/{cancel_me['id']}/cancel",
                         json={"reason": "regress"}, headers=owner["headers"])
        assert c.status_code == 200
        r = session.get(f"{BASE_URL}/api/reports/sales-items?period=daily",
                        headers=owner["headers"])
        assert r.status_code == 200
        rows = r.json()["rows"]
        invoices = {row["invoice_no"] for row in rows}
        assert sale["invoice_no"] in invoices
        assert cancel_me["invoice_no"] not in invoices

    def test_products_export_xlsx(self, session, owner):
        _create_goods(session, owner, name="TEST_Iter6 Export Goods")
        _create_service(session, owner, name="TEST_Iter6 Export Service")
        r = session.get(f"{BASE_URL}/api/products/export", headers=owner["headers"])
        assert r.status_code == 200
        assert "spreadsheetml.sheet" in r.headers.get("content-type", "")
        assert ".xlsx" in r.headers.get("content-disposition", "")
        try:
            import pandas as pd
            frame = pd.read_excel(io.BytesIO(r.content))
            assert "Nama" in frame.columns
            assert "Tipe" in frame.columns
        except ImportError:
            pytest.skip("pandas unavailable")

    def test_categories_crud(self, session, owner):
        r = session.post(f"{BASE_URL}/api/categories", json={"name": f"TEST_Iter6 Cat {uuid.uuid4().hex[:4]}"},
                         headers=owner["headers"])
        assert r.status_code == 200
        cid = r.json()["id"]
        r2 = session.get(f"{BASE_URL}/api/categories", headers=owner["headers"])
        assert any(c["id"] == cid for c in r2.json())
        session.delete(f"{BASE_URL}/api/categories/{cid}", headers=owner["headers"])

    def test_transactions_list(self, session, owner):
        r = session.get(f"{BASE_URL}/api/transactions", headers=owner["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)
