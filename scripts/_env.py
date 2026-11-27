"""Shared .env loader. Reads the project .env without printing values."""
import os
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent


def env() -> dict:
    return {k: v for k, v in dotenv_values(os.environ.get("ASHADI_ENV_FILE") or (ROOT / ".env")).items() if v is not None}


def require(cfg: dict, *keys) -> list:
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        raise SystemExit(f"[x] missing required .env keys: {', '.join(missing)}")
    return [cfg[k] for k in keys]
