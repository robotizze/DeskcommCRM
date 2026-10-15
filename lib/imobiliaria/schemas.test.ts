// @vitest-environment node
import { describe, expect, it } from "vitest";
import { imovelSchema, interessadoSchema, esquemasParciais, visitaSchema } from "./schemas";

const imovel = {
  codigo: "AQ-001",
  nome: "Casa com jardim",
  preco_cents: 65000000,
  finalidade: "venda",
  tipo: "casa",
  bairro: "Centro",
  cidade: "Manaus",
  uf: "AM",
};
const interesse = {
  contact_id: "dddddddd-0000-4000-8000-000000000001",
  finalidade: "venda",
  orcamento_min_cents: 30000000,
  orcamento_max_cents: 65000000,
  proximo_passo: "Apresentar três imóveis",
};
describe("contratos de entrada imobiliária", () => {
  it("rejeita escolha de organização e campos desconhecidos", () => {
    expect(
      imovelSchema.safeParse({ ...imovel, organization_id: "dddddddd-0000-4000-8000-000000000002" })
        .success,
    ).toBe(false);
    expect(interessadoSchema.safeParse({ ...interesse, consent: true }).success).toBe(false);
  });
  it("dinheiro é inteiro em centavos, sem moeda divergente do catálogo", () => {
    expect(imovelSchema.safeParse({ ...imovel, preco_cents: 1.1 }).success).toBe(false);
    expect(imovelSchema.safeParse({ ...imovel, moeda: "USD" }).success).toBe(false);
    expect(imovelSchema.safeParse(imovel).success).toBe(true);
  });
  it("captação aberta exige próximo passo", () => {
    expect(imovelSchema.safeParse({ ...imovel, etapa_captacao: "em_contato" }).success).toBe(false);
    expect(
      imovelSchema.safeParse({ ...imovel, etapa_captacao: "em_contato", proximo_passo: "    " })
        .success,
    ).toBe(false);
    expect(
      imovelSchema.safeParse({
        ...imovel,
        etapa_captacao: "em_contato",
        proximo_passo: "Solicitar matrícula",
      }).success,
    ).toBe(true);
  });
  it("imóvel em captação ou encerrado nunca fica disponível na busca nativa", () => {
    expect(
      imovelSchema.parse({
        ...imovel,
        etapa_captacao: "em_contato",
        proximo_passo: "Solicitar matrícula",
        ativo: true,
      }).ativo,
    ).toBe(false);
    expect(imovelSchema.parse({ ...imovel, etapa_captacao: "encerrado", ativo: true }).ativo).toBe(
      false,
    );
    expect(imovelSchema.parse({ ...imovel, etapa_captacao: "publicado", ativo: true }).ativo).toBe(
      true,
    );
  });
  it("perfil aberto exige próximo passo e orçamento coerente", () => {
    expect(interessadoSchema.safeParse({ ...interesse, proximo_passo: null }).success).toBe(false);
    expect(interessadoSchema.safeParse({ ...interesse, orcamento_max_cents: 1 }).success).toBe(
      false,
    );
    expect(
      interessadoSchema.safeParse({ ...interesse, status: "encerrado", proximo_passo: null })
        .success,
    ).toBe(true);
  });
  it("PATCH só inclui a alteração solicitada", () => {
    expect(esquemasParciais.imoveis.parse({ nome: "Outro título" })).toEqual({
      nome: "Outro título",
    });
    expect(esquemasParciais.interessados.parse({ prazo: "Em 60 dias" })).toEqual({
      prazo: "Em 60 dias",
    });
  });
  it("visita só vincula agenda existente, sem aceitar datas ou estado inventados", () => {
    const visita = {
      imovel_id: "dddddddd-0000-4000-8000-000000000001",
      appointment_id: "dddddddd-0000-4000-8000-000000000002",
    };
    expect(visitaSchema.safeParse(visita).success).toBe(true);
    expect(visitaSchema.safeParse({ ...visita, starts_at: "2026-11-01T10:00:00Z" }).success).toBe(
      false,
    );
  });
});
