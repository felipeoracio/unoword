import os
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.exception_handlers import request_validation_exception_handler
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from routers.product import router as product_router
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.google_auth import router as google_auth_router
from routers.documents import router as documents_router
from routers.links import router as links_router
from routers.admin import router as admin_router
from routers.subscriptions import router as subscription_router
from routers.account_security import router as account_security_router
from routers.workspace import router as workspace_router
from routers.onboarding import router as onboarding_router

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

api_router.include_router(product_router)
api_router.include_router(ai_router)
api_router.include_router(documents_router)
api_router.include_router(links_router)
api_router.include_router(auth_router)
api_router.include_router(google_auth_router)
api_router.include_router(admin_router)
api_router.include_router(subscription_router)
api_router.include_router(account_security_router)
api_router.include_router(workspace_router)
api_router.include_router(onboarding_router)


@api_router.get("/")
async def root() -> dict[str, str]:
    return {"message": "Uno Word AI API is running"}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Never reflect credential values from malformed request bodies into responses.
@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, error):
    if not request.url.path.startswith(('/api/auth/', '/api/subscription/', '/api/workspace/', '/api/onboarding')):
        return await request_validation_exception_handler(request, error)
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(item["loc"]), "type": item["type"], "msg": "Invalid value"}
        for item in error.errors()
    ]})


# Every route above must be registered before including the API router.
app.include_router(api_router)
