from fastapi import FastAPI, APIRouter, Depends, File, HTTPException, UploadFile, status
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
from jose import JWTError, jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import pandas as pd
from io import BytesIO


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.getenv("JWT_SECRET", "kasirku-local-development-secret")
JWT_ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str


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
    image_base64: Optional[str] = None


class TransactionItem(BaseModel):
    product_id: str
    name: str
    quantity: int = Field(gt=0)
    price: int = Field(ge=0)
    cost: int = Field(default=0, ge=0)


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
    password: str = Field(min_length=6, max_length=128)
    role: Literal["cashier", "inventory", "kitchen"] = "cashier"


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


def public_user(user: dict) -> UserPublic:
    return UserPublic(
        id=user["id"], business_id=user["business_id"], business_name=user["business_name"],
        name=user["name"], username=user["username"], role=user["role"],
    )


async def get_products(business_id: str, search: str = "") -> list[dict]:
    query: dict[str, Any] = {"business_id": business_id}
    if search.strip():
        query["$or"] = [
            {"name": {"$regex": search.strip(), "$options": "i"}},
            {"barcode": {"$regex": search.strip(), "$options": "i"}},
            {"sku": {"$regex": search.strip(), "$options": "i"}},
        ]
    return await db.products.find(query, {"_id": 0, "business_id": 0}).sort("name", 1).to_list(2000)

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "KasirKu Pro API", "status": "ready"}


@api_router.get("/health")
async def health():
    await db.command("ping")
    return {"status": "ok", "service": "kasirku"}


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(input: RegisterInput):
    username = input.username.strip().lower()
    if await db.users.find_one({"username": username}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    business_id = str(uuid.uuid4())
    user = {
        "id": str(uuid.uuid4()), "business_id": business_id,
        "business_name": input.business_name.strip(), "name": input.owner_name.strip(),
        "username": username, "role": "owner",
        "password_hash": bcrypt.hashpw(input.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return AuthResponse(token=make_token(user), user=public_user(user))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(input: LoginInput):
    user = await db.users.find_one({"username": input.username.strip().lower()}, {"_id": 0})
    if not user or not bcrypt.checkpw(input.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    return AuthResponse(token=make_token(user), user=public_user(user))


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api_router.get("/products")
async def products(search: str = "", user: dict = Depends(current_user)):
    return await get_products(user["business_id"], search)


@api_router.post("/products")
async def create_product(input: ProductInput, user: dict = Depends(current_user)):
    product = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"],
        **input.model_dump(), "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.products.insert_one(product)
    return {key: value for key, value in product.items() if key not in {"business_id", "_id"}}


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, input: ProductInput, user: dict = Depends(current_user)):
    result = await db.products.update_one(
        {"id": product_id, "business_id": user["business_id"]},
        {"$set": {**input.model_dump(), "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "business_id": 0})
    return product


@api_router.post("/transactions")
async def create_transaction(input: TransactionInput, user: dict = Depends(current_user)):
    product_ids = [item.product_id for item in input.items]
    found = await db.products.find({"id": {"$in": product_ids}, "business_id": user["business_id"]}, {"_id": 0}).to_list(2000)
    by_id = {item["id"]: item for item in found}
    if len(by_id) != len(set(product_ids)):
        raise HTTPException(status_code=400, detail="Ada produk yang tidak ditemukan")
    total = sum(item.price * item.quantity for item in input.items)
    if input.transaction_type == "sale" and input.payment_method == "cash" and input.paid_amount < total:
        raise HTTPException(status_code=400, detail="Nominal tunai kurang")
    direction = {"sale": -1, "purchase": 1, "purchase_return": -1, "sale_return": 1}[input.transaction_type]
    if input.transaction_type in {"sale", "purchase_return"}:
        for item in input.items:
            if by_id[item.product_id]["stock"] < item.quantity:
                raise HTTPException(status_code=400, detail=f"Stok {item.name} tidak mencukupi")
    for item in input.items:
        await db.products.update_one({"id": item.product_id, "business_id": user["business_id"]}, {"$inc": {"stock": direction * item.quantity}})
    transaction = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"], "invoice_no": f"INV-{datetime.now().strftime('%y%m%d')}-{uuid.uuid4().hex[:5].upper()}",
        "transaction_type": input.transaction_type, "payment_method": input.payment_method,
        "items": [item.model_dump() for item in input.items], "total": total,
        "paid_amount": input.paid_amount, "customer_name": input.customer_name,
        "note": input.note, "created_at": now_iso(), "created_by": user["id"],
    }
    await db.transactions.insert_one(transaction)
    return {key: value for key, value in transaction.items() if key not in {"business_id", "created_by", "_id"}}


@api_router.get("/reports/summary")
async def report_summary(period: Literal["daily", "monthly", "yearly"] = "daily", user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc)
    if period == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "monthly":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    docs = await db.transactions.find({"business_id": user["business_id"], "created_at": {"$gte": start.isoformat()}}, {"_id": 0, "business_id": 0}).to_list(10000)
    sales = [doc for doc in docs if doc["transaction_type"] == "sale"]
    purchases = [doc for doc in docs if doc["transaction_type"] == "purchase"]
    products = await db.products.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(2000)
    credit_sales = sum(doc["total"] for doc in sales if doc["payment_method"] == "credit")
    payable = sum(doc["total"] for doc in purchases if doc["payment_method"] == "credit")
    return {
        "period": period, "sales_total": sum(doc["total"] for doc in sales),
        "purchase_total": sum(doc["total"] for doc in purchases), "transaction_count": len(sales),
        "gross_profit": sum(sum((i["price"] - i.get("cost", 0)) * i["quantity"] for i in doc["items"]) for doc in sales),
        "receivable": credit_sales, "payable": payable,
        "low_stock": len([p for p in products if p["stock"] <= p.get("min_stock", 5)]),
        "cash_balance": sum(doc["total"] for doc in sales if doc["payment_method"] == "cash") - sum(doc["total"] for doc in purchases if doc["payment_method"] == "cash"),
    }


@api_router.post("/cash-entries")
async def create_cash_entry(input: CashEntryInput, user: dict = Depends(current_user)):
    entry = {"id": str(uuid.uuid4()), "business_id": user["business_id"], **input.model_dump(), "created_at": now_iso()}
    await db.cash_entries.insert_one(entry)
    return {key: value for key, value in entry.items() if key not in {"business_id", "_id"}}


@api_router.get("/operators")
async def operators(user: dict = Depends(current_user)):
    return await db.users.find({"business_id": user["business_id"], "role": {"$ne": "owner"}}, {"_id": 0, "password_hash": 0, "business_id": 0}).sort("name", 1).to_list(200)


@api_router.post("/operators")
async def create_operator(input: OperatorInput, user: dict = Depends(current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya pemilik yang dapat mengatur operator")
    username = input.username.strip().lower()
    if await db.users.find_one({"username": username}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    operator = {
        "id": str(uuid.uuid4()), "business_id": user["business_id"], "business_name": user["business_name"],
        "name": input.name.strip(), "username": username, "role": input.role,
        "password_hash": bcrypt.hashpw(input.password.encode(), bcrypt.gensalt()).decode(), "created_at": now_iso(),
    }
    await db.users.insert_one(operator)
    return {key: value for key, value in operator.items() if key not in {"_id", "business_id", "password_hash"}}


@api_router.get("/backup")
async def backup(user: dict = Depends(current_user)):
    products_data = await db.products.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    transactions_data = await db.transactions.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    cash_data = await db.cash_entries.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).to_list(10000)
    return {"exported_at": now_iso(), "business_name": user["business_name"], "products": products_data, "transactions": transactions_data, "cash_entries": cash_data}


@api_router.post("/products/import")
async def import_products(file: UploadFile = File(...), user: dict = Depends(current_user)):
    raw = await file.read()
    try:
        if file.filename and file.filename.lower().endswith(".csv"):
            frame = pd.read_csv(BytesIO(raw))
        else:
            frame = pd.read_excel(BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="File tidak dapat dibaca. Gunakan kolom nama, harga, stok.") from exc
    columns = {str(column).strip().lower(): column for column in frame.columns}
    name_column = columns.get("nama") or columns.get("name")
    if not name_column:
        raise HTTPException(status_code=400, detail="Kolom nama wajib tersedia")
    imported = 0
    for row in frame.to_dict(orient="records"):
        name = str(row.get(name_column, "")).strip()
        if not name or name == "nan":
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
            "id": str(uuid.uuid4()), "business_id": user["business_id"], "name": name,
            "sku": str(row.get(columns.get("sku", ""), "") or ""), "barcode": str(row.get(columns.get("barcode", ""), "") or ""),
            "category": str(row.get(columns.get("kategori", ""), "Umum") or "Umum"),
            "price": number("harga", "price"), "cost": number("modal", "cost"),
            "stock": number("stok", "stock"), "min_stock": number("minimum", "min_stock", default=5),
            "image_base64": None, "created_at": now_iso(), "updated_at": now_iso(),
        }
        await db.products.insert_one(product)
        imported += 1
    return {"imported": imported}


@api_router.get("/integrations/status")
async def integrations_status(user: dict = Depends(current_user)):
    return {
        "qris": {"configured": os.getenv("QRIS_MODE", "disabled") == "enabled", "label": "QRIS"},
        "whatsapp": {"configured": bool(os.getenv("META_ACCESS_TOKEN")), "label": "WhatsApp Cloud API"},
        "bluetooth_printing": {"configured": False, "label": "Printer Bluetooth / ESC-POS"},
    }

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
