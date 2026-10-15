import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { RECURSOS_IMOBILIARIOS } from "@/lib/imobiliaria/tipos";
import {
  exigirModuloImobiliaria,
  ImobiliariaError,
  listarRegistros,
  salvarRegistro,
  validarEntrada,
} from "@/lib/imobiliaria/service";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ recurso: string; id: string }> };
const paramsSchema = z.object({ recurso: z.enum(RECURSOS_IMOBILIARIOS), id: z.uuid() });

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const lido = paramsSchema.safeParse(await params);
  if (!lido.success) return fail("not_found", "Registro não encontrado.", 404, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "imobiliaria" });
  if (!authz.ok) return authz.response;
  try {
    await exigirModuloImobiliaria();
    const data = (
      await listarRegistros(await createClient(), authz.org.orgId, lido.data.recurso, lido.data.id)
    )[0];
    if (!data) return fail("not_found", "Registro não encontrado.", 404, { requestId });
    return ok(data, { requestId });
  } catch (e) {
    if (e instanceof ImobiliariaError) return fail(e.code, e.message, e.status, { requestId });
    throw e;
  }
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const lido = paramsSchema.safeParse(await params);
  if (!lido.success) return fail("not_found", "Registro não encontrado.", 404, { requestId });
  const papel = ["imoveis", "corretores"].includes(lido.data.recurso) ? "manager" : "agent";
  const authz = await requireRole(papel, { requestId, resource: "imobiliaria" });
  if (!authz.ok) return authz.response;
  try {
    await exigirModuloImobiliaria();
    const corpo = validarEntrada(lido.data.recurso, await req.json().catch(() => null), true);
    const db = await createClient();
    const data = await salvarRegistro(
      { db, organizationId: authz.org.orgId, actorId: authz.user.id, requestId },
      lido.data.recurso,
      corpo,
      lido.data.id,
    );
    return ok(data, { requestId });
  } catch (e) {
    if (e instanceof ImobiliariaError) return fail(e.code, e.message, e.status, { requestId });
    throw e;
  }
}
