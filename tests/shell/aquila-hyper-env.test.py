"""Prova isolamento dos segredos e retomada sem rotação involuntária."""

import base64
import contextlib
import hashlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("prepare_aquila", ROOT / "infra/aquila/prepare-hyper-env.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HyperSecretsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aquila-env-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / ".runtime"
        self.sb = self.runtime / "supabase"
        self.sb.mkdir(parents=True)
        (self.sb / ".env").write_text(
            "ANON_KEY=test-anon\nSERVICE_ROLE_KEY=test-service\n"
            "POSTGRES_PASSWORD=secret:/@password\nJWT_SECRET=test-jwt\n"
            "SMTP_HOST=supabase-mail\nSMTP_USER=fake-user\nSMTP_PASS=fake-pass\n",
            encoding="utf-8",
        )

    def prepare(self, **kwargs):
        helper.prepare(self.root, kwargs.get("version", "0.1.0"), kwargs.get("owner", "superadmin@robotizze.us"))

    def test_keys_never_print_and_owner_password_is_outside_app_environment(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.prepare()
        self.assertEqual(output.getvalue(), "")
        app = helper.read_env(self.root / ".env")
        owner = helper.read_env(self.runtime / "owner-credentials.env")
        self.assertNotIn("OWNER_PASSWORD", app)
        self.assertNotEqual(owner["OWNER_PASSWORD"], app["WAHA_API_KEY"])
        for key in ["CPF_ENCRYPTION_KEY", "AI_CRED_AES_KEY", "WAHA_BYO_ENCRYPTION_KEY"]:
            self.assertEqual(len(base64.b64decode(app[key])), 32)
        self.assertEqual(hashlib.sha512(app["WAHA_API_KEY"].encode()).hexdigest(), app["WAHA_API_KEY_SHA512"])
        self.assertEqual(app["SRH_TOKEN"], app["UPSTASH_REDIS_REST_TOKEN"])
        self.assertIn("secret%3A%2F%40password@aquila-imob-db", app["SUPABASE_DB_URL"])
        self.assertEqual(app["SIGNUP_MODE"], "so_convite")

    def test_internal_auth_templates_and_empty_smtp_survive_same_version_resume(self):
        self.prepare()
        private_files = [self.root / ".env", self.runtime / "owner-credentials.env", self.sb / ".env"]
        before = [path.read_bytes() for path in private_files]
        self.prepare()
        self.assertEqual(before, [path.read_bytes() for path in private_files])
        sb = helper.read_env(self.sb / ".env")
        self.assertEqual(sb["GOTRUE_MAILER_TEMPLATES_RECOVERY"], "http://aquila-imob-app:3000/email-templates/recovery")
        self.assertEqual(sb["ENABLE_EMAIL_AUTOCONFIRM"], "false")
        self.assertEqual(sb["SMTP_HOST"], "")
        self.assertEqual(sb["SMTP_PASS"], "")
        if os.name != "nt":
            for path in private_files:
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_existing_unmarked_environment_and_new_owner_are_rejected_without_overwrite(self):
        existing = self.root / ".env"
        existing.write_text("INTERNAL_SECRET=preserve-existing\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(existing.read_text(), "INTERNAL_SECRET=preserve-existing\n")
        existing.unlink()
        self.prepare()
        before = (self.runtime / "owner-credentials.env").read_bytes()
        with self.assertRaises(ValueError):
            self.prepare(owner="another@example.com")
        self.assertEqual(before, (self.runtime / "owner-credentials.env").read_bytes())
        with self.assertRaises(ValueError):
            self.prepare(version="0.2.0")

    def test_unfinished_official_setup_does_not_create_app_credentials(self):
        (self.sb / ".env").write_text("ANON_KEY=your-anon-key\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse((self.root / ".env").exists())
        self.assertFalse((self.runtime / "owner-credentials.env").exists())


if __name__ == "__main__":
    unittest.main()
