"""Server-only caption gateway. Never return provider error bodies or credentials."""

import re

import httpx
from fastapi import HTTPException

from .config import Settings


async def caption_response(
    video_id: str, settings: Settings, endpoint: str, params: dict
):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise HTTPException(422, "Invalid YouTube video ID")
    if not settings.rapid_api_key or not re.fullmatch(
        r"[a-z0-9-]+\.p\.rapidapi\.com", settings.rapid_api_host
    ):
        raise HTTPException(
            503, "Configure RAPID_API_KEY and RAPID_API_HOST on the backend"
        )
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.get(
                f"https://{settings.rapid_api_host}/{endpoint}/{video_id}",
                params=params,
                headers={
                    "x-rapidapi-host": settings.rapid_api_host,
                    "x-rapidapi-key": settings.rapid_api_key,
                },
            )
    except httpx.TimeoutException:
        raise HTTPException(
            504, "The caption service timed out. Please try again."
        ) from None
    except httpx.HTTPError:
        raise HTTPException(
            502, "Cannot reach the caption service. Please try again."
        ) from None
    if response.status_code == 404:
        raise HTTPException(
            404,
            "No captions found. The video may be unavailable or have captions disabled.",
        )
    if response.status_code in (401, 403):
        raise HTTPException(
            502,
            "The caption service denied access. Check the backend RapidAPI key/subscription and the video's availability.",
        )
    if response.status_code == 429:
        raise HTTPException(
            429,
            "The caption service quota or rate limit was reached. Please try again later.",
        )
    if response.status_code != 200:
        raise HTTPException(
            502, "The caption service is unavailable. Please try again later."
        )
    return response


async def fetch_subtitles(
    video_id: str, settings: Settings, language: str | None = None
) -> list[dict]:
    if language is not None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,35}", language):
            raise HTTPException(422, "Invalid caption language")
        response = await caption_response(
            video_id, settings, "download-srt", {"language": language}
        )
        if "-->" not in response.text:
            raise HTTPException(
                502,
                "The caption service returned an invalid subtitle. Please try another language.",
            )
        return [{"languageCode": language, "subtitle": response.text}]
    response = await caption_response(
        video_id,
        settings,
        "download-all",
        {"format_subtitle": "srt", "format_answer": "json"},
    )
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(
            502, "The caption service returned an invalid response. Please try again."
        ) from None
    if not isinstance(data, list):
        raise HTTPException(
            502, "The caption service returned an invalid response. Please try again."
        )
    tracks = []
    for item in data:
        if not isinstance(item, dict):
            continue
        language = item.get("languageCode")
        subtitle = item.get("subtitle")
        if (
            isinstance(language, str)
            and language.strip()
            and isinstance(subtitle, (str, list))
            and subtitle
        ):
            tracks.append({"languageCode": language.strip(), "subtitle": subtitle})
    if not tracks:
        raise HTTPException(
            404, "No usable captions found. Try a video with captions enabled."
        )
    return tracks


async def list_subtitles(video_id: str, settings: Settings) -> list[dict]:
    response = await caption_response(
        video_id, settings, "language-list", {"format": "json"}
    )
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(
            502, "The caption service returned an invalid language list."
        ) from None
    if not isinstance(data, list):
        raise HTTPException(
            502, "The caption service returned an invalid language list."
        )
    tracks = []
    for item in data:
        if not isinstance(item, dict):
            continue
        code = item.get("languageCode")
        if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,35}", code):
            name = item.get("name")
            tracks.append(
                {
                    "languageCode": code,
                    "languageName": name if isinstance(name, str) else code,
                }
            )
    if not tracks:
        raise HTTPException(
            404, "No usable captions found. Try a video with captions enabled."
        )
    return tracks
