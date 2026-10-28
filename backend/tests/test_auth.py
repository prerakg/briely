import httpx
from backend.app import main, security
from backend.app.config import Settings

P = "/api/v1"


def test_supabase_login_and_server_validated_identity(client, monkeypatch, draft):
    configuration = Settings(
        _env_file=None,
        supabase_url="https://auth.example",
        supabase_anon_key="public-test-key",
    )
    monkeypatch.setattr(main, "settings", configuration)
    monkeypatch.setattr(security, "settings", configuration)
    original = httpx.AsyncClient
    calls = []

    def handle(req):
        calls.append(req.url.path)
        if req.url.path.endswith("/token"):
            return httpx.Response(
                200,
                json={
                    "access_token": "valid-access",
                    "refresh_token": "valid-refresh",
                    "expires_in": 3600,
                },
            )
        if (
            req.url.path.endswith("/user")
            and req.headers.get("Authorization") == "Bearer valid-access"
        ):
            return httpx.Response(
                200, json={"id": "supabase-user-1", "user_metadata": {"role": "admin"}}
            )
        return httpx.Response(401, json={"message": "invalid"})

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    assert client.post(P + "/auth/session").json()["authenticated"] is False
    login = client.post(
        P + "/auth/login",
        json={"email": "student@example.com", "password": "example-password"},
    )
    assert login.status_code == 200
    assert (
        "HttpOnly" in login.headers["set-cookie"]
        and "example-password" not in login.text
    )
    created = client.post(P + "/quizzes", json=draft)
    assert created.status_code == 200
    assert (
        client.get(
            P + "/quizzes", headers={"Authorization": "Bearer forged-access"}
        ).status_code
        == 401
    )
    assert "/auth/v1/user" in calls
    assert client.post(P + "/auth/refresh").status_code == 200
    assert client.post(P + "/auth/logout").status_code == 200
    assert client.get(P + "/quizzes").status_code == 401


def test_supabase_signup_confirmation_is_not_fake_login(client, monkeypatch):
    configuration = Settings(
        _env_file=None,
        supabase_url="https://auth.example",
        supabase_anon_key="public-test-key",
    )
    monkeypatch.setattr(main, "settings", configuration)
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(
                lambda req: httpx.Response(200, json={"id": "pending-user"})
            ),
            **kw,
        ),
    )
    r = client.post(
        P + "/auth/signup",
        json={"email": "new@example.com", "password": "long-password"},
    )
    assert r.status_code == 200 and r.json()["authenticated"] is False
    assert "confirm" in r.json()["message"]
