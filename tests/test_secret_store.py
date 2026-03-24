import unittest
from unittest.mock import Mock, patch

from secret_store import (
    delete_groq_api_key,
    get_groq_api_key_status,
    has_groq_api_key,
    load_groq_api_key,
    store_groq_api_key,
)


class SecretStoreTest(unittest.TestCase):
    def test_round_trip_save_load_delete(self) -> None:
        store_data: dict[str, str] = {}
        fake_path = Mock()
        fake_path.exists.return_value = True
        fake_path.unlink.side_effect = lambda missing_ok=True: store_data.clear()

        def fake_read_store() -> dict[str, str]:
            return dict(store_data)

        def fake_write_store(payload: dict[str, str]) -> None:
            store_data.clear()
            store_data.update(payload)

        with (
            patch("secret_store._read_store", side_effect=fake_read_store),
            patch("secret_store._write_store", side_effect=fake_write_store),
            patch("secret_store._store_path", return_value=fake_path),
        ):
            self.assertFalse(has_groq_api_key())

            store_groq_api_key("gsk_test_local_key_123")

            self.assertTrue(has_groq_api_key())
            self.assertEqual(load_groq_api_key(), "gsk_test_local_key_123")

            status = get_groq_api_key_status()
            self.assertTrue(status["has_api_key"])
            self.assertEqual(status["storage_mode"], "windows_dpapi")

            delete_groq_api_key()

            self.assertFalse(store_data)
            self.assertFalse(has_groq_api_key())
            self.assertFalse(get_groq_api_key_status()["has_api_key"])

    def test_load_without_saved_key_raises_value_error(self) -> None:
        with patch("secret_store._read_store", return_value={}):
            with self.assertRaises(ValueError):
                load_groq_api_key()


if __name__ == "__main__":
    unittest.main()
