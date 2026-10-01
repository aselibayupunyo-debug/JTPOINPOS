"""Comprehensive backend regression suite for KasirKu Pro.

Covers auth, products CRUD, transactions (sale/purchase/returns/credit+pay),
cash entries, operators, reports, settings, backup, integrations, permissions,
and permission enforcement.
"""
import os
import uuid

import pytest
import requests


BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ["EXPO_PUBLIC_BACKEND_URL"]
).rstrip("/")

TIMEOUT = 25


# ----------------------- Fixtures -----------------------

@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    username = f"test_{uuid.uuid4().hex[:10]}"
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "business_name": "TEST Toko Owner",
            "owner_name": "TEST Owner",
            "username": username,
            "password": "TestPass123!",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers["Authorization"] = f"Bearer {data['token']}"
    s.username = username
    s.user = data["user"]
    return s


@pytest.fixture(scope="module")
def cashier(owner):
    """Create a cashier operator with only sales permission and return a session."""
    cashier_username = f"cashier_{uuid.uuid4().hex[:8]}"
    cashier_password = "Kasir123!"
    r = owner.post(
        f"{BASE_URL}/api/operators",
        json={
            "name": "TEST Kasir",
            "username": cashier_username,
            "password": cashier_password,
            "role": "cashier",
            "permissions": ["sales"],
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    login = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": cashier_username, "password": cashier_password},
        timeout=TIMEOUT,
    )
    assert login.status_code == 200, login.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {login.json()['token']}"
    s.operator_id = r.json()["id"]
    s.username = cashier_username
    return s


# ----------------------- Auth -----------------------

class TestAuth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200 and r.json()["status"] == "ok"

    def test_register_login_me(self):
        username = f"test_{uuid.uuid4().hex[:8]}"
        reg = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "business_name": "TEST BN",
                "owner_name": "TEST Owner",
                "username": username,
                "password": "Secret123!",
            },
            timeout=TIMEOUT,
        )
        assert reg.status_code == 200, reg.text
        token = reg.json()["token"]
        assert reg.json()["user"]["role"] == "owner"
        assert set(reg.json()["user"]["permissions"]) >= {
            "sales", "purchases", "returns", "inventory", "reports",
            "cashflow", "debts", "operators", "settings",
        }
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": username, "password": "Secret123!"},
            timeout=TIMEOUT,
        )
        assert login.status_code == 200
        me = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
        )
        assert me.status_code == 200
        assert me.json()["username"] == username

    def test_register_duplicate_username(self, owner):
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "business_name": "DupBiz",
                "owner_name": "DupOwner",
                "username": owner.username,
                "password": "AnotherPass1!",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 409

    def test_login_wrong_password(self, owner):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": owner.username, "password": "WRONG"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401

    def test_unauthorized(self):
        assert requests.get(f"{BASE_URL}/api/products", timeout=TIMEOUT).status_code == 401


# ----------------------- Products CRUD -----------------------

class TestProducts:
    def test_create_product_with_full_fields(self, owner):
        r = owner.post(
            f"{BASE_URL}/api/products",
            json={
                "name": "TEST Nasi Goreng",
                "sku": "SKU-NG",
                "barcode": "NG001",
                "category": "Makanan",
                "price": 20000,
                "cost": 8000,
                "stock": 10,
                "min_stock": 3,
                "kitchen_print": True,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert "_id" not in p and "business_id" not in p
        assert p["cost"] == 8000 and p["stock"] == 10
        assert p["min_stock"] == 3 and p["kitchen_print"] is True
        owner.product_ng = p
        # Verify persistence
        listed = owner.get(f"{BASE_URL}/api/products?search=NG001", timeout=TIMEOUT).json()
        assert any(x["id"] == p["id"] for x in listed)

    def test_update_product(self, owner):
        p = owner.product_ng
        r = owner.put(
            f"{BASE_URL}/api/products/{p['id']}",
            json={
                "name": "TEST Nasi Goreng Spesial",
                "sku": "SKU-NG",
                "barcode": "NG001",
                "category": "Makanan",
                "price": 25000,
                "cost": 9000,
                "stock": 10,
                "min_stock": 3,
                "kitchen_print": True,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST Nasi Goreng Spesial"
        assert r.json()["price"] == 25000

    def test_update_product_not_found(self, owner):
        r = owner.put(
            f"{BASE_URL}/api/products/does-not-exist",
            json={"name": "x", "price": 1},
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_delete_product(self, owner):
        # Create a disposable product
        p = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Delete Me", "price": 1000, "stock": 1},
            timeout=TIMEOUT,
        ).json()
        r = owner.delete(f"{BASE_URL}/api/products/{p['id']}", timeout=TIMEOUT)
        assert r.status_code == 200 and r.json()["ok"] is True
        # Verify deletion: search should not return it
        listed = owner.get(f"{BASE_URL}/api/products?search=Delete Me", timeout=TIMEOUT).json()
        assert not any(x["id"] == p["id"] for x in listed)

    def test_delete_product_not_found(self, owner):
        assert owner.delete(f"{BASE_URL}/api/products/nope", timeout=TIMEOUT).status_code == 404


# ----------------------- Transactions -----------------------

class TestTransactions:
    def test_sale_cash_reduces_stock_and_profit(self, owner):
        prod = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Kopi Sale", "price": 15000, "cost": 6000, "stock": 5},
            timeout=TIMEOUT,
        ).json()
        r = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale",
                "payment_method": "cash",
                "paid_amount": 30000,
                "items": [{
                    "product_id": prod["id"], "name": prod["name"],
                    "quantity": 2, "price": 15000, "cost": 6000,
                }],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        tx = r.json()
        assert "_id" not in tx and tx["total"] == 30000
        assert tx["outstanding"] == 0
        # stock reduced
        after = owner.get(f"{BASE_URL}/api/products?search=TEST Kopi Sale", timeout=TIMEOUT).json()
        assert after[0]["stock"] == 3
        owner.sale_tx = tx
        owner.sale_product = prod

    def test_sale_insufficient_cash(self, owner):
        prod = owner.sale_product
        r = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale", "payment_method": "cash",
                "paid_amount": 1,
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 1, "price": 15000}],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_sale_insufficient_stock(self, owner):
        prod = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Limited", "price": 5000, "stock": 1},
            timeout=TIMEOUT,
        ).json()
        r = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale", "payment_method": "cash", "paid_amount": 10000,
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 2, "price": 5000}],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_purchase_increases_stock(self, owner):
        prod = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Beli", "price": 10000, "cost": 7000, "stock": 2},
            timeout=TIMEOUT,
        ).json()
        r = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "purchase", "payment_method": "cash", "paid_amount": 21000,
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 3, "price": 7000, "cost": 7000}],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        after = owner.get(f"{BASE_URL}/api/products?search=TEST Beli", timeout=TIMEOUT).json()
        assert after[0]["stock"] == 5

    def test_sale_return_restores_stock(self, owner):
        prod = owner.sale_product
        before = owner.get(f"{BASE_URL}/api/products?search=TEST Kopi Sale", timeout=TIMEOUT).json()[0]["stock"]
        r = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale_return", "payment_method": "cash", "paid_amount": 0,
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 1, "price": 15000, "cost": 6000}],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        after = owner.get(f"{BASE_URL}/api/products?search=TEST Kopi Sale", timeout=TIMEOUT).json()[0]["stock"]
        assert after == before + 1

    def test_credit_sale_and_payment(self, owner):
        prod = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Kredit", "price": 20000, "cost": 10000, "stock": 5},
            timeout=TIMEOUT,
        ).json()
        tx = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale", "payment_method": "credit", "paid_amount": 0,
                "customer_name": "TEST Pelanggan",
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 1, "price": 20000, "cost": 10000}],
            },
            timeout=TIMEOUT,
        ).json()
        assert tx["outstanding"] == 20000
        # Should appear in receivables
        rec = owner.get(f"{BASE_URL}/api/debts?kind=receivable", timeout=TIMEOUT).json()
        assert any(d["id"] == tx["id"] for d in rec["items"])
        assert rec["total"] >= 20000
        # Pay 8000
        pay = owner.post(
            f"{BASE_URL}/api/transactions/{tx['id']}/pay",
            json={"amount": 8000, "note": "cicilan 1"},
            timeout=TIMEOUT,
        )
        assert pay.status_code == 200
        assert pay.json()["outstanding"] == 12000
        # Detail: GET
        detail = owner.get(f"{BASE_URL}/api/transactions/{tx['id']}", timeout=TIMEOUT).json()
        assert detail["outstanding"] == 12000
        assert any(p["amount"] == 8000 for p in detail.get("payments", []))
        # Cash entry auto-created
        entries = owner.get(f"{BASE_URL}/api/cash-entries", timeout=TIMEOUT).json()
        assert any(e["entry_type"] == "income" and e["amount"] == 8000 for e in entries)

    def test_transactions_filter(self, owner):
        all_tx = owner.get(f"{BASE_URL}/api/transactions", timeout=TIMEOUT).json()
        assert isinstance(all_tx, list) and len(all_tx) > 0
        sales = owner.get(f"{BASE_URL}/api/transactions?kind=sale", timeout=TIMEOUT).json()
        assert all(t["transaction_type"] == "sale" for t in sales)
        purchases = owner.get(f"{BASE_URL}/api/transactions?kind=purchase", timeout=TIMEOUT).json()
        assert all(t["transaction_type"] == "purchase" for t in purchases)

    def test_transaction_detail_not_found(self, owner):
        assert owner.get(f"{BASE_URL}/api/transactions/missing", timeout=TIMEOUT).status_code == 404


# ----------------------- Cash Entries -----------------------

class TestCashEntries:
    def test_create_income_expense(self, owner):
        inc = owner.post(
            f"{BASE_URL}/api/cash-entries",
            json={"entry_type": "income", "amount": 50000, "category": "TEST Modal", "note": "setoran"},
            timeout=TIMEOUT,
        )
        assert inc.status_code == 200 and inc.json()["amount"] == 50000
        exp = owner.post(
            f"{BASE_URL}/api/cash-entries",
            json={"entry_type": "expense", "amount": 15000, "category": "TEST Operasional"},
            timeout=TIMEOUT,
        )
        assert exp.status_code == 200
        listed = owner.get(f"{BASE_URL}/api/cash-entries", timeout=TIMEOUT).json()
        assert any(e["id"] == inc.json()["id"] for e in listed)
        assert any(e["id"] == exp.json()["id"] for e in listed)


# ----------------------- Operators & Permissions -----------------------

class TestOperators:
    def test_list_operators_contains_cashier(self, owner, cashier):
        r = owner.get(f"{BASE_URL}/api/operators", timeout=TIMEOUT)
        assert r.status_code == 200
        ops = r.json()
        assert any(o["id"] == cashier.operator_id for o in ops)
        # Must not leak password hash or _id
        for o in ops:
            assert "_id" not in o and "password_hash" not in o

    def test_update_operator(self, owner, cashier):
        r = owner.put(
            f"{BASE_URL}/api/operators/{cashier.operator_id}",
            json={
                "name": "TEST Kasir Updated",
                "username": cashier.username,
                # NOTE: OperatorInput requires password min_length=6 even on PUT.
                # Backend logic only updates password if it's non-empty, but the
                # Pydantic validator forces 6+ chars. Reporting as a minor issue.
                "password": "Kasir123!",
                "role": "cashier",
                "permissions": ["sales", "returns"],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_cashier_forbidden_from_products(self, cashier):
        r = cashier.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Blocked", "price": 1000, "stock": 1},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

    def test_permissions_endpoint(self):
        r = requests.get(f"{BASE_URL}/api/permissions", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "sales" in body["permissions"]
        assert "operators" in body["permissions"]
        assert set(body["presets"].keys()) >= {"owner", "manager", "cashier", "inventory", "kitchen"}
        assert body["presets"]["cashier"] == ["sales"]

    def test_delete_operator(self, owner):
        # Create a throwaway operator and delete
        uname = f"ops_{uuid.uuid4().hex[:6]}"
        created = owner.post(
            f"{BASE_URL}/api/operators",
            json={"name": "TEST Del", "username": uname, "password": "abc12345", "role": "cashier", "permissions": ["sales"]},
            timeout=TIMEOUT,
        ).json()
        r = owner.delete(f"{BASE_URL}/api/operators/{created['id']}", timeout=TIMEOUT)
        assert r.status_code == 200 and r.json()["ok"] is True
        # Verify not in list
        ops = owner.get(f"{BASE_URL}/api/operators", timeout=TIMEOUT).json()
        assert not any(o["id"] == created["id"] for o in ops)


# ----------------------- Reports / Settings / Backup / Integrations -----------------------

class TestReports:
    @pytest.mark.parametrize("period", ["daily", "monthly", "yearly"])
    def test_summary(self, owner, period):
        r = owner.get(f"{BASE_URL}/api/reports/summary?period={period}", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ["sales_total", "gross_profit", "receivable", "payable",
                    "cash_balance", "cash_in", "cash_out", "transaction_count",
                    "purchase_total", "low_stock", "period"]:
            assert key in body, f"missing {key} in {body}"
        assert body["period"] == period
        # After our tests we expect sales_total >= 0 and gross_profit >= 0
        assert body["sales_total"] >= 0
        assert body["gross_profit"] >= 0


class TestSettings:
    def test_default_settings(self, owner):
        r = owner.get(f"{BASE_URL}/api/settings", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["business_name"] in {"TEST Toko Owner", "TEST Toko Owner Updated"}
        assert body["receipt_width"] in {"58mm", "80mm"}

    def test_update_settings(self, owner):
        logo = "data:image/png;base64,iVBORw0KGgo="  # tiny stub
        r = owner.put(
            f"{BASE_URL}/api/settings",
            json={
                "business_name": "TEST Toko Owner Updated",
                "address": "Jl. Test 1",
                "phone": "08123",
                "footer_note": "Terima kasih",
                "logo_base64": logo,
                "receipt_width": "80mm",
                "whatsapp_number": "6281234567890",
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["receipt_width"] == "80mm"
        assert body["logo_base64"] == logo
        assert body["business_name"] == "TEST Toko Owner Updated"


class TestBackup:
    def test_backup_contents(self, owner):
        r = owner.get(f"{BASE_URL}/api/backup", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        for key in ["products", "transactions", "cash_entries", "exported_at", "business_name"]:
            assert key in body
        assert isinstance(body["products"], list)
        assert isinstance(body["transactions"], list)
        assert isinstance(body["cash_entries"], list)


class TestIntegrations:
    def test_integrations_status(self, owner):
        r = owner.get(f"{BASE_URL}/api/integrations/status", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "qris" in body and "configured" in body["qris"]
        assert "whatsapp" in body and "configured" in body["whatsapp"]
        assert "bluetooth_printing" in body and "configured" in body["bluetooth_printing"]
        # Expected default: all three unconfigured in preview
        assert body["qris"]["configured"] is False
        assert body["bluetooth_printing"]["configured"] is False


class TestDebts:
    def test_payable(self, owner):
        # Create credit purchase to produce payable
        prod = owner.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST Hutang", "price": 50000, "cost": 30000, "stock": 0},
            timeout=TIMEOUT,
        ).json()
        tx = owner.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "purchase", "payment_method": "credit", "paid_amount": 0,
                "items": [{"product_id": prod["id"], "name": prod["name"], "quantity": 1, "price": 30000, "cost": 30000}],
            },
            timeout=TIMEOUT,
        ).json()
        assert tx["outstanding"] == 30000
        payable = owner.get(f"{BASE_URL}/api/debts?kind=payable", timeout=TIMEOUT).json()
        assert any(d["id"] == tx["id"] for d in payable["items"])
        assert payable["total"] >= 30000
