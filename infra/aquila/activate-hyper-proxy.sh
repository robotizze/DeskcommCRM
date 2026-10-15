#!/usr/bin/env bash
# Acrescenta somente o Aquila ao Caddy existente, sem recriar containers.
set -Eeuo pipefail
umask 077
MODE="${1:---plan}"
[[ $# -le 1 && ( "$MODE" == --plan || "$MODE" == --apply ) ]] || { echo 'Use --plan ou --apply.' >&2; exit 1; }
if [[ "$MODE" == --plan ]]; then
  printf '%s\n' 'Conferir app privado, proxy vigente e os quatro domínios existentes.' \
    'Preparar backups privados e candidatos; validar Caddy e Compose completos.' \
    'Conectar apenas o Caddy à rede nova e persistir essa rede em compose.public.yaml.' \
    'Acrescentar o domínio ao arquivo montado, recarregar e verificar os domínios antigos.' \
    'DNS é aplicado separadamente. Sem recriação de containers ou volumes.'
  exit 0
fi
die() { printf '%s\n' "$1" >&2; exit 1; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ "$ROOT" == /srv/aquila/imob && "$(hostname -s)" == aquila-hyper ]] || die 'Execute somente na Hyper, do checkout /srv/aquila/imob.'
[[ -f "$ROOT/.runtime/private-app-ready" ]] || die 'Primeiro conclua a instalação privada do Aquila.'
[[ $EUID == 0 ]] || die 'Este procedimento precisa de sudo para os arquivos do proxy e Docker.'
CONFIG=/home/newxai9_gmail_com/aquila3/config
CADDYFILE="$CONFIG/Caddyfile"
PUBLIC_COMPOSE="$CONFIG/compose.public.yaml"
PROXY=aquila3-public-web-1
NETWORK=aquila-imob-ingress
for file in "$CADDYFILE" "$PUBLIC_COMPOSE" "$CONFIG/.env.hyper"; do
  [[ -f "$file" && ! -L "$file" ]] || die 'Arquivo vigente ausente ou link simbólico; revisar o destino.'
done
exec 9>"$ROOT/.runtime/proxy.lock"
flock -n 9 || die 'Outra ativação do proxy está em execução.'
[[ "$(docker inspect --format '{{.State.Running}}' "$PROXY")" == true ]] || die 'Caddy vigente não está executando.'
[[ "$(docker network inspect --format '{{index .Labels "aquila.application"}}' "$NETWORK")" == aquila-imob ]] \
  || die 'Rede de ingresso não pertence à instalação Aquila.'
curl --fail --silent http://127.0.0.1:13000/extensoes/catalogo.json \
  | python3 -c 'import json,sys; assert json.load(sys.stdin)["origin"] == "https://imob.aquila.ia.br"' \
  || die 'App privado ainda não responde com o catálogo correto.'
BACKUP="$ROOT/.runtime/proxy-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$BACKUP"
LOG="$BACKUP/activation.log"
touch "$LOG"
cp "$CADDYFILE" "$BACKUP/Caddyfile.before"
cp "$PUBLIC_COMPOSE" "$BACKUP/compose.public.before.yaml"
chmod 600 "$BACKUP"/*
DOMAINS=(v3.aquila.ia.br coolify.aquila.ia.br app.aquila.ia.br registry.aquila.ia.br)
http_status() { curl --silent --show-error --max-time 30 --resolve "$1:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$1/"; }
for domain in "${DOMAINS[@]}"; do
  status="$(http_status "$domain")"
  [[ "$status" =~ ^[234][0-9][0-9]$ ]] || die 'Um domínio existente já está indisponível; revisar antes da alteração.'
  printf '%s\n' "$status" > "$BACKUP/$domain.status"
done
docker ps --format '{{.ID}} {{.Names}}' | sort > "$BACKUP/containers.before"
python3 - "$CADDYFILE" "$PUBLIC_COMPOSE" "$ROOT/infra/aquila/Caddyfile.hyper-supabase" "$BACKUP" <<'PY' >> "$LOG" 2>&1
import pathlib,re,sys
caddy,compose,fragment,backup=map(pathlib.Path,sys.argv[1:])
text=caddy.read_text()
expected={'v3.aquila.ia.br','coolify.aquila.ia.br','app.aquila.ia.br','registry.aquila.ia.br'}
assert set(re.findall(r'^([a-z0-9.-]+)\s*\{\s*$',text,re.M))==expected, 'Domínios vigentes divergiram.'
assert 'imob.aquila.ia.br' not in text, 'Domínio já configurado; revisar sem duplicar.'
public=compose.read_text()
assert public.count('      harbor_ingress: {}')==1, 'Âncora da rede do serviço divergiu.'
assert public.count('\nnetworks:\n')==1, 'Âncora das redes divergiu.'
assert 'aquila-imob-ingress' not in public and 'aquila_imob_ingress:' not in public, 'Rede já persistida; revisar.'
candidate=public.replace('      harbor_ingress: {}','      harbor_ingress: {}\n      aquila_imob_ingress: {}')
candidate+='\n  aquila_imob_ingress:\n    external: true\n    name: aquila-imob-ingress\n'
(backup/'compose.public.candidate.yaml').write_text(candidate)
(backup/'Caddyfile.candidate').write_text(text.rstrip()+'\n\n'+fragment.read_text())
PY
COMPOSE=(docker compose --project-directory "$CONFIG" -p aquila3 --env-file "$CONFIG/.env.hyper" \
  -f "$CONFIG/compose.yaml" -f "$CONFIG/compose.hyper.yaml" -f "$CONFIG/compose.pur.yaml")
"${COMPOSE[@]}" -f "$BACKUP/compose.public.candidate.yaml" config --quiet >> "$LOG" 2>&1
docker cp "$BACKUP/Caddyfile.candidate" "$PROXY:/tmp/aquila-imob-Caddyfile" >> "$LOG" 2>&1
docker exec "$PROXY" caddy validate --config /tmp/aquila-imob-Caddyfile --adapter caddyfile >> "$LOG" 2>&1
CONNECTED=0
CHANGED=0
restore_file() {
  # Mantém o inode: o Caddy recebe este arquivo por bind mount somente leitura.
  python3 - "$1" "$2" <<'PY'
import os,pathlib,sys
with open(sys.argv[2],'wb') as destination:
    destination.write(pathlib.Path(sys.argv[1]).read_bytes())
    destination.flush()
    os.fsync(destination.fileno())
PY
}
rollback() {
  trap - ERR
  if [[ "$CHANGED" == 1 ]]; then
    restore_file "$BACKUP/Caddyfile.before" "$CADDYFILE"
    restore_file "$BACKUP/compose.public.before.yaml" "$PUBLIC_COMPOSE"
    docker exec "$PROXY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >> "$LOG" 2>&1 || true
  fi
  if [[ "$CONNECTED" == 1 ]]; then docker network disconnect "$NETWORK" "$PROXY" >> "$LOG" 2>&1 || true; fi
  printf 'Ativação interrompida; arquivos anteriores restaurados. Consulte o log privado de ativação.\n' >&2
  exit 1
}
trap rollback ERR
if ! docker inspect --format '{{json .NetworkSettings.Networks}}' "$PROXY" | python3 -c 'import json,sys; sys.exit(0 if "aquila-imob-ingress" in json.load(sys.stdin) else 1)'; then
  docker network connect "$NETWORK" "$PROXY" >> "$LOG" 2>&1
  CONNECTED=1
fi
CHANGED=1
restore_file "$BACKUP/compose.public.candidate.yaml" "$PUBLIC_COMPOSE"
restore_file "$BACKUP/Caddyfile.candidate" "$CADDYFILE"
"${COMPOSE[@]}" -f "$PUBLIC_COMPOSE" config --quiet >> "$LOG" 2>&1
docker exec "$PROXY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >> "$LOG" 2>&1
docker exec "$PROXY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >> "$LOG" 2>&1
for domain in "${DOMAINS[@]}"; do
  [[ "$(http_status "$domain")" == "$(<"$BACKUP/$domain.status")" ]]
done
docker ps --format '{{.ID}} {{.Names}}' | sort > "$BACKUP/containers.after"
cmp --silent "$BACKUP/containers.before" "$BACKUP/containers.after"
trap - ERR
printf '%s\n' 'Novo bloco do Aquila carregado; os quatro domínios e containers anteriores continuam respondendo.' \
  'Rede adicional persistida no compose vigente. DNS e prova do novo HTTPS são a próxima etapa.'
