from fastapi import FastAPI, APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
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
    product_type: Literal["goods", "service"] = "goods"
    base_unit: str = "Pcs"
    price: int = Field(ge=0)
    cost: int = Field(default=0, ge=0)
    prices: dict[str, int] = Field(default_factory=dict)
    units: List[dict[str, Any]] = Field(default_factory=list)
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
    discount: int = Field(default=0, ge=0)
    unit: str = ""
    unit_factor: float = 1.0
    product_type: Literal["goods", "service"] = "goods"
    kitchen_print: bool = False


class TransactionInput(BaseModel):
    transaction_type: Literal["sale", "purchase", "purchase_return", "sale_return"] = "sale"
    payment_method: str = "cash"
    payment_method_label: str = "Tunai"
    items: List[TransactionItem] = Field(min_length=1)
    paid_amount: int = Field(default=0, ge=0)
    customer_name: str = "Umum"
    customer_id: Optional[str] = None
    supplier_id: Optional[str] = None
    price_level_id: str = "default"
    discount_percent: float = Field(default=0, ge=0, le=100)
    discount_amount: int = Field(default=0, ge=0)
    tax_percent: float = Field(default=0, ge=0, le=100)
    shipping: int = Field(default=0, ge=0)
    shift_id: Optional[str] = None
    promo_ids: List[str] = Field(default_factory=list)
    note: str = ""


class ParkedTransactionInput(BaseModel):
    label: str = ""
    customer_name: str = Field(min_length=1, max_length=120)
    customer_id: Optional[str] = None
    price_level_id: str = "default"
    items: List[TransactionItem]
    note: str = ""
    discount_percent: float = 0
    discount_amount: int = 0
    tax_percent: float = 0
    shipping: int = 0


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    icon: str = "cube-outline"


class PaymentMethodInput(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    kind: Literal["cash", "credit", "qris_static", "custom"] = "custom"
    qris_image_base64: Optional[str] = None
    enabled: bool = True
    sort_order: int = 0


class PromoCondition(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)


class PromoReward(BaseModel):
    kind: Literal["free_item", "percent_discount", "fixed_price"] = "free_item"
    product_id: Optional[str] = None
    quantity: int = 1
    percent: float = 0
    fixed_price: int = 0


class PromoInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["buy_x_get_y", "bundle", "percent"] = "buy_x_get_y"
    conditions: List[PromoCondition] = Field(min_length=1)
    reward: PromoReward
    active: bool = True
    note: str = ""


class ShiftOpenInput(BaseModel):
    opening_cash: int = Field(default=0, ge=0)
    note: str = ""


class ShiftCloseInput(BaseModel):
    closing_cash: int = Field(default=0, ge=0)
    note: str = ""


class ContactInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = ""
    address: str = ""
    note: str = ""
    price_level_id: str = "default"


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
    payment_method: str = "cash"
    payment_method_label: Optional[str] = None
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
    # stock direction: sale/purchase_return decrease stock, purchase/sale_return increase stock
    direction = {"sale": -1, "purchase": 1, "purchase_return": -1, "sale_return": 1}[payload.transaction_type]

    def _is_service(item: TransactionItem) -> bool:
        if item.product_type == "service":
            return True
        prod = by_id.get(item.product_id, {})
        return prod.get("product_type") == "service"

    def _stock_delta(item: TransactionItem) -> int:
        # convert sold quantity into base units via unit_factor
        factor = max(item.unit_factor or 1.0, 0.000001)
        return int(round(item.quantity * factor))

    if direction < 0:
        for item in payload.items:
            if _is_service(item):
                continue
            needed = _stock_delta(item)
            if by_id[item.product_id].get("stock", 0) < needed:
                raise HTTPException(status_code=400, detail=f"Stok {item.name} tidak mencukupi")
    # Resolve payment method id to its "kind" (cash/credit/qris_static/custom) for math + validation
    kind = payload.payment_method
    if payload.payment_method not in {"cash", "credit", "qris_static", "custom"}:
        pm_doc = await db.payment_methods.find_one({"id": payload.payment_method, "business_id": user["business_id"]}, {"_id": 0, "kind": 1})
        kind = (pm_doc or {}).get("kind", payload.payment_method)
    # recompute totals with discount/tax/shipping
    item_discount_total = sum(item.discount for item in payload.items)
    subtotal = total - item_discount_total
    global_discount = payload.discount_amount + int(round(subtotal * payload.discount_percent / 100))
    after_discount = max(subtotal - global_discount, 0)
    tax_amount = int(round(after_discount * payload.tax_percent / 100))
    grand_total = after_discount + tax_amount + payload.shipping
    if payload.transaction_type == "sale" and kind == "cash" and payload.paid_amount < grand_total:
        raise HTTPException(status_code=400, detail="Nominal tunai kurang dari total")
    # Apply stock change AFTER validation (skip services)
    for item in payload.items:
        if _is_service(item):
            continue
        delta = _stock_delta(item)
        await db.products.update_one(
            {"id": item.product_id, "business_id": user["business_id"]},
            {"$inc": {"stock": direction * delta}},
        )
    outstanding = max(grand_total - payload.paid_amount, 0) if kind == "credit" else 0
    transaction = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        "invoice_no": f"{payload.transaction_type[:2].upper()}-{datetime.now().strftime('%y%m%d')}-{uuid.uuid4().hex[:5].upper()}",
        "transaction_type": payload.transaction_type, "payment_method": payload.payment_method,
        "payment_method_label": payload.payment_method_label,
        "items": [item.model_dump() for item in payload.items],
        "subtotal": subtotal, "item_discount": item_discount_total,
        "discount_percent": payload.discount_percent, "discount_amount": payload.discount_amount,
        "global_discount": global_discount,
        "tax_percent": payload.tax_percent, "tax_amount": tax_amount,
        "shipping": payload.shipping,
        "total": grand_total,
        "paid_amount": payload.paid_amount, "outstanding": outstanding,
        "customer_name": payload.customer_name.strip() or "Umum",
        "customer_id": payload.customer_id, "supplier_id": payload.supplier_id,
        "price_level_id": payload.price_level_id,
        "shift_id": payload.shift_id,
        "promo_ids": payload.promo_ids,
        "status": "active",
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


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    username: Optional[str] = Field(default=None, min_length=3, max_length=40)
    current_password: str = Field(min_length=1)
    new_password: Optional[str] = Field(default=None, min_length=6, max_length=120)


@api_router.put("/profile")
async def update_profile(payload: ProfileUpdate, user: dict = Depends(current_user)):
    """Update owner profile: name, username, and/or password. Current password required."""
    me = await db.users.find_one({"id": user["id"]})
    if not me:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan")
    if not bcrypt.checkpw(payload.current_password.encode(), me["password_hash"].encode()):
        raise HTTPException(status_code=400, detail="Password saat ini salah")
    patch: dict[str, Any] = {}
    if payload.name and payload.name.strip():
        patch["name"] = payload.name.strip()
    if payload.username and payload.username.strip() and payload.username.strip() != me.get("username"):
        new_un = payload.username.strip().lower()
        clash = await db.users.find_one({"username": new_un, "id": {"$ne": user["id"]}})
        if clash:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")
        patch["username"] = new_un
    if payload.new_password:
        patch["password_hash"] = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    if not patch:
        return {"ok": True, "message": "Tidak ada perubahan"}
    await db.users.update_one({"id": user["id"]}, {"$set": patch})
    return {"ok": True}


async def _write_audit(business_id: str, actor_id: str, actor_name: str, action: str, details: dict[str, Any] | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "business_id": business_id,
        "actor_id": actor_id,
        "actor_name": actor_name,
        "action": action,
        "details": details or {},
        "created_at": now_iso(),
    })


class AdminPasswordInput(BaseModel):
    password: str = Field(min_length=1)


async def _require_owner_password(payload: AdminPasswordInput, user: dict) -> None:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang boleh melakukan aksi ini")
    me = await db.users.find_one({"id": user["id"]})
    if not me or not bcrypt.checkpw(payload.password.encode(), me["password_hash"].encode()):
        raise HTTPException(status_code=400, detail="Password pemilik salah")


@api_router.post("/admin/reset-transactions")
async def admin_reset_transactions(payload: AdminPasswordInput, user: dict = Depends(current_user)):
    """Dangerous: delete all transactions (sale/purchase/returns), parked, cashflow, shifts.
    Products, categories, customers, suppliers, settings tetap. Verified by owner password."""
    await _require_owner_password(payload, user)
    biz = user["business_id"]
    results = {
        "transactions": (await db.transactions.delete_many({"business_id": biz})).deleted_count,
        "parked": (await db.parked_transactions.delete_many({"business_id": biz})).deleted_count,
        "cashflow": (await db.cash_entries.delete_many({"business_id": biz})).deleted_count,
        "shifts": (await db.shifts.delete_many({"business_id": biz})).deleted_count,
    }
    await _write_audit(biz, user["id"], user["name"], "reset_transactions", results)
    return {"ok": True, "deleted": results}


@api_router.post("/admin/delete-all-products")
async def admin_delete_all_products(payload: AdminPasswordInput, user: dict = Depends(current_user)):
    """Dangerous: delete all products in business. Verified by owner password."""
    await _require_owner_password(payload, user)
    biz = user["business_id"]
    count = (await db.products.delete_many({"business_id": biz})).deleted_count
    await _write_audit(biz, user["id"], user["name"], "delete_all_products", {"deleted": count})
    return {"ok": True, "deleted": count}


@api_router.get("/audit-logs")
async def list_audit_logs(limit: int = 100, user: dict = Depends(current_user)):
    """Owner-only. Returns recent admin actions (reset, delete-all, role changes)."""
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang boleh melihat log audit")
    docs = await db.audit_logs.find(
        {"business_id": user["business_id"]},
        {"_id": 0, "business_id": 0},
    ).sort("created_at", -1).to_list(max(min(limit, 500), 1))
    return docs




class CancelInput(BaseModel):
    reason: str = ""


@api_router.post("/transactions/{transaction_id}/cancel")
async def cancel_transaction(transaction_id: str, payload: CancelInput, user: dict = Depends(current_user)):
    doc = await db.transactions.find_one({"id": transaction_id, "business_id": user["business_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if doc.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Transaksi sudah dibatalkan")
    permission_map = {"sale": "sales", "purchase": "purchases", "sale_return": "returns", "purchase_return": "returns"}
    ensure_permission(user, permission_map.get(doc.get("transaction_type", "sale"), "sales"))
    # Reverse stock
    reverse_direction = {"sale": 1, "purchase": -1, "purchase_return": 1, "sale_return": -1}.get(doc.get("transaction_type", "sale"), 0)
    for item in doc.get("items", []):
        if item.get("product_type") == "service":
            continue
        factor = float(item.get("unit_factor", 1.0) or 1.0)
        delta = int(round(item.get("quantity", 0) * max(factor, 0.000001)))
        if delta == 0:
            continue
        await db.products.update_one(
            {"id": item["product_id"], "business_id": user["business_id"]},
            {"$inc": {"stock": reverse_direction * delta}},
        )
    await db.transactions.update_one(
        {"id": transaction_id, "business_id": user["business_id"]},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso(), "cancelled_by": user["name"], "cancel_reason": payload.reason, "outstanding": 0}},
    )
    return {"ok": True}



@api_router.get("/debts")
async def debts(kind: Literal["receivable", "payable"] = "receivable", user: dict = Depends(current_user)):
    ensure_permission(user, "debts")
    types = ["sale"] if kind == "receivable" else ["purchase"]
    docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": {"$in": types}, "outstanding": {"$gt": 0}, "status": {"$ne": "cancelled"}},
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
    payment_id = str(uuid.uuid4())
    payment_entry = {
        "id": payment_id,
        "amount": payload.amount,
        "payment_method": payload.payment_method,
        "payment_method_label": payload.payment_method_label or payload.payment_method,
        "note": payload.note,
        "at": now_iso(),
        "received_by": user["name"],
    }
    await db.transactions.update_one(
        {"id": transaction_id, "business_id": user["business_id"]},
        {"$set": {"outstanding": outstanding, "updated_at": now_iso()},
         "$push": {"payments": payment_entry}},
    )
    # also log cash entry
    entry_type = "income" if doc["transaction_type"] == "sale" else "expense"
    await db.cash_entries.insert_one({
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        "entry_type": entry_type, "amount": payload.amount,
        "category": "Pelunasan " + ("piutang" if entry_type == "income" else "hutang"),
        "payment_method": payload.payment_method,
        "note": f"{doc['invoice_no']} · {payload.payment_method_label or payload.payment_method} · {payload.note}".strip(" ·"),
        "created_at": now_iso(),
    })
    return {"outstanding": outstanding, "payment_id": payment_id, "payment": payment_entry}


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
        {"business_id": user["business_id"], "created_at": {"$gte": start.isoformat()}, "status": {"$ne": "cancelled"}},
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
        {"business_id": user["business_id"], "transaction_type": "sale", "outstanding": {"$gt": 0}, "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(2000)
    payable_docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "purchase", "outstanding": {"$gt": 0}, "status": {"$ne": "cancelled"}},
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
    bid = user["business_id"]
    projection = {"_id": 0, "business_id": 0}
    products_data = await db.products.find({"business_id": bid}, projection).to_list(100000)
    transactions_data = await db.transactions.find({"business_id": bid}, projection).to_list(100000)
    cash_data = await db.cash_entries.find({"business_id": bid}, projection).to_list(100000)
    customers_data = await db.customers.find({"business_id": bid}, projection).to_list(100000)
    suppliers_data = await db.suppliers.find({"business_id": bid}, projection).to_list(100000)
    categories_data = await db.categories.find({"business_id": bid}, projection).to_list(5000)
    payment_methods_data = await db.payment_methods.find({"business_id": bid}, projection).to_list(500)
    parked_data = await db.parked_transactions.find({"business_id": bid}, projection).to_list(5000)
    settings_data = await db.business_settings.find_one({"business_id": bid}, projection) or {}
    return {
        "exported_at": now_iso(), "business_name": user["business_name"], "version": 2,
        "products": products_data, "transactions": transactions_data, "cash_entries": cash_data,
        "customers": customers_data, "suppliers": suppliers_data, "categories": categories_data,
        "payment_methods": payment_methods_data, "parked_transactions": parked_data, "settings": settings_data,
    }


@api_router.post("/restore")
async def restore_backup(payload: dict[str, Any], user: dict = Depends(current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang dapat memulihkan data")
    bid = user["business_id"]
    collections = {
        "products": db.products, "transactions": db.transactions, "cash_entries": db.cash_entries,
        "customers": db.customers, "suppliers": db.suppliers, "categories": db.categories,
        "payment_methods": db.payment_methods, "parked_transactions": db.parked_transactions,
    }
    stats: dict[str, int] = {}
    for key, coll in collections.items():
        rows = payload.get(key, [])
        if not isinstance(rows, list):
            continue
        await coll.delete_many({"business_id": bid})
        if rows:
            for row in rows:
                row["business_id"] = bid
                row.pop("_id", None)
            await coll.insert_many(rows)
        stats[key] = len(rows)
    settings = payload.get("settings")
    if isinstance(settings, dict):
        settings = {k: v for k, v in settings.items() if k != "_id"}
        settings["business_id"] = bid
        settings["restored_at"] = now_iso()
        await db.business_settings.update_one({"business_id": bid}, {"$set": settings}, upsert=True)
        stats["settings"] = 1
    return {"restored": stats}


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
    header_lines: List[str] = Field(default_factory=list, max_length=4)
    footer_lines: List[str] = Field(default_factory=list, max_length=4)
    logo_base64: Optional[str] = None
    receipt_width: Literal["58mm", "80mm"] = "58mm"
    whatsapp_number: Optional[str] = None
    qris_static_image: Optional[str] = None
    cashdrawer_enabled: bool = False
    multi_printer: bool = False
    tax_percent: float = 0
    tax_label: str = "Pajak"
    shipping_default: int = 0
    allow_price_edit: bool = True
    auto_park_on_cancel: bool = False
    confirm_cancel: bool = True
    price_levels: List[dict[str, str]] = Field(default_factory=lambda: [{"id": "default", "name": "Harga Jual"}])
    enabled_payment_kinds: List[str] = Field(default_factory=lambda: ["cash", "credit"])
    email_recipient: str = ""

    @classmethod
    def _strip_empty(cls, value: List[str]) -> List[str]:
        return [v.strip() for v in (value or []) if v and v.strip()][:4]

    def model_post_init(self, __context: Any) -> None:  # type: ignore[override]
        object.__setattr__(self, "header_lines", self._strip_empty(self.header_lines))
        object.__setattr__(self, "footer_lines", self._strip_empty(self.footer_lines))


@api_router.get("/settings")
async def get_settings(user: dict = Depends(current_user)):
    doc = await db.business_settings.find_one({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0})
    if not doc:
        doc = {}
    defaults = {
        "business_name": user["business_name"], "address": "", "phone": "",
        "footer_note": "Terima kasih atas kunjungan Anda", "logo_base64": None,
        "header_lines": [], "footer_lines": [],
        "receipt_width": "58mm", "whatsapp_number": "", "qris_static_image": None,
        "cashdrawer_enabled": False, "multi_printer": False,
        "tax_percent": 0, "tax_label": "Pajak", "shipping_default": 0,
        "allow_price_edit": True, "auto_park_on_cancel": False, "confirm_cancel": True,
        "price_levels": [{"id": "default", "name": "Harga Jual"}],
        "enabled_payment_kinds": ["cash", "credit"],
        "email_recipient": "",
    }
    for k, v in defaults.items():
        doc.setdefault(k, v)
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


# ---------- Customers & Suppliers ----------
async def _list_contacts(collection: str, user: dict, search: str = ""):
    query: dict[str, Any] = {"business_id": user["business_id"]}
    if search.strip():
        query["$or"] = [
            {"name": {"$regex": search.strip(), "$options": "i"}},
            {"phone": {"$regex": search.strip(), "$options": "i"}},
        ]
    docs = await db[collection].find(query, {"_id": 0, "business_id": 0}).sort("name", 1).to_list(5000)
    key_field = "customer_id" if collection == "customers" else "supplier_id"
    tx_filter = "sale" if collection == "customers" else "purchase"
    tx_docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": tx_filter, key_field: {"$in": [d["id"] for d in docs]}},
        {"_id": 0, key_field: 1, "total": 1, "outstanding": 1, "payment_method": 1},
    ).to_list(50000)
    stats: dict[str, dict[str, int]] = {}
    for tx in tx_docs:
        cid = tx.get(key_field)
        if not cid:
            continue
        bucket = stats.setdefault(cid, {"count": 0, "spent": 0, "outstanding": 0})
        bucket["count"] += 1
        bucket["spent"] += tx.get("total", 0)
        bucket["outstanding"] += tx.get("outstanding", 0)
    for d in docs:
        s = stats.get(d["id"], {"count": 0, "spent": 0, "outstanding": 0})
        d["transaction_count"] = s["count"]
        d["total_spent"] = s["spent"]
        d["outstanding"] = s["outstanding"]
    return docs


@api_router.get("/customers")
async def list_customers(search: str = "", user: dict = Depends(current_user)):
    return await _list_contacts("customers", user, search)


@api_router.post("/customers")
async def create_customer(payload: ContactInput, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso()}
    await db.customers.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"business_id", "_id"}}


@api_router.put("/customers/{customer_id}")
async def update_customer(customer_id: str, payload: ContactInput, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    result = await db.customers.update_one(
        {"id": customer_id, "business_id": user["business_id"]},
        {"$set": {**payload.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    return await db.customers.find_one({"id": customer_id}, {"_id": 0, "business_id": 0})


@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    result = await db.customers.delete_one({"id": customer_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    return {"ok": True}


@api_router.get("/suppliers")
async def list_suppliers(search: str = "", user: dict = Depends(current_user)):
    return await _list_contacts("suppliers", user, search)


@api_router.post("/suppliers")
async def create_supplier(payload: ContactInput, user: dict = Depends(current_user)):
    ensure_permission(user, "purchases")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso()}
    await db.suppliers.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"business_id", "_id"}}


@api_router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, payload: ContactInput, user: dict = Depends(current_user)):
    ensure_permission(user, "purchases")
    result = await db.suppliers.update_one(
        {"id": supplier_id, "business_id": user["business_id"]},
        {"$set": {**payload.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    return await db.suppliers.find_one({"id": supplier_id}, {"_id": 0, "business_id": 0})


@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "purchases")
    result = await db.suppliers.delete_one({"id": supplier_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    return {"ok": True}


# ---------- Detailed Reports ----------
def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "daily":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


@api_router.get("/reports/products")
async def report_products(period: Literal["daily", "monthly", "yearly"] = "monthly", user: dict = Depends(current_user)):
    ensure_permission(user, "reports")
    start = _period_start(period)
    sales = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "sale", "created_at": {"$gte": start.isoformat()}, "status": {"$ne": "cancelled"}},
        {"_id": 0, "items": 1},
    ).to_list(10000)
    buckets: dict[str, dict[str, Any]] = {}
    for tx in sales:
        for item in tx.get("items", []):
            pid = item["product_id"]
            b = buckets.setdefault(pid, {"product_id": pid, "name": item["name"], "quantity": 0, "revenue": 0, "profit": 0})
            b["quantity"] += item["quantity"]
            b["revenue"] += item["price"] * item["quantity"]
            b["profit"] += (item["price"] - item.get("cost", 0)) * item["quantity"]
    rows = sorted(buckets.values(), key=lambda r: r["profit"], reverse=True)
    return {"period": period, "rows": rows}


@api_router.get("/reports/customers")
async def report_customers(period: Literal["daily", "monthly", "yearly"] = "monthly", user: dict = Depends(current_user)):
    ensure_permission(user, "reports")
    start = _period_start(period)
    sales = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "sale", "created_at": {"$gte": start.isoformat()}, "status": {"$ne": "cancelled"}},
        {"_id": 0, "customer_id": 1, "customer_name": 1, "total": 1, "outstanding": 1, "payment_method": 1, "items": 1},
    ).to_list(50000)
    buckets: dict[str, dict[str, Any]] = {}
    for tx in sales:
        key = tx.get("customer_id") or f"name:{tx.get('customer_name', 'Umum')}"
        b = buckets.setdefault(key, {"customer_id": tx.get("customer_id"), "customer_name": tx.get("customer_name", "Umum"), "transaction_count": 0, "total_spent": 0, "outstanding": 0, "profit": 0})
        b["transaction_count"] += 1
        b["total_spent"] += tx.get("total", 0)
        b["outstanding"] += tx.get("outstanding", 0)
        for item in tx.get("items", []):
            b["profit"] += (item["price"] - item.get("cost", 0)) * item["quantity"]
    rows = sorted(buckets.values(), key=lambda r: r["total_spent"], reverse=True)
    return {"period": period, "rows": rows}


@api_router.get("/reports/operators")
async def report_operators(period: Literal["daily", "monthly", "yearly"] = "monthly", user: dict = Depends(current_user)):
    ensure_permission(user, "reports")
    start = _period_start(period)
    docs = await db.transactions.find(
        {"business_id": user["business_id"], "transaction_type": "sale", "created_at": {"$gte": start.isoformat()}, "status": {"$ne": "cancelled"}},
        {"_id": 0, "created_by": 1, "created_by_name": 1, "total": 1, "items": 1},
    ).to_list(50000)
    buckets: dict[str, dict[str, Any]] = {}
    for tx in docs:
        key = tx.get("created_by") or "-"
        b = buckets.setdefault(key, {"operator_id": tx.get("created_by"), "name": tx.get("created_by_name", "-"), "transaction_count": 0, "total_sales": 0, "profit": 0})
        b["transaction_count"] += 1
        b["total_sales"] += tx.get("total", 0)
        for item in tx.get("items", []):
            b["profit"] += (item["price"] - item.get("cost", 0)) * item["quantity"]
    rows = sorted(buckets.values(), key=lambda r: r["total_sales"], reverse=True)
    return {"period": period, "rows": rows}


@api_router.get("/reports/sales-items")
async def report_sales_items(
    period: Literal["daily", "monthly", "yearly"] = "monthly",
    operator_id: Optional[str] = None,
    product_id: Optional[str] = None,
    user: dict = Depends(current_user),
):
    """Flat list of sold items with invoice number, date/time, operator & customer. Can filter by operator or product."""
    ensure_permission(user, "reports")
    start = _period_start(period)
    query: dict[str, Any] = {
        "business_id": user["business_id"],
        "transaction_type": "sale",
        "created_at": {"$gte": start.isoformat()},
        "status": {"$ne": "cancelled"},
    }
    if operator_id:
        query["created_by"] = operator_id
    docs = await db.transactions.find(query, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(50000)
    rows: list[dict[str, Any]] = []
    for tx in docs:
        for item in tx.get("items", []):
            if product_id and item.get("product_id") != product_id:
                continue
            rows.append({
                "invoice_no": tx.get("invoice_no"),
                "transaction_id": tx.get("id"),
                "created_at": tx.get("created_at"),
                "customer_name": tx.get("customer_name", "Umum"),
                "operator_name": tx.get("created_by_name", "-"),
                "operator_id": tx.get("created_by"),
                "product_id": item.get("product_id"),
                "name": item.get("name"),
                "quantity": item.get("quantity", 0),
                "unit": item.get("unit", ""),
                "price": item.get("price", 0),
                "discount": item.get("discount", 0),
                "subtotal": item.get("price", 0) * item.get("quantity", 0) - item.get("discount", 0),
                "cost": item.get("cost", 0),
                "profit": (item.get("price", 0) - item.get("cost", 0)) * item.get("quantity", 0) - item.get("discount", 0),
            })
    return {"period": period, "rows": rows, "total": sum(r["subtotal"] for r in rows), "qty": sum(r["quantity"] for r in rows)}


@api_router.get("/products/export")
async def export_products(user: dict = Depends(current_user)):
    """Export catalog produk ke file Excel (.xlsx)."""
    ensure_permission(user, "inventory")
    rows = await db.products.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0, "image_base64": 0}).sort("name", 1).to_list(10000)
    data = []
    for p in rows:
        data.append({
            "Nama": p.get("name", ""),
            "SKU": p.get("sku", ""),
            "Barcode": p.get("barcode", ""),
            "Kategori": p.get("category", "Umum"),
            "Tipe": "Jasa" if p.get("product_type") == "service" else "Barang",
            "Satuan": p.get("base_unit", "Pcs"),
            "Harga Pokok": p.get("cost", 0),
            "Harga Jual": p.get("price", 0),
            "Stok": p.get("stock", 0),
            "Stok Minimum": p.get("min_stock", 5),
        })
    frame = pd.DataFrame(data if data else [{"Nama": "", "SKU": "", "Barcode": "", "Kategori": "", "Tipe": "", "Satuan": "", "Harga Pokok": 0, "Harga Jual": 0, "Stok": 0, "Stok Minimum": 0}])
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="xlsxwriter") as writer:
        frame.to_excel(writer, index=False, sheet_name="Produk")
        workbook = writer.book
        worksheet = writer.sheets["Produk"]
        header_fmt = workbook.add_format({"bold": True, "bg_color": "#0f8043", "font_color": "white", "border": 1})
        money_fmt = workbook.add_format({"num_format": "#,##0"})
        for col_idx, column in enumerate(frame.columns):
            worksheet.write(0, col_idx, column, header_fmt)
            worksheet.set_column(col_idx, col_idx, max(14, min(32, int(frame[column].astype(str).map(len).max() or 10) + 2)))
        for col_name in ("Harga Pokok", "Harga Jual", "Stok", "Stok Minimum"):
            if col_name in frame.columns:
                idx = frame.columns.get_loc(col_name)
                worksheet.set_column(idx, idx, 15, money_fmt)
    buffer.seek(0)
    filename = f"produk-{user['business_name'].replace(' ', '_')}-{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Categories ----------
@api_router.get("/categories")
async def list_categories(user: dict = Depends(current_user)):
    return await db.categories.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("name", 1).to_list(500)


@api_router.post("/categories")
async def create_category(payload: CategoryInput, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    name = payload.name.strip()
    if await db.categories.find_one({"business_id": user["business_id"], "name": name}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Kategori sudah ada")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], "name": name, "icon": payload.icon, "created_at": now_iso()}
    await db.categories.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"_id", "business_id"}}


@api_router.put("/categories/{category_id}")
async def update_category(category_id: str, payload: CategoryInput, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    result = await db.categories.update_one(
        {"id": category_id, "business_id": user["business_id"]},
        {"$set": {"name": payload.name.strip(), "icon": payload.icon}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    return await db.categories.find_one({"id": category_id}, {"_id": 0, "business_id": 0})


@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "inventory")
    result = await db.categories.delete_one({"id": category_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    return {"ok": True}


# ---------- Payment Methods ----------
@api_router.get("/payment-methods")
async def list_payment_methods(user: dict = Depends(current_user)):
    rows = await db.payment_methods.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("sort_order", 1).to_list(100)
    if not rows:
        defaults = [
            {"id": "pm_cash", "name": "Tunai", "kind": "cash", "enabled": True, "sort_order": 0, "qris_image_base64": None},
            {"id": "pm_credit", "name": "Kredit", "kind": "credit", "enabled": True, "sort_order": 1, "qris_image_base64": None},
            {"id": "pm_qris", "name": "QRIS Statis", "kind": "qris_static", "enabled": True, "sort_order": 2, "qris_image_base64": None},
        ]
        for d in defaults:
            await db.payment_methods.insert_one({**d, "business_id": user["business_id"], "created_at": now_iso()})
        rows = defaults
    return rows


@api_router.post("/payment-methods")
async def create_payment_method(payload: PaymentMethodInput, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso()}
    await db.payment_methods.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"_id", "business_id"}}


@api_router.put("/payment-methods/{pm_id}")
async def update_payment_method(pm_id: str, payload: PaymentMethodInput, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    result = await db.payment_methods.update_one(
        {"id": pm_id, "business_id": user["business_id"]},
        {"$set": payload.model_dump()},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Metode pembayaran tidak ditemukan")
    return await db.payment_methods.find_one({"id": pm_id}, {"_id": 0, "business_id": 0})


@api_router.delete("/payment-methods/{pm_id}")
async def delete_payment_method(pm_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    if pm_id in {"pm_cash", "pm_credit", "pm_qris"}:
        raise HTTPException(status_code=400, detail="Metode default tidak bisa dihapus. Nonaktifkan saja.")
    result = await db.payment_methods.delete_one({"id": pm_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Metode pembayaran tidak ditemukan")
    return {"ok": True}


# ---------- Parked Transactions ----------
@api_router.get("/parked")
async def list_parked(user: dict = Depends(current_user)):
    return await db.parked_transactions.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(200)


@api_router.post("/parked")
async def create_parked(payload: ParkedTransactionInput, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso(), "created_by_name": user["name"]}
    await db.parked_transactions.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"_id", "business_id"}}


@api_router.delete("/parked/{parked_id}")
async def delete_parked(parked_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    result = await db.parked_transactions.delete_one({"id": parked_id, "business_id": user["business_id"]})
    # Idempotent: tidak error jika sudah terhapus (menghindari race condition saat edit → simpan ulang)
    return {"ok": True, "deleted": result.deleted_count}


# ---------- Promos ----------
@api_router.get("/promos")
async def list_promos(user: dict = Depends(current_user)):
    return await db.promos.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/promos")
async def create_promo(payload: PromoInput, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    doc = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **payload.model_dump(), "created_at": now_iso()}
    await db.promos.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"_id", "business_id"}}


@api_router.put("/promos/{promo_id}")
async def update_promo(promo_id: str, payload: PromoInput, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    result = await db.promos.update_one(
        {"id": promo_id, "business_id": user["business_id"]},
        {"$set": {**payload.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Promo tidak ditemukan")
    return await db.promos.find_one({"id": promo_id}, {"_id": 0, "business_id": 0})


@api_router.delete("/promos/{promo_id}")
async def delete_promo(promo_id: str, user: dict = Depends(current_user)):
    ensure_permission(user, "settings")
    result = await db.promos.delete_one({"id": promo_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Promo tidak ditemukan")
    return {"ok": True}


# ---------- Shifts ----------
@api_router.get("/shifts/current")
async def current_shift(user: dict = Depends(current_user)):
    doc = await db.shifts.find_one(
        {"business_id": user["business_id"], "operator_id": user["id"], "closed_at": None},
        {"_id": 0, "business_id": 0},
    )
    return doc or {}


@api_router.get("/shifts")
async def list_shifts(user: dict = Depends(current_user)):
    return await db.shifts.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("opened_at", -1).to_list(500)


@api_router.post("/shifts/open")
async def open_shift(payload: ShiftOpenInput, user: dict = Depends(current_user)):
    ensure_permission(user, "sales")
    existing = await db.shifts.find_one({"business_id": user["business_id"], "operator_id": user["id"], "closed_at": None}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Masih ada shift aktif. Tutup dulu sebelum membuka shift baru.")
    doc = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        "operator_id": user["id"], "operator_name": user["name"],
        "opening_cash": payload.opening_cash, "closing_cash": 0, "difference": 0,
        "expected_cash": payload.opening_cash,
        "sales_total": 0, "cash_sales": 0, "non_cash_sales": 0,
        "note": payload.note, "opened_at": now_iso(), "closed_at": None,
    }
    await db.shifts.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in {"_id", "business_id"}}


async def _compute_shift_summary(bid: str, shift_id: str, opened_at: str) -> dict:
    txs = await db.transactions.find(
        {"business_id": bid, "shift_id": shift_id, "transaction_type": "sale"},
        {"_id": 0, "total": 1, "paid_amount": 1},
    ).to_list(50000)
    sales_total = sum(tx.get("total", 0) for tx in txs)
    # Resolve cash vs non-cash via payment method lookup
    cash_tx_ids = []
    cash_sales = 0
    tx_full = await db.transactions.find(
        {"business_id": bid, "shift_id": shift_id, "transaction_type": "sale"},
        {"_id": 0, "payment_method": 1, "total": 1},
    ).to_list(50000)
    for tx in tx_full:
        pm = tx.get("payment_method")
        if pm == "cash":
            cash_sales += tx.get("total", 0); continue
        pm_doc = await db.payment_methods.find_one({"id": pm, "business_id": bid}, {"_id": 0, "kind": 1})
        if (pm_doc or {}).get("kind") == "cash":
            cash_sales += tx.get("total", 0)
    non_cash = sales_total - cash_sales
    # Cash entries during shift
    entries = await db.cash_entries.find(
        {"business_id": bid, "created_at": {"$gte": opened_at}},
        {"_id": 0, "entry_type": 1, "amount": 1},
    ).to_list(50000)
    cash_in = sum(e["amount"] for e in entries if e["entry_type"] == "income")
    cash_out = sum(e["amount"] for e in entries if e["entry_type"] == "expense")
    return {"sales_total": sales_total, "cash_sales": cash_sales, "non_cash_sales": non_cash, "cash_in": cash_in, "cash_out": cash_out, "transaction_count": len(txs)}


@api_router.get("/shifts/{shift_id}")
async def shift_detail(shift_id: str, user: dict = Depends(current_user)):
    doc = await db.shifts.find_one({"id": shift_id, "business_id": user["business_id"]}, {"_id": 0, "business_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Shift tidak ditemukan")
    summary = await _compute_shift_summary(user["business_id"], shift_id, doc["opened_at"])
    doc.update(summary)
    doc["expected_cash"] = doc["opening_cash"] + summary["cash_sales"] + summary["cash_in"] - summary["cash_out"]
    return doc


@api_router.post("/shifts/{shift_id}/close")
async def close_shift(shift_id: str, payload: ShiftCloseInput, user: dict = Depends(current_user)):
    doc = await db.shifts.find_one({"id": shift_id, "business_id": user["business_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Shift tidak ditemukan")
    if doc.get("closed_at"):
        raise HTTPException(status_code=400, detail="Shift sudah ditutup")
    if doc.get("operator_id") != user["id"] and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya operator pemilik shift atau owner yang bisa menutup")
    summary = await _compute_shift_summary(user["business_id"], shift_id, doc["opened_at"])
    expected = doc["opening_cash"] + summary["cash_sales"] + summary["cash_in"] - summary["cash_out"]
    difference = payload.closing_cash - expected
    update = {
        "closing_cash": payload.closing_cash, "expected_cash": expected, "difference": difference,
        "sales_total": summary["sales_total"], "cash_sales": summary["cash_sales"], "non_cash_sales": summary["non_cash_sales"],
        "cash_in": summary["cash_in"], "cash_out": summary["cash_out"], "transaction_count": summary["transaction_count"],
        "note": (doc.get("note", "") + ("\n" if doc.get("note") else "") + payload.note).strip(),
        "closed_at": now_iso(),
    }
    await db.shifts.update_one({"id": shift_id, "business_id": user["business_id"]}, {"$set": update})
    return await db.shifts.find_one({"id": shift_id}, {"_id": 0, "business_id": 0})


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
