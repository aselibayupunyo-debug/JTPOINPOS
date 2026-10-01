"""
Iteration-3 backend tests for KasirKu Pro.

Scope:
- Categories CRUD (+ 409 duplicate)
- Payment-methods auto-seed (pm_cash/pm_credit/pm_qris) + CRUD
- Parked transactions POST/GET/DELETE
- Extended settings GET/PUT defaults + updates
- Transactions with discount_percent/discount_amount/tax_percent/shipping
  * grand_total math (subtotal, item_discount, global_discount, tax_amount, total)
  * insufficient cash check uses grand_total
  * credit outstanding uses grand_total
- customer.price_level_id persisted
- product.prices (dict) + units list persisted
- /api/backup version=2 includes new collections + settings dict
- /api/restore owner-only replaces data (and non-owner 403)
- Permission matrix: cashier (['sales']) 403 on categories/payment-methods POST but OK on parked POST;
  operator without 'settings' 403 on PUT /api/settings

All state lives inside one TestClass so pytest-xdist --dist loadscope keeps us on 1 worker.
"""
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    uniq = uuid.uuid4().hex[:8]
    owner_user = f"iter3owner_{uniq}"
    r = s.post(f"{API}/auth/register", json={
        "business_name": "TEST_Iter3 Shop", "owner_name": "TEST_Owner",
        "username": owner_user, "password": "owner123",
    })
    assert r.status_code == 200, r.text
    owner_token = r.json()["token"]

    # Create a cashier operator (only 'sales')
    cashier_user = f"iter3cashier_{uniq}"
    rc = s.post(f"{API}/operators",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={"name": "TEST_Cashier", "username": cashier_user,
                      "password": "cashier123", "role": "cashier", "permissions": ["sales"]})
    assert rc.status_code == 200, rc.text

    r2 = s.post(f"{API}/auth/login", json={"username": cashier_user, "password": "cashier123"})
    assert r2.status_code == 200, r2.text
    cashier_token = r2.json()["token"]

    # Operator without 'settings' but with inventory (manager preset minus settings)
    nosettings_user = f"iter3nos_{uniq}"
    rn = s.post(f"{API}/operators",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={"name": "TEST_NoSettings", "username": nosettings_user,
                      "password": "pass1234", "role": "manager",
                      "permissions": ["sales", "inventory", "reports"]})
    assert rn.status_code == 200, rn.text
    rn2 = s.post(f"{API}/auth/login", json={"username": nosettings_user, "password": "pass1234"})
    assert rn2.status_code == 200
    nosettings_token = rn2.json()["token"]

    return {
        "s": s,
        "owner": {"Authorization": f"Bearer {owner_token}"},
        "cashier": {"Authorization": f"Bearer {cashier_token}"},
        "nosettings": {"Authorization": f"Bearer {nosettings_token}"},
        "uniq": uniq,
    }


class TestIter3Features:
    # ---------- Categories CRUD ----------
    def test_01_category_create(self, ctx):
        r = ctx["s"].post(f"{API}/categories", headers=ctx["owner"],
                          json={"name": f"TEST_Minuman_{ctx['uniq']}", "icon": "cafe-outline"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == f"TEST_Minuman_{ctx['uniq']}"
        assert data["icon"] == "cafe-outline"
        assert "id" in data
        pytest.cat_id = data["id"]
        pytest.cat_name = data["name"]

    def test_02_category_duplicate_409(self, ctx):
        r = ctx["s"].post(f"{API}/categories", headers=ctx["owner"],
                          json={"name": pytest.cat_name, "icon": "cafe-outline"})
        assert r.status_code == 409, r.text

    def test_03_category_list(self, ctx):
        r = ctx["s"].get(f"{API}/categories", headers=ctx["owner"])
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert pytest.cat_name in names

    def test_04_category_update(self, ctx):
        r = ctx["s"].put(f"{API}/categories/{pytest.cat_id}", headers=ctx["owner"],
                         json={"name": pytest.cat_name + "_v2", "icon": "beer-outline"})
        assert r.status_code == 200, r.text
        assert r.json()["icon"] == "beer-outline"
        pytest.cat_name = pytest.cat_name + "_v2"

    def test_05_category_delete(self, ctx):
        r = ctx["s"].delete(f"{API}/categories/{pytest.cat_id}", headers=ctx["owner"])
        assert r.status_code == 200
        r2 = ctx["s"].get(f"{API}/categories", headers=ctx["owner"])
        assert all(c["id"] != pytest.cat_id for c in r2.json())

    # ---------- Payment Methods ----------
    def test_06_payment_methods_autoseed(self, ctx):
        r = ctx["s"].get(f"{API}/payment-methods", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = {p["id"] for p in rows}
        assert {"pm_cash", "pm_credit", "pm_qris"}.issubset(ids), rows
        for p in rows:
            if p["id"] in {"pm_cash", "pm_credit", "pm_qris"}:
                assert p["enabled"] is True

    def test_07_payment_method_create_update_delete(self, ctx):
        r = ctx["s"].post(f"{API}/payment-methods", headers=ctx["owner"],
                          json={"name": "TEST_Transfer BCA", "kind": "custom",
                                "enabled": True, "sort_order": 5})
        assert r.status_code == 200, r.text
        pm = r.json()
        assert pm["name"] == "TEST_Transfer BCA"
        pm_id = pm["id"]

        r2 = ctx["s"].put(f"{API}/payment-methods/{pm_id}", headers=ctx["owner"],
                          json={"name": "TEST_Transfer BCA 2", "kind": "custom",
                                "enabled": False, "sort_order": 7})
        assert r2.status_code == 200, r2.text
        assert r2.json()["enabled"] is False
        assert r2.json()["name"] == "TEST_Transfer BCA 2"

        r3 = ctx["s"].delete(f"{API}/payment-methods/{pm_id}", headers=ctx["owner"])
        assert r3.status_code == 200

    # ---------- Settings extended ----------
    def test_08_settings_defaults(self, ctx):
        r = ctx["s"].get(f"{API}/settings", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        s = r.json()
        for key in ("tax_percent", "tax_label", "allow_price_edit", "confirm_cancel",
                    "cashdrawer_enabled", "multi_printer", "price_levels",
                    "enabled_payment_kinds", "qris_static_image", "email_recipient",
                    "shipping_default"):
            assert key in s, f"missing default field: {key}"
        assert s["tax_label"] == "Pajak"
        assert isinstance(s["price_levels"], list) and s["price_levels"][0]["id"] == "default"
        assert "cash" in s["enabled_payment_kinds"]

    def test_09_settings_update(self, ctx):
        payload = {
            "price_levels": [{"id": "default", "name": "Harga Jual"},
                             {"id": "grosir", "name": "Grosir"}],
            "tax_percent": 11,
            "shipping_default": 7500,
            "receipt_width": "58mm",
        }
        r = ctx["s"].put(f"{API}/settings", headers=ctx["owner"], json=payload)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["tax_percent"] == 11
        assert s["shipping_default"] == 7500
        assert any(lv["id"] == "grosir" for lv in s["price_levels"])

    def test_10_settings_put_requires_settings_permission(self, ctx):
        r = ctx["s"].put(f"{API}/settings", headers=ctx["nosettings"],
                         json={"tax_percent": 5, "receipt_width": "58mm"})
        assert r.status_code == 403, r.text

    # ---------- Products & Customers extended ----------
    def test_11_product_with_prices_and_units(self, ctx):
        r = ctx["s"].post(f"{API}/products", headers=ctx["owner"], json={
            "name": "TEST_Kopi Sachet", "sku": "KPSC", "category": "Minuman",
            "price": 15000, "cost": 10000,
            "prices": {"default": 15000, "grosir": 12000},
            "units": [{"name": "pcs", "factor": 1}, {"name": "lusin", "factor": 12}],
            "stock": 100, "min_stock": 10,
        })
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["prices"] == {"default": 15000, "grosir": 12000}
        assert len(p["units"]) == 2 and p["units"][1]["factor"] == 12
        pytest.prod_id = p["id"]
        pytest.prod_price = 15000

    def test_12_customer_with_price_level(self, ctx):
        r = ctx["s"].post(f"{API}/customers", headers=ctx["owner"], json={
            "name": "TEST_Grosir Boss", "phone": "0811", "price_level_id": "grosir",
        })
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["price_level_id"] == "grosir"
        pytest.cust_id = c["id"]

        r2 = ctx["s"].get(f"{API}/customers", headers=ctx["owner"])
        assert r2.status_code == 200
        found = next((x for x in r2.json() if x["id"] == pytest.cust_id), None)
        assert found and found["price_level_id"] == "grosir"

    # ---------- Transaction math ----------
    def test_13_transaction_cash_discount_tax_shipping(self, ctx):
        """
        qty 2 @ 15000 = 30000 subtotal_raw
        item.discount 1000 (per spec test wording: items[0].discount=1000)
        subtotal after items = 29000
        discount_percent 10 of 29000 = 2900
        after_discount = 29000 - 2900 = 26100
        tax 11% of 26100 = 2871
        shipping 5000
        grand_total = 26100 + 2871 + 5000 = 33971
        """
        payload = {
            "transaction_type": "sale", "payment_method": "pm_cash",
            "payment_method_label": "Tunai",
            "items": [{"product_id": pytest.prod_id, "name": "TEST_Kopi Sachet",
                       "quantity": 2, "price": 15000, "cost": 10000, "discount": 1000}],
            "paid_amount": 50000,
            "discount_percent": 10, "tax_percent": 11, "shipping": 5000,
            "price_level_id": "default",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["owner"], json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["subtotal"] == 29000, t
        assert t["item_discount"] == 1000
        assert t["global_discount"] == 2900
        assert t["tax_amount"] == 2871
        assert t["shipping"] == 5000
        assert t["total"] == 33971
        assert t["payment_method_label"] == "Tunai"
        assert t["payment_method"] == "pm_cash"

    def test_14_transaction_cash_insufficient_uses_grand_total(self, ctx):
        """Paid > subtotal but < grand_total should fail."""
        payload = {
            "transaction_type": "sale", "payment_method": "pm_cash",
            "payment_method_label": "Tunai",
            "items": [{"product_id": pytest.prod_id, "name": "TEST_Kopi Sachet",
                       "quantity": 1, "price": 15000, "cost": 10000, "discount": 0}],
            "paid_amount": 15000,  # equals subtotal but tax+ship make grand bigger
            "discount_percent": 0, "tax_percent": 11, "shipping": 5000,
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["owner"], json=payload)
        assert r.status_code == 400, r.text

    def test_15_transaction_credit_outstanding_grand_total(self, ctx):
        """
        qty 10 @ 15000 = 150000; discount_percent compute to reach grand_total=100000
        Simplify: subtotal 100000 (qty tweaks), paid 30000 -> outstanding = 70000.
        Use qty=10 price=10000 (override via item price): subtotal=100000, no discount/tax/ship -> grand=100000.
        """
        payload = {
            "transaction_type": "sale", "payment_method": "credit",
            "payment_method_label": "Kredit",
            "items": [{"product_id": pytest.prod_id, "name": "TEST_Kopi Sachet",
                       "quantity": 10, "price": 10000, "cost": 10000, "discount": 0}],
            "paid_amount": 30000,
            "customer_id": pytest.cust_id, "customer_name": "TEST_Grosir Boss",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["owner"], json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["total"] == 100000
        assert t["outstanding"] == 70000

    # ---------- Parked transactions ----------
    def test_16_parked_crud(self, ctx):
        payload = {
            "label": "Meja 3", "customer_name": "Umum", "price_level_id": "default",
            "items": [{"product_id": pytest.prod_id, "name": "TEST_Kopi Sachet",
                       "quantity": 2, "price": 15000, "cost": 10000,
                       "discount": 500, "unit": "pcs"}],
            "note": "No sugar", "discount_percent": 5, "tax_percent": 0, "shipping": 0,
        }
        # cashier allowed
        r = ctx["s"].post(f"{API}/parked", headers=ctx["cashier"], json=payload)
        assert r.status_code == 200, r.text
        parked = r.json()
        assert parked["label"] == "Meja 3"
        parked_id = parked["id"]

        # second parked (owner) for ordering check
        import time; time.sleep(0.05)
        payload2 = {**payload, "label": "Meja 4"}
        r2 = ctx["s"].post(f"{API}/parked", headers=ctx["owner"], json=payload2)
        assert r2.status_code == 200

        rl = ctx["s"].get(f"{API}/parked", headers=ctx["owner"])
        assert rl.status_code == 200
        rows = rl.json()
        assert len(rows) >= 2
        # created_at desc
        assert rows[0]["created_at"] >= rows[1]["created_at"]

        rd = ctx["s"].delete(f"{API}/parked/{parked_id}", headers=ctx["cashier"])
        assert rd.status_code == 200

    # ---------- Permission matrix ----------
    def test_17_cashier_cannot_create_category(self, ctx):
        r = ctx["s"].post(f"{API}/categories", headers=ctx["cashier"],
                          json={"name": "TEST_X", "icon": "cube-outline"})
        assert r.status_code == 403, r.text

    def test_18_cashier_cannot_create_payment_method(self, ctx):
        r = ctx["s"].post(f"{API}/payment-methods", headers=ctx["cashier"],
                          json={"name": "TEST_PM", "kind": "custom", "enabled": True})
        assert r.status_code == 403, r.text

    # ---------- Backup / Restore ----------
    def test_19_backup_version2_includes_new_collections(self, ctx):
        r = ctx["s"].get(f"{API}/backup", headers=ctx["owner"])
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("version") == 2
        for key in ("categories", "payment_methods", "parked_transactions", "settings",
                    "products", "transactions", "customers", "suppliers", "cash_entries"):
            assert key in b, f"backup missing {key}"
        assert isinstance(b["settings"], dict)
        assert isinstance(b["payment_methods"], list) and len(b["payment_methods"]) >= 3
        pytest.backup_payload = b

    def test_20_restore_owner_replaces_data(self, ctx):
        # Craft a minimal backup payload that only contains categories+payment_methods+settings
        # so we can see 'restored' stats and verify replace.
        payload = {
            "categories": [{"id": str(uuid.uuid4()), "name": "TEST_Restored_Cat",
                            "icon": "cube-outline", "created_at": "2026-01-01T00:00:00+00:00"}],
            "payment_methods": [
                {"id": "pm_cash", "name": "Tunai", "kind": "cash",
                 "enabled": True, "sort_order": 0, "qris_image_base64": None},
            ],
            "parked_transactions": [],
            "settings": {"tax_percent": 7, "tax_label": "PPN", "receipt_width": "80mm"},
        }
        r = ctx["s"].post(f"{API}/restore", headers=ctx["owner"], json=payload)
        assert r.status_code == 200, r.text
        stats = r.json()["restored"]
        assert stats.get("categories") == 1
        assert stats.get("payment_methods") == 1
        assert stats.get("parked_transactions") == 0
        assert stats.get("settings") == 1

        # Verify replace
        rc = ctx["s"].get(f"{API}/categories", headers=ctx["owner"])
        names = [c["name"] for c in rc.json()]
        assert "TEST_Restored_Cat" in names

        rp = ctx["s"].get(f"{API}/payment-methods", headers=ctx["owner"])
        ids = {p["id"] for p in rp.json()}
        # Only pm_cash should remain (restore replaced the collection)
        assert ids == {"pm_cash"}, ids

        rs = ctx["s"].get(f"{API}/settings", headers=ctx["owner"])
        s = rs.json()
        assert s["tax_percent"] == 7
        assert s["tax_label"] == "PPN"

    def test_21_restore_non_owner_forbidden(self, ctx):
        r = ctx["s"].post(f"{API}/restore", headers=ctx["cashier"], json={"categories": []})
        assert r.status_code == 403, r.text
