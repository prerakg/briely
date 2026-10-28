from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator, Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env.local", ".env"), extra="ignore")
    app_env: str = "development"
    database_url: str = "sqlite:///./briefly.db"
    frontend_url: str = "http://localhost:3000"
    groq_api_key: str = ""
    gemini_api_key: str = ""
    xai_api_key: str = ""
    ai_primary_provider: str = "groq"
    ai_fallback_provider: str = "gemini"
    groq_model: str = "openai/gpt-oss-20b"
    gemini_model: str = "gemini-3.8-flash"
    gemini_live_model: str = "gemini-3.8-live"
    xai_model: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""
    rapid_api_key: str = ""
    rapid_api_host: str = ""
    ai_task_models: dict[str, dict[str, str]] = Field(default_factory=dict)
    ai_timeout: float = 45
    ai_max_prompt_chars: int = 60000
    ai_max_output_tokens: int = 6000
    ai_evidence_chars: int = Field(default=7000, ge=1000, le=30000)
    ai_rate_limit_wait_seconds: float = Field(default=60, ge=0, le=90)
    ai_output_tokens_by_task: dict[str, int] = Field(
        default_factory=lambda: {
            "summary": 1600,
            "verification": 900,
            "flashcards": 2400,
            "notes": 4200,
            "mindmap": 1400,
            "topics": 1400,
            "tutor": 1400,
            "planner": 2000,
            "quiz": 6000,
        }
    )
    ai_cache_seconds: int = 300
    request_limit_per_minute: int = 120

    @model_validator(mode="after")
    def production_safety(self):
        if self.app_env == "production":
            if (
                not self.supabase_url.startswith("https://")
                or not self.supabase_anon_key
            ):
                raise ValueError("Production requires Supabase authentication")
            if not self.database_url.startswith("postgresql"):
                raise ValueError("Production requires PostgreSQL")
            if not self.frontend_url.startswith("https://"):
                raise ValueError("Production requires HTTPS")
        return self


@lru_cache
def get_settings():
    return Settings()
