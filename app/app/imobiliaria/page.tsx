import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { ImobiliariaClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imobiliária" };

export default async function ImobiliariaPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const administrador =
    user.is_platform_admin && user.platform_admin_scope === "full" && !user.support;

  return (
    <ImobiliariaClient
      podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager}
      podeQualificar={ROLE_RANK[org.role] >= ROLE_RANK.agent}
      podeInstalar={administrador}
    />
  );
}
