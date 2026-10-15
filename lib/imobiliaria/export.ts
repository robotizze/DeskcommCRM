import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export interface ExportImobiliario {
  imoveis: Record<string, unknown>[];
  interessados: Record<string, unknown>[];
  visitas: Record<string, unknown>[];
  parcial: boolean;
}
const AUSENTE = new Set(["42P01", "PGRST205"]);
/** Export do titular, não inventário do tenant: cada consulta filtra org e vínculo ao contato. */
export async function coletarImobiliaria(
  db: SupabaseClient,
  org: string,
  contatoId: string,
  requestId: string,
): Promise<ExportImobiliario | undefined> {
  const resultado: ExportImobiliario = {
    imoveis: [],
    interessados: [],
    visitas: [],
    parcial: false,
  };
  const [imoveis, interessados] = await Promise.all([
    db
      .from("imob_imoveis")
      .select(
        "id,produto_id,finalidade,tipo,bairro,cidade,uf,quartos,banheiros,vagas,area_m2,endereco,proprietario_id,corretor_id,etapa_captacao,proximo_passo,proximo_contato_em,created_at,updated_at",
      )
      .eq("organization_id", org)
      .eq("proprietario_id", contatoId)
      .limit(500),
    db
      .from("imob_interessados")
      .select(
        "id,contact_id,finalidade,tipo,orcamento_min_cents,orcamento_max_cents,bairros,quartos_min,prazo,corretor_id,status,proximo_passo,proximo_contato_em,created_at,updated_at",
      )
      .eq("organization_id", org)
      .eq("contact_id", contatoId)
      .limit(500),
  ]);
  if (
    imoveis.error &&
    interessados.error &&
    AUSENTE.has(imoveis.error.code) &&
    AUSENTE.has(interessados.error.code)
  )
    return undefined;
  const conferir = (error: { code?: string } | null, tamanho: number) => {
    if (error || tamanho >= 500) resultado.parcial = true;
    if (error)
      logger.warn("imobiliária: seção do export incompleta", {
        request_id: requestId,
        codigo: error.code,
      });
  };
  conferir(imoveis.error, imoveis.data?.length ?? 0);
  conferir(interessados.error, interessados.data?.length ?? 0);
  resultado.imoveis = imoveis.data ?? [];
  resultado.interessados = interessados.data ?? [];
  if (resultado.imoveis.length) {
    const { data, error } = await db
      .from("catalog_products")
      .select("id,codigo,nome,descricao,preco_cents,moeda,imagem_url,ativo")
      .eq("organization_id", org)
      .in(
        "id",
        resultado.imoveis.map((i) => i.produto_id as string),
      )
      .limit(500);
    conferir(error, data?.length ?? 0);
    const mapa = new Map((data ?? []).map((p) => [p.id, p]));
    resultado.imoveis = resultado.imoveis.map((i) => ({
      ...i,
      catalogo: mapa.get(i.produto_id as string) ?? null,
    }));
  }
  const agendamentos = await db
    .from("calendar_appointments")
    .select("id")
    .eq("organization_id", org)
    .eq("contact_id", contatoId)
    .limit(500);
  conferir(agendamentos.error, agendamentos.data?.length ?? 0);
  if (agendamentos.data?.length) {
    const visitas = await db
      .from("imob_visitas")
      .select("id,imovel_id,appointment_id,corretor_id,created_at,updated_at")
      .eq("organization_id", org)
      .in(
        "appointment_id",
        agendamentos.data.map((a) => a.id),
      )
      .limit(500);
    conferir(visitas.error, visitas.data?.length ?? 0);
    resultado.visitas = visitas.data ?? [];
  }
  // Preserva o contrato legado onde o módulo não guarda nenhum dado do titular.
  if (
    !resultado.parcial &&
    !resultado.imoveis.length &&
    !resultado.interessados.length &&
    !resultado.visitas.length
  )
    return undefined;
  return resultado;
}
