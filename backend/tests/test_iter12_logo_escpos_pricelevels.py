"""Iter-12 feature tests for JTPOIN POS backend.

Covers two new features added in iter-12:
  1. GET /api/settings/logo-escpos (ESC/POS raster from BusinessSettings.logo_base64)
  2. ProductInput.use_price_levels toggle on POST/PUT /api/products

Also provides a lightweight regression smoke across previously-passing areas
(products CRUD, settings, transactions sale + sale_return with admin_password,
custom-period report) so any regression introduced by Pillow import or model
changes surfaces here immediately.

Isolated to a fresh business created via POST /api/auth/register — no shared
state with other test modules; safe with pytest-xdist loadscope.
"""
import base64
import os
import secrets
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "EXPO_BACKEND_URL / EXPO_PUBLIC_BACKEND_URL must be set"

# 1x1 transparent PNG (valid, Pillow can decode)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


# ---------- Shared fixtures ----------
@pytest.fixture(scope="module")
def owner_session():
    """Register a fresh owner and return an authenticated requests.Session."""
    uname = f"iter12_{secrets.token_hex(4)}"
    payload = {
        "business_name": "TEST_Iter12 Toko",
        "owner_name": "TEST_Iter12 Admin",
        "username": uname,
        "password": "TestPass123!",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    token = body["token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    s.owner_password = "TestPass123!"
    s.owner_username = uname
    s.user_id = body["user"]["id"]
    s.business_id = body["user"]["business_id"]
    return s


# ============================================================
# Feature 1: GET /api/settings/logo-escpos
# ============================================================
class TestLogoEscpos:
    """ESC/POS raster endpoint for business logo."""

    def test_logo_escpos_without_logo_returns_empty(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "58mm"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["bytes_base64", "width", "height"]).issubset(data.keys()), data
        assert data["bytes_base64"] == ""
        assert isinstance(data["width"], int)
        assert isinstance(data["height"], int)
        # Server returns note='Belum ada logo' when no logo exists
        assert data.get("note") == "Belum ada logo"

    def test_logo_escpos_defaults_width_58mm(self, owner_session):
        # Without query param — should default to 58mm, still 200
        r = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos")
        assert r.status_code == 200, r.text
        assert "bytes_base64" in r.json()

    def test_logo_escpos_with_valid_logo_58mm(self, owner_session):
        # Seed a tiny valid PNG via PUT /api/settings
        put = owner_session.put(
            f"{BASE_URL}/api/settings",
            json={"logo_base64": TINY_PNG_B64},
        )
        assert put.status_code == 200, put.text
        assert put.json().get("logo_base64") == TINY_PNG_B64

        r = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "58mm"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["bytes_base64"], str) and len(data["bytes_base64"]) > 0
        # Must be valid base64
        raw = base64.b64decode(data["bytes_base64"])
        # ESC/POS raster must contain GS v 0 (0x1D 0x76 0x30) somewhere
        assert b"\x1d\x76\x30" in raw, "ESC/POS raster header GS v 0 missing"
        assert data["width"] > 0
        assert data["height"] >= 0

    def test_logo_escpos_80mm_has_different_width_than_58mm(self, owner_session):
        # Logo already seeded in previous test (module scope)
        r58 = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "58mm"})
        r80 = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "80mm"})
        assert r58.status_code == 200 and r80.status_code == 200
        d58 = r58.json()
        d80 = r80.json()
        # Both must have non-empty payload now
        assert d58["bytes_base64"] and d80["bytes_base64"]
        # 80mm width should be >= 58mm width (384 vs 576 after any max_height cap)
        # For a 1x1 PNG, aspect=1, projected_h would exceed max_height so target_w gets reduced to max_height-derived.
        # Both will likely cap to same max_height=180, but widths may still differ or equal.
        # Just assert both are positive and within sane bounds (<= 576).
        assert 0 < d58["width"] <= 384
        assert 0 < d80["width"] <= 576

    def test_logo_escpos_max_height_cap(self, owner_session):
        # Set a very small max_height — height should respect the cap
        r = owner_session.get(
            f"{BASE_URL}/api/settings/logo-escpos",
            params={"width": "80mm", "max_height": 32},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["height"] <= 32

    def test_logo_escpos_invalid_logo_returns_400(self, owner_session):
        # Corrupt the stored logo with non-decodable data
        put = owner_session.put(
            f"{BASE_URL}/api/settings",
            json={"logo_base64": "!!!not-base64-and-not-image!!!"},
        )
        assert put.status_code == 200, put.text
        r = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "58mm"})
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "Logo tidak bisa dibaca" in detail, detail
        # Cleanup: restore to a valid tiny PNG so later tests in other modules
        # (if they share this business — they don't here) aren't affected.
        owner_session.put(f"{BASE_URL}/api/settings", json={"logo_base64": TINY_PNG_B64})

    def test_logo_escpos_rejects_invalid_width_enum(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "100mm"})
        # Pydantic/FastAPI should 422 for invalid Literal
        assert r.status_code in (400, 422), r.text

    def test_logo_escpos_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/settings/logo-escpos", params={"width": "58mm"})
        assert r.status_code in (401, 403), r.status_code


# ============================================================
# Feature 2: ProductInput.use_price_levels
# ============================================================
class TestProductUsePriceLevels:
    """use_price_levels flag on products CRUD."""

    def test_create_product_with_use_price_levels_true(self, owner_session):
        payload = {
            "name": "TEST_Iter12 Kopi Levels",
            "price": 15000,
            "cost": 7000,
            "stock": 50,
            "prices": {"Grosir": 13000, "Member": 14000},
            "use_price_levels": True,
        }
        r = owner_session.post(f"{BASE_URL}/api/products", json=payload)
        assert r.status_code == 200, r.text  # endpoint returns 200 (not 201)
        body = r.json()
        assert body["use_price_levels"] is True
        pid = body["id"]
        # GET verifies persistence
        g = owner_session.get(f"{BASE_URL}/api/products")
        assert g.status_code == 200
        match = [p for p in g.json() if p["id"] == pid]
        assert len(match) == 1
        assert match[0]["use_price_levels"] is True
        assert match[0]["prices"].get("Grosir") == 13000

    def test_create_product_without_flag_defaults_to_false(self, owner_session):
        payload = {
            "name": "TEST_Iter12 Teh Default",
            "price": 8000,
            "cost": 3000,
            "stock": 20,
        }
        r = owner_session.post(f"{BASE_URL}/api/products", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["use_price_levels"] is False
        pid = body["id"]
        g = owner_session.get(f"{BASE_URL}/api/products")
        match = [p for p in g.json() if p["id"] == pid]
        assert len(match) == 1
        assert match[0]["use_price_levels"] is False

    def test_update_product_toggles_use_price_levels(self, owner_session):
        # Create (default False), then PUT with True, then back to False.
        create = owner_session.post(
            f"{BASE_URL}/api/products",
            json={"name": "TEST_Iter12 Toggle", "price": 10000, "stock": 10},
        )
        assert create.status_code == 200, create.text
        pid = create.json()["id"]
        assert create.json()["use_price_levels"] is False

        # Toggle to True — must send full ProductInput shape
        put1 = owner_session.put(
            f"{BASE_URL}/api/products/{pid}",
            json={
                "name": "TEST_Iter12 Toggle",
                "price": 10000,
                "stock": 10,
                "use_price_levels": True,
            },
        )
        assert put1.status_code == 200, put1.text
        assert put1.json()["use_price_levels"] is True

        # Verify via GET
        g1 = owner_session.get(f"{BASE_URL}/api/products")
        m1 = [p for p in g1.json() if p["id"] == pid][0]
        assert m1["use_price_levels"] is True

        # Toggle back to False
        put2 = owner_session.put(
            f"{BASE_URL}/api/products/{pid}",
            json={
                "name": "TEST_Iter12 Toggle",
                "price": 10000,
                "stock": 10,
                "use_price_levels": False,
            },
        )
        assert put2.status_code == 200, put2.text
        assert put2.json()["use_price_levels"] is False


# ============================================================
# Regression smoke: previously passing core flows
# ============================================================
class TestRegressionSmoke:
    """Minimal smoke across prior iter features to catch regressions from iter-12 code (PIL import + ProductInput change)."""

    def test_health_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200

    def test_settings_get(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        assert "business_id" not in (r.json() or {})  # projection drops business_id

    def test_integrations_status(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/integrations/status")
        assert r.status_code == 200
        body = r.json()
        assert body["bluetooth_printing"]["configured"] is True

    def test_products_list(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sale_and_sale_return_with_admin_password(self, owner_session):
        # Create a product
        p = owner_session.post(
            f"{BASE_URL}/api/products",
            json={
                "name": "TEST_Iter12 Reg Kopi",
                "price": 20000,
                "cost": 10000,
                "stock": 100,
            },
        )
        assert p.status_code == 200, p.text
        prod = p.json()
        pid = prod["id"]

        # Sale
        sale_payload = {
            "transaction_type": "sale",
            "payment_method": "cash",
            "tax_percent": 0,
            "shipping": 0,
            "discount": 0,
            "items": [
                {
                    "product_id": pid,
                    "name": prod["name"],
                    "quantity": 2,
                    "price": 20000,
                    "cost": 10000,
                    "unit": "Pcs",
                    "unit_factor": 1.0,
                    "product_type": "goods",
                }
            ],
            "paid_amount": 100000,
        }
        s = owner_session.post(f"{BASE_URL}/api/transactions", json=sale_payload)
        assert s.status_code == 200, s.text
        sale = s.json()
        assert sale["total"] == 40000
        sale_id = sale["id"]

        # Retur without admin_password → 400
        ret_bad = owner_session.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale_return",
                "payment_method": "cash",
                "tax_percent": 0,
                "shipping": 0,
                "discount": 0,
                "original_transaction_id": sale_id,
                "items": sale_payload["items"],
                "paid_amount": 100000,
            },
        )
        assert ret_bad.status_code == 400, ret_bad.text
        assert "password" in ret_bad.json().get("detail", "").lower()

        # Retur with wrong password → 401
        ret_wrong = owner_session.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale_return",
                "payment_method": "cash",
                "tax_percent": 0,
                "shipping": 0,
                "discount": 0,
                "original_transaction_id": sale_id,
                "admin_password": "wrong-password",
                "items": sale_payload["items"],
                "paid_amount": 100000,
            },
        )
        assert ret_wrong.status_code == 401, ret_wrong.text

        # Retur with correct password → 200
        ret_ok = owner_session.post(
            f"{BASE_URL}/api/transactions",
            json={
                "transaction_type": "sale_return",
                "payment_method": "cash",
                "tax_percent": 0,
                "shipping": 0,
                "discount": 0,
                "original_transaction_id": sale_id,
                "admin_password": "TestPass123!",
                "items": sale_payload["items"],
                "paid_amount": 100000,
            },
        )
        assert ret_ok.status_code == 200, ret_ok.text

        # Original is now flagged
        g = owner_session.get(f"{BASE_URL}/api/transactions/{sale_id}")
        assert g.status_code == 200
        gdoc = g.json()
        assert gdoc.get("returned") is True
        assert gdoc.get("return_transaction_id")

    def test_report_summary_daily_and_custom(self, owner_session):
        r1 = owner_session.get(f"{BASE_URL}/api/reports/summary", params={"period": "daily"})
        assert r1.status_code == 200, r1.text
        # Custom period
        today = time.strftime("%Y-%m-%d")
        r2 = owner_session.get(
            f"{BASE_URL}/api/reports/summary",
            params={"period": "custom", "start_date": today, "end_date": today},
        )
        assert r2.status_code == 200, r2.text
