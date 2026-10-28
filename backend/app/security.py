import hashlib
import secrets
import time
from collections import OrderedDict, deque
import httpx
from fastapi import HTTPException, Request, Response
from .config import get_settings
from .models import Session, Identity

settings = get_settings()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def cookie(response, name, value, max_age=2592000):
    response.set_cookie(
        name,
        value,
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        max_age=max_age,
        path="/",
    )


async def owner(request: Request):
    token = request.headers.get("authorization", "").removeprefix(
        "Bearer "
    ) or request.cookies.get("briefly_auth", "")
    if settings.supabase_url and settings.supabase_anon_key and token:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    settings.supabase_url.rstrip("/") + "/auth/v1/user",
                    headers={
                        "Authorization": "Bearer " + token,
                        "apikey": settings.supabase_anon_key,
                    },
                )
            if r.status_code == 200 and r.json().get("id"):
                return r.json()["id"]
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, "Authentication service unavailable")
    if settings.app_env != "production" and not settings.supabase_url:
        local = request.cookies.get("briefly_local", "")
        if local:
            with Session() as db:
                identity = db.get(Identity, digest(local))
                if identity and identity.created > time.time() - 2592000:
                    return "local:" + identity.id
    raise HTTPException(401, "Sign in to manage quizzes and AI workflows")


def guest(request: Request, response: Response):
    value = request.cookies.get("briefly_guest", "")
    if len(value) != 43:
        value = secrets.token_urlsafe(32)
        cookie(response, "briefly_guest", value)
    return digest(value)


class Limiter:
    def __init__(self):
        self.buckets = OrderedDict()

    def check(self, key, limit, window=60):
        now = time.monotonic()
        bucket = self.buckets.setdefault(key, deque())
        while bucket and bucket[0] < now - window:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(
                429,
                "Too many requests. Try again later.",
                headers={"Retry-After": str(window)},
            )
        bucket.append(now)
        self.buckets.move_to_end(key)
        while len(self.buckets) > 10000:
            self.buckets.popitem(last=False)


limiter = Limiter()
