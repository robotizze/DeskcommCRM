// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { comIdempotencia } from "@/lib/api/idempotency";
import {
  exigirModuloImobiliaria,
  ImobiliariaError,
  salvarRegistro,
} from "@/lib/imobiliaria/service";
import { POST } from "./route";
import type * as Idempotencia from "@/lib/api/idempotency";
import type * as Imobiliaria from "@/lib/imobiliaria/service";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/api/idempotency", async (original) => ({
  ...(await original<typeof Idempotencia>()),
  comIdempotencia: vi.fn(),
}));
vi.mock("@/lib/imobiliaria/service", async (original) => ({
  ...(await original<typeof Imobiliaria>()),
  exigirModuloImobiliaria: vi.fn(),
  salvarRegistro: vi.fn(),
}));

const ORG = "eeeeeeee-0000-4000-8000-000000000001";
const USER = "eeeeeeee-0000-4000-8000-000000000002";
const imovel = {
  codigo: "AQ-001",
  nome: "Casa",
  preco_cents: 10000000,
  finalidade: "venda",
  tipo: "casa",
  bairro: "Centro",
  cidade: "Manaus",
  uf: "AM",
};
function request(corpo: unknown, chave?: string) {
  return new NextRequest("http://localhost/api/v1/imobiliaria/imoveis", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...(chave ? { "Idempotency-Key": chave } : {}) },
  });
}
const params = { params: Promise.resolve({ recurso: "imoveis" }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG },
  } as never);
  vi.mocked(exigirModuloImobiliaria).mockResolvedValue(undefined);
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(salvarRegistro).mockResolvedValue({ id: "registro" } as never);
});
describe("escrita da imobiliária", () => {
  it("recusa suporte de leitura antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(
      fail("forbidden", "Acompanhamento de leitura", 403),
    );
    expect((await POST(request(imovel), params)).status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
  it("exige manager para imóvel e respeita recusa de RBAC", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Sem permissão", 403),
    } as never);
    expect((await POST(request(imovel), params)).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("manager", expect.anything());
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
  it("módulo desligado não permite escrita", async () => {
    vi.mocked(exigirModuloImobiliaria).mockRejectedValue(
      new ImobiliariaError("module_not_installed", "Instale o módulo", 409),
    );
    expect((await POST(request(imovel), params)).status).toBe(409);
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
  it("organização injetada no corpo é recusada", async () => {
    expect((await POST(request({ ...imovel, organization_id: ORG }), params)).status).toBe(422);
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
  it("escrita usa organização da autenticação", async () => {
    expect((await POST(request(imovel), params)).status).toBe(201);
    expect(salvarRegistro).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, actorId: USER }),
      "imoveis",
      expect.objectContaining({ codigo: "AQ-001" }),
    );
  });
  it("replay devolve recibo e não repete a escrita", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({
      tipo: "replay",
      resposta: { id: "anterior" },
      status: 201,
    } as never);
    const response = await POST(request(imovel, "eeeeeeee-0000-4000-8000-000000000003"), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "anterior" } });
    expect(comIdempotencia).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, endpoint: "/api/v1/imobiliaria/imoveis" }),
    );
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
  it("chave em curso retorna orientação sem repetir efeito", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({ tipo: "em_curso" } as never);
    const response = await POST(request(imovel, "eeeeeeee-0000-4000-8000-000000000003"), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("idempotency_in_progress");
    expect(salvarRegistro).not.toHaveBeenCalled();
  });
});
