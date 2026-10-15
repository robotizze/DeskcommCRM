import { beforeAll, describe, expect, it } from "vitest";
import {
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

const ORG_B = "dddddddd-1000-4000-8000-000000000001";
const CONTATO_B = "dddddddd-2000-4000-8000-000000000001";
const PRODUTO = "dddddddd-3000-4000-8000-000000000001";
const PRODUTO_B = "dddddddd-3000-4000-8000-000000000002";
const IMOVEL = "dddddddd-4000-4000-8000-000000000001";
const IMOVEL_B = "dddddddd-4000-4000-8000-000000000002";
const INTERESSE = "dddddddd-5000-4000-8000-000000000001";
const AGENDAMENTO = "dddddddd-6000-4000-8000-000000000001";
const AGENDAMENTO_B = "dddddddd-6000-4000-8000-000000000002";
const CORRETOR = "dddddddd-7000-4000-8000-000000000001";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_imobiliaria_provisionar();
    insert into public.organizations (id,slug,legal_name,display_name) values ('${ORG_B}','imob-rls-b','Imobiliaria B','Imob B') on conflict do nothing;
    insert into public.contacts (id,organization_id,display_name) values ('${CONTATO_B}','${ORG_B}','Contato B') on conflict do nothing;
    insert into public.catalog_products (id,organization_id,codigo,nome,preco_cents,controla_estoque) values
      ('${PRODUTO}','${GOV_ORG}','AQ-TEST','Casa teste',50000000,false),
      ('${PRODUTO_B}','${ORG_B}','AQ-TEST','Casa de B',50000000,false) on conflict do nothing;
    insert into public.imob_corretores(id,organization_id,user_id,creci) values ('${CORRETOR}','${GOV_ORG}','${GOV_AGENT_A}','12345-AM') on conflict do nothing;
    insert into public.imob_imoveis(id,organization_id,produto_id,finalidade,tipo,bairro,cidade,uf) values
      ('${IMOVEL}','${GOV_ORG}','${PRODUTO}','venda','casa','Centro','Manaus','AM'),
      ('${IMOVEL_B}','${ORG_B}','${PRODUTO_B}','venda','casa','Centro','Manaus','AM') on conflict do nothing;
    insert into public.imob_interessados(id,organization_id,contact_id,finalidade,orcamento_max_cents,proximo_passo) values
      ('${INTERESSE}','${GOV_ORG}','${GOV_CONTACT_1}','venda',50000000,'Apresentar imóveis') on conflict do nothing;
    insert into public.calendar_appointments(id,organization_id,title,starts_at,ends_at,contact_id) values
      ('${AGENDAMENTO}','${GOV_ORG}','Visita','2026-11-10T10:00:00Z','2026-11-10T11:00:00Z','${GOV_CONTACT_1}'),
      ('${AGENDAMENTO_B}','${ORG_B}','Visita B','2026-11-10T10:00:00Z','2026-11-10T11:00:00Z','${CONTATO_B}') on conflict do nothing;
  `);
});

describe("imobiliária: papéis e vínculos isolados", () => {
  it("viewer lê só sua organização e não altera imóvel", () => {
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.imob_imoveis where id in ('${IMOVEL}','${IMOVEL_B}');`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_VIEWER,
        `update public.imob_imoveis set cidade='Outra' where id='${IMOVEL}'`,
      ),
    ).toBe(0);
  });
  it("agent qualifica interessado, mas não altera patrimônio ou CRECI", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.imob_interessados set proximo_passo='Ligar amanhã' where id='${INTERESSE}'`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.imob_imoveis set cidade='Outra' where id='${IMOVEL}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.imob_corretores set creci='Falso' where id='${CORRETOR}'`,
      ),
    ).toBe(0);
  });
  it("manager edita, mas FK composta recusa proprietário de outro tenant", () => {
    expect(
      writeCountAs(GOV_MANAGER, `update public.imob_imoveis set quartos=3 where id='${IMOVEL}'`),
    ).toBe(1);
    expect(() =>
      sql(
        `set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_MANAGER}"}',false); update public.imob_imoveis set proprietario_id='${CONTATO_B}' where id='${IMOVEL}';`,
      ),
    ).toThrow(/foreign key/);
  });
  it("visita recusa imóvel ou agenda de outro tenant e vínculo repetido", () => {
    expect(() =>
      sql(
        `insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL_B}','${AGENDAMENTO}');`,
      ),
    ).toThrow(/imobiliaria_imovel_indisponivel|foreign key/);
    expect(() =>
      sql(
        `insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL}','${AGENDAMENTO_B}');`,
      ),
    ).toThrow(/imobiliaria_agendamento_indisponivel|foreign key/);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL}','${AGENDAMENTO}')`,
      ),
    ).toBe(1);
    expect(() =>
      sql(
        `insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL}','${AGENDAMENTO}');`,
      ),
    ).toThrow(/unique constraint/);
  });
  it("PostgREST não cria vínculo de visita com imóvel inativo ou agenda cancelada", () => {
    expect(() =>
      sql(
        `begin; update public.catalog_products set ativo=false where id='${PRODUTO}'; set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_AGENT_A}"}',false); insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL}','${AGENDAMENTO}'); rollback;`,
      ),
    ).toThrow(/imobiliaria_imovel_indisponivel/);
    expect(() =>
      sql(
        `begin; update public.calendar_appointments set status='cancelled',cancelled_at=now(),cancellation_reason='Cancelado pelo interessado' where id='${AGENDAMENTO}'; set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_AGENT_A}"}',false); insert into public.imob_visitas(organization_id,imovel_id,appointment_id) values ('${GOV_ORG}','${IMOVEL}','${AGENDAMENTO}'); rollback;`,
      ),
    ).toThrow(/imobiliaria_agendamento_indisponivel/);
  });
  it("banco impede demanda aberta sem próximo passo", () => {
    expect(() =>
      sql(
        `update public.imob_imoveis set etapa_captacao='em_contato',proximo_passo=null where id='${IMOVEL}';`,
      ),
    ).toThrow(/check constraint/);
    expect(() =>
      sql(`update public.imob_interessados set proximo_passo=null where id='${INTERESSE}';`),
    ).toThrow(/check constraint/);
  });
  it("falha no imóvel desfaz produto: par atômico", () => {
    const dados = JSON.stringify({
      codigo: "AQ-ROLLBACK",
      nome: "Casa rollback",
      preco_cents: 50000000,
      moeda: "BRL",
      ativo: true,
      finalidade: "venda",
      tipo: "casa",
      bairro: "Centro",
      cidade: "Manaus",
      uf: "AM",
      quartos: 0,
      banheiros: 0,
      vagas: 0,
      etapa_captacao: "publicado",
      proprietario_id: CONTATO_B,
    });
    expect(() =>
      sql(
        `set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_MANAGER}"}',false); select public.fn_imobiliaria_imovel_salvar('${GOV_ORG}',null,'${dados}'::jsonb);`,
      ),
    ).toThrow(/foreign key/);
    expect(
      lastLine(
        sql(
          `select count(*) from public.catalog_products where organization_id='${GOV_ORG}' and codigo='AQ-ROLLBACK';`,
        ),
      ),
    ).toBe("0");
  });
  it("captação nunca aparece ativa no catálogo, mesmo pela RPC direta", () => {
    const dados = JSON.stringify({
      codigo: "AQ-CAPTACAO",
      nome: "Casa em captação",
      preco_cents: 50000000,
      moeda: "BRL",
      ativo: true,
      finalidade: "venda",
      tipo: "casa",
      bairro: "Centro",
      cidade: "Manaus",
      uf: "AM",
      quartos: 0,
      banheiros: 0,
      vagas: 0,
      etapa_captacao: "em_contato",
      proximo_passo: "Solicitar matrícula",
    });
    sql(
      `set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_MANAGER}"}',false); select public.fn_imobiliaria_imovel_salvar('${GOV_ORG}',null,'${dados}'::jsonb);`,
    );
    expect(
      lastLine(
        sql(
          `select ativo::text from public.catalog_products where organization_id='${GOV_ORG}' and codigo='AQ-CAPTACAO';`,
        ),
      ),
    ).toBe("false");
  });
  it("alterar etapa diretamente desativa catálogo e catálogo comum não reativa captação", () => {
    const out = sql(
      `begin; update public.imob_imoveis set etapa_captacao='encerrado' where id='${IMOVEL}'; select ativo::text from public.catalog_products where id='${PRODUTO}'; set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_MANAGER}"}',false); update public.catalog_products set ativo=true where organization_id='${GOV_ORG}' and id='${PRODUTO}'; select ativo::text from public.catalog_products where id='${PRODUTO}'; rollback;`,
    );
    expect(out.split("\n").filter((l) => l === "false")).toHaveLength(2);
  });
  it("publicar captação pela RPC permite disponibilidade só depois da etapa publicada", () => {
    const dados = JSON.stringify({ codigo: "AQ-TEST", nome: "Casa publicada", preco_cents: 50000000, moeda: "BRL", ativo: true, finalidade: "venda", tipo: "casa", bairro: "Centro", cidade: "Manaus", uf: "AM", quartos: 3, banheiros: 0, vagas: 0, etapa_captacao: "publicado" });
    const out = sql(`begin; update public.imob_imoveis set etapa_captacao='em_contato',proximo_passo='Conferir matrícula' where id='${IMOVEL}'; set role authenticated; select set_config('request.jwt.claims','{"sub":"${GOV_MANAGER}"}',false); select public.fn_imobiliaria_imovel_salvar('${GOV_ORG}','${IMOVEL}','${dados}'::jsonb); select ativo::text from public.catalog_products where id='${PRODUTO}'; rollback;`);
    expect(out.split("\n")).toContain("true");
  });
  it("anonimização alcança perfil, endereço e descrição do catálogo do proprietário", () => {
    const out = sql(
      `begin; update public.imob_imoveis set proprietario_id='${GOV_CONTACT_1}',endereco='Rua privada',proximo_passo='Conversar com o dono' where id='${IMOVEL}'; update public.catalog_products set descricao='Texto do proprietário' where id='${PRODUTO}'; update public.imob_interessados set prazo='Prazo pessoal',proximo_passo='Texto pessoal' where id='${INTERESSE}'; select public.fn_lgpd_cascade_redact_contact('${GOV_ORG}','${GOV_CONTACT_1}',gen_random_uuid()); select json_build_array((select endereco from public.imob_imoveis where id='${IMOVEL}'),(select descricao from public.catalog_products where id='${PRODUTO}'),(select proximo_passo from public.imob_interessados where id='${INTERESSE}')); rollback;`,
    );
    expect(out).toContain('[null, null, "[redigido]"]');
  });
  it("nenhuma função ou tabela imobiliária fica acessível a anon", () => {
    expect(
      lastLine(
        sql(
          `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fn_imobiliaria_%' and has_function_privilege('anon',p.oid,'EXECUTE');`,
        ),
      ),
    ).toBe("0");
    expect(
      lastLine(
        sql(
          `select count(*) from information_schema.role_table_grants where table_schema='public' and table_name like 'imob_%' and grantee='anon';`,
        ),
      ),
    ).toBe("0");
  });
});
