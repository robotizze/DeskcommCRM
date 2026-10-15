import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import {
  contextoImobiliario,
  exigirModuloImobiliaria,
  ImobiliariaError,
} from "@/lib/imobiliaria/service";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "imobiliaria" });
  if (!authz.ok) return authz.response;
  try {
    await exigirModuloImobiliaria();
    const podeLerEquipe =
      roleAtLeast(authz.org.role, "manager") ||
      (authz.user.is_platform_admin && authz.user.platform_admin_scope === "full");
    return ok(await contextoImobiliario(await createClient(), authz.org.orgId, podeLerEquipe), {
      requestId,
    });
  } catch (e) {
    if (e instanceof ImobiliariaError) return fail(e.code, e.message, e.status, { requestId });
    throw e;
  }
}
