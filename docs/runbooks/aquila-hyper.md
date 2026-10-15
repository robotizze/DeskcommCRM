# Aquila Imob na VPS Hyper

Destino confirmado por consulta e SSH em 15/10/2026: instância `aquila-hyper`,
projeto `aquila-485600`, zona `us-central1-a`, ID `1329830132519476126`, usuário
OS Login `newxai9_gmail_com`. O endereço público observado é `136.71.136.5`,
efêmero; reconsulte antes de ajustar DNS. Acesso administrativo por IAP com a
chave local já existente `C:/Users/scarn/.ssh/aquila-hyper-lab`.

A Hyper já atende Finance, painel Coolify, outro aplicativo Aquila e Harbor.
Não iniciar o Caddy do compose base nem substituir os bancos ou volumes dessas
aplicações. A inspeção somente leitura encontrou Compose 5.6.0, aproximadamente
29 GiB de RAM disponíveis e 107 GiB livres em `/srv/aquila`; isso é um retrato,
não um benchmark ou reserva de capacidade.

## Proxy existente e topologia própria

O container `aquila3-public-web-1` é o proprietário de 80/443. Seu Caddyfile vem
de `/home/newxai9_gmail_com/aquila3/config/Caddyfile`, e já contém:

- `v3.aquila.ia.br` — Finance, SPA e `/api/*`.
- `coolify.aquila.ia.br` — painel e caminhos WebSocket.
- `app.aquila.ia.br` — outro aplicativo Aquila.
- `registry.aquila.ia.br` — Harbor.

O novo aplicativo deve usar o projeto Compose `aquila-imob`, em diretório próprio
em `/srv/aquila/imob`. A rede **nova** `aquila-imob-ingress` contém o
aplicativo, seu gateway Supabase e o proxy que os atende. Redis, WAHA e o banco não entram nas redes do
Finance ou do painel. A porta de diagnóstico do app é `127.0.0.1:13000`; estava
livre na inspeção e deve ser conferida novamente antes da aplicação.

Artefatos preparados:

| Arquivo                                    | Finalidade                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `docker-compose.aquila.yml`                | Trio de imagens próprias, marca e versão.                                               |
| `docker-compose.aquila-hyper.yml`          | Desliga o Caddy próprio, liga o app à rede nova e abre apenas diagnóstico em loopback.  |
| `docker-compose.aquila-supabase.yml`       | Opcional: liga app e worker ao Supabase próprio.                                        |
| `infra/aquila/supabase-hyper.override.yml` | Supabase oficial sem nomes globais, banco privado e gateway em loopback.                |
| `infra/aquila/Caddyfile.hyper-app`         | Bloco do novo domínio quando Supabase é externo.                                        |
| `infra/aquila/Caddyfile.hyper-supabase`    | Bloco alternativo com as seis superfícies do Supabase próprio.                          |
| `infra/aquila/install-hyper.sh`            | Primeiro deploy privado, com verificações e recibos de cada etapa.                      |
| `infra/aquila/prepare-hyper-env.py`        | Geração de ambiente e credenciais privados, sem imprimir ou trocar segredos existentes. |
| `infra/aquila/activate-hyper-proxy.sh`     | Valida e acrescenta o bloco no Caddy existente, com backup e restauração se falhar.     |

Nenhum desses arquivos foi aplicado à Hyper como parte da inspeção. A publicação
das imagens e o banco próprio precisam estar prontos antes de iniciar o app.

## Banco próprio na Hyper

A escolha desta instalação é **Supabase próprio na Hyper**, sem dependência dos
bancos dos outros aplicativos. A alternativa externa abaixo é apenas uma opção
de portabilidade do fork.

**Supabase externo:** use um projeto novo, com URL e chaves próprias. Não aplique
`docker-compose.aquila-supabase.yml`; o app usa o endereço público desse projeto.
O proxy recebe o bloco `Caddyfile.hyper-app`.

**Supabase na Hyper:** use a referência oficial fixada pela base,
`self-hosted/v0.8.1`. O template existente em
`hostgator-setup-kit/supabase-single-server.override.yml` orientou o novo
override, que retira os nomes globais de todos os serviços e não publica
Postgres ou o pooler. A nova rede `aquila-imob-supabase` pertence apenas a essa
instalação; o gateway também entra na rede de ingresso para ser alcançado pelo
Caddy. Studio continua privado.

O instalador completo `install-single-server.sh` chama o instalador do upstream
e tenta configurar uma stack pública. Ele não é o procedimento de aplicação
desta máquina compartilhada. O setup oficial do Supabase deve preparar somente
o diretório próprio, com os segredos em arquivos privados e sem iniciar portas
globais; use depois o novo override. A existência do template não comprova uma
instalação Supabase feita na Hyper.

O script confere também o commit oficial
`690080884040e238926ba22606e8c05a3536829b`, o SHA-256 do setup e o do compose
revisado. Os onze serviços oficiais têm imagens com versão explícita; analytics
e proxy próprio não são acrescentados. O setup oficial só prepara arquivos,
gera chaves e baixa imagens. Não iniciar seu compose sem o override.

O projeto Compose desse Supabase é `aquila-imob-supabase`. Seu ambiente privado
inclui `SUPABASE_PUBLIC_URL=https://imob.aquila.ia.br`,
`API_EXTERNAL_URL=https://imob.aquila.ia.br/auth/v1`,
`SITE_URL=https://imob.aquila.ia.br`, os redirects do login e
`API_GW_HTTP_PORT=18001`. Cadastro aberto fica desligado e a confirmação de
e-mail continua ligada. Os templates internos apontam para o alias
`aquila-imob-app:3000`. SMTP fica vazio até configurar um transporte real; o
dono inicial já é confirmado pelo bootstrap, e os acessos da equipe seguem o
fluxo de convite da base.

O ambiente privado do app recebe as chaves desse banco novo,
`NEXT_PUBLIC_SUPABASE_URL=https://imob.aquila.ia.br`,
`SUPABASE_SERVER_URL=http://aquila-imob-envoy:8000` e uma conexão PostgreSQL
própria cujo host é `aquila-imob-db`. Nunca copiar a senha PostgreSQL, JWT ou
service key do Finance, do laboratório ou do Imob Flow. Aplique
`supabase/baseline.sql` no banco novo com o procedimento da base, e crie a conta
inicial usando o bootstrap existente.

## Primeiro deploy privado

Depois de publicar o trio de imagens da versão, transfira ou clone **o fork**
para `/srv/aquila/imob` e selecione exatamente o commit registrado nas imagens.
O script recusa outra máquina, outro caminho, uma revisão diferente, uma rede
preexistente sem o rótulo Aquila e um banco com organizações sem recibo. Requer
Docker/Compose, Git, Python 3, curl, OpenSSL, jq, sha256sum, flock e ss já
instalados; não instala dependências globais nem reinicia Docker.

```bash
cd /srv/aquila/imob
bash infra/aquila/install-hyper.sh --plan
sudo bash infra/aquila/install-hyper.sh --apply --version 0.1.0 --owner-email superadmin@robotizze.us
```

`--plan` apenas descreve o procedimento. Após revisão, `--apply` verifica e
baixa as três imagens do fork, prepara o Supabase, gera chaves, inicia os
serviços privados e aplica o baseline numa transação única. Cria o dono com
`scripts/bootstrap-owner.ts` dentro da imagem própria do worker e instala
Imobiliária com `fn_modulo_instalar`, ator real, recibo e auditoria. A stack
termina com o catálogo respondendo em loopback; o domínio permanece uma etapa
separada de proxy/DNS.

`.env`, `.runtime/supabase/.env`, `.runtime/owner-credentials.env`, SQL de
segredos e logs ficam privados, com permissão 600; o diretório `.runtime` é 700.
A senha do dono não entra no ambiente persistente do app nem aparece na saída.
O administrador consulta o arquivo de credenciais pela sessão SSH privada e
troca a senha após o primeiro acesso. Nunca copiar esse arquivo para issues,
logs públicos ou o repositório.

Os marcadores em `.runtime` permitem retomar **a mesma versão**, sem refazer
etapas concluídas ou gerar outras chaves. Uma operação interrompida após criar
usuário mas antes de gravar o recibo pede revisão manual; o script recusa trocar
a senha por conta própria. Esse procedimento não é um atualizador: nova versão
exige backup do banco e revisão das migrations, mantendo chaves e volumes.

A verificação local dos artefatos inclui
`python tests/shell/aquila-hyper-env.test.py`, sintaxe Bash e configuração
Compose mesclada. Isso não comprova instalação remota ou imagens publicadas.

## Aplicar o app após a preparação

Antes de qualquer alteração, confirme imagens publicadas, diretório próprio,
backup do Caddyfile vigente, domínio ainda não cadastrado no proxy, portas livres
e arquivos privados com permissão restrita. Não reiniciar Docker nem alterar
suas configurações para iniciar este aplicativo.

Os comandos abaixo descrevem a aplicação autorizada e ainda precisam ser
executados contra os artefatos publicados. Para Supabase externo:

```bash
docker network create aquila-imob-ingress
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml -f docker-compose.aquila-hyper.yml --env-file .env config --quiet
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml -f docker-compose.aquila-hyper.yml --env-file .env pull app worker scheduler
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml -f docker-compose.aquila-hyper.yml --env-file .env up -d
```

Para Supabase próprio, o script acima já cria as redes e os dois projetos.
Em toda atualização posterior, acrescente
`-f docker-compose.aquila-supabase.yml` em todos os comandos do app. Não recrie
uma rede que já existe sem conferir sua propriedade. Nunca usar `down -v` nesse
procedimento.

Conecte **somente o Caddy existente** à rede de ingresso nova e acrescente o
bloco escolhido ao arquivo vigente, preservando os quatro domínios. O bloco
começa recusando o webhook global do WAHA na borda; o WAHA do Aquila o chama pela
rede interna, e a variante com token mantém seu contrato. Para Supabase próprio,
o bloco encaminha apenas os prefixos públicos da API ao gateway e mantém todo
o restante no aplicativo. O bloco não publica Studio, Redis ou Postgres.

Valide o arquivo completo com `caddy validate` no container antes de recarregar.
Faça uma recarga do Caddy, sem recriar o container ou seus volumes. A conexão
adicional da rede também deve entrar na configuração que mantém o proxy, para
persistir numa futura recriação.

O script preparado faz essa etapa após o app privado estar pronto:

```bash
bash infra/aquila/activate-hyper-proxy.sh --plan
sudo bash infra/aquila/activate-hyper-proxy.sh --apply
```

Ele lê os quatro arquivos Compose vigentes em
`/home/newxai9_gmail_com/aquila3/config`, com `.env.hyper`; não imprime o ambiente
resolvido. Guarda backups privados, valida os dois candidatos antes de tocar
arquivos ativos, persiste a rede nova em `compose.public.yaml` e recarrega o
Caddy. Mantém o inode do Caddyfile, por causa do bind mount. Se a recarga ou a
comparação dos quatro domínios falhar, restaura os arquivos e recarrega a
configuração anterior. Não recria o proxy nem os containers existentes. A
emissão do certificado e a prova do novo HTTPS seguem a configuração do DNS.

## Provar e recuperar

Confira `https://imob.aquila.ia.br/`, o redirecionamento de `/app`, a marca no
login, o catálogo público e um pacote pelo seu hash. Para Supabase próprio,
confirme também `/auth/v1/settings`, login, REST, Realtime e Storage. Confirme
Imobiliária em `/admin/modulos` e execute a jornada de imóvel, interessado e visita
descrita em [Aquila Imob](../aquila-imob.md).

Confira novamente os quatro domínios anteriores. Não basta o novo domínio
responder: Finance, painel, outro aplicativo e registry devem continuar
respondendo como antes. Uma falha de rota pede restauração do Caddyfile anterior
e recarga; o app novo pode continuar privado para diagnóstico. Uma falha do app
pede o número anterior do trio de imagens, sem rebaixar banco ou remover volumes
automaticamente. O nome de projeto e os quatro arquivos usados no deploy devem
acompanhar cada atualização.
