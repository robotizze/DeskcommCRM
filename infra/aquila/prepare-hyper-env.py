#!/usr/bin/env python3
"""Gera o ambiente da instalação NOVA; nunca imprime nem troca chaves existentes."""

import argparse
import base64
import hashlib
import os
import re
import secrets
from pathlib import Path
from urllib.parse import quote

DOMAIN = "https://imob.aquila.ia.br"


def read_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if match:
            value = match[2].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[match[1]] = value
    return values


def private_write(path, content, exclusive=True):
    if path.is_symlink():
        raise ValueError("Arquivo privado não pode ser link simbólico.")
    target = path if exclusive else path.with_name(path.name + ".aquila-new")
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
    os.chmod(target, 0o600)
    if not exclusive:
        os.replace(target, path)


def env_lines(values):
    # Os arquivos do app também são lidos por docker run --env-file (sem shell).
    for value in values.values():
        if "\n" in value or "\r" in value or "$" in value:
            raise ValueError("Valor incompatível com arquivo de ambiente privado.")
    return "".join(f"{key}={value}\n" for key, value in values.items())


def prepare(root, version, owner_email):
    root = root.resolve(strict=True)
    runtime = root / ".runtime"
    supabase_env = runtime / "supabase" / ".env"
    marker = runtime / "aquila-env-prepared"
    if runtime.is_symlink() or supabase_env.is_symlink():
        raise ValueError("Diretório de estado não pode ser link simbólico.")
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("Versão deve ser X.Y.Z.")
    if not re.fullmatch(r"[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", owner_email):
        raise ValueError("E-mail do dono inválido.")
    if marker.exists():
        if marker.read_text(encoding="utf-8").strip() != version:
            raise ValueError("Versão diferente: atualização exige procedimento próprio.")
        owner = read_env(runtime / "owner-credentials.env")
        if owner.get("OWNER_EMAIL") != owner_email:
            raise ValueError("Dono diferente: não substituir credenciais existentes.")
        for path in [root / ".env", runtime / "owner-credentials.env", runtime / "seed-secrets.sql"]:
            if not path.is_file() or path.is_symlink():
                raise ValueError("Estado privado incompleto; revisar antes de retomar.")
        return
    if (root / ".env").exists() or (runtime / "owner-credentials.env").exists():
        raise ValueError("Ambiente existente sem marcador: revisar, sem sobrescrever.")

    sb = read_env(supabase_env)
    for key in ["ANON_KEY", "SERVICE_ROLE_KEY", "POSTGRES_PASSWORD", "JWT_SECRET"]:
        if not sb.get(key) or sb[key].startswith("your-"):
            raise ValueError("Setup oficial não concluiu a geração das chaves.")
    changes = {
        "SUPABASE_PUBLIC_URL": DOMAIN,
        "API_EXTERNAL_URL": DOMAIN + "/auth/v1",
        "SITE_URL": DOMAIN,
        "ADDITIONAL_REDIRECT_URLS": DOMAIN + "/auth/confirm," + DOMAIN + "/**",
        "PROXY_DOMAIN": "imob.aquila.ia.br",
        "COMPOSE_PROJECT_NAME": "aquila-imob-supabase",
        "COMPOSE_FILE": "docker-compose.yml:supabase-hyper.override.yml",
        "API_GW_HTTP_PORT": "18001",
        "DISABLE_SIGNUP": "true",
        "ENABLE_EMAIL_AUTOCONFIRM": "false",
        "GOTRUE_MAILER_TEMPLATES_CONFIRMATION": "http://aquila-imob-app:3000/email-templates/confirmation",
        "GOTRUE_MAILER_TEMPLATES_RECOVERY": "http://aquila-imob-app:3000/email-templates/recovery",
        # Vazio até a configuração do transporte real; não usar o SMTP de exemplo.
        "SMTP_HOST": "",
        "SMTP_ADMIN_EMAIL": "",
        "SMTP_USER": "",
        "SMTP_PASS": "",
        "SMTP_SENDER_NAME": "Aquila Imob",
    }
    updated = []
    remaining = dict(changes)
    for line in supabase_env.read_text(encoding="utf-8").splitlines():
        key = line.split("=", 1)[0]
        if key in changes:
            updated.append(f"{key}={changes[key]}")
            remaining.pop(key, None)
        else:
            updated.append(line)
    updated.append(env_lines(remaining).rstrip("\n"))
    private_write(supabase_env, "\n".join(updated) + "\n", exclusive=False)

    random_hex = lambda: secrets.token_hex(32)
    random_b64 = lambda: base64.b64encode(secrets.token_bytes(32)).decode("ascii")
    waha_key, redis_key = random_hex(), random_hex()
    app = {
        "AQUILA_VERSION": version,
        "NODE_ENV": "production",
        "APP_NAME": "Aquila Imob",
        "APP_LOCALE": "pt-BR",
        "DOMAIN": "imob.aquila.ia.br",
        "NEXT_PUBLIC_APP_URL": DOMAIN,
        "NEXT_PUBLIC_ADMIN_URL": DOMAIN,
        "NEXT_PUBLIC_SUPABASE_URL": DOMAIN,
        "SUPABASE_SERVER_URL": "http://aquila-imob-envoy:8000",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": sb["ANON_KEY"],
        "SUPABASE_SERVICE_ROLE_KEY": sb["SERVICE_ROLE_KEY"],
        "SUPABASE_DB_URL": "postgresql://postgres:" + quote(sb["POSTGRES_PASSWORD"], safe="") + "@aquila-imob-db:5432/postgres",
        "INTERNAL_SECRET": random_hex(),
        "INTERNAL_CRON_SECRET": random_hex(),
        "NUVEMSHOP_OAUTH_ENCRYPTION_KEY": random_hex(),
        "CPF_ENCRYPTION_KEY": random_b64(),
        "AI_CRED_AES_KEY": random_b64(),
        "WAHA_BYO_ENCRYPTION_KEY": random_b64(),
        "IMPERSONATE_COOKIE_SECRET": random_hex(),
        "LGPD_SIGNING_KEY": random_hex(),
        "WAHA_API_BASE_URL": "http://waha:3000",
        "WAHA_WEBHOOK_BASE_URL": "http://app:3000",
        "WAHA_API_KEY": waha_key,
        "WAHA_API_KEY_SHA512": hashlib.sha512(waha_key.encode()).hexdigest(),
        "WAHA_HMAC_SECRET": random_hex(),
        "WAHA_WEBHOOK_REQUIRE_SIGNATURE": "false",
        "WHATSAPP_DEFAULT_ENGINE": "NOWEB",
        "WHATSAPP_RESTART_ALL_SESSIONS": "True",
        "WAHA_IMAGE": "devlikeapro/waha:latest-2026.7.2",
        "UPSTASH_REDIS_REST_URL": "http://srh:80",
        "UPSTASH_REDIS_REST_TOKEN": redis_key,
        "SRH_TOKEN": redis_key,
        "SIGNUP_MODE": "so_convite",
        "COMPOSE_PROFILES": "",
        "TENANT_PROVISIONING_SECRET": "",
        "NUVEMSHOP_ENABLED": "false",
        "INTERNAL_AGENT_RUN_STUB": "false",
        "SENTRY_DSN": "off",
    }
    owner = {"OWNER_EMAIL": owner_email, "OWNER_PASSWORD": random_hex(), "OWNER_ORG_NAME": "Aquila Imob"}
    private_write(root / ".env", env_lines(app))
    private_write(runtime / "owner-credentials.env", env_lines(owner))
    sql_values = [("nuvemshop_oauth_key", app["NUVEMSHOP_OAUTH_ENCRYPTION_KEY"]), ("cpf_key", app["CPF_ENCRYPTION_KEY"])]
    sql = "BEGIN;\n" + "".join(
        "INSERT INTO private.app_secrets (name, value) VALUES ('" + key + "', '" + value.replace("'", "''") + "') ON CONFLICT (name) DO NOTHING;\n"
        for key, value in sql_values
    ) + "COMMIT;\n"
    private_write(runtime / "seed-secrets.sql", sql)
    private_write(marker, version + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--owner-email", required=True)
    args = parser.parse_args()
    try:
        prepare(args.root, args.version, args.owner_email)
    except (OSError, ValueError) as error:
        # Os erros da aplicação usam mensagens sem valores das chaves.
        raise SystemExit(str(error)) from None
