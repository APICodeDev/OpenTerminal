"""Small HTTP inference service around the official Kronos implementation.

The model code lives in the pinned git submodule under vendor/Kronos. Models
and tokenizers are downloaded lazily from Hugging Face on the first request so
the terminal can start without paying the model-loading cost.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor" / "Kronos"))

MODEL_SPECS = {
    "mini": {
        "model": "NeoQuasar/Kronos-mini",
        "tokenizer": "NeoQuasar/Kronos-Tokenizer-2k",
        "max_context": 2048,
    },
    "small": {
        "model": "NeoQuasar/Kronos-small",
        "tokenizer": "NeoQuasar/Kronos-Tokenizer-base",
        "max_context": 512,
    },
    "base": {
        "model": "NeoQuasar/Kronos-base",
        "tokenizer": "NeoQuasar/Kronos-Tokenizer-base",
        "max_context": 512,
    },
}

MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_CACHE_ENTRIES = 32
_predictors: dict[str, Any] = {}
_model_lock = threading.Lock()
_inference_lock = threading.Lock()
_cache_lock = threading.Lock()
_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()


class RequestError(ValueError):
    pass


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise RequestError(f"{name} must be a finite number")
    return float(value)


def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    number = _number(value, name)
    if not number.is_integer() or number < minimum or number > maximum:
        raise RequestError(f"{name} must be an integer between {minimum} and {maximum}")
    return int(number)


def validate_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RequestError("JSON body must be an object")

    model_name = payload.get("model")
    if model_name not in MODEL_SPECS:
        raise RequestError("model must be one of: mini, small, base")
    spec = MODEL_SPECS[model_name]

    interval_seconds = _integer(payload.get("intervalSeconds"), "intervalSeconds", 300, 86_400)
    lookback = _integer(payload.get("lookback"), "lookback", 32, spec["max_context"])
    pred_len = _integer(payload.get("predictionLength"), "predictionLength", 1, 120)
    temperature = _number(payload.get("temperature"), "temperature")
    top_k = _integer(payload.get("topK"), "topK", 0, 512)
    top_p = _number(payload.get("topP"), "topP")
    sample_count = _integer(payload.get("sampleCount"), "sampleCount", 1, 5)

    if not 0.1 <= temperature <= 2.0:
        raise RequestError("temperature must be between 0.1 and 2.0")
    if not 0.1 <= top_p <= 1.0:
        raise RequestError("topP must be between 0.1 and 1.0")

    raw_candles = payload.get("candles")
    if not isinstance(raw_candles, list) or len(raw_candles) < 32:
        raise RequestError("at least 32 closed candles are required")

    candles: list[dict[str, float]] = []
    for index, raw in enumerate(raw_candles[-lookback:]):
        if not isinstance(raw, dict):
            raise RequestError(f"candles[{index}] must be an object")
        candle = {
            "time": _number(raw.get("time"), f"candles[{index}].time"),
            "open": _number(raw.get("open"), f"candles[{index}].open"),
            "high": _number(raw.get("high"), f"candles[{index}].high"),
            "low": _number(raw.get("low"), f"candles[{index}].low"),
            "close": _number(raw.get("close"), f"candles[{index}].close"),
            "volume": max(0.0, _number(raw.get("volume", 0), f"candles[{index}].volume")),
        }
        if candle["time"] <= 0 or min(candle["open"], candle["high"], candle["low"], candle["close"]) <= 0:
            raise RequestError(f"candles[{index}] contains non-positive time or price values")
        candles.append(candle)

    candles.sort(key=lambda item: item["time"])
    deduped = {int(item["time"]): item for item in candles}
    candles = [deduped[key] for key in sorted(deduped)]
    if len(candles) < 32:
        raise RequestError("at least 32 unique closed candles are required")

    return {
        "model": model_name,
        "intervalSeconds": interval_seconds,
        "lookback": lookback,
        "predictionLength": pred_len,
        "temperature": temperature,
        "topK": top_k,
        "topP": top_p,
        "sampleCount": sample_count,
        "candles": candles,
    }


def get_predictor(model_name: str):
    with _model_lock:
        cached = _predictors.get(model_name)
        if cached is not None:
            return cached

        from model import Kronos, KronosPredictor, KronosTokenizer

        spec = MODEL_SPECS[model_name]
        tokenizer = KronosTokenizer.from_pretrained(spec["tokenizer"])
        model = Kronos.from_pretrained(spec["model"])
        configured_device = os.environ.get("KRONOS_DEVICE", "auto").strip()
        device = None if configured_device in ("", "auto") else configured_device
        predictor = KronosPredictor(model, tokenizer, device=device, max_context=spec["max_context"])
        _predictors[model_name] = predictor
        return predictor


def _cache_key(request: dict[str, Any]) -> str:
    encoded = json.dumps(request, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def predict(request: dict[str, Any]) -> dict[str, Any]:
    key = _cache_key(request)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return {**cached, "cached": True}

    candles = request["candles"]
    frame = pd.DataFrame(candles)
    x_timestamp = pd.Series(pd.to_datetime(frame["time"], unit="s", utc=True).dt.tz_localize(None))
    x_df = frame[["open", "high", "low", "close", "volume"]].copy()
    x_df["amount"] = x_df["volume"] * x_df[["open", "high", "low", "close"]].mean(axis=1)

    last_timestamp = x_timestamp.iloc[-1]
    interval = pd.Timedelta(seconds=request["intervalSeconds"])
    y_timestamp = pd.Series(pd.date_range(start=last_timestamp + interval, periods=request["predictionLength"], freq=interval))

    predictor = get_predictor(request["model"])
    with _inference_lock:
        prediction = predictor.predict(
            df=x_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=request["predictionLength"],
            T=request["temperature"],
            top_k=request["topK"],
            top_p=request["topP"],
            sample_count=request["sampleCount"],
            verbose=False,
        )

    forecast = []
    for timestamp, row in prediction.iterrows():
        open_price = max(0.00000001, float(row["open"]))
        close_price = max(0.00000001, float(row["close"]))
        high_price = max(open_price, close_price, float(row["high"]))
        low_price = max(0.00000001, min(open_price, close_price, float(row["low"])))
        forecast.append({
            "time": int(pd.Timestamp(timestamp).timestamp()),
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": max(0.0, float(row["volume"])),
        })

    result = {
        "model": request["model"],
        "lastCandleTime": int(candles[-1]["time"]),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "forecast": forecast,
        "cached": False,
    }
    with _cache_lock:
        _cache[key] = result
        _cache.move_to_end(key)
        while len(_cache) > MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenTerminal-Kronos/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[kronos] {self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self.send_json(HTTPStatus.OK, {
            "ok": True,
            "loadedModels": sorted(_predictors),
            "device": os.environ.get("KRONOS_DEVICE", "auto"),
        })

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/predict":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                raise RequestError("request body is empty or too large")
            payload = json.loads(self.rfile.read(content_length))
            request = validate_request(payload)
            self.send_json(HTTPStatus.OK, predict(request))
        except (RequestError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # Keep model/library details out of the client response.
            print(f"[kronos] inference failed: {error!r}", flush=True)
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Kronos inference unavailable"})


def main() -> None:
    host = os.environ.get("KRONOS_HOST", "127.0.0.1")
    port = int(os.environ.get("KRONOS_PORT", "8001"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Kronos inference service listening on http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
