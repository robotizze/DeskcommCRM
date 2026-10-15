// @vitest-environment node
import { describe, expect, it } from "vitest";
import { copiaDoTitular, partesDoArquivoDoTitular } from "@/lib/lgpd/copia-do-titular";
import type { ExportPayload } from "@/lib/lgpd/export-collector";

describe("cópia imobiliária que o titular recebe", () => {
  it("entrega preferências e imóvel, sem chaves ou agenda interna da equipe", () => {
    const payload = {
      request_id: "protocolo",
      imobiliaria: {
        imoveis: [
          {
            id: "SEGREDO-imovel",
            produto_id: "SEGREDO-produto",
            corretor_id: "SEGREDO-corretor",
            proprietario_id: "SEGREDO-dono",
            endereco: "Rua do titular",
            proximo_passo: "SEGREDO-passo",
            proximo_contato_em: "SEGREDO-data",
            catalogo: {
              id: "SEGREDO-catalogo",
              codigo: "AQ-001",
              descricao: "Descrição do imóvel",
              preco_cents: 50000000,
            },
          },
        ],
        interessados: [
          {
            contact_id: "SEGREDO-contato",
            prazo: "Em 60 dias",
            orcamento_max_cents: 50000000,
            proximo_passo: "SEGREDO-equipe",
          },
        ],
        visitas: [
          { id: "SEGREDO-visita", appointment_id: "SEGREDO-agenda", created_at: "2026-10-15" },
        ],
        parcial: false,
      },
    } as unknown as ExportPayload;
    const copia = copiaDoTitular(payload, "BR");
    const escrito = JSON.stringify(copia);
    expect(escrito).not.toContain("SEGREDO");
    expect(escrito).toContain("Rua do titular");
    expect(escrito).toContain("Em 60 dias");
    expect(escrito).toContain("AQ-001");
    expect([...partesDoArquivoDoTitular(payload, "BR")].join("")).toBe(
      JSON.stringify(copia, null, 2),
    );
    expect(JSON.stringify(payload)).toContain("SEGREDO");
  });
});
