"""Runtime settings. Everything comes from environment variables (see .env.example)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VOLTIX_", extra="ignore")

    database_url: str = "sqlite:///./voltix.db"
    secret_key: str = "dev-only-change-me"
    cors_origins: str = "http://localhost:3000"

    # MQTT. Leave host empty to run without a broker.
    mqtt_host: str = ""
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_tls: bool = False

    # SIMULATE=1 runs an in-process device simulator. Every value it produces is
    # stored with source="simulated" and labelled SIMULATED in the UI.
    simulate: bool = False
    simulate_speed: int = 1  # simulated seconds per wall-clock second
    seed_demo: bool = False

    # Auth
    dev_login: bool = False
    google_client_id: str = ""
    admin_emails: str = ""
    operator_emails: str = ""

    # Integrations (all optional; features hide themselves when unset)
    telegram_bot_token: str = ""
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-4-8"
    open_meteo_enabled: bool = True

    ocpp_port: int = 0  # 0 disables the OCPP 1.6J central system

    slot_minutes: int = 15
    horizon_slots: int = 96
    control_interval_s: int = 60
    solver_time_s: float = 3.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
