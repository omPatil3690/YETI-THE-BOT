from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path
from typing import Any
from ctypes import wintypes

APP_DIR_NAME = "YetiBot"
STORE_FILE_NAME = "credentials.json"
CRYPTPROTECT_UI_FORBIDDEN = 0x01


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


if os.name != "nt":
    raise RuntimeError("Encrypted local API-key storage is currently implemented for Windows only.")

crypt32 = ctypes.windll.crypt32
kernel32 = ctypes.windll.kernel32

crypt32.CryptProtectData.argtypes = [
    ctypes.POINTER(DATA_BLOB),
    wintypes.LPCWSTR,
    ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DATA_BLOB),
]
crypt32.CryptProtectData.restype = wintypes.BOOL

crypt32.CryptUnprotectData.argtypes = [
    ctypes.POINTER(DATA_BLOB),
    ctypes.POINTER(wintypes.LPWSTR),
    ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DATA_BLOB),
]
crypt32.CryptUnprotectData.restype = wintypes.BOOL

kernel32.LocalFree.argtypes = [ctypes.c_void_p]
kernel32.LocalFree.restype = ctypes.c_void_p


def _storage_dir() -> Path:
    override = os.getenv("YETI_BOT_DATA_DIR")
    if override:
        base_dir = Path(override)
    else:
        base_dir = Path(os.getenv("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        base_dir = base_dir / APP_DIR_NAME

    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


def _store_path() -> Path:
    return _storage_dir() / STORE_FILE_NAME


def _blob_from_bytes(data: bytes) -> tuple[DATA_BLOB, ctypes.Array[Any]]:
    buffer = ctypes.create_string_buffer(data, len(data))
    blob = DATA_BLOB(
        cbData=len(data),
        pbData=ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)),
    )
    return blob, buffer


def _protect_bytes(data: bytes) -> bytes:
    input_blob, _buffer = _blob_from_bytes(data)
    output_blob = DATA_BLOB()
    success = crypt32.CryptProtectData(
        ctypes.byref(input_blob),
        "Yeti Bot Groq API Key",
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not success:
        raise RuntimeError("Windows could not encrypt the API key locally.")

    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        if output_blob.pbData:
            kernel32.LocalFree(output_blob.pbData)


def _unprotect_bytes(data: bytes) -> bytes:
    input_blob, _buffer = _blob_from_bytes(data)
    output_blob = DATA_BLOB()
    success = crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not success:
        raise ValueError("The saved Groq API key could not be decrypted. Delete it and save it again.")

    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        if output_blob.pbData:
            kernel32.LocalFree(output_blob.pbData)


def _read_store() -> dict[str, Any]:
    path = _store_path()
    if not path.exists():
        return {}

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("The saved credential store is corrupted. Delete the stored key and save it again.") from exc


def _write_store(payload: dict[str, Any]) -> None:
    path = _store_path()
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def store_groq_api_key(api_key: str) -> None:
    cleaned_key = api_key.strip()
    if not cleaned_key:
        raise ValueError("Please enter a Groq API key before saving.")

    encrypted_key = _protect_bytes(cleaned_key.encode("utf-8"))
    payload = _read_store()
    payload["groq_api_key"] = base64.b64encode(encrypted_key).decode("ascii")
    _write_store(payload)


def load_groq_api_key() -> str:
    payload = _read_store()
    encoded_key = payload.get("groq_api_key")
    if not encoded_key:
        raise ValueError("No Groq API key is saved yet. Open the extension and save your own key first.")

    try:
        encrypted_key = base64.b64decode(encoded_key)
    except ValueError as exc:
        raise ValueError("The saved Groq API key is unreadable. Delete it and save it again.") from exc

    return _unprotect_bytes(encrypted_key).decode("utf-8")


def delete_groq_api_key() -> None:
    path = _store_path()
    if not path.exists():
        return

    try:
        payload = _read_store()
    except ValueError:
        path.unlink(missing_ok=True)
        return

    if "groq_api_key" not in payload:
        return

    payload.pop("groq_api_key", None)
    if payload:
        _write_store(payload)
        return

    path.unlink(missing_ok=True)


def has_groq_api_key() -> bool:
    try:
        load_groq_api_key()
    except ValueError:
        return False
    return True


def get_groq_api_key_status() -> dict[str, Any]:
    try:
        load_groq_api_key()
    except ValueError as exc:
        return {
            "has_api_key": False,
            "provider": "groq",
            "storage_mode": "windows_dpapi",
            "message": str(exc),
        }

    return {
        "has_api_key": True,
        "provider": "groq",
        "storage_mode": "windows_dpapi",
        "message": "Your Groq API key is saved locally in encrypted form and ready to use.",
    }
