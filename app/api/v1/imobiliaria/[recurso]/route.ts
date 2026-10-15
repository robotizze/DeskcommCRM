import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { RECURSOS_IMOBILIARIOS } from "@/lib/imobiliaria/tipos";
import { chaveIdempotenteSchema } from "@/lib/imobiliaria/schemas";
import {
  exigirModuloImobiliaria,
  ImobiliariaError,
  listarRegistros,
  salvarRegistro,
  validarEntrada,
} from "@/lib/imobiliaria/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ recurso: string }> };
const recursoSchema = z.enum(RECURSOS_IMOBILIARIOS);

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const { recurso: nome } = await params;
  const recurso = recursoSchema.safeParse(nome);
  if (!recurso.success) return fail("not_found", "Área não encontrada.", 404, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "imobiliaria" });
  if (!authz.ok) return authz.response;
  try {
    await exigirModuloImobiliaria();
    const db = await createClient();
    const data = await listarRegistros(db, authz.org.orgId, recurso.data);
    return ok(data, { requestId, meta: { total: data.length, has_more: data.length === 200 } });
  } catch (e) {
    if (e instanceof ImobiliariaError) return fail(e.code, e.message, e.status, { requestId });
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const recurso = recursoSchema.safeParse((await params).recurso);
  if (!recurso.success) return fail("not_found", "Área não encontrada.", 404, { requestId });
  const papel = ["imoveis", "corretores"].includes(recurso.data) ? "manager" : "agent";
  const authz = await requireRole(papel, { requestId, resource: "imobiliaria" });
  if (!authz.ok) return authz.response;
  try {
    await exigirModuloImobiliaria();
    const corpo = validarEntrada(recurso.data, await req.json().catch(() => null));
    const chave = chaveDaRequisicao(req);
    if (chave && !chaveIdempotenteSchema.safeParse(chave).success)
      return fail("validation_failed", "A chave da operação deve ser um UUID.", 422, { requestId });
    const db = await createClient();
    const ctx = { db, organizationId: authz.org.orgId, actorId: authz.user.id, requestId };
    if (!chave)
      return ok(await salvarRegistro(ctx, recurso.data, corpo), { requestId, status: 201 });
    const resultado = await comIdempotencia({
      db,
      organizationId: authz.org.orgId,
      endpoint: `/api/v1/imobiliaria/${recurso.data}`,
      chave,
      corpo,
      executar: async () => ({
        resposta: await salvarRegistro(ctx, recurso.data, corpo),
        status: 201,
      }),
    });
    if (resultado.tipo === "conflito")
      return fail("idempotency_conflict", "Esta operação já foi usada com outros dados.", 409, {
        requestId,
      });
    if (resultado.tipo === "em_curso")
      return fail(
        "idempotency_in_progress",
        "Esta operação ainda está sendo concluída. Aguarde e atualize a lista.",
        409,
        { requestId },
      );
    return ok(resultado.resposta, { requestId, status: 201 });
  } catch (e) {
    if (e instanceof ImobiliariaError) return fail(e.code, e.message, e.status, { requestId });
    throw e;
  }
}
