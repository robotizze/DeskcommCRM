// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { coletarImobiliaria } from "./export";
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

const ORG = "ffffffff-0000-4000-8000-000000000001";
const CONTATO = "ffffffff-0000-4000-8000-000000000002";
function banco(
  resultados: Record<string, { data: unknown[] | null; error: { code: string } | null }>,
) {
  const consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  const db = {
    from(tabela: string) {
      const registro = { tabela, filtros: [] as Array<[string, unknown]> };
      consultas.push(registro);
      const q = {
        select: () => q,
        eq: (campo: string, valor: unknown) => {
          registro.filtros.push([campo, valor]);
          return q;
        },
        in: (campo: string, valor: unknown) => {
          registro.filtros.push([campo, valor]);
          return q;
        },
        limit: () => Promise.resolve(resultados[tabela] ?? { data: [], error: null }),
      };
      return q;
    },
  };
  return { db: db as never, consultas };
}
describe("export imobiliário do titular", () => {
  it("instalação sem módulo mantém o contrato legado", async () => {
    const { db, consultas } = banco({
      imob_imoveis: { data: null, error: { code: "42P01" } },
      imob_interessados: { data: null, error: { code: "PGRST205" } },
    });
    expect(await coletarImobiliaria(db, ORG, CONTATO, "req")).toBeUndefined();
    expect(consultas).toHaveLength(2);
  });
  it("export só lê vínculos do contato na organização autenticada", async () => {
    const { db, consultas } = banco({
      imob_interessados: {
        data: [{ id: "perfil", contact_id: CONTATO, prazo: "Em 60 dias" }],
        error: null,
      },
      calendar_appointments: { data: [{ id: "agenda" }], error: null },
      imob_visitas: { data: [{ id: "visita", appointment_id: "agenda" }], error: null },
    });
    const data = await coletarImobiliaria(db, ORG, CONTATO, "req");
    expect(data?.interessados).toHaveLength(1);
    expect(data?.visitas).toHaveLength(1);
    for (const q of consultas) expect(q.filtros).toContainEqual(["organization_id", ORG]);
    expect(consultas.find((q) => q.tabela === "imob_imoveis")?.filtros).toContainEqual([
      "proprietario_id",
      CONTATO,
    ]);
    expect(consultas.find((q) => q.tabela === "imob_interessados")?.filtros).toContainEqual([
      "contact_id",
      CONTATO,
    ]);
    expect(consultas.find((q) => q.tabela === "imob_visitas")?.filtros).toContainEqual([
      "appointment_id",
      ["agenda"],
    ]);
  });
  it("falha real é entregue como parcial, nunca ausência silenciosa", async () => {
    const { db } = banco({ imob_interessados: { data: null, error: { code: "42501" } } });
    expect((await coletarImobiliaria(db, ORG, CONTATO, "req"))?.parcial).toBe(true);
  });
  it("teto atingido sinaliza export parcial", async () => {
    const { db } = banco({
      imob_interessados: {
        data: Array.from({ length: 500 }, (_, id) => ({ id, contact_id: CONTATO })),
        error: null,
      },
    });
    expect((await coletarImobiliaria(db, ORG, CONTATO, "req"))?.parcial).toBe(true);
  });
});
