#!/usr/bin/env bash
# Primeiro deploy PRIVADO do Aquila. Não altera DNS, Caddy ou aplicações antigas.
set -Eeuo pipefail
umask 077

MODE=plan
VERSION=0.1.0
OWNER_EMAIL=superadmin@robotizze.us
while (( $# )); do
  case "$1" in
    --apply) MODE=apply; shift ;;
    --plan) MODE=plan; shift ;;
    --version) VERSION="${2:?Informe X.Y.Z}"; shift 2 ;;
    --owner-email) OWNER_EMAIL="${2:?Informe o e-mail}"; shift 2 ;;
    *) printf 'Opção desconhecida. Use --plan ou --apply --version X.Y.Z.\n' >&2; exit 1 ;;
  esac
done
[[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'Versão deve ser X.Y.Z.' >&2; exit 1; }
if [[ "$MODE" == plan ]]; then
  printf '%s\n' 'Destino exclusivo: /srv/aquila/imob; Supabase aquila-imob-supabase.' \
    'Verificar revisão e baixar três imagens próprias já publicadas.' \
    'Preparar Supabase oficial fixado, gerar segredos privados e iniciar banco próprio.' \
    'Aplicar baseline apenas em banco novo; criar dono e instalar Imobiliária pelo RPC oficial.' \
    'Iniciar app privado em 127.0.0.1:13000. Proxy e DNS são aplicados separadamente.'
  exit 0
fi

die() { printf '%s\n' "$1" >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ "$ROOT" == /srv/aquila/imob ]] || die 'Execute somente do checkout próprio /srv/aquila/imob.'
[[ "$(hostname -s)" == aquila-hyper ]] || die 'Destino não é a Hyper confirmada.'
for tool in docker git python3 curl openssl jq sha256sum flock ss; do
  command -v "$tool" >/dev/null || die "Dependência ausente: $tool (nenhuma instalação global automática)."
done
docker compose version >/dev/null || die 'Docker Compose indisponível.'
[[ "$(uname -m)" == x86_64 ]] || die 'Este primeiro deploy Hyper foi preparado para amd64.'
cd "$ROOT"
git diff --quiet && git diff --cached --quiet || die 'Checkout possui alterações; use a revisão publicada.'
REVISION="$(git rev-parse HEAD)"
for file in .env .runtime .runtime/supabase; do
  [[ ! -L "$file" ]] || die 'Estado da instalação não pode ser link simbólico.'
done
mkdir -p .runtime
chmod 700 .runtime
exec 9>.runtime/install.lock
flock -n 9 || die 'Outra instalação Aquila está em execução.'
LOG="$ROOT/.runtime/install.log"
touch "$LOG"
chmod 600 "$LOG"
trap 'printf "Instalação interrompida; consulte o log privado .runtime/install.log. Nenhum segredo foi impresso.\n" >&2' ERR
if [[ -f .runtime/checkout-revision ]]; then
  [[ "$(<.runtime/checkout-revision)" == "$REVISION" ]] || die 'Revisão mudou; atualização precisa de procedimento próprio.'
else
  [[ ! -e .env && ! -e .runtime/supabase ]] || die 'Estado existente sem recibo; revisar sem sobrescrever.'
  printf '%s\n' "$REVISION" > .runtime/checkout-revision
fi

printf 'Verificando as imagens publicadas do Aquila %s.\n' "$VERSION"
for image in aquila-imob aquila-imob-worker aquila-imob-scheduler; do
  reference="ghcr.io/robotizze/$image:$VERSION"
  docker pull "$reference" >> "$LOG" 2>&1
  source="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$reference")"
  revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference")"
  version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$reference")"
  [[ "$source" == https://github.com/robotizze/DeskcommCRM && "$revision" == "$REVISION" && "$version" == "$VERSION" ]] \
    || die 'Imagem e checkout não pertencem à mesma versão/revisão do fork.'
done

ensure_network() {
  local name="$1"
  if docker network inspect "$name" >/dev/null 2>&1; then
    [[ "$(docker network inspect --format '{{index .Labels "aquila.application"}}' "$name")" == aquila-imob ]] \
      || die 'Rede de destino preexistente sem propriedade Aquila; revisar.'
  else
    docker network create --label aquila.application=aquila-imob "$name" >> "$LOG" 2>&1
  fi
}
if [[ ! -f .runtime/supabase/.env ]]; then
  for port in 13000 18001; do
    [[ -z "$(ss -H -ltn "sport = :$port")" ]] || die 'Porta reservada já está em uso; revisar destino.'
  done
  [[ "$(git ls-remote https://github.com/supabase/supabase.git refs/tags/self-hosted/v0.8.1 | cut -f1)" == 690080884040e238926ba22606e8c05a3536829b ]] \
    || die 'A referência oficial mudou; revisar o snapshot antes de instalar.'
  curl --fail --silent --show-error --location \
    'https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.1/docker/setup.sh' \
    --output .runtime/supabase-setup.sh >> "$LOG" 2>&1
  printf '%s  %s\n' '848973911bd5fa03dfd714b67bff4132e49b1b7777b6edb6ab0a9d9e85bc813c' '.runtime/supabase-setup.sh' \
    | sha256sum --check --status || die 'Setup oficial não passou no SHA-256.'
  # --skip-deps não instala pacotes nem reinicia Docker. O setup não faz up.
  # Configs montadas precisam ser legíveis pelos usuários dos containers. O
  # diretório pai .runtime continua 700; a .env será explicitamente 600.
  (umask 022; sh .runtime/supabase-setup.sh -y --skip-deps --ref self-hosted/v0.8.1 --project-dir .runtime/supabase) >> "$LOG" 2>&1
fi
# O setup oficial add-new-auth-keys.sh guarda a origem em .old e habilita
# quatro campos JWT no compose gerado. Os dois snapshots são fixados: não
# aceitar o hash do arquivo cru como se ainda fosse o resultado do setup.
printf '%s  %s\n' 'f6724c97f1ca555b700f5ecf630e8a2e5114682b64ca94158061326187139183' '.runtime/supabase/docker-compose.yml.old' \
  | sha256sum --check --status || die 'Compose original divergiu da referência revisada.'
printf '%s  %s\n' '2cada25b2bcd5b52eb6c6d4cd5de8c0adeb2a7433ffe701991dd24ec13ca618a' '.runtime/supabase/docker-compose.yml' \
  | sha256sum --check --status || die 'Compose gerado pelo setup oficial divergiu do snapshot revisado.'
cp infra/aquila/supabase-hyper.override.yml .runtime/supabase/supabase-hyper.override.yml
python3 infra/aquila/prepare-hyper-env.py --root "$ROOT" --version "$VERSION" --owner-email "$OWNER_EMAIL" >> "$LOG" 2>&1
ensure_network aquila-imob-ingress
ensure_network aquila-imob-supabase
SB=(docker compose --project-directory "$ROOT/.runtime/supabase" -p aquila-imob-supabase \
  --env-file "$ROOT/.runtime/supabase/.env" -f "$ROOT/.runtime/supabase/docker-compose.yml" \
  -f "$ROOT/.runtime/supabase/supabase-hyper.override.yml")
APP=(docker compose --project-directory "$ROOT" -p aquila-imob --env-file "$ROOT/.env" \
  -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/docker-compose.aquila.yml" \
  -f "$ROOT/docker-compose.aquila-hyper.yml" -f "$ROOT/docker-compose.aquila-supabase.yml")
"${SB[@]}" config --quiet >> "$LOG" 2>&1
"${APP[@]}" config --quiet >> "$LOG" 2>&1
printf 'Iniciando o Supabase privado da instalação.\n'
"${SB[@]}" up -d --wait --wait-timeout 300 >> "$LOG" 2>&1
DB=("${SB[@]}" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1)
if [[ ! -f .runtime/baseline-applied ]]; then
  existing="$("${DB[@]}" -tAc "select to_regclass('public.organizations') is not null;")"
  [[ "$existing" == f ]] || die 'Banco já possui organizações sem recibo; não reaplicar baseline.'
  "${DB[@]}" -c 'create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;' >> "$LOG" 2>&1
  # Transação única: uma falha em banco novo não deixa RLS pela metade.
  "${DB[@]}" --single-transaction < supabase/baseline.sql >> "$LOG" 2>&1
  sha256sum supabase/baseline.sql > .runtime/baseline-applied
fi
if [[ ! -f .runtime/secrets-seeded ]]; then
  "${DB[@]}" < .runtime/seed-secrets.sql >> "$LOG" 2>&1
  touch .runtime/secrets-seeded
fi
"${DB[@]}" -c "notify pgrst, 'reload schema';" >> "$LOG" 2>&1
if [[ ! -f .runtime/owner-created ]]; then
  existing="$("${DB[@]}" -tAc 'select count(*) from auth.users;')"
  [[ "$existing" == 0 ]] || die 'Auth já possui usuários sem recibo; não trocar senha nem criar outro dono.'
  # Credenciais via arquivo privado, nunca argumento; rede exclusiva do banco.
  docker run --rm --network aquila-imob-supabase --env-file "$ROOT/.env" \
    --env-file "$ROOT/.runtime/owner-credentials.env" \
    -e NEXT_PUBLIC_SUPABASE_URL=http://aquila-imob-envoy:8000 \
    "ghcr.io/robotizze/aquila-imob-worker:$VERSION" pnpm exec tsx scripts/bootstrap-owner.ts >> "$LOG" 2>&1
  touch .runtime/owner-created
fi
if [[ ! -f .runtime/imobiliaria-installed ]]; then
  # Ator real criado pelo bootstrap: provisionadora + recibo oficiais, sem DDL paralelo.
  "${DB[@]}" <<'SQL' >> "$LOG" 2>&1
do $$
declare v_actor uuid; v_op uuid := gen_random_uuid(); v_result jsonb;
begin
  select user_id into strict v_actor from public.platform_admins where revoked_at is null;
  v_result := public.fn_modulo_instalar(v_actor, v_op, 'imobiliaria');
  if (v_result->>'applied_now')::boolean then
    insert into public.api_audit_log (action, actor_user_id, acting_as_platform_admin, bypassed_rls, resource_type, resource_id, metadata)
    values ('modulo.instalado', v_actor, true, true, 'modulos_instalados', v_op, jsonb_build_object('modulo', 'imobiliaria', 'operation_id', v_op));
  end if;
end $$;
SQL
  touch .runtime/imobiliaria-installed
fi
printf 'Iniciando o app privado, transporte e tarefas do Aquila.\n'
"${APP[@]}" pull app worker scheduler waha redis srh >> "$LOG" 2>&1
# Lista explícita evita habilitar Caddy/voz por um profile externo.
"${APP[@]}" up -d --wait --wait-timeout 240 app worker scheduler waha redis srh >> "$LOG" 2>&1
curl --fail --silent --show-error 'http://127.0.0.1:13000/extensoes/catalogo.json' \
  | python3 -c 'import json,sys; assert json.load(sys.stdin)["origin"] == "https://imob.aquila.ia.br"' >> "$LOG" 2>&1
touch .runtime/private-app-ready
printf '%s\n' 'Aquila privado responde. Credenciais apenas em .runtime/owner-credentials.env (600).' \
  'Próximo passo: revisão do Caddy vigente, conexão à rede de ingresso e recarga do novo bloco.' \
  'SMTP, usuários da equipe e sessões WhatsApp são configurados no aplicativo.'
