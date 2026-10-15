// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { conferirNovaVisita } from "./service";
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), isServiceRoleConfigured: () => false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
function banco(
  patch: {
    etapa?: string;
    ativo?: boolean;
    status?: string;
    contact_id?: string | null;
    passado?: boolean;
    contatoAusente?: boolean;
  } = {},
) {
  const filtros: Array<[string, string, unknown]> = [];
  const linhas: Record<string, unknown> = {
    imob_imoveis: {
      id: "imovel",
      produto_id: "produto",
      etapa_captacao: patch.etapa ?? "publicado",
    },
    catalog_products: { id: "produto", ativo: patch.ativo ?? true },
    calendar_appointments: {
      id: "agenda",
      contact_id: patch.contact_id === undefined ? "contato" : patch.contact_id,
      status: patch.status ?? "confirmed",
      starts_at: new Date(Date.now() + (patch.passado ? -1 : 1) * 86400000).toISOString(),
    },
    contacts: patch.contatoAusente ? null : { id: "contato" },
  };
  const db = {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: (campo: string, valor: unknown) => {
          filtros.push([tabela, campo, valor]);
          return q;
        },
        is: () => q,
        maybeSingle: () => Promise.resolve({ data: linhas[tabela], error: null }),
      };
      return q;
    },
  };
  return { db: db as never, filtros };
}
describe("novos vínculos de visita", () => {
  it("aceita só imóvel publicado/ativo e agenda futura com contato", async () => {
    const { db, filtros } = banco();
    await expect(conferirNovaVisita(db, "org", "imovel", "agenda")).resolves.toBeUndefined();
    for (const tabela of ["imob_imoveis", "catalog_products", "calendar_appointments", "contacts"])
      expect(filtros).toContainEqual([tabela, "organization_id", "org"]);
  });
  for (const patch of [
    { etapa: "em_contato" },
    { ativo: false },
    { status: "cancelled" },
    { passado: true },
    { contact_id: null },
    { contatoAusente: true },
  ]) {
    it(`recusa configuração indisponível ${JSON.stringify(patch)}`, async () => {
      await expect(
        conferirNovaVisita(banco(patch).db, "org", "imovel", "agenda"),
      ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    });
  }
});
