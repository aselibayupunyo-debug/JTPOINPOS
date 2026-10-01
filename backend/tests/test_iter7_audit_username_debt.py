"""
Iteration-7 backend tests for KasirKu Pro (session 2026-10 iter-7) covering:
  - GET /api/audit-logs (owner-only, returns entries after reset / delete-all)
  - POST /api/admin/reset-transactions writes audit_log(action='reset_transactions', details.deleted*)
  - POST /api/admin/delete-all-products writes audit_log(action='delete_all_products', details.deleted)
  - PUT /api/profile with username (unique global lowercased, 400 on clash, 422 on <3)
  - POST /api/transactions/{id}/pay now accepts payment_method + payment_method_label
    and returns payment entry; cash_entries note embeds method label.
  - Regression: PUT /api/profile name + password still works.
  - Regression: existing admin reset/delete endpoints still function.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"


# ----- Helpers -----
def _register_owner(session: requests.Session, prefix: str = "iter7"):
    uname = f"{prefix}_{uuid.uuid4().hex[:8]}"
    pwd = "password123"
    r = session.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": f"TEST_Iter7 {uname}",
        "owner_name": "Iter7 Owner",
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


def _create_goods(session, owner, name="TEST_Iter7 Goods", stock=100):
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": name, "sku": f"ITER7-{uuid.uuid4().hex[:4]}",
        "category": "Umum", "product_type": "goods", "base_unit": "Pcs",
        "price": 10000, "cost": 7000,
        "prices": {"default": 10000},
        "units": [{"name": "Pcs", "factor": 1, "price": 10000}],
        "stock": stock, "min_stock": 5,
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def _create_credit_sale(session, owner, goods, qty=1, paid=0):
    """Create a credit (unpaid) sale that yields outstanding > 0."""
    price = 10000
    total = price * qty
    r = session.post(f"{BASE_URL}/api/transactions", json={
        "transaction_type": "sale",
        "payment_method": "credit",
        "payment_method_label": "Piutang",
        "items": [{
            "product_id": goods["id"], "name": goods["name"],
            "quantity": qty, "price": price, "cost": 7000,
            "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
        }],
        "paid_amount": paid,
        "customer_name": "TEST_Iter7 Pelanggan",
    }, headers=owner["headers"])
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx.get("outstanding", 0) >= (total - paid), tx
    return tx


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ========== GET /api/audit-logs (owner only) + reset/delete audit writes ==========
class TestAuditLogs:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter7aud")

    def test_initial_audit_log_empty_list(self, session, owner):
        r = session.get(f"{BASE_URL}/api/audit-logs", headers=owner["headers"])
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
        # may be empty or carry prior entries from this fresh owner — expected empty
        assert r.json() == []

    def test_non_owner_audit_logs_403(self, session, owner):
        op_pwd = "operator123"
        op_create = session.post(f"{BASE_URL}/api/operators", json={
            "name": "Kasir Iter7", "username": f"op7_{uuid.uuid4().hex[:6]}",
            "password": op_pwd, "role": "cashier", "permissions": ["sales"],
        }, headers=owner["headers"])
        assert op_create.status_code == 200, op_create.text
        op_login = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": op_create.json()["username"], "password": op_pwd,
        })
        assert op_login.status_code == 200
        op_headers = {"Authorization": f"Bearer {op_login.json()['token']}"}
        r = session.get(f"{BASE_URL}/api/audit-logs", headers=op_headers)
        assert r.status_code == 403, r.text

    def test_reset_transactions_writes_audit_entry(self, session, owner):
        # Seed one tx + one parked + one cash entry so counts > 0
        goods = _create_goods(session, owner, name="TEST_Iter7 Aud Goods")
        tx = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "sale", "payment_method": "cash", "payment_method_label": "Tunai",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 1, "price": 10000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 10000, "customer_name": "Umum",
        }, headers=owner["headers"])
        assert tx.status_code == 200
        p = session.post(f"{BASE_URL}/api/parked", json={
            "customer_name": "Parked7",
            "items": [{"product_id": goods["id"], "name": goods["name"], "quantity": 1,
                       "price": 10000, "cost": 7000, "unit": "Pcs",
                       "unit_factor": 1.0, "product_type": "goods"}],
        }, headers=owner["headers"])
        assert p.status_code == 200
        c = session.post(f"{BASE_URL}/api/cash-entries",
                         json={"entry_type": "income", "amount": 1000, "category": "TEST"},
                         headers=owner["headers"])
        assert c.status_code == 200

        r = session.post(f"{BASE_URL}/api/admin/reset-transactions",
                         json={"password": owner["password"]}, headers=owner["headers"])
        assert r.status_code == 200, r.text
        deleted = r.json()["deleted"]

        logs = session.get(f"{BASE_URL}/api/audit-logs", headers=owner["headers"]).json()
        resets = [log for log in logs if log["action"] == "reset_transactions"]
        assert len(resets) >= 1, logs
        latest = resets[0]
        # Required fields on entry
        for key in ("id", "actor_id", "actor_name", "action", "details", "created_at"):
            assert key in latest, f"missing {key} in {latest}"
        # business_id excluded from projection
        assert "business_id" not in latest
        # actor is this owner
        assert latest["actor_id"] == owner["user"]["id"]
        assert latest["actor_name"] == owner["user"]["name"]
        # details echoes deleted counts
        d = latest["details"]
        assert d.get("transactions") == deleted["transactions"]
        assert d.get("parked") == deleted["parked"]
        assert d.get("cashflow") == deleted["cashflow"]
        assert d.get("transactions") >= 1
        assert d.get("parked") >= 1
        assert d.get("cashflow") >= 1

    def test_delete_all_products_writes_audit_entry(self, session, owner):
        # Seed 2 products so count >=2
        _create_goods(session, owner, name="TEST_Iter7 Aud Del A")
        _create_goods(session, owner, name="TEST_Iter7 Aud Del B")
        r = session.post(f"{BASE_URL}/api/admin/delete-all-products",
                         json={"password": owner["password"]}, headers=owner["headers"])
        assert r.status_code == 200, r.text
        deleted_count = r.json()["deleted"]
        assert deleted_count >= 2

        logs = session.get(f"{BASE_URL}/api/audit-logs", headers=owner["headers"]).json()
        dels = [log for log in logs if log["action"] == "delete_all_products"]
        assert len(dels) >= 1
        latest = dels[0]
        assert latest["details"].get("deleted") == deleted_count
        assert latest["actor_id"] == owner["user"]["id"]

    def test_audit_logs_sorted_desc(self, session, owner):
        logs = session.get(f"{BASE_URL}/api/audit-logs", headers=owner["headers"]).json()
        assert len(logs) >= 2
        # Expected ordering: delete_all_products was executed AFTER reset_transactions
        actions = [log["action"] for log in logs]
        # newest first
        assert actions.index("delete_all_products") < actions.index("reset_transactions"), actions
        # created_at descending
        ts = [log["created_at"] for log in logs]
        assert ts == sorted(ts, reverse=True), ts


# ========== PUT /api/profile username changes ==========
class TestProfileUsername:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter7un")

    @pytest.fixture(scope="class")
    def other(self, session):
        # Pre-existing user with a known username to force a clash
        return _register_owner(session, "iter7clash")

    def test_username_too_short_422(self, session, owner):
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
            "username": "ab",
        }, headers=owner["headers"])
        assert r.status_code == 422, r.text

    def test_username_clash_returns_400(self, session, owner, other):
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
            "username": other["username"].upper(),  # ensure case-insensitive clash check
        }, headers=owner["headers"])
        assert r.status_code == 400, r.text
        assert "Username" in r.text or "username" in r.text.lower()

    def test_empty_username_is_ignored_noop(self, session, owner):
        # username="" is falsy -> ignored, request still 200, no change
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
            "username": "",
        }, headers=owner["headers"])
        # pydantic Field min_length=3 may 422 on empty string too; accept either behavior but assert no change
        if r.status_code == 200:
            me = session.get(f"{BASE_URL}/api/auth/me", headers=owner["headers"]).json()
            assert me["username"] == owner["username"].lower()
        else:
            assert r.status_code == 422, r.text

    def test_change_username_and_login(self, session, owner):
        new_un = f"iter7new_{uuid.uuid4().hex[:6]}"
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
            "username": new_un.upper(),  # should be normalized to lowercase
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        # /me now reports new username lowercased
        me = session.get(f"{BASE_URL}/api/auth/me", headers=owner["headers"]).json()
        assert me["username"] == new_un.lower()
        # old username can no longer login
        old = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": owner["username"], "password": owner["password"],
        })
        assert old.status_code in (400, 401)
        # new username can login (case-insensitive on login side also normalizes)
        new_ok = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": new_un, "password": owner["password"],
        })
        assert new_ok.status_code == 200, new_ok.text
        owner["username"] = new_un.lower()

    def test_name_and_password_still_work(self, session, owner):
        """Regression: existing name + password change path."""
        new_pwd = "regress789"
        r = session.put(f"{BASE_URL}/api/profile", json={
            "current_password": owner["password"],
            "name": "Owner Updated",
            "new_password": new_pwd,
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        me = session.get(f"{BASE_URL}/api/auth/me", headers=owner["headers"]).json()
        assert me["name"] == "Owner Updated"
        bad = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": owner["username"], "password": owner["password"],
        })
        assert bad.status_code in (400, 401)
        good = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": owner["username"], "password": new_pwd,
        })
        assert good.status_code == 200
        owner["password"] = new_pwd


# ========== Debt payment with payment_method ==========
class TestDebtPaymentMethod:
    @pytest.fixture(scope="class")
    def owner(self, session):
        return _register_owner(session, "iter7pay")

    @pytest.fixture(scope="class")
    def goods(self, session, owner):
        return _create_goods(session, owner, name="TEST_Iter7 Pay Goods")

    def test_pay_with_qris_method_persists_in_payments_and_cash_entries(self, session, owner, goods):
        tx = _create_credit_sale(session, owner, goods, qty=3, paid=0)  # outstanding 30000
        assert tx["outstanding"] == 30000

        r = session.post(f"{BASE_URL}/api/transactions/{tx['id']}/pay", json={
            "amount": 20000,
            "payment_method": "qris",
            "payment_method_label": "QRIS Dinamis",
            "note": "lunas sebagian",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outstanding"] == 10000
        pay = body["payment"]
        assert pay["amount"] == 20000
        assert pay["payment_method"] == "qris"
        assert pay["payment_method_label"] == "QRIS Dinamis"
        assert pay["received_by"] == owner["user"]["name"]
        assert pay["note"] == "lunas sebagian"
        assert "id" in pay and "at" in pay

        # GET transaction and verify payments[] has entry
        got = session.get(f"{BASE_URL}/api/transactions/{tx['id']}",
                          headers=owner["headers"]).json()
        assert got["outstanding"] == 10000
        payments = got.get("payments", [])
        assert len(payments) >= 1
        matched = [p for p in payments if p["id"] == pay["id"]]
        assert matched, payments
        p0 = matched[0]
        assert p0["payment_method"] == "qris"
        assert p0["payment_method_label"] == "QRIS Dinamis"
        assert p0["amount"] == 20000

        # Verify a corresponding cash_entry with embedded label in note
        entries = session.get(f"{BASE_URL}/api/cash-entries",
                              headers=owner["headers"]).json()
        matched_entries = [
            e for e in entries
            if e.get("category", "").startswith("Pelunasan")
            and e.get("amount") == 20000
        ]
        assert matched_entries, entries
        ce = matched_entries[0]
        assert ce["entry_type"] == "income"  # sale -> income
        assert ce["payment_method"] == "qris"
        # note should contain invoice_no AND the human label 'QRIS Dinamis'
        assert "QRIS Dinamis" in ce["note"], ce["note"]
        assert tx["invoice_no"] in ce["note"], ce["note"]

    def test_pay_defaults_to_cash_when_omitted(self, session, owner, goods):
        """payment_method defaults to 'cash'; payment_method_label defaults to method."""
        tx = _create_credit_sale(session, owner, goods, qty=1, paid=0)  # outstanding 10000
        r = session.post(f"{BASE_URL}/api/transactions/{tx['id']}/pay", json={
            "amount": 10000,  # omit method / label / note
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outstanding"] == 0
        pay = body["payment"]
        assert pay["payment_method"] == "cash"
        # label defaults to method when not provided
        assert pay["payment_method_label"] == "cash"

    def test_purchase_debt_payment_generates_expense_cash_entry(self, session, owner, goods):
        """Regression: purchase credit -> payment creates 'expense' cash entry with method label."""
        pur = session.post(f"{BASE_URL}/api/transactions", json={
            "transaction_type": "purchase",
            "payment_method": "credit",
            "payment_method_label": "Hutang",
            "items": [{
                "product_id": goods["id"], "name": goods["name"],
                "quantity": 2, "price": 7000, "cost": 7000,
                "unit": "Pcs", "unit_factor": 1.0, "product_type": "goods",
            }],
            "paid_amount": 0,
            "supplier_name": "TEST_Iter7 Supplier",
        }, headers=owner["headers"])
        assert pur.status_code == 200, pur.text
        ptx = pur.json()
        assert ptx["outstanding"] == 14000
        r = session.post(f"{BASE_URL}/api/transactions/{ptx['id']}/pay", json={
            "amount": 14000,
            "payment_method": "transfer",
            "payment_method_label": "Transfer BCA",
        }, headers=owner["headers"])
        assert r.status_code == 200, r.text
        entries = session.get(f"{BASE_URL}/api/cash-entries",
                              headers=owner["headers"]).json()
        matched = [e for e in entries if e.get("amount") == 14000
                   and e.get("entry_type") == "expense"
                   and "Transfer BCA" in e.get("note", "")]
        assert matched, entries
