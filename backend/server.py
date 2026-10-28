import os
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.exception_handlers import request_validation_exception_handler
from starlette.middleware.cors import CORSMiddleware
from lib.request_security import BrowserSecurityMiddleware, web_origins, extension_origin_pattern

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from routers.product import router as product_router
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.google_auth import router as google_auth_router
from routers.email_signup import router as email_signup_router
from routers.documents import router as documents_router
from routers.links import router as links_router
from routers.admin import router as admin_router
from routers.subscriptions import router as subscription_router
from routers.account_security import router as account_security_router
from routers.workspace import router as workspace_router
from routers.onboarding import router as onboarding_router
from routers.processing import router as processing_router

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
api_router.include_router(email_signup_router)
api_router.include_router(admin_router)
api_router.include_router(subscription_router)
api_router.include_router(account_security_router)
api_router.include_router(workspace_router)
api_router.include_router(onboarding_router)
api_router.include_router(processing_router)


@api_router.get("/")
async def root() -> dict[str, str]:
    return {"message": "UnoWord AI API is running"}


app.add_middleware(BrowserSecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=web_origins(),
    allow_origin_regex=extension_origin_pattern(),
    allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Uno-User-Id", "X-Uno-Extension-Id"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Never reflect credential values from malformed request bodies into responses.
@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, error):
    if not request.url.path.startswith(('/api/auth/', '/api/admin/', '/api/subscription/', '/api/workspace/', '/api/onboarding')):
        return await request_validation_exception_handler(request, error)
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(item["loc"]), "type": item["type"], "msg": "Invalid value"}
        for item in error.errors()
    ]})


# Every route above must be registered before including the API router.
app.include_router(api_router)
