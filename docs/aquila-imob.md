# Aquila Imob

O Aquila Imob é um aplicativo imobiliário independente, preparado neste fork do
[DeskcommCRM](https://github.com/melgarafael/DeskcommCRM), com endereço escolhido
`https://imob.aquila.ia.br`. A licença MIT e os créditos do projeto original são
preservados em `LICENSE`.

O fork mantém a base de atendimento, contatos, funil, tarefas, agenda e WhatsApp,
e acrescenta a operação imobiliária. Não usa o banco, as contas ou as conexões do
Imob Flow. A configuração de marca continua pela interface, sem um tema fixo no
código de cada tela.

## O que foi acrescentado

| Peça                            | Uso                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Módulo **Imobiliária**          | Carteira e captação de imóveis, corretores, perfil de interessados e visitas vinculadas à agenda. |
| **Carteira e captação**         | Roteiro para autorização, conferência da ficha e retorno ao proprietário.                         |
| **Interessados e qualificação** | Roteiro para entender a busca, conduzir o funil e continuar a conversa com contexto.              |
| **Visitas e retornos**          | Roteiro para combinar a visita, conferir o compromisso e registrar o próximo passo.               |
| **Corretores e operação**       | Roteiro para organizar responsáveis e revisar pendências da equipe.                               |

O módulo é nativo e opcional: o administrador da instalação o instala em
**Administração → Módulos** (`/admin/modulos`). Ele usa o mecanismo de
provisionamento da base; suas tabelas nascem quando instalado. A porta
**Imobiliária** leva a `/app/imobiliaria`. Sem o módulo, a operação comum do CRM
continua disponível.

Os quatro pacotes Aquila são extensões declarativas, instaláveis pelo framework
existente. Eles exibem instruções e botões no hub do CRM, com permissões mostradas
antes da instalação. Não executam código, não criam suas próprias tabelas e não
enviam mensagens. A porta `imobiliaria.open` é traduzida pelo host para a rota
literal `/app/imobiliaria`; nenhum pacote escolhe um endereço livre.

## Preparar a instalação separada

1. Crie um **projeto Supabase próprio** para o Aquila Imob ou uma instalação
   Supabase própria. Aplique `supabase/baseline.sql` no banco novo; a cadeia de
   migrations não é o caminho de instalação inicial da base.
2. Configure Auth para o endereço do Aquila, incluindo os retornos autorizados
   usados pelo login. Use chaves, segredos internos e chaves de criptografia
   próprios. Não copie o arquivo de configuração do Imob Flow.
3. Configure WAHA e suas sessões para esta instalação. O WhatsApp da base usa
   WAHA; a integração Uazapi do Imob Flow não é uma dependência deste aplicativo.
   O cliente envia a chave pelo cabeçalho, e os webhooks mantêm a validação da
   base. Conecte os números em **Conexões** pelo QR code.
4. Configure o aplicativo, worker e scheduler conforme o
   [runbook de publicação](runbooks/deploy.md). Cada processo deve usar o banco
   e os serviços da instalação Aquila. O scheduler local não deve consumir a
   fila de outro aplicativo.
5. Aponte `imob.aquila.ia.br` para a hospedagem e habilite HTTPS. O endereço
   escolhido prepara os artefatos; ele não comprova que DNS e publicação já
   aconteceram.

Os valores de marca e endereço para essa instalação são:

```dotenv
APP_NAME=Aquila Imob
NEXT_PUBLIC_APP_URL=https://imob.aquila.ia.br
NEXT_PUBLIC_ADMIN_URL=https://imob.aquila.ia.br
```

São variáveis já existentes. O arquivo `.env.example` contém todas as demais
variáveis e a finalidade de cada uma; segredos ficam no arquivo privado da
instalação. O nome e a cor salvos em **Administração → Marca** têm precedência
sobre a semente do ambiente. Suba logo e ícone por essa tela quando disponíveis.

Não use o instalador público do upstream para obter este fork: ele pode baixar
imagens e scripts do projeto original. O caminho próprio para VPS com Docker é
o workflow `aquila-images.yml` e o complemento `docker-compose.aquila.yml`
descritos abaixo. A presença desses arquivos não comprova que as imagens já
foram publicadas.

## Publicar as imagens para a VPS

O workflow `.github/workflows/aquila-images.yml` constrói no GitHub as três
imagens a partir dos Dockerfiles da base, em máquinas nativas AMD64 e ARM64. Os
segredos de produção entram na VPS, não no build. Ele confere o catálogo,
constrói o conjunto, mede o início do aplicativo e só então publica os números
de versão. Um pull request constrói as imagens sem publicar. Uma versão que já
existe é recusada.

Dispare pela tag `aquila-vX.Y.Z` ou pelo botão **Run workflow**, indicando uma
versão inédita `X.Y.Z`. Depois de todos os jobs concluírem, confira no resumo as
imagens:

```text
ghcr.io/robotizze/aquila-imob:X.Y.Z
ghcr.io/robotizze/aquila-imob-worker:X.Y.Z
ghcr.io/robotizze/aquila-imob-scheduler:X.Y.Z
```

Se os pacotes GHCR estiverem privados, a VPS precisa de uma credencial de
leitura do registry. Para uma distribuição pública, ajuste a visibilidade dos
três pacotes no GitHub. Credenciais não são adicionadas ao compose ou ao
repositório.

Na VPS, use Docker Compose **2.24.4 ou superior**: o complemento usa `!reset`
para retirar os escapes de build locais do worker e do scheduler. O conjunto
deve ser aplicado sempre com os dois arquivos, na ordem indicada. Coloque no
arquivo privado `.env` a versão que realmente foi publicada, os segredos
próprios e o domínio usado pelo HTTPS da base:

```dotenv
AQUILA_VERSION=X.Y.Z
DOMAIN=imob.aquila.ia.br
```

`ACME_EMAIL` recebe um e-mail válido do responsável pela instalação. Os dados
de banco e os demais valores obrigatórios estão no `.env.example`. Com DNS e
acesso às portas 80/443 prontos em uma VPS sem proxy preexistente:

```bash
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml --env-file .env config --quiet
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml --env-file .env pull app worker scheduler
docker compose -p aquila-imob -f docker-compose.prod.yml -f docker-compose.aquila.yml --env-file .env up -d
```

O nome de projeto `aquila-imob` mantém os volumes e a rede separados de outras
instalações na mesma VPS. O complemento fixa as três imagens na mesma versão,
injeta a marca e os endereços e não abre portas adicionais. Se o download falhar,
ele não constrói o aplicativo na VPS como alternativa.

Se a VPS já usa Traefik, Coolify ou Dokploy, use também o arquivo de proxy
compatível depois desses dois arquivos, conforme o
[runbook de publicação](runbooks/deploy.md). O arquivo de proxy e seu domínio
devem acompanhar toda atualização; omiti-los pode tirar o app do endereço mesmo
com os processos saudáveis.

Para atualizar, faça backup de banco e volumes WAHA, troque `AQUILA_VERSION`
pelo número novo publicado e repita o download e a subida com os mesmos
arquivos. Aplique também o baseline da versão conforme o runbook. Para voltar
a imagem anterior, use o número anterior do trio; não rebaixe o banco
automaticamente. O atualizador público do upstream não é o atualizador do
Aquila.

## Instalar os pacotes

O catálogo próprio está preparado em:

- Fonte versionada: `extensoes/catalogo.json`.
- Resposta pública: `/extensoes/catalogo.json`.
- Origem admitida: `https://imob.aquila.ia.br`, sem caminho adicional.
- Pacote imutável: `/packages/<sha256>.json`.

O catálogo preserva os três pacotes MIT originais e inclui os quatro Aquila. O
gerador lê todos os manifests, usa o parser e a verificação de compatibilidade do
host e calcula o hash dos bytes exatos. Esses mesmos bytes são copiados para
`public/packages/`, que acompanha a imagem do aplicativo. O catálogo não recebe
o selo do catálogo oficial do upstream.

```powershell
pnpm tsx scripts/gerar-catalogo-de-extensoes.ts
pnpm tsx scripts/gerar-catalogo-de-extensoes.ts --conferir
```

Ao publicar em outro endereço, defina `EXTENSOES_ORIGEM` durante a geração e
publique novamente os artefatos. O valor deve ser uma origem HTTPS exata, sem
credenciais, caminho, query ou fragmento. Regere depois de alterar ou formatar
qualquer pacote; uma mudança de espaço também muda o hash.

Em **Extensões** (`/app/extensions`), o administrador da instalação admite o
catálogo e instala os pacotes. Depois, o administrador de cada organização ativa
os roteiros desejados e configura a apresentação. A ativação de um roteiro não
instala o módulo nativo nem concede acesso além do papel da pessoa. Instale
**Imobiliária** antes de usar os botões desse módulo.

## Primeira jornada de operação

1. Cadastre o proprietário e o interessado em **Contatos** para manter uma
   identidade e um histórico por pessoa.
2. Cadastre o corretor responsável e registre o imóvel na carteira. Durante a
   captação, registre o que falta e o próximo contato; confirme a autorização
   de divulgação antes de anunciar.
3. Vincule ao interessado a finalidade, faixa de orçamento, região e
   preferências da busca. Confira a disponibilidade dos imóveis antes de
   oferecer opções pelo atendimento.
4. Crie primeiro um compromisso da **Agenda**, vinculado ao contato interessado.
   Depois, registre a visita ligando esse compromisso ao imóvel e ao corretor.
   Confira horário e acesso ao imóvel com as pessoas envolvidas.
5. Registre o resultado do compromisso na **Agenda** e crie uma tarefa de
   retorno. A visita acompanha o horário e o estado do compromisso existente.
   Quando uma visita revelar
   novas preferências, atualize a busca antes de sugerir outra opção.

O WhatsApp continua usando o atendimento e as regras da base: consentimento,
opt-out, controle de ritmo e permissões de canal. Os roteiros imobiliários
melhoram o contexto usado pela equipe. Eles não introduzem disparos em massa,
captura automática de portais, publicação automática de anúncios, seleção
automática de imóveis ou cálculo de comissão.

## Verificar antes de operar

| Verificação                                   | Resultado esperado                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Marca no login, barra lateral e título da aba | Aquila Imob, resolvido pela configuração de marca.                                                                           |
| `/` e `/app` sem sessão                       | Página pública acessível e redirecionamento para login.                                                                      |
| `/extensoes/catalogo.json` sem sessão         | JSON com a origem Aquila e as sete entradas.                                                                                 |
| Download de `/packages/<sha256>.json`         | Bytes cujo tamanho e hash correspondem à entrada admitida.                                                                   |
| Instalação de **Imobiliária**                 | Módulo ativo e porta visível, sem criação de tabelas em uma instalação que nunca o instalou.                                 |
| Organização A e organização B                 | Cada uma vê somente seus imóveis, interessados, corretores e visitas.                                                        |
| Operador sem permissão de gestão              | Escritas administrativas recusadas conforme o papel atual.                                                                   |
| WhatsApp                                      | Sessão conectada, webhook validado e atendimento preservado; envio real precisa ser verificado com os números da instalação. |
| Visita                                        | Imóvel e contato do mesmo tenant ligados a um compromisso real da Agenda.                                                    |
| Falha de gravação ou módulo ausente           | Mensagem visível, sem anúncio de sucesso.                                                                                    |

Os testes dos pacotes são `tests/unit/aquila-plugins.test.ts` e
`tests/unit/catalogo-de-extensoes-em-dia.test.ts`. Eles medem formato,
compatibilidade, permissões, catálogo, bytes públicos e recusa de adulteração.
Não comprovam publicação do domínio, pareamento do WhatsApp ou uso real da
interface. A prova do módulo exige também os testes de banco e a jornada em
tela descrita acima.

## Living System Checklist

| Pergunta                                | Artefato concreto                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Quem alimenta a operação?               | A equipe em `/app/imobiliaria`, os contatos e usuários membros existentes e os compromissos da Agenda.                                         |
| Quem ela alimenta?                      | A carteira, os perfis de interessados, as visitas, a Agenda e as tarefas de retorno criadas pela equipe.                                       |
| Onde aparece?                           | Porta Imobiliária, hub do CRM com cards dos pacotes e Agenda do atendimento.                                                                   |
| Onde se vê a trilha de ações?           | As gravações do módulo emitem auditoria da API; quem tem acesso acompanha em `/app/audit`.                                                     |
| Onde a configuração aparece?            | `/admin/modulos` instala o módulo; `/app/extensions` admite, instala e ativa os roteiros; `/admin/marca` define a fachada.                     |
| Como o trabalho continua?               | Responsável e próximo contato na operação, resultado da visita e tarefa de retorno no CRM.                                                     |
| O que acontece quando uma decisão erra? | A equipe registra o resultado, corrige disponibilidade ou preferências e redefine a próxima tarefa. Os pacotes não tomam decisões automáticas. |
| Como uma falha chega à pessoa?          | Erros exibidos na instalação e nos formulários; ausência do módulo não é apresentada como carteira vazia.                                      |
| Qual mapa mostra as conexões?           | `docs/architecture/aquila-imob.architecture.json`.                                                                                             |

A liberação para uso depende de publicar a imagem do fork, configurar o banco e
os serviços próprios, apontar o domínio e executar a primeira jornada com contas
e números da instalação.
