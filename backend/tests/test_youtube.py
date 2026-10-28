import httpx
import pytest

from backend.app import youtube
from backend.app.main import settings

P = "/api/v1/youtube/dQw4w9WgXcQ"


@pytest.fixture
def caption_provider(monkeypatch):
    monkeypatch.setattr(settings, "rapid_api_key", "test-private-key")
    monkeypatch.setattr(settings, "rapid_api_host", "captions.p.rapidapi.com")
    original_client = httpx.AsyncClient

    def configure(status=200, data=None, raw=None, failure=None):
        def handle(request):
            assert request.url.host == "captions.p.rapidapi.com"
            assert request.url.path == "/download-all/dQw4w9WgXcQ"
            assert request.url.params["format_subtitle"] == "srt"
            assert request.headers["x-rapidapi-key"] == "test-private-key"
            if failure:
                raise failure("upstream failure with private provider details")
            if raw is not None:
                return httpx.Response(status, text=raw)
            return httpx.Response(status, json=data)

        monkeypatch.setattr(
            youtube.httpx,
            "AsyncClient",
            lambda **kwargs: original_client(
                transport=httpx.MockTransport(handle), **kwargs
            ),
        )

    return configure


def test_caption_gateway_returns_only_tracks(client, caption_provider):
    caption_provider(
        data=[
            {
                "languageCode": "en",
                "subtitle": "1\n00:00:00,000 --> 00:00:01,000\nHello",
                "private_metadata": "hidden",
            },
            {
                "languageCode": "hi",
                "subtitle": [{"start": "1.5", "dur": "2", "text": "नमस्ते"}],
            },
            None,
            {"subtitle": "missing language"},
        ]
    )
    response = client.get(P)
    assert response.status_code == 200
    assert len(response.json()) == 2
    assert set(response.json()[0]) == {"languageCode", "subtitle"}
    assert "private" not in response.text


@pytest.mark.parametrize(
    ("status", "expected", "message"),
    [
        (404, 404, "No captions"),
        (401, 502, "denied access"),
        (403, 502, "denied access"),
        (429, 429, "quota"),
        (500, 502, "unavailable"),
    ],
)
def test_caption_gateway_safe_provider_errors(
    client, caption_provider, status, expected, message
):
    caption_provider(status=status, raw="PRIVATE-PROVIDER-BODY test-private-key")
    response = client.get(P)
    assert response.status_code == expected
    assert message in response.json()["detail"]
    assert "PRIVATE" not in response.text and "test-private-key" not in response.text


@pytest.mark.parametrize(
    "data",
    [None, {"error": "private"}, [], [None, {"languageCode": "en", "subtitle": ""}]],
)
def test_caption_gateway_rejects_unusable_payloads(client, caption_provider, data):
    caption_provider(data=data)
    assert client.get(P).status_code in (404, 502)


def test_caption_gateway_non_json(client, caption_provider):
    caption_provider(raw="<html>private provider error</html>")
    assert client.get(P).status_code == 502


@pytest.mark.parametrize(
    ("failure", "status"), [(httpx.ReadTimeout, 504), (httpx.ConnectError, 502)]
)
def test_caption_gateway_transport_errors(client, caption_provider, failure, status):
    caption_provider(failure=failure)
    response = client.get(P)
    assert response.status_code == status
    assert "private provider" not in response.text


def test_caption_gateway_validates_configuration_and_id(client, monkeypatch):
    monkeypatch.setattr(settings, "rapid_api_key", "")
    assert client.get("/api/v1/youtube/not-an-id").status_code == 422
    assert client.get(P).status_code == 503


def test_caption_gateway_requires_creator_cookie(client):
    client.cookies.clear()
    assert client.get(P).status_code == 401


def test_selected_language_uses_individual_caption_endpoint(client, monkeypatch):
    monkeypatch.setattr(settings, "rapid_api_key", "test-private-key")
    monkeypatch.setattr(settings, "rapid_api_host", "captions.p.rapidapi.com")
    original = httpx.AsyncClient
    calls = []

    def handle(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/languages"):
            raise AssertionError("Internal route must not be sent to provider")
        if "/language-list/" in request.url.path:
            return httpx.Response(
                200,
                json=[
                    {"languageCode": "en", "name": "English"},
                    {"languageCode": "hi", "name": "Hindi"},
                    {"languageCode": "../../bad"},
                ],
            )
        assert (
            "/download-srt/" in request.url.path
            and request.url.params["language"] == "hi"
        )
        return httpx.Response(200, text="1\n00:00:01,000 --> 00:00:02,000\nनमस्ते")

    monkeypatch.setattr(
        youtube.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    listing = client.get(P + "/languages")
    assert listing.status_code == 200 and len(listing.json()) == 2
    response = client.get(P, params={"language": "hi"})
    assert response.status_code == 200 and response.json()[0]["languageCode"] == "hi"
    assert len(calls) == 2 and not any("/download-all/" in path for path in calls)
    assert client.get(P, params={"language": "../../evil"}).status_code == 422
    assert len(calls) == 2
