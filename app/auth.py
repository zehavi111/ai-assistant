"""Single-password auth: signed httpOnly cookie via itsdangerous."""
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from pydantic import BaseModel

from app.config import APP_PASSWORD, SECRET_KEY, SESSION_MAX_AGE

signer = TimestampSigner(SECRET_KEY)
COOKIE_NAME = "session"

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    password: str


def require_auth(request: Request) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        signer.unsign(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Invalid session")


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    ok = secrets.compare_digest(body.password.encode(), APP_PASSWORD.encode())
    if not ok:
        time.sleep(0.5)  # brute-force friction
        raise HTTPException(status_code=401, detail="Wrong password")
    token = signer.sign(b"user").decode()
    secure = request.url.hostname not in ("localhost", "127.0.0.1")
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=secure,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    require_auth(request)
    return {"ok": True}
