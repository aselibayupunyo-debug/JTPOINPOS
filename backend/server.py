from fastapi import FastAPI, APIRouter, Depends, File, HTTPException, UploadFile, status
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
from jose import JWTError, jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import pandas as pd
from io import BytesIO


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.getenv("JWT_SECRET", "kasirku-local-development-secret")
JWT_ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class RegisterInput(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    owner_name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=128)


class LoginInput(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    id: str
    business_id: str
    business_name: str
    name: str
    username: str
    role: str
    permissions: List[str] = []


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class ProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sku: str = ""
    barcode: str = ""
    category: str = "Umum"
    price: int = Field(ge=0)
    cost: int = Field(default=0, ge=0)
    stock: int = Field(default=0, ge=0)
    min_stock: int = Field(default=5, ge=0)
    kitchen_print: bool = False
    image_base64: Optional[str] = None


class TransactionItem(BaseModel):
    product_id: str
    name: str
    quantity: int = Field(gt=0)
    price: int = Field(ge=0)
    cost: int = Field(default=0, ge=0)
    kitchen_print: bool = False


class TransactionInput(BaseModel):
    transaction_type: Literal["sale", "purchase", "purchase_return", "sale_return"] = "sale"
    payment_method: Literal["cash", "credit", "bank", "wallet", "qris"] = "cash"
    items: List[TransactionItem] = Field(min_length=1)
    paid_amount: int = Field(default=0, ge=0)
    customer_name: str = "Umum"
    note: str = ""


class CashEntryInput(BaseModel):
    entry_type: Literal["income", "expense"]
    amount: int = Field(gt=0)
    category: str = "Lainnya"
    note: str = ""


class OperatorInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=40)
    password: Optional[str] = Field(default=None, max_length=128)
    role: Literal["cashier", "inventory", "kitchen", "manager"] = "cashier"
    permissions: List[str] = []


class DebtPaymentInput(BaseModel):
    amount: int = Field(gt=0)
    note: str = ""


ALL_PERMISSIONS = ["sales", "purchases", "returns", "inventory", "reports", "cashflow", "debts", "operators", "settings"]
ROLE_PRESETS = {
    "owner": ALL_PERMISSIONS,
    "manager": ["sales", "purchases", "returns", "inventory", "reports", "cashflow", "debts"],
    "cashier": ["sales"],
    "inventory": ["inventory", "purchases"],
    "kitchen": [],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "business_id": user["business_id"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(days=14),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login diperlukan")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise JWTError()
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesi tidak valid") from exc
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pengguna tidak ditemukan")
    return user


def ensure_permission(user: dict, permission: str) -> None:
    if user["role"] == "owner":
        return
    allowed = user.get("permissions") or ROLE_PRESETS.get(user["role"], [])
    if permission not in allowed:
        raise HTTPException(status_code=403, detail=f"Kewenangan '{permission}' belum diaktifkan admin")


def public_user(user: dict) -> UserPublic:
    permissions = user.get("permissions") if user.get("permissions") else ROLE_PRESETS.get(user["role"], [])
    return UserPublic(
        id=user["id"], business_id=user["business_id"], business_name=user["business_name"],
        name=user["name"], username=user["username"], role=user["role"], permissions=permissions,
    )


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "KasirKu Pro API", "status": "ready"}


@api_router.get("/health")
async def health():
    await db.command("ping")
    return {"status": "ok", "service": "kasirku"}


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterInput):
    username = payload.username.strip().lower()
    if await db.users.find_one({"username": username}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    business_id = str(uuid.uuid4())
    user = {
        "id": str(uuid.uuid4()), "business_id": business_id,
        "business_name": payload.business_name.strip(), "name": payload.owner_name.strip(),
        "username": username, "role": "owner", "permissions": ALL_PERMISSIONS,
        "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return AuthResponse(token=make_token(user), user=public_user(user))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginInput):
    user = await db.users.find_one({"username": payload.username.strip().lower()}, {"_id": 0})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    return AuthResponse(token=make_token(user), user=public_user(user))


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(current_user)):
    return public_user(user)


# ---------- Products ----------
@api_router.get("/products")
async def products(search: str = "", user: dict = Depends(current_user)):
    query: dict[str, Any] = {"business_id": user["business_id"]}
    if search.strip():
        query["$or"] = [
            {"name": {"$regex": search.strip(), "$options": "i"}},
            {"barcode": {"$regex": search.strip(), "$options": "i"}},
            {"sku": {"$regex": search.strip(), "$options": "i"}},
        ]
    return await db.products.find(query, {"_id": 0, "business_id": 0}).sort("name", 1).to_list(5000)


@api_router.post("/products")
async def create_product(payload: ProductInput, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    product = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        **payload.model_dump(), "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.products.insert_one(product)
    return {k: v for k, v in product.items() if k not in {"business_id", "_id"}}


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, payload: ProductInput, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    result = await db.products.update_one(
        {"id": product_id, "business_id": user["business_id"]},
        {"$set": {**payload.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "business_id": 0})
    return product


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    result = await db.products.update_one(
        {"id": product_id, "business_id": user["business_id"]},
        {"$set": {"deleted_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"id": product_id, "business_id": user["business_id"]})
    return {"ok": True}


# ---------- Transactions ----------
@api_router.post("/transactions")
async def create_transaction(payload: TransactionInput, user: dict = Depends(current_user)):
    permission_map = {"sale": "sales", "purchase": "purchases", "sale_return": "returns", "purchase_return": "returns"}
    ensure_permission(user, permission_map[payload.transaction_type])
    product_ids = [item.product_id for item in payload.items]
    found = await db.products.find({"id": {"$in": product_ids}, "business_id": user["business_id"]}, {"_id": 0}).to_list(5000)
    by_id = {item["id"]: item for item in found}
    if len(by_id) != len(set(product_ids)):
        raise HTTPException(status_code=400, detail="Ada produk yang tidak ditemukan")
    total = sum(item.price * item.quantity for item in payload.items)
    if payload.transaction_type == "sale" and payload.payment_method == "cash" and payload.paid_amount < total:
        raise HTTPException(status_code=400, detail="Nominal tunai kurang dari total")
    # stock direction: sale/purchase_return decrease stock, purchase/sale_return increase stock
    direction = {"sale": -1, "purchase": 1, "purchase_return": -1, "sale_return": 1}[payload.transaction_type]
    if direction < 0:
        for item in payload.items:
            if by_id[item.product_id]["stock"] < item.quantity:
                raise HTTPException(status_code=400, detail=f"Stok {item.name} tidak mencukupi")
    for item in payload.items:
        await db.products.update_one(
            {"id": item.product_id, "business_id": user["business_id"]},
            {"$inc": {"stock": direction * item.quantity}},
        )
    outstanding = max(total - payload.paid_amount, 0) if payload.payment_method == "credit" else 0
    transaction = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        "invoice_no": f"{payload.transaction_type[:2].upper()}-{datetime.now().strftime('%y%m%d')}-{uuid.uuid4().hex[:5].upper()}",
        "transaction_type": payload.transaction_type, "payment_method": payload.payment_method,
        "items": [item.model_dump() for item in payload.items], "total": total,
        "paid_amount": payload.paid_amount, "outstanding": outstanding,
        "customer_name": payload.customer_name.strip() or "Umum",
        "note": payload.note, "created_at": now_iso(), "created_by": user["id"], "created_by_name": user["name"],
    }
    await db.transactions.insert_one(transaction)
    return {k: v for k, v in transaction.items() if k not in {"business_id", "_id"}}


@api_router.get("/transactions")
async def list_transactions(
    kind: Optional[Literal["sale", "purchase", "sale_return", "purchase_return"]] = None,
    limit: int = 100,
    user: dict = Depends(current_user),
):
    query: dict[str, Any] = {"business_id": user["business_id"]}
    if kind:
        query["transaction_type"] = kind
    return await db.transactions.find(query, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(max(min(limit, 500), 1))


@api_router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str, user: dict = Depends(current_user)):
    doc = await db.transactions.find_one(
        {"id": transaction_id, "business_id": user["business_id"]},
        {"_id": 0, "business_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    return doc


@api_router.get("/debts")
async def debts(kind: Literal["receivable", "payable"] = "receivable", user: dict = Depends(current_user)):
    ensure_permission(user, "debts")
    types = ["sale"] if kind == "receivable" else ["purchase"]
    docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": {"$in": types}, "payment_method": "credit", "outstanding": {"$gt": 0}},
        {"_id": 0, "business_id": 0},
    ).sort("created_at", -1).to_list(500)
    total = sum(doc.get("outstanding", 0) for doc in docs)
    return {"total": total, "items": docs}


@api_router.post("/transactions/{transaction_id}/pay")
async def pay_debt(transaction_id: str, payload: DebtPaymentInput, user: dict = Depends(current_user)):
    ensure_permission(user, "debts")
    doc = await db.transactions.find_one({"id": transaction_id, "business_id": user["business_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    outstanding = max(doc.get("outstanding", 0) - payload.amount, 0)
    await db.transactions.update_one(
        {"id": transaction_id, "business_id": user["business_id"]},
        {"$set": {"outstanding": outstanding, "updated_at": now_iso()},
         "$push": {"payments": {"amount": payload.amount, "note": payload.note, "at": now_iso()}}},
    )
    # also log cash entry
    entry_type = "income" if doc["transaction_type"] == "sale" else "expense"
    await db.cash_entries.insert_one({
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        "entry_type": entry_type, "amount": payload.amount,
        "category": "Pelunasan " + ("piutang" if entry_type == "income" else "hutang"),
        "note": f"{doc['invoice_no']} · {payload.note}".strip(" ·"),
        "created_at": now_iso(),
    })
    return {"outstanding": outstanding}


# ---------- Cash Entries ----------
@api_router.get("/cash-entries")
async def list_cash_entries(limit: int = 100, user: dict = Depends(current_user)):
    ensure_permission(user, "cashflow")
    return await db.cash_entries.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(max(min(limit, 500), 1))


@api_router.post("/cash-entries")
async def create_cash_entry(payload: CashEntryInput, user: dict = Depends(current_user)):
    ensure_permission(user, "cashflow")
    entry = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso(), "created_by": user["name"]}
    await db.cash_entries.insert_one(entry)
    return {k: v for k, v in entry.items() if k not in {"business_id", "_id"}}


# ---------- Operators ----------
@api_router.get("/operators")
async def operators(user: dict = Depends(current_user)):
    ensure_permission(user, "operators")
    return await db.users.find(
        {"business_id": user["business_id"], "role": {"$ne": "owner"}},
        {"_id": 0, "password_hash": 0, "business_id": 0},
    ).sort("name", 1).to_list(200)


@api_router.post("/operators")
async def create_operator(payload: OperatorInput, user: dict = Depends(current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang dapat mengatur operator")
    username = payload.username.strip().lower()
    if await db.users.find_one({"username": username}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password operator minimal 6 karakter")
    permissions = payload.permissions or ROLE_PRESETS.get(payload.role, [])
    operator = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"], "business_name": user["business_name"],
        "name": payload.name.strip(), "username": username, "role": payload.role,
        "permissions": permissions,
        "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": now_iso(),
    }
    await db.users.insert_one(operator)
    return {k: v for k, v in operator.items() if k not in {"_id", "business_id", "password_hash"}}


@api_router.put("/operators/{operator_id}")
async def update_operator(operator_id: str, payload: OperatorInput, user: dict = Depends(current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang dapat mengatur operator")
    update = {
        "name": payload.name.strip(), "role": payload.role,
        "permissions": payload.permissions or ROLE_PRESETS.get(payload.role, []),
    }
    if payload.password and payload.password.strip():
        update["password_hash"] = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    result = await db.users.update_one(
        {"id": operator_id, "business_id": user["business_id"], "role": {"$ne": "owner"}},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Operator tidak ditemukan")
    return {"ok": True}


@api_router.delete("/operators/{operator_id}")
async def delete_operator(operator_id: str, user: dict = Depends(current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang dapat mengatur operator")
    result = await db.users.delete_one({"id": operator_id, "business_id": user["business_id"], "role": {"$ne": "owner"}})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Operator tidak ditemukan")
    return {"ok": True}


@api_router.get("/permissions")
async def list_permissions():
    return {"permissions": ALL_PERMISSIONS, "presets": ROLE_PRESETS}


# ---------- Reports ----------
@api_router.get("/reports/summary")
async def report_summary(period: Literal["daily", "monthly", "yearly"] = "daily", user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc)
    if period == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "monthly":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    docs = await db.transactions.find(
        {"business_id": user["business_id"], "created_at": {"$gte": start.isoformat()}},
        {"_id": 0, "business_id": 0},
    ).to_list(10000)
    cash_entries = await db.cash_entries.find(
        {"business_id": user["business_id"], "created_at": {"$gte": start.isoformat()}},
        {"_id": 0, "business_id": 0},
    ).to_list(10000)
    sales = [d for d in docs if d["transaction_type"] == "sale"]
    sale_returns = [d for d in docs if d["transaction_type"] == "sale_return"]
    purchases = [d for d in docs if d["transaction_type"] == "purchase"]
    purchase_returns = [d for d in docs if d["transaction_type"] == "purchase_return"]
    products_data = await db.products.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(5000)
    receivable_docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "sale", "payment_method": "credit", "outstanding": {"$gt": 0}},
        {"_id": 0},
    ).to_list(2000)
    payable_docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "purchase", "payment_method": "credit", "outstanding": {"$gt": 0}},
        {"_id": 0},
    ).to_list(2000)
    sales_total = sum(d["total"] for d in sales) - sum(d["total"] for d in sale_returns)
    purchase_total = sum(d["total"] for d in purchases) - sum(d["total"] for d in purchase_returns)
    gross_profit = sum(sum((i["price"] - i.get("cost", 0)) * i["quantity"] for i in d["items"]) for d in sales)
    cash_in = sum(d["total"] for d in sales if d["payment_method"] == "cash") + sum(e["amount"] for e in cash_entries if e["entry_type"] == "income")
    cash_out = sum(d["total"] for d in purchases if d["payment_method"] == "cash") + sum(e["amount"] for e in cash_entries if e["entry_type"] == "expense")
    return {
        "period": period,
        "sales_total": sales_total,
        "purchase_total": purchase_total,
        "transaction_count": len(sales),
        "gross_profit": gross_profit,
        "receivable": sum(d.get("outstanding", 0) for d in receivable_docs),
        "payable": sum(d.get("outstanding", 0) for d in payable_docs),
        "low_stock": len([p for p in products_data if p["stock"] <= p.get("min_stock", 5)]),
        "cash_balance": cash_in - cash_out,
        "cash_in": cash_in,
        "cash_out": cash_out,
    }


# ---------- Backup / Import ----------
@api_router.get("/backup")
async def backup(user: dict = Depends(current_user)):
    products_data = await db.products.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    transactions_data = await db.transactions.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    cash_data = await db.cash_entries.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    return {"exported_at": now_iso(), "business_name": user["business_name"], "products": products_data, "transactions": transactions_data, "cash_entries": cash_data}


@api_router.post("/products/import")
async def import_products(file: UploadFile = File(...), user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    raw = await file.read()
    try:
        if file.filename and file.filename.lower().endswith(".csv"):
            frame = pd.read_csv(BytesIO(raw))
        else:
            frame = pd.read_excel(BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="File tidak dapat dibaca. Gunakan kolom nama, harga, modal, stok.") from exc
    columns = {str(c).strip().lower(): c for c in frame.columns}
    name_column = columns.get("nama") or columns.get("name")
    if not name_column:
        raise HTTPException(status_code=400, detail="Kolom 'nama' wajib tersedia")
    imported = 0
    for row in frame.to_dict(orient="records"):
        name_value = str(row.get(name_column, "")).strip()
        if not name_value or name_value.lower() == "nan":
            continue

        def number(*keys: str, default: int = 0) -> int:
            for key in keys:
                if key in columns:
                    value = row.get(columns[key], default)
                    try:
                        return int(float(value))
                    except (TypeError, ValueError):
                        return default
            return default

        product = {
            "id": str(uuid.uuid4()), "business_id": user["business_id"], "name": name_value,
            "sku": str(row.get(columns.get("sku", ""), "") or ""),
            "barcode": str(row.get(columns.get("barcode", ""), "") or ""),
            "category": str(row.get(columns.get("kategori", ""), "Umum") or "Umum"),
            "price": number("harga", "price"),
            "cost": number("modal", "pokok", "cost"),
            "stock": number("stok", "stock"),
            "min_stock": number("minimum", "min_stock", default=5),
            "kitchen_print": False, "image_base64": None,
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        await db.products.insert_one(product)
        imported += 1
    return {"imported": imported}


# ---------- Settings & Integrations ----------
class BusinessSettingsInput(BaseModel):
    business_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    footer_note: Optional[str] = None
    logo_base64: Optional[str] = None
    receipt_width: Literal["58mm", "80mm"] = "58mm"
    whatsapp_number: Optional[str] = None


@api_router.get("/settings")
async def get_settings(user: dict = Depends(current_user)):
    doc = await db.business_settings.find_one({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0})
    if not doc:
        doc = {"business_name": user["business_name"], "address": "", "phone": "", "footer_note": "Terima kasih atas kunjungan Anda", "logo_base64": None, "receipt_width": "58mm", "whatsapp_number": ""}
    return doc


@api_router.put("/settings")
async def update_settings(payload: BusinessSettingsInput, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    await db.business_settings.update_one(
        {"business_id": user["business_id"]},
        {"$set": update, "$setOnInsert": {"business_id": user["business_id"], "created_at": now_iso()}},
        upsert=True,
    )
    if update.get("business_name"):
        await db.users.update_many({"business_id": user["business_id"]}, {"$set": {"business_name": update["business_name"]}})
    doc = await db.business_settings.find_one({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0})
    return doc


@api_router.get("/integrations/status")
async def integrations_status(user: dict = Depends(current_user)):
    return {
        "qris": {"configured": os.getenv("QRIS_MODE", "disabled") == "enabled", "label": "QRIS"},
        "whatsapp": {"configured": bool(os.getenv("META_ACCESS_TOKEN")), "label": "WhatsApp Cloud API"},
        "bluetooth_printing": {"configured": False, "label": "Printer Bluetooth / ESC-POS", "note": "Aktif pada build Android produksi"},
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
