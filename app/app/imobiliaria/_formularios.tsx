"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  dataLocal,
  dataParaApi,
  listaDoCampo,
  mensagemDoErro,
  valorEmCentavos,
  dataLegivel,
} from "./_formato";
import {
  ETAPAS,
  STATUS,
  TIPOS,
  type Contexto,
  type Corretor,
  type Imovel,
  type Interessado,
} from "./_tipos";

type Salvar = (dados: Record<string, unknown>) => Promise<void>;
const campo = (dados: FormData, nome: string) => String(dados.get(nome) ?? "").trim();
const opcional = (dados: FormData, nome: string) => campo(dados, nome) || null;
const numero = (dados: FormData, nome: string) => Number(campo(dados, nome) || "0");
const reais = (centavos: number | undefined) =>
  centavos === undefined ? "" : (centavos / 100).toFixed(2).replace(".", ",");

function Campo({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className}`}>
      <span>{titulo}</span>
      {children}
    </label>
  );
}

function Escolha(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50"
    />
  );
}

function Finalidade({ valor }: { valor?: string }) {
  const t = useT();
  return (
    <Campo titulo={t("Finalidade")}>
      <Escolha name="finalidade" defaultValue={valor ?? "venda"}>
        <option value="venda">{t("Venda")}</option>
        <option value="locacao">{t("Locação")}</option>
      </Escolha>
    </Campo>
  );
}

function CorretorEscolha({ corretores, valor }: { corretores: Corretor[]; valor?: string | null }) {
  const t = useT();
  return (
    <Campo titulo={t("Corretor responsável")}>
      <Escolha name="corretor_id" defaultValue={valor ?? ""}>
        <option value="">{t("Sem responsável")}</option>
        {corretores
          .filter((c) => c.ativo || c.id === valor)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome || c.creci}
              {!c.ativo ? ` (${t("Inativo")})` : ""}
            </option>
          ))}
      </Escolha>
    </Campo>
  );
}

function ProximoPasso({
  valor,
  data,
  obrigatorio,
}: {
  valor?: string | null;
  data?: string | null;
  obrigatorio: boolean;
}) {
  const t = useT();
  return (
    <>
      <Campo
        titulo={obrigatorio ? t("Próximo passo *") : t("Próximo passo")}
        className="sm:col-span-2"
      >
        <Input
          name="proximo_passo"
          required={obrigatorio}
          maxLength={500}
          defaultValue={valor ?? ""}
          placeholder={t("Ex.: confirmar documentos com o proprietário")}
        />
      </Campo>
      <Campo titulo={t("Data do próximo contato")} className="sm:col-span-2">
        <Input name="proximo_contato_em" type="datetime-local" defaultValue={dataLocal(data)} />
        <span className="text-xs font-normal text-muted-foreground">
          {t("Horário local deste dispositivo.")}
        </span>
      </Campo>
    </>
  );
}

function Editor({
  titulo,
  descricao,
  children,
  salvar,
  fechar,
}: {
  titulo: string;
  descricao: string;
  children: ReactNode;
  salvar: (dados: FormData) => Promise<void>;
  fechar: () => void;
}) {
  const t = useT();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) fechar();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (evento) => {
            evento.preventDefault();
            const dados = new FormData(evento.currentTarget);
            setErro(null);
            setSalvando(true);
            try {
              await salvar(dados);
            } catch (falha) {
              setErro(mensagemDoErro(falha));
            } finally {
              setSalvando(false);
            }
          }}
        >
          <fieldset disabled={salvando} className="grid gap-4 sm:grid-cols-2">
            {children}
          </fieldset>
          {erro && (
            <p
              role="alert"
              className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {erro}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={fechar} disabled={salvando}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? t("Salvando…") : t("Salvar")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FormularioImovel({
  imovel,
  captacao,
  contexto,
  corretores,
  salvar,
  fechar,
}: {
  imovel?: Imovel;
  captacao?: boolean;
  contexto: Contexto;
  corretores: Corretor[];
  salvar: Salvar;
  fechar: () => void;
}) {
  const t = useT();
  const [etapa, setEtapa] = useState(imovel?.etapa_captacao ?? (captacao ? "novo" : "publicado"));
  return (
    <Editor
      titulo={imovel ? t("Editar imóvel") : captacao ? t("Nova captação") : t("Cadastrar imóvel")}
      descricao={t(
        "O imóvel fica vinculado ao catálogo usado no atendimento. Captações abertas precisam de um próximo passo.",
      )}
      fechar={fechar}
      salvar={async (dados) => {
        const area = opcional(dados, "area_m2");
        await salvar({
          codigo: campo(dados, "codigo"),
          nome: campo(dados, "nome"),
          descricao: opcional(dados, "descricao"),
          preco_cents: valorEmCentavos(campo(dados, "preco"), "Preço"),
          moeda: "BRL",
          imagem_url: opcional(dados, "imagem_url"),
          finalidade: campo(dados, "finalidade"),
          tipo: campo(dados, "tipo"),
          bairro: campo(dados, "bairro"),
          cidade: campo(dados, "cidade"),
          uf: campo(dados, "uf").toUpperCase(),
          quartos: numero(dados, "quartos"),
          banheiros: numero(dados, "banheiros"),
          vagas: numero(dados, "vagas"),
          area_m2: area ? Number(area.replace(",", ".")) : null,
          endereco: opcional(dados, "endereco"),
          proprietario_id: opcional(dados, "proprietario_id"),
          corretor_id: opcional(dados, "corretor_id"),
          etapa_captacao: campo(dados, "etapa_captacao"),
          proximo_passo: opcional(dados, "proximo_passo"),
          proximo_contato_em: dataParaApi(campo(dados, "proximo_contato_em")),
          ativo: dados.has("ativo"),
        });
      }}
    >
      <Campo titulo={t("Código *")}>
        <Input
          name="codigo"
          required
          maxLength={80}
          defaultValue={imovel?.codigo ?? ""}
          placeholder={t("Ex.: AP-104")}
        />
      </Campo>
      <Campo titulo={t("Nome do imóvel *")}>
        <Input
          name="nome"
          required
          maxLength={200}
          defaultValue={imovel?.nome ?? ""}
          placeholder={t("Ex.: apartamento de 2 quartos")}
        />
      </Campo>
      <Finalidade valor={imovel?.finalidade} />
      <Campo titulo={t("Tipo")}>
        <Escolha name="tipo" defaultValue={imovel?.tipo ?? "apartamento"}>
          {Object.keys(TIPOS).map((chave) => (
            <option key={chave} value={chave}>
              {t(TIPOS[chave as keyof typeof TIPOS])}
            </option>
          ))}
        </Escolha>
      </Campo>
      <Campo titulo={t("Preço em R$ *")}>
        <Input
          name="preco"
          required
          inputMode="decimal"
          defaultValue={reais(imovel?.preco_cents)}
          placeholder="450.000,00"
        />
      </Campo>
      <Campo titulo={t("Área em m²")}>
        <Input
          name="area_m2"
          type="number"
          min="0.01"
          step="0.01"
          defaultValue={imovel?.area_m2 ?? ""}
        />
      </Campo>
      <Campo titulo={t("Bairro *")}>
        <Input name="bairro" required maxLength={120} defaultValue={imovel?.bairro ?? ""} />
      </Campo>
      <Campo titulo={t("Cidade *")}>
        <Input name="cidade" required maxLength={120} defaultValue={imovel?.cidade ?? ""} />
      </Campo>
      <Campo titulo={t("UF *")}>
        <Input
          name="uf"
          required
          minLength={2}
          maxLength={2}
          defaultValue={imovel?.uf ?? ""}
          placeholder="SP"
        />
      </Campo>
      <Campo titulo={t("Quartos")}>
        <Input name="quartos" type="number" min="0" max="100" defaultValue={imovel?.quartos ?? 0} />
      </Campo>
      <Campo titulo={t("Banheiros")}>
        <Input
          name="banheiros"
          type="number"
          min="0"
          max="100"
          defaultValue={imovel?.banheiros ?? 0}
        />
      </Campo>
      <Campo titulo={t("Vagas")}>
        <Input name="vagas" type="number" min="0" max="100" defaultValue={imovel?.vagas ?? 0} />
      </Campo>
      <Campo titulo={t("Endereço")} className="sm:col-span-2">
        <Input name="endereco" maxLength={300} defaultValue={imovel?.endereco ?? ""} />
      </Campo>
      <Campo titulo={t("Proprietário")}>
        <Escolha name="proprietario_id" defaultValue={imovel?.proprietario_id ?? ""}>
          <option value="">{t("Sem proprietário vinculado")}</option>
          {contexto.contatos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t("Contato sem nome")}
            </option>
          ))}
        </Escolha>
        <Link href="/app/contacts" className="text-xs font-normal text-primary underline">
          {t("Cadastrar ou consultar contatos")}
        </Link>
      </Campo>
      <CorretorEscolha corretores={corretores} valor={imovel?.corretor_id} />
      <Campo titulo={t("Etapa da captação")}>
        <Escolha
          name="etapa_captacao"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value as typeof etapa)}
        >
          {Object.keys(ETAPAS).map((chave) => (
            <option key={chave} value={chave}>
              {t(ETAPAS[chave as keyof typeof ETAPAS])}
            </option>
          ))}
        </Escolha>
      </Campo>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          name="ativo"
          type="checkbox"
          defaultChecked={imovel?.ativo ?? true}
          className="size-4 accent-primary"
        />{" "}
        {t("Imóvel ativo")}
      </label>
      <ProximoPasso
        valor={imovel?.proximo_passo}
        data={imovel?.proximo_contato_em}
        obrigatorio={["novo", "em_contato", "documentacao"].includes(etapa)}
      />
      <Campo titulo={t("Descrição para atendimento")} className="sm:col-span-2">
        <Textarea
          name="descricao"
          maxLength={4000}
          defaultValue={imovel?.descricao ?? ""}
          rows={3}
        />
      </Campo>
      <Campo titulo={t("Imagem do imóvel")} className="sm:col-span-2">
        <Input
          name="imagem_url"
          type="url"
          defaultValue={imovel?.imagem_url ?? ""}
          placeholder="https://…"
        />
        <span className="text-xs font-normal text-muted-foreground">
          {t("Endereço HTTPS de uma imagem usada no catálogo e no atendimento.")}
        </span>
      </Campo>
    </Editor>
  );
}

export function FormularioInteressado({
  interessado,
  contexto,
  corretores,
  salvar,
  fechar,
}: {
  interessado?: Interessado;
  contexto: Contexto;
  corretores: Corretor[];
  salvar: Salvar;
  fechar: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState(interessado?.status ?? "aberto");
  return (
    <Editor
      titulo={interessado ? t("Editar perfil do interessado") : t("Qualificar interessado")}
      descricao={t(
        "Registre o que a pessoa procura e o próximo contato. O histórico continua na ficha do contato.",
      )}
      fechar={fechar}
      salvar={async (dados) => {
        const minimo = valorEmCentavos(campo(dados, "orcamento_min") || "0", "Orçamento mínimo");
        const maximo = valorEmCentavos(campo(dados, "orcamento_max"), "Orçamento máximo");
        if (minimo > maximo)
          throw new Error("O orçamento máximo precisa ser maior ou igual ao mínimo.");
        await salvar({
          contact_id: campo(dados, "contact_id"),
          finalidade: campo(dados, "finalidade"),
          tipo: opcional(dados, "tipo"),
          orcamento_min_cents: minimo,
          orcamento_max_cents: maximo,
          bairros: listaDoCampo(campo(dados, "bairros")),
          quartos_min: numero(dados, "quartos_min"),
          prazo: opcional(dados, "prazo"),
          corretor_id: opcional(dados, "corretor_id"),
          status: campo(dados, "status"),
          proximo_passo: opcional(dados, "proximo_passo"),
          proximo_contato_em: dataParaApi(campo(dados, "proximo_contato_em")),
        });
      }}
    >
      <Campo titulo={t("Contato *")} className="sm:col-span-2">
        <Escolha name="contact_id" required defaultValue={interessado?.contact_id ?? ""}>
          <option value="">{t("Selecione o interessado")}</option>
          {contexto.contatos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t("Contato sem nome")}
            </option>
          ))}
        </Escolha>
        <Link href="/app/contacts" className="text-xs font-normal text-primary underline">
          {t("Cadastrar ou consultar contatos")}
        </Link>
      </Campo>
      <Finalidade valor={interessado?.finalidade} />
      <Campo titulo={t("Tipo desejado")}>
        <Escolha name="tipo" defaultValue={interessado?.tipo ?? ""}>
          <option value="">{t("Qualquer tipo")}</option>
          {Object.keys(TIPOS).map((chave) => (
            <option key={chave} value={chave}>
              {t(TIPOS[chave as keyof typeof TIPOS])}
            </option>
          ))}
        </Escolha>
      </Campo>
      <Campo titulo={t("Orçamento mínimo em R$")}>
        <Input
          name="orcamento_min"
          inputMode="decimal"
          defaultValue={reais(interessado?.orcamento_min_cents) || "0"}
        />
      </Campo>
      <Campo titulo={t("Orçamento máximo em R$ *")}>
        <Input
          name="orcamento_max"
          required
          inputMode="decimal"
          defaultValue={reais(interessado?.orcamento_max_cents)}
        />
      </Campo>
      <Campo titulo={t("Bairros desejados")} className="sm:col-span-2">
        <Input
          name="bairros"
          maxLength={1000}
          defaultValue={interessado?.bairros.join(", ") ?? ""}
          placeholder={t("Separe os bairros por vírgula")}
        />
      </Campo>
      <Campo titulo={t("Mínimo de quartos")}>
        <Input
          name="quartos_min"
          type="number"
          min="0"
          max="100"
          defaultValue={interessado?.quartos_min ?? 0}
        />
      </Campo>
      <Campo titulo={t("Prazo para mudar")}>
        <Input
          name="prazo"
          maxLength={200}
          defaultValue={interessado?.prazo ?? ""}
          placeholder={t("Ex.: nos próximos 3 meses")}
        />
      </Campo>
      <CorretorEscolha corretores={corretores} valor={interessado?.corretor_id} />
      <Campo titulo={t("Situação")}>
        <Escolha
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          {Object.keys(STATUS).map((chave) => (
            <option key={chave} value={chave}>
              {t(STATUS[chave as keyof typeof STATUS])}
            </option>
          ))}
        </Escolha>
      </Campo>
      <ProximoPasso
        valor={interessado?.proximo_passo}
        data={interessado?.proximo_contato_em}
        obrigatorio={["aberto", "em_visita", "proposta"].includes(status)}
      />
    </Editor>
  );
}

export function FormularioCorretor({
  corretor,
  contexto,
  salvar,
  fechar,
}: {
  corretor?: Corretor;
  contexto: Contexto;
  salvar: Salvar;
  fechar: () => void;
}) {
  const t = useT();
  return (
    <Editor
      titulo={corretor ? t("Editar corretor") : t("Cadastrar corretor")}
      descricao={t(
        "Vincule um integrante da equipe. Acesso e permissões são administrados na área Equipe.",
      )}
      fechar={fechar}
      salvar={async (dados) => {
        await salvar({
          user_id: campo(dados, "user_id"),
          creci: campo(dados, "creci"),
          especialidades: listaDoCampo(campo(dados, "especialidades")),
          regioes: listaDoCampo(campo(dados, "regioes")),
          ativo: dados.has("ativo"),
        });
      }}
    >
      <Campo titulo={t("Integrante da equipe *")} className="sm:col-span-2">
        <Escolha name="user_id" required defaultValue={corretor?.user_id ?? ""}>
          <option value="">{t("Selecione o integrante")}</option>
          {contexto.membros.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.nome || t("Integrante sem nome")}
            </option>
          ))}
        </Escolha>
        <Link href="/app/team" className="text-xs font-normal text-primary underline">
          {t("Convidar ou gerenciar equipe")}
        </Link>
      </Campo>
      <Campo titulo={t("CRECI *")}>
        <Input
          name="creci"
          required
          maxLength={40}
          defaultValue={corretor?.creci ?? ""}
          placeholder={t("Ex.: 123456-F/SP")}
        />
      </Campo>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          name="ativo"
          type="checkbox"
          defaultChecked={corretor?.ativo ?? true}
          className="size-4 accent-primary"
        />{" "}
        {t("Corretor ativo")}
      </label>
      <Campo titulo={t("Especialidades")} className="sm:col-span-2">
        <Input
          name="especialidades"
          maxLength={1000}
          defaultValue={corretor?.especialidades.join(", ") ?? ""}
          placeholder={t("Ex.: locação, residencial")}
        />
      </Campo>
      <Campo titulo={t("Regiões de atuação")} className="sm:col-span-2">
        <Input
          name="regioes"
          maxLength={1000}
          defaultValue={corretor?.regioes.join(", ") ?? ""}
          placeholder={t("Separe as regiões por vírgula")}
        />
      </Campo>
    </Editor>
  );
}

export function FormularioVisita({
  contexto,
  imoveis,
  corretores,
  salvar,
  fechar,
}: {
  contexto: Contexto;
  imoveis: Imovel[];
  corretores: Corretor[];
  salvar: Salvar;
  fechar: () => void;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [agora] = useState(() => Date.now());
  const publicados = imoveis.filter((i) => i.ativo && i.etapa_captacao === "publicado");
  const compromissos = contexto.agendamentos.filter(
    (a) =>
      a.contact_id &&
      ["pending", "confirmed"].includes(a.status) &&
      new Date(a.starts_at).getTime() > agora,
  );
  return (
    <Editor
      titulo={t("Vincular visita ao imóvel")}
      descricao={t(
        "Marque primeiro o horário na Agenda e associe o compromisso ao imóvel. Alterações e desfechos continuam na Agenda.",
      )}
      fechar={fechar}
      salvar={async (dados) => {
        await salvar({
          imovel_id: campo(dados, "imovel_id"),
          appointment_id: campo(dados, "appointment_id"),
          corretor_id: opcional(dados, "corretor_id"),
        });
      }}
    >
      <Campo titulo={t("Imóvel *")} className="sm:col-span-2">
        <Escolha name="imovel_id" required defaultValue="">
          <option value="">{t("Selecione o imóvel")}</option>
          {publicados.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo} · {i.nome}
            </option>
          ))}
        </Escolha>
        {publicados.length === 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            {t("Publique um imóvel ativo na carteira para vincular a visita.")}
          </span>
        )}
      </Campo>
      <Campo titulo={t("Compromisso na Agenda *")} className="sm:col-span-2">
        <Escolha name="appointment_id" required defaultValue="">
          <option value="">{t("Selecione o compromisso")}</option>
          {compromissos.map((a) => (
            <option key={a.id} value={a.id}>
              {dataLegivel(a.starts_at, idioma)} · {a.title}
            </option>
          ))}
        </Escolha>
        {compromissos.length === 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            {t("Marque um compromisso futuro com contato na Agenda para vincular a visita.")}
          </span>
        )}
        <Link href="/app/agenda" className="text-xs font-normal text-primary underline">
          {t("Abrir Agenda para marcar um horário")}
        </Link>
      </Campo>
      <CorretorEscolha corretores={corretores} />
    </Editor>
  );
}
