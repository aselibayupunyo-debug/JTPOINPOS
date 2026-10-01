"""Backend tests for iteration 2: customers, suppliers, detailed reports, extended backup.

NOTE: pytest.ini pins `-n 2 --dist loadscope`, which groups tests by CLASS onto a
single worker. All stateful flow tests must therefore live inside ONE class so
that shared ids (customer_id, supplier_id, transactions) stay on the same worker.
"""
import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL (or EXPO_PUBLIC_BACKEND_URL) must be set"


@pytest.fixture(scope="class")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="class")
def owner(api):
    uname = f"seedtest_{uuid.uuid4().hex[:10]}"
    r = api.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": "TEST_Toko", "owner_name": "TEST_Owner",
        "username": uname, "password": "owner123",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user": data["user"],
            "headers": {"Authorization": f"Bearer {data['token']}"}}


@pytest.fixture(scope="class")
def cashier(api, owner):
    uname = f"cashier_{uuid.uuid4().hex[:8]}"
    r = api.post(f"{BASE_URL}/api/operators", headers=owner["headers"], json={
        "name": "TEST_Cashier", "username": uname, "password": "kasir123",
        "role": "cashier", "permissions": ["sales"],
    })
    assert r.status_code == 200, r.text
    login = api.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": "kasir123"})
    token = login.json()["token"]
    return {"token": token, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="class")
def product(api, owner):
    r = api.post(f"{BASE_URL}/api/products", headers=owner["headers"], json={
        "name": "TEST_Kopi", "sku": "K-001", "price": 10000, "cost": 6000,
        "stock": 100, "min_stock": 5,
    })
    assert r.status_code == 200, r.text
    return r.json()


class TestContactsAndReports:
    """Full flow: contacts -> transactions -> stats -> reports -> backup."""

    # ---------- Customers CRUD ----------
    def test_01_create_customer_no_leak(self, api, owner):
        r = api.post(f"{BASE_URL}/api/customers", headers=owner["headers"], json={
            "name": "TEST_Pelanggan A", "phone": "081200001111",
            "address": "Jl. Mawar 1", "note": "VIP",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] and "_id" not in body and "business_id" not in body
        assert body["name"] == "TEST_Pelanggan A"
        pytest.cust_id = body["id"]

    def test_02_list_customers_stats_fields(self, api, owner):
        r = api.get(f"{BASE_URL}/api/customers", headers=owner["headers"])
        assert r.status_code == 200
        row = next(x for x in r.json() if x["id"] == pytest.cust_id)
        for k in ("transaction_count", "total_spent", "outstanding"):
            assert row[k] == 0
        assert "_id" not in row and "business_id" not in row

    def test_03_search_customer_by_phone(self, api, owner):
        r = api.get(f"{BASE_URL}/api/customers", headers=owner["headers"],
                    params={"search": "081200001111"})
        assert r.status_code == 200
        assert any(x["id"] == pytest.cust_id for x in r.json())

    def test_04_update_customer(self, api, owner):
        r = api.put(f"{BASE_URL}/api/customers/{pytest.cust_id}", headers=owner["headers"], json={
            "name": "TEST_Pelanggan A2", "phone": "081200001111", "address": "", "note": "",
        })
        assert r.status_code == 200 and r.json()["name"] == "TEST_Pelanggan A2"

    def test_05_create_customer_empty_name_422(self, api, owner):
        r = api.post(f"{BASE_URL}/api/customers", headers=owner["headers"], json={
            "name": "", "phone": "", "address": "", "note": "",
        })
        assert r.status_code == 422

    def test_06_delete_customer(self, api, owner):
        r = api.post(f"{BASE_URL}/api/customers", headers=owner["headers"], json={
            "name": "TEST_ToDelete", "phone": "", "address": "", "note": "",
        })
        cid = r.json()["id"]
        assert api.delete(f"{BASE_URL}/api/customers/{cid}", headers=owner["headers"]).status_code == 200
        assert api.delete(f"{BASE_URL}/api/customers/{cid}", headers=owner["headers"]).status_code == 404

    # ---------- Suppliers CRUD ----------
    def test_07_create_supplier(self, api, owner):
        r = api.post(f"{BASE_URL}/api/suppliers", headers=owner["headers"], json={
            "name": "TEST_Supplier Z", "phone": "081999", "address": "Gudang", "note": "",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["id"] and "_id" not in body and "business_id" not in body
        pytest.sup_id = body["id"]

    def test_08_list_suppliers_stats(self, api, owner):
        r = api.get(f"{BASE_URL}/api/suppliers", headers=owner["headers"])
        assert r.status_code == 200
        row = next(x for x in r.json() if x["id"] == pytest.sup_id)
        assert row["transaction_count"] == 0
        assert row["outstanding"] == 0
        assert row["total_spent"] == 0

    def test_09_update_supplier(self, api, owner):
        r = api.put(f"{BASE_URL}/api/suppliers/{pytest.sup_id}", headers=owner["headers"], json={
            "name": "TEST_Supplier Z2", "phone": "081999", "address": "", "note": "",
        })
        assert r.status_code == 200 and r.json()["name"] == "TEST_Supplier Z2"

    # ---------- Transactions with customer_id / supplier_id ----------
    def test_10_sale_with_customer_id_updates_stats(self, api, owner, product):
        tx = api.post(f"{BASE_URL}/api/transactions", headers=owner["headers"], json={
            "transaction_type": "sale", "payment_method": "cash",
            "items": [{"product_id": product["id"], "name": product["name"],
                       "quantity": 2, "price": product["price"], "cost": product["cost"]}],
            "paid_amount": product["price"] * 2,
            "customer_name": "TEST_Pelanggan A2", "customer_id": pytest.cust_id,
        })
        assert tx.status_code == 200, tx.text
        body = tx.json()
        assert body["customer_id"] == pytest.cust_id
        assert "_id" not in body and "business_id" not in body

        tx2 = api.post(f"{BASE_URL}/api/transactions", headers=owner["headers"], json={
            "transaction_type": "sale", "payment_method": "credit",
            "items": [{"product_id": product["id"], "name": product["name"],
                       "quantity": 1, "price": product["price"], "cost": product["cost"]}],
            "paid_amount": 0,
            "customer_name": "TEST_Pelanggan A2", "customer_id": pytest.cust_id,
        })
        assert tx2.status_code == 200
        assert tx2.json()["outstanding"] == product["price"]

        row = next(x for x in api.get(f"{BASE_URL}/api/customers", headers=owner["headers"]).json()
                   if x["id"] == pytest.cust_id)
        assert row["transaction_count"] == 2
        assert row["total_spent"] == product["price"] * 3
        assert row["outstanding"] == product["price"]

    def test_11_purchase_with_supplier_id_updates_stats(self, api, owner, product):
        tx = api.post(f"{BASE_URL}/api/transactions", headers=owner["headers"], json={
            "transaction_type": "purchase", "payment_method": "credit",
            "items": [{"product_id": product["id"], "name": product["name"],
                       "quantity": 5, "price": product["cost"], "cost": product["cost"]}],
            "paid_amount": 0,
            "customer_name": "TEST_Supplier Z2", "supplier_id": pytest.sup_id,
        })
        assert tx.status_code == 200, tx.text
        assert tx.json()["supplier_id"] == pytest.sup_id

        row = next(x for x in api.get(f"{BASE_URL}/api/suppliers", headers=owner["headers"]).json()
                   if x["id"] == pytest.sup_id)
        assert row["transaction_count"] == 1
        assert row["outstanding"] == product["cost"] * 5
        assert row["total_spent"] == product["cost"] * 5

    # ---------- Detailed Reports ----------
    def test_12_report_products(self, api, owner, product):
        r = api.get(f"{BASE_URL}/api/reports/products", headers=owner["headers"],
                    params={"period": "monthly"})
        assert r.status_code == 200
        body = r.json()
        assert body["period"] == "monthly"
        rows = body["rows"]
        assert len(rows) >= 1
        row = next(x for x in rows if x["product_id"] == product["id"])
        assert row["quantity"] == 3
        assert row["revenue"] == product["price"] * 3
        assert row["profit"] == (product["price"] - product["cost"]) * 3
        assert row["name"] == product["name"]
        profits = [x["profit"] for x in rows]
        assert profits == sorted(profits, reverse=True)

    def test_13_report_customers(self, api, owner):
        r = api.get(f"{BASE_URL}/api/reports/customers", headers=owner["headers"],
                    params={"period": "monthly"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        row = next(x for x in rows if x["customer_id"] == pytest.cust_id)
        assert row["transaction_count"] == 2
        assert row["total_spent"] > 0
        assert row["outstanding"] > 0
        assert "profit" in row

    def test_14_report_operators(self, api, owner):
        r = api.get(f"{BASE_URL}/api/reports/operators", headers=owner["headers"],
                    params={"period": "monthly"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        row = next(x for x in rows if x["operator_id"] == owner["user"]["id"])
        assert row["transaction_count"] >= 2
        assert row["total_sales"] > 0
        assert row["name"]
        assert "profit" in row

    def test_15_report_products_forbidden_for_cashier(self, api, cashier):
        assert api.get(f"{BASE_URL}/api/reports/products",
                       headers=cashier["headers"]).status_code == 403

    def test_16_report_customers_forbidden_for_cashier(self, api, cashier):
        assert api.get(f"{BASE_URL}/api/reports/customers",
                       headers=cashier["headers"]).status_code == 403

    def test_17_report_operators_forbidden_for_cashier(self, api, cashier):
        assert api.get(f"{BASE_URL}/api/reports/operators",
                       headers=cashier["headers"]).status_code == 403

    # ---------- Backup extended ----------
    def test_18_backup_includes_customers_suppliers(self, api, owner):
        r = api.get(f"{BASE_URL}/api/backup", headers=owner["headers"])
        assert r.status_code == 200
        body = r.json()
        for key in ("products", "transactions", "cash_entries", "customers", "suppliers"):
            assert key in body and isinstance(body[key], list)
        assert any(c["id"] == pytest.cust_id for c in body["customers"])
        assert any(s["id"] == pytest.sup_id for s in body["suppliers"])
        for arr in (body["customers"], body["suppliers"]):
            for d in arr:
                assert "_id" not in d and "business_id" not in d
