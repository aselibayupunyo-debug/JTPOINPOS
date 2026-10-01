import os
import uuid

import pytest
import requests


BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    username = f"test_{uuid.uuid4().hex[:10]}"
    response = s.post(f"{BASE_URL}/api/auth/register", json={
        "business_name": "TEST Business",
        "owner_name": "TEST Owner",
        "username": username,
        "password": "TestPass123!",
    }, timeout=20)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["user"]["username"] == username
    s.headers["Authorization"] = f"Bearer {payload['token']}"
    return s


def test_health_and_root():
    assert requests.get(f"{BASE_URL}/api/health", timeout=20).json()["status"] == "ok"
    assert requests.get(f"{BASE_URL}/api/", timeout=20).json()["status"] == "ready"


def test_product_create_list_search_and_no_mongo_id(session):
    response = session.post(f"{BASE_URL}/api/products", json={"name": "TEST Kopi", "price": 12000, "cost": 5000, "stock": 5, "barcode": "TEST123"}, timeout=20)
    assert response.status_code == 200
    product = response.json()
    assert product["name"] == "TEST Kopi" and "_id" not in product
    listed = session.get(f"{BASE_URL}/api/products?search=TEST123", timeout=20).json()
    assert any(p["id"] == product["id"] for p in listed)
    return product


def test_sale_updates_stock_and_report(session):
    product = session.post(f"{BASE_URL}/api/products", json={"name": "TEST Sale", "price": 10000, "cost": 4000, "stock": 3}, timeout=20).json()
    sale = session.post(f"{BASE_URL}/api/transactions", json={"payment_method": "cash", "paid_amount": 10000, "items": [{"product_id": product["id"], "name": product["name"], "quantity": 1, "price": 10000, "cost": 4000}]}, timeout=20)
    assert sale.status_code == 200 and "_id" not in sale.json()
    products = session.get(f"{BASE_URL}/api/products?search=TEST Sale", timeout=20).json()
    assert products[0]["stock"] == 2
    report = session.get(f"{BASE_URL}/api/reports/summary?period=daily", timeout=20).json()
    assert report["sales_total"] >= 10000 and report["gross_profit"] >= 6000


def test_insufficient_cash_and_stock_rejected(session):
    product = session.post(f"{BASE_URL}/api/products", json={"name": "TEST Limited", "price": 10000, "stock": 1}, timeout=20).json()
    payload = {"payment_method": "cash", "paid_amount": 1, "items": [{"product_id": product["id"], "name": product["name"], "quantity": 1, "price": 10000}]}
    assert session.post(f"{BASE_URL}/api/transactions", json=payload, timeout=20).status_code == 400
    payload["paid_amount"] = 10000
    payload["items"][0]["quantity"] = 2
    assert session.post(f"{BASE_URL}/api/transactions", json=payload, timeout=20).status_code == 400


def test_integrations_are_explicitly_unconfigured(session):
    data = session.get(f"{BASE_URL}/api/integrations/status", timeout=20).json()
    assert data["qris"]["configured"] is False
    assert data["whatsapp"]["configured"] is False
    assert data["bluetooth_printing"]["configured"] is False


def test_protected_products_without_token():
    assert requests.get(f"{BASE_URL}/api/products", timeout=20).status_code == 401