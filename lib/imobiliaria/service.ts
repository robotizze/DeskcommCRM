import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { rotuloDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import { esquemas, esquemasParciais } from "./schemas";
import type {
  ContextoImobiliario,
  Corretor,
  Imovel,
  Interessado,
  RecursoImobiliario,
  Visita,
} from "./tipos";

export class ImobiliariaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export interface ContextoDaOperacao {
  db: SupabaseClient;
  organizationId: string;
  actorId: string;
  requestId: string;
}
type Linha = Record<string, unknown> & { id: string };
type FalhaDoBanco = { code?: string; message?: string } | null;
const TABELAS = {
  imoveis: "imob_imoveis",
  corretores: "imob_corretores",
  interessados: "imob_interessados",
  visitas: "imob_visitas",
} as const;
const CAMPOS_CATALOGO = "id,codigo,nome,descricao,preco_cents,moeda,imagem_url,ativo";
const CAMPOS_CONTATO = "id,name,display_name,phone_number";
const ACOES = {
  imoveis: "imobiliaria.imovel_salvo",
  corretores: "imobiliaria.corretor_salvo",
  interessados: "imobiliaria.interessado_salvo",
  visitas: "imobiliaria.visita_salva",
} as const;

function falha(error: FalhaDoBanco): void {
  if (!error) return;
  if (["42P01", "PGRST205"].includes(error.code ?? ""))
    throw new ImobiliariaError(
      "module_not_installed",
      "O módulo Imobiliária precisa ser instalado em Configurações da instalação › Módulos.",
      409,
    );
  if (error.code === "23505")
    throw new ImobiliariaError(
      "state_conflict",
      "Este código, corretor ou agendamento já está cadastrado. Abra o registro existente para editar.",
      409,
    );
  if (["23503", "23514", "22023", "22P02"].includes(error.code ?? ""))
    throw new ImobiliariaError(
      "validation_failed",
      "Confira os dados e escolha registros da sua organização.",
      422,
    );
  if (error.code === "42501")
    throw new ImobiliariaError(
      "forbidden_role",
      "Seu papel não permite alterar este registro.",
      403,
    );
  if (error.code === "P0002")
    throw new ImobiliariaError("not_found", "Registro não encontrado.", 404);
  logger.warn("imobiliária: operação de banco recusada", { codigo: error.code ?? null });
  throw new ImobiliariaError(
    "upstream_unavailable",
    "Não foi possível concluir a operação. Atualize a tela e tente novamente.",
    503,
  );
}

export async function exigirModuloImobiliaria(): Promise<void> {
  if (!(await moduloLigado(createAdminClient(), "imobiliaria"))) {
    throw new ImobiliariaError(
      "module_not_installed",
      "O módulo Imobiliária está indisponível. Peça ao administrador para instalar ou conferir o módulo nas configurações da instalação.",
      409,
    );
  }
}

async function lerRelacionados(
  db: SupabaseClient,
  org: string,
  tabela: string,
  campos: string,
  ids: unknown[],
): Promise<Linha[]> {
  const chaves = [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))];
  if (!chaves.length) return [];
  const { data, error } = await db
    .from(tabela)
    .select(campos)
    .eq("organization_id", org)
    .in("id", chaves);
  falha(error);
  return (data ?? []) as unknown as Linha[];
}

async function nomesDosMembros(
  db: SupabaseClient,
  organizationId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .not("accepted_at", "is", null)
    .is("revoked_at", null)
    .limit(200);
  falha(error);
  const ids = (data ?? []) as Array<{ user_id: string }>;
  const nomes = new Map(ids.map((m) => [m.user_id, `Membro ${m.user_id.slice(0, 8)}`]));
  if (!isServiceRoleConfigured()) return nomes;
  const admin = createAdminClient();
  await Promise.all(
    ids.map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      const nome = u?.user?.user_metadata?.full_name;
      if (typeof nome === "string" && nome.trim()) nomes.set(m.user_id, nome.trim());
    }),
  );
  return nomes;
}

export async function contextoImobiliario(
  db: SupabaseClient,
  organizationId: string,
  incluirMembros: boolean,
): Promise<ContextoImobiliario> {
  const [contatos, agendamentos, nomes] = await Promise.all([
    db
      .from("contacts")
      .select(CAMPOS_CONTATO)
      .eq("organization_id", organizationId)
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .order("display_name")
      .limit(200),
    db
      .from("calendar_appointments")
      .select("id,title,starts_at,ends_at,status,contact_id")
      .eq("organization_id", organizationId)
      .gte("starts_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("starts_at")
      .limit(200),
    incluirMembros
      ? nomesDosMembros(db, organizationId)
      : Promise.resolve(new Map<string, string>()),
  ]);
  falha(contatos.error);
  falha(agendamentos.error);
  return {
    contatos: (contatos.data ?? []).map((c: { id: string } & ContatoNomeavel) => ({
      id: c.id,
      name: rotuloDoContato(c),
    })),
    membros: [...nomes].map(([user_id, nome]) => ({ user_id, nome })),
    agendamentos: agendamentos.data ?? [],
  };
}

/** Junções separadas, sempre recortadas por organização; preço e agenda nunca são copiados ao módulo. */
export async function listarRegistros(
  db: SupabaseClient,
  organizationId: string,
  recurso: RecursoImobiliario,
  id?: string,
): Promise<Array<Imovel | Corretor | Interessado | Visita>> {
  let consulta = db
    .from(TABELAS[recurso])
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (id) consulta = consulta.eq("id", id);
  const { data, error } = await consulta;
  falha(error);
  const linhas = (data ?? []) as Linha[];
  if (recurso === "imoveis") {
    const produtos = await lerRelacionados(
      db,
      organizationId,
      "catalog_products",
      CAMPOS_CATALOGO,
      linhas.map((l) => l.produto_id),
    );
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    return linhas
      .filter((l) => mapa.has(l.produto_id as string))
      .map((l) => {
        const { id: _produtoId, ...produto } = mapa.get(l.produto_id as string)!;
        return {
          ...l,
          ...produto,
          preco_cents: Number(produto.preco_cents),
          area_m2: l.area_m2 === null ? null : Number(l.area_m2),
        } as unknown as Imovel;
      });
  }
  if (recurso === "corretores") {
    const nomes = await nomesDosMembros(db, organizationId);
    return linhas.map(
      (l) =>
        ({
          ...l,
          nome: nomes.get(l.user_id as string) ?? "Membro indisponível",
        }) as unknown as Corretor,
    );
  }
  if (recurso === "interessados") {
    const contatos = await lerRelacionados(
      db,
      organizationId,
      "contacts",
      CAMPOS_CONTATO,
      linhas.map((l) => l.contact_id),
    );
    const mapa = new Map(contatos.map((c) => [c.id, rotuloDoContato(c as ContatoNomeavel)]));
    return linhas.map(
      (l) =>
        ({
          ...l,
          contato_nome: mapa.get(l.contact_id as string) ?? "Contato indisponível",
          orcamento_min_cents: Number(l.orcamento_min_cents),
          orcamento_max_cents: Number(l.orcamento_max_cents),
        }) as unknown as Interessado,
    );
  }
  const agendas = await lerRelacionados(
    db,
    organizationId,
    "calendar_appointments",
    "id,title,starts_at,ends_at,status,contact_id",
    linhas.map((l) => l.appointment_id),
  );
  const agenda = new Map(agendas.map((a) => [a.id, a]));
  const imoveis = await lerRelacionados(
    db,
    organizationId,
    "imob_imoveis",
    "id,produto_id",
    linhas.map((l) => l.imovel_id),
  );
  const produtos = await lerRelacionados(
    db,
    organizationId,
    "catalog_products",
    "id,nome",
    imoveis.map((l) => l.produto_id),
  );
  const produto = new Map(produtos.map((p) => [p.id, p.nome]));
  const imovel = new Map(imoveis.map((i) => [i.id, produto.get(i.produto_id as string)]));
  const contatos = await lerRelacionados(
    db,
    organizationId,
    "contacts",
    CAMPOS_CONTATO,
    agendas.map((a) => a.contact_id),
  );
  const contato = new Map(contatos.map((c) => [c.id, rotuloDoContato(c as ContatoNomeavel)]));
  return linhas
    .filter((l) => agenda.has(l.appointment_id as string))
    .map((l) => {
      const { id: _agendaId, ...a } = agenda.get(l.appointment_id as string)!;
      return {
        ...l,
        ...a,
        imovel_nome: imovel.get(l.imovel_id as string) ?? "Imóvel",
        contato_nome: contato.get(a.contact_id as string) ?? null,
      } as unknown as Visita;
    });
}

export function validarEntrada(
  recurso: RecursoImobiliario,
  corpo: unknown,
  parcial = false,
): Record<string, unknown> {
  const resultado = (parcial ? esquemasParciais[recurso] : esquemas[recurso]).safeParse(corpo);
  if (!resultado.success)
    throw new ImobiliariaError(
      "validation_failed",
      resultado.error.issues[0]?.message ?? "Confira os campos.",
      422,
    );
  if (parcial && Object.keys(resultado.data).length === 0)
    throw new ImobiliariaError(
      "validation_failed",
      "Informe pelo menos um campo para alterar.",
      422,
    );
  return resultado.data as Record<string, unknown>;
}

async function conferirReferencia(
  db: SupabaseClient,
  org: string,
  tabela: string,
  id: unknown,
  campo = "id",
): Promise<void> {
  if (id == null) return;
  let consulta = db.from(tabela).select(campo).eq("organization_id", org).eq(campo, id);
  if (tabela === "user_organizations")
    consulta = consulta.not("accepted_at", "is", null).is("revoked_at", null);
  if (tabela === "imob_corretores") consulta = consulta.eq("ativo", true);
  if (tabela === "contacts")
    consulta = consulta.eq("is_anonymized", false).is("is_merged_into", null);
  const { data, error } = await consulta.maybeSingle();
  falha(error);
  if (!data)
    throw new ImobiliariaError(
      "validation_failed",
      "Escolha um registro disponível na sua organização.",
      422,
    );
}

export async function conferirNovaVisita(
  db: SupabaseClient,
  org: string,
  imovelId: string,
  agendamentoId: string,
): Promise<void> {
  const [imovel, agendamento] = await Promise.all([
    db
      .from("imob_imoveis")
      .select("id,produto_id,etapa_captacao")
      .eq("organization_id", org)
      .eq("id", imovelId)
      .maybeSingle(),
    db
      .from("calendar_appointments")
      .select("id,contact_id,status,starts_at")
      .eq("organization_id", org)
      .eq("id", agendamentoId)
      .maybeSingle(),
  ]);
  falha(imovel.error);
  falha(agendamento.error);
  if (!imovel.data || imovel.data.etapa_captacao !== "publicado")
    throw new ImobiliariaError(
      "validation_failed",
      "Escolha um imóvel publicado e disponível.",
      422,
    );
  const produto = await db
    .from("catalog_products")
    .select("id,ativo")
    .eq("organization_id", org)
    .eq("id", imovel.data.produto_id)
    .maybeSingle();
  falha(produto.error);
  if (!produto.data?.ativo)
    throw new ImobiliariaError(
      "validation_failed",
      "Escolha um imóvel publicado e disponível.",
      422,
    );
  const a = agendamento.data;
  if (
    !a?.contact_id ||
    !["pending", "confirmed"].includes(a.status) ||
    Date.parse(a.starts_at) <= Date.now()
  )
    throw new ImobiliariaError(
      "validation_failed",
      "Escolha um agendamento futuro, aberto e vinculado a um interessado.",
      422,
    );
  await conferirReferencia(db, org, "contacts", a.contact_id);
}

export async function salvarRegistro(
  ctx: ContextoDaOperacao,
  recurso: RecursoImobiliario,
  corpo: Record<string, unknown>,
  id?: string,
): Promise<Imovel | Corretor | Interessado | Visita> {
  const { db, organizationId } = ctx;
  let dados = corpo;
  let trocarVinculoDeVisita = !id;
  if (id) {
    const anterior = (await listarRegistros(db, organizationId, recurso, id))[0];
    if (!anterior) throw new ImobiliariaError("not_found", "Registro não encontrado.", 404);
    // Campos de leitura (nome do contato, timestamps, id) não voltam à escrita.
    const chaves = Object.keys(esquemasParciais[recurso].shape);
    const atuais = Object.fromEntries(
      chaves.map((k) => [k, (anterior as unknown as Record<string, unknown>)[k]]),
    );
    dados = validarEntrada(recurso, { ...atuais, ...corpo });
    trocarVinculoDeVisita =
      recurso === "visitas" &&
      (dados.imovel_id !== atuais.imovel_id || dados.appointment_id !== atuais.appointment_id);
  }
  if (recurso === "visitas" && trocarVinculoDeVisita)
    await conferirNovaVisita(
      db,
      organizationId,
      dados.imovel_id as string,
      dados.appointment_id as string,
    );
  await Promise.all([
    conferirReferencia(db, organizationId, "imob_corretores", dados.corretor_id),
    conferirReferencia(db, organizationId, "contacts", dados.proprietario_id ?? dados.contact_id),
    conferirReferencia(db, organizationId, "user_organizations", dados.user_id, "user_id"),
    conferirReferencia(db, organizationId, "imob_imoveis", dados.imovel_id),
    conferirReferencia(db, organizationId, "calendar_appointments", dados.appointment_id),
  ]);
  let salvoId: string;
  if (recurso === "imoveis") {
    const resultado = await db.rpc("fn_imobiliaria_imovel_salvar", {
      p_org: organizationId,
      p_id: id ?? null,
      p_dados: dados,
    });
    falha(resultado.error);
    salvoId = resultado.data as string;
  } else {
    const consulta = id
      ? db.from(TABELAS[recurso]).update(dados).eq("organization_id", organizationId).eq("id", id)
      : db.from(TABELAS[recurso]).insert({ ...dados, organization_id: organizationId });
    const resultado = await consulta.select("id").maybeSingle();
    falha(resultado.error);
    if (!resultado.data) throw new ImobiliariaError("not_found", "Registro não encontrado.", 404);
    salvoId = resultado.data.id;
  }
  await audit({
    action: ACOES[recurso],
    actorUserId: ctx.actorId,
    organizationId,
    resourceType: TABELAS[recurso],
    resourceId: salvoId,
    requestId: ctx.requestId,
    metadata: { operacao: id ? "atualizacao" : "criacao" },
  });
  const salvo = (await listarRegistros(db, organizationId, recurso, salvoId))[0];
  if (!salvo)
    throw new ImobiliariaError(
      "upstream_unavailable",
      "Registro salvo. Atualize a lista para visualizar.",
      503,
    );
  return salvo;
}
