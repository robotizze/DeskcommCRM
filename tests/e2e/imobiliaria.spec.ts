import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";

/** A organização e as pessoas desta prova são próprias; nenhuma fixture de outra jornada é alterada. */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const ESPERA = 60_000;
const sufixo = randomUUID().slice(0, 8);
const senha = `Prova-Imob-${randomUUID()}!`;
const emailGestor = `imob-gestor-${sufixo}@example.test`;
const emailLeitor = `imob-leitor-${sufixo}@example.test`;
const evidencias = "evidence/aquila-imob";

let admin: SupabaseClient;
let orgId: string;
let gestorId: string;
let leitorId: string;
let contatoId: string;
let appointmentId: string;

function confirmar(erro: { message: string } | null, etapa: string) {
  if (erro) throw new Error(`${etapa}: ${erro.message}`);
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: ESPERA });
}

async function salvarDialogo(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: ESPERA });
}

async function preencherImovel(page: Page, codigo: string, nome: string) {
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Código *", { exact: true }).fill(codigo);
  await dialogo.getByLabel("Nome do imóvel *", { exact: true }).fill(nome);
  await dialogo.getByLabel("Preço em R$ *", { exact: true }).fill("450.000,00");
  await dialogo.getByLabel("Bairro *", { exact: true }).fill("Centro");
  await dialogo.getByLabel("Cidade *", { exact: true }).fill("São Paulo");
  await dialogo.getByLabel("UF *", { exact: true }).fill("SP");
  await dialogo.getByLabel("Quartos", { exact: true }).fill("2");
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    throw new Error(
      "A prova imobiliária exige Supabase local; recusado qualquer endereço externo.",
    );
  }
  admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const gestor = await admin.auth.admin.createUser({
    email: emailGestor,
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: "Gestor da prova imobiliária", locale: "pt-BR" },
  });
  confirmar(gestor.error, "criar gestor");
  gestorId = gestor.data.user!.id;
  const leitor = await admin.auth.admin.createUser({
    email: emailLeitor,
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: "Leitor da prova imobiliária", locale: "pt-BR" },
  });
  confirmar(leitor.error, "criar leitor");
  leitorId = leitor.data.user!.id;

  const org = await admin
    .from("organizations")
    .insert({
      slug: `imob-prova-${sufixo}`,
      display_name: "Imobiliária da prova",
      legal_name: "Imobiliária da prova",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
      status: "active",
      onboarded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  confirmar(org.error, "criar organização");
  orgId = org.data!.id;
  confirmar(
    (
      await admin.from("user_organizations").insert([
        {
          user_id: gestorId,
          organization_id: orgId,
          role: "manager",
          accepted_at: new Date().toISOString(),
        },
        {
          user_id: leitorId,
          organization_id: orgId,
          role: "viewer",
          accepted_at: new Date().toISOString(),
        },
      ])
    ).error,
    "vincular integrantes",
  );

  // Somente se ausente: o provisionamento oficial requer um administrador da instalação.
  const instalado = await admin
    .from("modulos_instalados")
    .select("estado")
    .eq("modulo", "imobiliaria")
    .maybeSingle();
  confirmar(instalado.error, "consultar módulo");
  if (instalado.data?.estado !== "ativo") {
    confirmar(
      (
        await admin.from("platform_admins").insert({
          user_id: gestorId,
          granted_by: gestorId,
          scope: "full",
          reason: "Prova local do módulo imobiliário",
          mfa_required: false,
        })
      ).error,
      "administrador local para instalação",
    );
    confirmar(
      (
        await admin.rpc("fn_modulo_instalar", {
          p_actor: gestorId,
          p_operation: randomUUID(),
          p_modulo: "imobiliaria",
        })
      ).error,
      "instalar módulo imobiliário",
    );
    confirmar(
      (await admin.from("platform_admins").delete().eq("user_id", gestorId)).error,
      "remover autoridade da prova",
    );
  }

  const contato = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      name: "Interessado da prova",
      display_name: "Interessado da prova",
      source: "manual",
    })
    .select("id")
    .single();
  confirmar(contato.error, "criar contato");
  contatoId = contato.data!.id;
  const inicio = new Date(Date.now() + 3 * 86400000);
  inicio.setUTCHours(14, 0, 0, 0);
  const compromisso = await admin
    .from("calendar_appointments")
    .insert({
      organization_id: orgId,
      title: "Visita da prova imobiliária",
      contact_id: contatoId,
      owner_user_id: gestorId,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 3600000).toISOString(),
      status: "confirmed",
      time_zone: "America/Sao_Paulo",
      location_kind: "in_person",
      source: "ui",
      created_by_kind: "user",
      created_by_user_id: gestorId,
    })
    .select("id")
    .single();
  confirmar(compromisso.error, "preparar horário na agenda");
  appointmentId = compromisso.data!.id;
  mkdirSync(evidencias, { recursive: true });
});

test.afterAll(async () => {
  if (!admin) return;
  if (orgId) {
    confirmar(
      (await admin.from("calendar_appointments").delete().eq("organization_id", orgId)).error,
      "limpar agenda da prova",
    );
    confirmar(
      (await admin.from("organizations").delete().eq("id", orgId)).error,
      "limpar organização da prova",
    );
  }
  if (gestorId) {
    await admin.from("platform_admins").delete().eq("user_id", gestorId);
    confirmar((await admin.auth.admin.deleteUser(gestorId)).error, "limpar gestor da prova");
  }
  if (leitorId)
    confirmar((await admin.auth.admin.deleteUser(leitorId)).error, "limpar leitor da prova");
});

test("carteira, captação, qualificação e visita permanecem ligadas ao atendimento", async ({
  page,
}) => {
  await entrar(page, emailGestor);
  await page.goto("/app/crm");
  const porta = page.getByRole("link", { name: /^Imobiliária(?:\s|$)/ }).first();
  await expect(porta).toBeVisible({ timeout: ESPERA });
  await expect(porta).toHaveAttribute("href", "/app/imobiliaria");
  await porta.click();
  await expect(page.getByRole("heading", { name: "Imóveis e relacionamentos" })).toBeVisible({
    timeout: ESPERA,
  });
  await expect(page.getByText("Sua carteira começa aqui")).toBeVisible({ timeout: ESPERA });

  await page.getByRole("tab", { name: "Corretores", exact: true }).click();
  await page.getByRole("button", { name: "Cadastrar corretor", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByLabel(/^Integrante da equipe \*/)
    .selectOption(gestorId);
  await page.getByRole("dialog").getByLabel("CRECI *", { exact: true }).fill("12345-F/SP");
  await salvarDialogo(page);
  await expect(page.getByRole("heading", { name: "Gestor da prova imobiliária" })).toBeVisible();
  const corretor = await admin.from("imob_corretores").select("id").eq("organization_id", orgId).eq("user_id", gestorId).single();
  confirmar(corretor.error, "consultar corretor cadastrado");

  await page.getByRole("tab", { name: "Carteira de imóveis", exact: true }).click();
  await page.getByRole("button", { name: "Cadastrar imóvel", exact: true }).first().click();
  await preencherImovel(page, "AP-PROVA", "Apartamento da prova imobiliária");
  await page
    .getByRole("dialog")
    .getByLabel(/^Corretor responsável/)
    .selectOption(corretor.data!.id);
  await salvarDialogo(page);
  await expect(
    page.getByRole("heading", { name: "Apartamento da prova imobiliária" }),
  ).toBeVisible();
  await expect(page.getByText("R$ 450.000,00", { exact: true })).toBeVisible();
  const catalogo = await admin
    .from("catalog_products")
    .select("preco_cents")
    .eq("organization_id", orgId)
    .eq("codigo", "AP-PROVA")
    .single();
  confirmar(catalogo.error, "consultar catálogo");
  expect(catalogo.data!.preco_cents).toBe(45000000);
  await page.screenshot({ path: `${evidencias}/carteira.png`, fullPage: true });

  await page.getByLabel("Só captações abertas", { exact: true }).check();
  await page.getByRole("button", { name: "Nova captação", exact: true }).first().click();
  await preencherImovel(page, "CAP-PROVA", "Captação da prova imobiliária");
  await expect(
    page.getByRole("dialog").getByLabel("Próximo passo *", { exact: true }),
  ).toHaveAttribute("required", "");
  await page
    .getByRole("dialog")
    .getByLabel("Próximo passo *", { exact: true })
    .fill("Confirmar documentos com proprietário");
  await salvarDialogo(page);
  await expect(
    page.getByText("Confirmar documentos com proprietário", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Interessados", exact: true }).click();
  await page.getByRole("button", { name: "Qualificar interessado", exact: true }).first().click();
  await page.getByRole("dialog").getByLabel(/^Contato \*/).selectOption(contatoId);
  await page
    .getByRole("dialog")
    .getByLabel("Orçamento máximo em R$ *", { exact: true })
    .fill("500.000,00");
  await page.getByRole("dialog").getByLabel("Bairros desejados", { exact: true }).fill("Centro");
  await page
    .getByRole("dialog")
    .getByLabel("Próximo passo *", { exact: true })
    .fill("Apresentar apartamento e confirmar visita");
  await salvarDialogo(page);
  await expect(page.getByRole("heading", { name: "Interessado da prova" })).toBeVisible();
  await expect(
    page.getByText("Apresentar apartamento e confirmar visita", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${evidencias}/interessados.png`, fullPage: true });

  await page.getByRole("tab", { name: "Visitas", exact: true }).click();
  await page.getByRole("button", { name: "Vincular visita", exact: true }).click();
  const imovel = await admin
    .from("imob_imoveis")
    .select("id,produto_id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  confirmar(imovel.error, "consultar imóvel publicado");
  await page
    .getByRole("dialog")
    .getByLabel(/^Imóvel \*/)
    .selectOption(imovel.data!.id);
  await page
    .getByRole("dialog")
    .getByLabel(/^Compromisso na Agenda \*/)
    .selectOption(appointmentId);
  await salvarDialogo(page);
  await expect(
    page.getByRole("link", { name: "Consultar na Agenda", exact: true }),
  ).toHaveAttribute("href", `/app/agenda?compromisso=${appointmentId}`);
  await expect(page.getByText("Confirmado", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidencias}/visitas.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${evidencias}/visitas-mobile.png`, fullPage: true });
});

test("leitor consulta imóveis, interessados e visitas sem receber ações de escrita", async ({
  page,
}) => {
  await entrar(page, emailLeitor);
  await page.goto("/app/imobiliaria");
  await expect(page.getByRole("heading", { name: "Apartamento da prova imobiliária" })).toBeVisible(
    { timeout: ESPERA },
  );
  await expect(page.getByRole("button", { name: "Cadastrar imóvel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Interessados", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Interessado da prova" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Qualificar interessado", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Marcar visita", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Visitas", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vincular visita", exact: true })).toHaveCount(0);
});
