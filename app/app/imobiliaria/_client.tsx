"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api/client";
import { ROTULO_DA_SITUACAO, type SituacaoDoAgendamento } from "@/lib/agenda/tipos";
import { ApiError, type ApiSuccess } from "@/lib/api/types";
import { formatCents } from "@/lib/money";
import {
  ArrowsClockwise,
  ArrowRight,
  CalendarBlank,
  House,
  MagnifyingGlass,
  MapPin,
  PencilSimple,
  Plus,
  UsersThree,
  Warning,
  WhatsappLogo,
} from "@/lib/ui/icons";

import {
  FormularioCorretor,
  FormularioImovel,
  FormularioInteressado,
  FormularioVisita,
} from "./_formularios";
import { dataLegivel, mensagemDoErro } from "./_formato";
import {
  ETAPAS,
  STATUS,
  TIPOS,
  type Contexto,
  type Corretor,
  type Imovel,
  type Interessado,
  type Visita,
} from "./_tipos";

type Aba = "imoveis" | "interessados" | "corretores" | "visitas";
type Edicao =
  | { recurso: "imoveis"; item?: Imovel; captacao?: boolean }
  | { recurso: "interessados"; item?: Interessado }
  | { recurso: "corretores"; item?: Corretor }
  | { recurso: "visitas" };
interface Dados {
  imoveis: Imovel[];
  interessados: Interessado[];
  corretores: Corretor[];
  visitas: Visita[];
  contexto: Contexto;
}
const TITULOS: Record<Aba, string> = {
  imoveis: "Carteira de imóveis",
  interessados: "Interessados",
  corretores: "Corretores",
  visitas: "Visitas",
};
const CAPTACOES_ABERTAS = new Set(["novo", "em_contato", "documentacao"]);
const INTERESSES_ABERTOS = new Set(["aberto", "em_visita", "proposta"]);

function rotuloVisita(status: string): string {
  return ROTULO_DA_SITUACAO[status as SituacaoDoAgendamento] ?? "Situação indisponível";
}

function ProximoContato({
  passo,
  data,
  agora,
}: {
  passo?: string | null;
  data?: string | null;
  agora: number;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  if (!passo) return null;
  const vencido = data ? new Date(data).getTime() < agora : false;
  return (
    <div
      className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${vencido ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-muted/40"}`}
    >
      <p className="font-medium">{passo}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {vencido ? t("Contato pendente") : t("Próximo contato")} ·
        {data ? dataLegivel(data, idioma) : t("Sem data definida")}
      </p>
    </div>
  );
}

function Vazio({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="grid justify-items-center gap-3 border-dashed px-6 py-12 text-center">
      <House className="size-9 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>
      {children}
    </Card>
  );
}

export function ImobiliariaClient({
  podeGerenciar,
  podeQualificar,
  podeInstalar,
}: {
  podeGerenciar: boolean;
  podeQualificar: boolean;
  podeInstalar: boolean;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [aba, setAba] = useState<Aba>("imoveis");
  const [busca, setBusca] = useState("");
  const [somenteCaptacao, setSomenteCaptacao] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [moduloAusente, setModuloAusente] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setCarregando(true);
    setErro(null);
    setModuloAusente(false);
    try {
      const [imoveis, interessados, corretores, visitas, contexto] = await Promise.all([
        apiClient.get<ApiSuccess<Imovel[]>>("/api/v1/imobiliaria/imoveis", { signal }),
        apiClient.get<ApiSuccess<Interessado[]>>("/api/v1/imobiliaria/interessados", { signal }),
        apiClient.get<ApiSuccess<Corretor[]>>("/api/v1/imobiliaria/corretores", { signal }),
        apiClient.get<ApiSuccess<Visita[]>>("/api/v1/imobiliaria/visitas", { signal }),
        apiClient.get<ApiSuccess<Contexto>>("/api/v1/imobiliaria/contexto", { signal }),
      ]);
      if (!signal?.aborted) {
        setAgora(Date.now());
        setDados({
          imoveis: imoveis.data,
          interessados: interessados.data,
          corretores: corretores.data,
          visitas: visitas.data,
          contexto: contexto.data,
        });
      }
    } catch (falha) {
      if (!signal?.aborted) {
        setModuloAusente(falha instanceof ApiError && falha.code === "module_not_installed");
        setErro(mensagemDoErro(falha));
      }
    } finally {
      if (!signal?.aborted) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const inicio = window.setTimeout(() => void carregar(controller.signal), 0);
    return () => {
      window.clearTimeout(inicio);
      controller.abort();
    };
  }, [carregar]);

  const imoveis = useMemo(() => {
    const termo = busca.toLocaleLowerCase("pt-BR").trim();
    return (dados?.imoveis ?? []).filter(
      (i) =>
        (!somenteCaptacao || CAPTACOES_ABERTAS.has(i.etapa_captacao)) &&
        (!termo ||
          `${i.codigo} ${i.nome} ${i.bairro} ${i.cidade}`
            .toLocaleLowerCase("pt-BR")
            .includes(termo)),
    );
  }, [dados, busca, somenteCaptacao]);
  const interessados = useMemo(() => {
    const termo = busca.toLocaleLowerCase("pt-BR").trim();
    return (dados?.interessados ?? []).filter(
      (i) =>
        !termo ||
        `${i.contato_nome ?? ""} ${i.bairros.join(" ")}`.toLocaleLowerCase("pt-BR").includes(termo),
    );
  }, [dados, busca]);
  const corretores = useMemo(() => {
    const termo = busca.toLocaleLowerCase("pt-BR").trim();
    return (dados?.corretores ?? []).filter(
      (c) =>
        !termo ||
        `${c.nome ?? ""} ${c.creci} ${c.regioes.join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
    );
  }, [dados, busca]);
  const visitas = useMemo(() => {
    const termo = busca.toLocaleLowerCase("pt-BR").trim();
    return (dados?.visitas ?? []).filter(
      (v) =>
        !termo ||
        `${v.imovel_nome} ${v.contato_nome ?? ""} ${v.title}`
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
    );
  }, [dados, busca]);

  async function salvar(registro: Record<string, unknown>) {
    if (!edicao) return;
    const caminho = `/api/v1/imobiliaria/${edicao.recurso}`;
    if ("item" in edicao && edicao.item)
      await apiClient.patch(`${caminho}/${edicao.item.id}`, registro);
    else await apiClient.post(caminho, registro);
    setEdicao(null);
    toast.success(t("Registro salvo."));
    await carregar();
  }

  const podeCriar = aba === "imoveis" || aba === "corretores" ? podeGerenciar : podeQualificar;
  const abrirCriacao = () => {
    if (aba === "imoveis") setEdicao({ recurso: "imoveis", captacao: somenteCaptacao });
    else if (aba === "interessados") setEdicao({ recurso: "interessados" });
    else if (aba === "corretores") setEdicao({ recurso: "corretores" });
    else setEdicao({ recurso: "visitas" });
  };
  const rotuloCriar =
    aba === "imoveis"
      ? somenteCaptacao
        ? t("Nova captação")
        : t("Cadastrar imóvel")
      : aba === "interessados"
        ? t("Qualificar interessado")
        : aba === "corretores"
          ? t("Cadastrar corretor")
          : t("Vincular visita");
  const nomeCorretor = (id?: string | null) =>
    dados?.corretores.find((c) => c.id === id)?.nome ?? t("Sem corretor responsável");

  return (
    <div
      data-fonte="api-imobiliaria"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase">
            <House className="size-4" /> {t("Operação imobiliária")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("Imóveis e relacionamentos")}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {t(
              "Organize a carteira, conduza as captações e mantenha cada interessado com um próximo passo.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/app/connections">
              <WhatsappLogo className="mr-2 size-4" /> {t("WhatsApp")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/app/agenda">
              <CalendarBlank className="mr-2 size-4" /> {t("Abrir Agenda")}
            </Link>
          </Button>
        </div>
      </header>

      {moduloAusente ? (
        <Card className="grid gap-3 border-amber-500/40 bg-amber-500/5 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Warning className="size-5" /> {t("Módulo imobiliário indisponível")}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {t(
              "O administrador da instalação precisa instalar e habilitar o módulo Imobiliária para usar esta área.",
            )}
          </p>
          {podeInstalar && (
            <Button asChild className="w-fit">
              <Link href="/admin/modulos">
                {t("Gerenciar módulos")}
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          )}
          <Button variant="outline" className="w-fit" onClick={() => void carregar()}>
            {t("Verificar novamente")}
          </Button>
        </Card>
      ) : (
        <>
          {erro && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
            >
              <span>{erro}</span>
              <Button variant="outline" onClick={() => void carregar()} disabled={carregando}>
                {t("Tentar novamente")}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                rotulo: t("Imóveis ativos"),
                total: dados?.imoveis.filter((i) => i.ativo).length,
                acao: () => {
                  setAba("imoveis");
                  setSomenteCaptacao(false);
                },
                dica: t("Consultar a carteira"),
              },
              {
                rotulo: t("Captações em andamento"),
                total: dados?.imoveis.filter((i) => CAPTACOES_ABERTAS.has(i.etapa_captacao)).length,
                acao: () => {
                  setAba("imoveis");
                  setSomenteCaptacao(true);
                },
                dica: t("Continuar a captação"),
              },
              {
                rotulo: t("Interessados em atendimento"),
                total: dados?.interessados.filter((i) => INTERESSES_ABERTOS.has(i.status)).length,
                acao: () => setAba("interessados"),
                dica: t("Ver os próximos passos"),
              },
              {
                rotulo: t("Corretores ativos"),
                total: dados?.corretores.filter((c) => c.ativo).length,
                acao: () => setAba("corretores"),
                dica: t("Consultar responsáveis"),
              },
            ].map((resumo) => (
              <button
                type="button"
                key={resumo.rotulo}
                onClick={() => {
                  resumo.acao();
                  setBusca("");
                }}
                disabled={!dados}
                className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none"
              >
                <span className="text-xs text-muted-foreground">{resumo.rotulo}</span>
                {resumo.total === undefined ? (
                  <Skeleton className="my-2 h-8 w-12" />
                ) : (
                  <span className="my-2 block text-3xl font-semibold tabular-nums">
                    {resumo.total}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-primary">
                  {resumo.dica}
                  <ArrowRight className="size-3" />
                </span>
              </button>
            ))}
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {t("Contagens dos registros carregados nesta lista.")}
          </p>
          {dados &&
            [dados.imoveis, dados.interessados, dados.corretores, dados.visitas].some(
              (lista) => lista.length >= 200,
            ) && (
              <p
                role="status"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              >
                {t(
                  "Esta área mostra até 200 registros por seção. A busca e as contagens consideram apenas os registros carregados.",
                )}
              </p>
            )}

          <Tabs
            value={aba}
            onValueChange={(valor) => {
              setAba(valor as Aba);
              setBusca("");
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList className="h-auto justify-start p-1">
                {Object.keys(TITULOS).map((valor) => (
                  <TabsTrigger key={valor} value={valor} className="px-4 py-2 whitespace-nowrap">
                    {t(TITULOS[valor as Aba])}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button
                variant="ghost"
                onClick={() => void carregar()}
                disabled={carregando}
                aria-label={t("Atualizar registros")}
              >
                <ArrowsClockwise className={`mr-2 size-4 ${carregando ? "animate-spin" : ""}`} />{" "}
                {t("Atualizar")}
              </Button>
            </div>
            <div className="my-5 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full sm:max-w-sm">
                <MagnifyingGlass className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
                <Input
                  aria-label={`${t("Buscar em")} ${t(TITULOS[aba])}`}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="h-11 pl-9"
                  placeholder={
                    aba === "imoveis"
                      ? t("Buscar por código, imóvel ou região")
                      : t("Buscar registros")
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {aba === "imoveis" && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={somenteCaptacao}
                      onChange={(e) => setSomenteCaptacao(e.target.checked)}
                      className="size-4 accent-primary"
                    />{" "}
                    {t("Só captações abertas")}
                  </label>
                )}
                {podeCriar && (
                  <Button onClick={abrirCriacao} disabled={!dados || carregando || !!erro}>
                    <Plus className="mr-2 size-4" />
                    {rotuloCriar}
                  </Button>
                )}
              </div>
            </div>
            {carregando && !dados ? (
              <div
                role="status"
                aria-label={t("Carregando registros")}
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-64 rounded-xl" />
                ))}
              </div>
            ) : (
              dados && (
                <>
                  <TabsContent value="imoveis" className="mt-0">
                    {imoveis.length === 0 ? (
                      <Vazio
                        titulo={
                          busca
                            ? "Nenhum imóvel encontrado"
                            : somenteCaptacao
                              ? "Nenhuma captação em andamento"
                              : "Sua carteira começa aqui"
                        }
                        descricao={
                          busca
                            ? "Ajuste a busca para localizar um imóvel."
                            : "Cadastre os imóveis da equipe ou registre uma nova captação com responsável e próximo contato."
                        }
                      >
                        {podeGerenciar && <Button onClick={abrirCriacao}>{rotuloCriar}</Button>}
                      </Vazio>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {imoveis.map((i) => (
                          <Card key={i.id} className="flex flex-col p-5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                                {i.codigo}
                              </span>
                              <Badge variant={i.ativo ? "secondary" : "outline"}>
                                {i.ativo ? t(ETAPAS[i.etapa_captacao]) : t("Inativo")}
                              </Badge>
                            </div>
                            <h2 className="mt-3 text-lg font-semibold">{i.nome}</h2>
                            <p className="mt-1 flex items-start gap-1 text-sm text-muted-foreground">
                              <MapPin className="mt-0.5 size-4 shrink-0" />
                              {i.bairro} · {i.cidade}/{i.uf}
                            </p>
                            <p className="mt-4 text-xl font-semibold">
                              {formatCents(i.preco_cents, i.moeda)}
                              {i.finalidade === "locacao" && (
                                <span className="text-xs font-normal text-muted-foreground">
                                  {" "}
                                  {t("/ mês")}
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t(TIPOS[i.tipo])} · {i.quartos} {t("quartos")}
                              {i.area_m2 ? ` · ${i.area_m2} m²` : ""} · {i.vagas} {t("vagas")}
                            </p>
                            <p className="mt-3 text-xs text-muted-foreground">
                              {nomeCorretor(i.corretor_id)}
                            </p>
                            <ProximoContato
                              passo={i.proximo_passo}
                              data={i.proximo_contato_em}
                              agora={agora}
                            />
                            <div className="mt-auto flex flex-wrap gap-2 pt-4">
                              {podeGerenciar && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEdicao({ recurso: "imoveis", item: i })}
                                >
                                  <PencilSimple className="mr-1 size-4" /> {t("Editar")}
                                </Button>
                              )}
                              {i.proprietario_id && (
                                <Button variant="ghost" size="sm" asChild>
                                  <Link href={`/app/contacts/${i.proprietario_id}`}>
                                    {t("Proprietário")}
                                  </Link>
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/app/products?busca=${encodeURIComponent(i.codigo)}`}>
                                  {t("Ver no catálogo")}
                                </Link>
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="interessados" className="mt-0">
                    {interessados.length === 0 ? (
                      <Vazio
                        titulo={
                          busca
                            ? "Nenhum interessado encontrado"
                            : "Conheça o que cada interessado procura"
                        }
                        descricao={t(
                          "Vincule um contato, registre orçamento e preferências e defina o próximo passo do atendimento.",
                        )}
                      >
                        {podeQualificar && (
                          <Button onClick={abrirCriacao}>{t("Qualificar interessado")}</Button>
                        )}
                      </Vazio>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {interessados.map((i) => (
                          <Card key={i.id} className="flex flex-col p-5">
                            <div className="flex items-center justify-between gap-2">
                              <UsersThree className="size-5 text-primary" />
                              <Badge variant="secondary">{t(STATUS[i.status])}</Badge>
                            </div>
                            <h2 className="mt-3 text-lg font-semibold">
                              {i.contato_nome || t("Interessado sem nome")}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {i.finalidade === "venda" ? t("Compra") : t("Locação")}
                              {i.tipo ? ` · ${t(TIPOS[i.tipo])}` : ""} {t("· a partir de")}
                              {i.quartos_min} {t("quartos")}
                            </p>
                            <p className="mt-4 text-sm font-semibold">
                              {formatCents(i.orcamento_min_cents, "BRL")} a{" "}
                              {formatCents(i.orcamento_max_cents, "BRL")}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {i.bairros.length ? i.bairros.join(" · ") : t("Região a definir")}
                              {i.prazo ? ` · ${i.prazo}` : ""}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {nomeCorretor(i.corretor_id)}
                            </p>
                            <ProximoContato
                              passo={i.proximo_passo}
                              data={i.proximo_contato_em}
                              agora={agora}
                            />
                            <div className="mt-auto flex flex-wrap gap-2 pt-4">
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/app/contacts/${i.contact_id}`}>
                                  {t("Contato e histórico")}
                                </Link>
                              </Button>
                              {podeQualificar && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEdicao({ recurso: "interessados", item: i })}
                                  >
                                    {t("Editar perfil")}
                                  </Button>
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link
                                      href={`/app/agenda?contato=${encodeURIComponent(i.contact_id)}`}
                                    >
                                      {t("Marcar visita")}
                                    </Link>
                                  </Button>
                                </>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="corretores" className="mt-0">
                    {corretores.length === 0 ? (
                      <Vazio
                        titulo={
                          busca ? "Nenhum corretor encontrado" : "Conecte a equipe à operação"
                        }
                        descricao={t(
                          "Vincule integrantes da equipe ao cadastro de corretores para distribuir imóveis e interessados.",
                        )}
                      >
                        {podeGerenciar && (
                          <Button onClick={abrirCriacao}>{t("Cadastrar corretor")}</Button>
                        )}
                      </Vazio>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {corretores.map((c) => (
                          <Card key={c.id} className="p-5">
                            <div className="flex justify-between gap-2">
                              <UsersThree className="size-5 text-primary" />
                              <Badge variant={c.ativo ? "secondary" : "outline"}>
                                {c.ativo ? t("Ativo") : t("Inativo")}
                              </Badge>
                            </div>
                            <h2 className="mt-3 text-lg font-semibold">
                              {c.nome || t("Integrante sem nome")}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t("CRECI")}
                              {c.creci}
                            </p>
                            <p className="mt-4 text-xs text-muted-foreground">
                              {c.especialidades.join(" · ") || t("Especialidades a definir")}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {c.regioes.join(" · ") || t("Regiões a definir")}
                            </p>
                            <p className="mt-4 text-sm">
                              {
                                dados.imoveis.filter((i) => i.corretor_id === c.id && i.ativo)
                                  .length
                              }{" "}
                              {t("imóveis ativos ·")}{" "}
                              {
                                dados.interessados.filter(
                                  (i) => i.corretor_id === c.id && INTERESSES_ABERTOS.has(i.status),
                                ).length
                              }{" "}
                              {t("interessados abertos")}
                            </p>
                            {podeGerenciar && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-4"
                                onClick={() => setEdicao({ recurso: "corretores", item: c })}
                              >
                                {t("Editar corretor")}
                              </Button>
                            )}
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="visitas" className="mt-0">
                    <p className="mb-4 text-sm text-muted-foreground">
                      {t(
                        "Horários, remarcações e desfechos são mantidos na Agenda. Aqui você associa cada visita ao imóvel.",
                      )}
                    </p>
                    {visitas.length === 0 ? (
                      <Vazio
                        titulo={busca ? t("Nenhuma visita encontrada") : t("Da conversa à visita")}
                        descricao={t(
                          "Marque o compromisso na Agenda e vincule-o ao imóvel. Assim a equipe consulta o horário e o contexto juntos.",
                        )}
                      >
                        <Button asChild variant="outline">
                          <Link href="/app/agenda">{t("Abrir Agenda")}</Link>
                        </Button>
                      </Vazio>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {visitas.map((v) => (
                          <Card key={v.id} className="p-5">
                            <div className="flex justify-between gap-2">
                              <CalendarBlank className="size-5 text-primary" />
                              <Badge variant="outline">{t(rotuloVisita(v.status))}</Badge>
                            </div>
                            <h2 className="mt-3 text-lg font-semibold">{v.imovel_nome}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {v.contato_nome || v.title}
                            </p>
                            <p className="mt-4 text-sm font-medium">
                              {dataLegivel(v.starts_at, idioma)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {nomeCorretor(v.corretor_id)}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button asChild variant="outline" size="sm">
                                <Link
                                  href={`/app/agenda?compromisso=${encodeURIComponent(v.appointment_id)}`}
                                >
                                  {t("Consultar na Agenda")}
                                </Link>
                              </Button>
                              {v.contact_id && (
                                <Button asChild variant="ghost" size="sm">
                                  <Link href={`/app/contacts/${v.contact_id}`}>
                                    {t("Contato e histórico")}
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </>
              )
            )}
          </Tabs>
        </>
      )}
      {edicao &&
        dados &&
        (edicao.recurso === "imoveis" ? (
          <FormularioImovel
            key={edicao.item?.id ?? "novo"}
            imovel={edicao.item}
            captacao={edicao.captacao}
            contexto={dados.contexto}
            corretores={dados.corretores}
            salvar={salvar}
            fechar={() => setEdicao(null)}
          />
        ) : edicao.recurso === "interessados" ? (
          <FormularioInteressado
            key={edicao.item?.id ?? "novo"}
            interessado={edicao.item}
            contexto={dados.contexto}
            corretores={dados.corretores}
            salvar={salvar}
            fechar={() => setEdicao(null)}
          />
        ) : edicao.recurso === "corretores" ? (
          <FormularioCorretor
            key={edicao.item?.id ?? "novo"}
            corretor={edicao.item}
            contexto={dados.contexto}
            salvar={salvar}
            fechar={() => setEdicao(null)}
          />
        ) : (
          <FormularioVisita
            contexto={dados.contexto}
            imoveis={dados.imoveis}
            corretores={dados.corretores}
            salvar={salvar}
            fechar={() => setEdicao(null)}
          />
        ))}
    </div>
  );
}
