-- manifest: Módulo opcional imobiliária cria portfólio, corretores, perfis de interessados e vínculos de visitas na instalação, reutilizando catálogo, contatos, equipe e agenda com isolamento por organização e escrita de imóvel atômica.
-- Destino: extensão oficial (ADR-0002). Sem instalar, as quatro tabelas não existem.
-- Catálogo mantém nome/código/preço/foto; agenda mantém datas/status/lembretes; auth mantém nome do corretor.
-- Índices do núcleo ficam FORA da provisionadora: ela só cria e protege as tabelas que possui.
create unique index if not exists catalog_products_org_id_key on public.catalog_products (organization_id, id);
create unique index if not exists contacts_org_id_key on public.contacts (organization_id, id);
create unique index if not exists calendar_appointments_org_id_key on public.calendar_appointments (organization_id, id);
create unique index if not exists user_organizations_org_user_key on public.user_organizations (organization_id, user_id);

create or replace function public.fn_imobiliaria_provisionar()
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  create table if not exists public.imob_corretores (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null,
    creci text not null check (btrim(creci) <> '' and length(creci) <= 40),
    ativo boolean not null default true,
    especialidades text[] not null default '{}', regioes text[] not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (organization_id, id), unique (organization_id, user_id),
    foreign key (organization_id, user_id) references public.user_organizations(organization_id, user_id) on delete cascade
  );
  create table if not exists public.imob_imoveis (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    produto_id uuid not null,
    finalidade text not null check (finalidade in ('venda','locacao')),
    tipo text not null check (tipo in ('casa','apartamento','terreno','comercial','rural')),
    bairro text not null check (btrim(bairro) <> ''), cidade text not null check (btrim(cidade) <> ''),
    uf text not null check (uf ~ '^[A-Z]{2}$'),
    quartos integer not null default 0 check (quartos between 0 and 100),
    banheiros integer not null default 0 check (banheiros between 0 and 100),
    vagas integer not null default 0 check (vagas between 0 and 100),
    area_m2 numeric check (area_m2 > 0), endereco text, proprietario_id uuid, corretor_id uuid,
    etapa_captacao text not null default 'publicado' check (etapa_captacao in ('novo','em_contato','documentacao','publicado','encerrado')),
    proximo_passo text, proximo_contato_em timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (organization_id, id), unique (organization_id, produto_id),
    foreign key (organization_id, produto_id) references public.catalog_products(organization_id,id) on delete cascade,
    foreign key (organization_id, proprietario_id) references public.contacts(organization_id,id),
    foreign key (organization_id, corretor_id) references public.imob_corretores(organization_id,id),
    constraint imob_imoveis_captacao_tem_passo check (etapa_captacao in ('publicado','encerrado') or nullif(btrim(proximo_passo),'') is not null)
  );
  create table if not exists public.imob_interessados (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null, finalidade text not null check (finalidade in ('venda','locacao')),
    tipo text check (tipo in ('casa','apartamento','terreno','comercial','rural')),
    orcamento_min_cents bigint not null default 0 check (orcamento_min_cents >= 0),
    orcamento_max_cents bigint not null check (orcamento_max_cents >= orcamento_min_cents),
    bairros text[] not null default '{}', quartos_min integer not null default 0 check (quartos_min between 0 and 100),
    prazo text, corretor_id uuid,
    status text not null default 'aberto' check (status in ('aberto','em_visita','proposta','concluido','encerrado')),
    proximo_passo text, proximo_contato_em timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, contact_id) references public.contacts(organization_id,id) on delete cascade,
    foreign key (organization_id, corretor_id) references public.imob_corretores(organization_id,id),
    constraint imob_interessados_tem_passo check (status in ('concluido','encerrado') or nullif(btrim(proximo_passo),'') is not null)
  );
  create table if not exists public.imob_visitas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    imovel_id uuid not null, appointment_id uuid not null, corretor_id uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (organization_id, id), unique (organization_id, appointment_id),
    foreign key (organization_id, imovel_id) references public.imob_imoveis(organization_id,id),
    foreign key (organization_id, appointment_id) references public.calendar_appointments(organization_id,id) on delete cascade,
    foreign key (organization_id, corretor_id) references public.imob_corretores(organization_id,id)
  );
  create index if not exists imob_imoveis_portfolio_idx on public.imob_imoveis (organization_id, finalidade, cidade, etapa_captacao);
  create index if not exists imob_interessados_retorno_idx on public.imob_interessados (organization_id, status, proximo_contato_em);
  create index if not exists imob_visitas_imovel_idx on public.imob_visitas (organization_id, imovel_id);

  alter table public.imob_corretores enable row level security;
  alter table public.imob_imoveis enable row level security;
  alter table public.imob_interessados enable row level security;
  alter table public.imob_visitas enable row level security;
  drop policy if exists imob_corretores_select on public.imob_corretores;
  create policy imob_corretores_select
  on public.imob_corretores for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists imob_corretores_insert on public.imob_corretores;
  create policy imob_corretores_insert
  on public.imob_corretores for insert with check (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full());
  drop policy if exists imob_corretores_update on public.imob_corretores;
  create policy imob_corretores_update
  on public.imob_corretores for update using (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full()) with check (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full());
  drop policy if exists imob_imoveis_select on public.imob_imoveis;
  create policy imob_imoveis_select
  on public.imob_imoveis for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists imob_imoveis_insert on public.imob_imoveis;
  create policy imob_imoveis_insert
  on public.imob_imoveis for insert with check (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full());
  drop policy if exists imob_imoveis_update on public.imob_imoveis;
  create policy imob_imoveis_update
  on public.imob_imoveis for update using (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full()) with check (public.fn_role_at_least(organization_id,'manager') or public.fn_is_platform_admin_full());
  drop policy if exists imob_interessados_select on public.imob_interessados;
  create policy imob_interessados_select
  on public.imob_interessados for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists imob_interessados_insert on public.imob_interessados;
  create policy imob_interessados_insert
  on public.imob_interessados for insert with check (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full());
  drop policy if exists imob_interessados_update on public.imob_interessados;
  create policy imob_interessados_update
  on public.imob_interessados for update using (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full()) with check (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full());
  drop policy if exists imob_visitas_select on public.imob_visitas;
  create policy imob_visitas_select
  on public.imob_visitas for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists imob_visitas_insert on public.imob_visitas;
  create policy imob_visitas_insert
  on public.imob_visitas for insert with check (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full());
  drop policy if exists imob_visitas_update on public.imob_visitas;
  create policy imob_visitas_update
  on public.imob_visitas for update using (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full()) with check (public.fn_role_at_least(organization_id,'agent') or public.fn_is_platform_admin_full());
  revoke all on public.imob_corretores, public.imob_imoveis, public.imob_interessados, public.imob_visitas from anon, authenticated;
  grant select, insert, update on public.imob_corretores, public.imob_imoveis, public.imob_interessados, public.imob_visitas to authenticated;
  grant all on public.imob_corretores, public.imob_imoveis, public.imob_interessados, public.imob_visitas to service_role;
  drop trigger if exists imob_corretores_updated_at on public.imob_corretores;
  create trigger imob_corretores_updated_at before update on public.imob_corretores for each row execute function public.fn_set_updated_at();
  drop trigger if exists imob_imoveis_updated_at on public.imob_imoveis;
  create trigger imob_imoveis_updated_at before update on public.imob_imoveis for each row execute function public.fn_set_updated_at();
  drop trigger if exists imob_imoveis_catalogo_disponivel on public.imob_imoveis;
  create trigger imob_imoveis_catalogo_disponivel after insert or update of etapa_captacao on public.imob_imoveis for each row execute function public.fn_imobiliaria_desativar_catalogo();
  drop trigger if exists imob_interessados_updated_at on public.imob_interessados;
  create trigger imob_interessados_updated_at before update on public.imob_interessados for each row execute function public.fn_set_updated_at();
  drop trigger if exists imob_visitas_updated_at on public.imob_visitas;
  create trigger imob_visitas_updated_at before update on public.imob_visitas for each row execute function public.fn_set_updated_at();
  drop trigger if exists imob_visitas_vinculo_disponivel on public.imob_visitas;
  create trigger imob_visitas_vinculo_disponivel before insert or update on public.imob_visitas for each row execute function public.fn_imobiliaria_conferir_visita();
  perform public.fn_proteger_modulo_provisionado();
  perform public.fn_imobiliaria_declarar_secoes_lgpd();
end
$f$;
revoke execute on function public.fn_imobiliaria_provisionar() from public, anon, authenticated;
grant execute on function public.fn_imobiliaria_provisionar() to service_role;

-- Seções de redação registradas pelo mesmo caminho dos demais módulos. Export tem consumidor próprio.
create or replace function public.fn_imobiliaria_declarar_secoes_lgpd()
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if to_regclass('public.imob_interessados') is null then return; end if;
  insert into public.modulo_secoes_lgpd (modulo,tabela,ligacao,colunas,colunas_rotulo,colunas_redigidas,colunas_agora)
  values
    ('imobiliaria','imob_interessados','organization_id = $1 and contact_id = $2','{}','{}',array['prazo','proximo_passo'],array['updated_at']),
    ('imobiliaria','imob_imoveis','organization_id = $1 and proprietario_id = $2',array['endereco'],'{}',array['proximo_passo'],array['updated_at']),
    ('imobiliaria','catalog_products','organization_id = $1 and id in (select produto_id from public.imob_imoveis where organization_id = $1 and proprietario_id = $2)',array['descricao'],'{}','{}',array['updated_at'])
  on conflict (modulo,tabela) do update set ligacao=excluded.ligacao,colunas=excluded.colunas,colunas_rotulo=excluded.colunas_rotulo,colunas_redigidas=excluded.colunas_redigidas,colunas_agora=excluded.colunas_agora;
end
$f$;
revoke execute on function public.fn_imobiliaria_declarar_secoes_lgpd() from public, anon, authenticated;
grant execute on function public.fn_imobiliaria_declarar_secoes_lgpd() to service_role;

-- Invoker: JWT, RLS e travas de suporte continuam decidindo. O par produto/imóvel grava ou desfaz junto.
-- JSON é só entrada validada da API; as propriedades persistidas são colunas tipadas, não armazém genérico.
create or replace function public.fn_imobiliaria_imovel_salvar(p_org uuid, p_id uuid, p_dados jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $f$
declare v_produto uuid; v_imovel uuid;
begin
  if auth.uid() is null or not (public.fn_role_at_least(p_org,'manager') or public.fn_is_platform_admin_full()) then
    raise exception 'imobiliaria_forbidden' using errcode='42501';
  end if;
  -- A busca nativa do catálogo só conhece ativo. Imóvel em captação ou encerrado não pode ser oferecido.
  if p_dados->>'etapa_captacao' is distinct from 'publicado' then
    p_dados := jsonb_set(p_dados,'{ativo}','false'::jsonb);
  end if;
  if p_id is not null then
    select produto_id into v_produto from public.imob_imoveis where organization_id=p_org and id=p_id for update;
    if not found then raise exception 'imovel_nao_encontrado' using errcode='P0002'; end if;
  end if;
  if v_produto is null then
    insert into public.catalog_products (organization_id,codigo,nome,descricao,preco_cents,moeda,imagem_url,ativo,controla_estoque,categoria)
      values (p_org,p_dados->>'codigo',p_dados->>'nome',p_dados->>'descricao',(p_dados->>'preco_cents')::bigint,p_dados->>'moeda',p_dados->>'imagem_url',(p_dados->>'ativo')::boolean,false,'Imóveis')
      returning id into v_produto;
  else
    update public.catalog_products set codigo=p_dados->>'codigo',nome=p_dados->>'nome',descricao=p_dados->>'descricao',preco_cents=(p_dados->>'preco_cents')::bigint,moeda=p_dados->>'moeda',imagem_url=p_dados->>'imagem_url',ativo=(p_dados->>'ativo')::boolean,controla_estoque=false
      where organization_id=p_org and id=v_produto;
    if not found then raise exception 'imovel_nao_encontrado' using errcode='P0002'; end if;
  end if;
  v_imovel := coalesce(p_id,gen_random_uuid());
  insert into public.imob_imoveis (id,organization_id,produto_id,finalidade,tipo,bairro,cidade,uf,quartos,banheiros,vagas,area_m2,endereco,proprietario_id,corretor_id,etapa_captacao,proximo_passo,proximo_contato_em)
    values (v_imovel,p_org,v_produto,p_dados->>'finalidade',p_dados->>'tipo',p_dados->>'bairro',p_dados->>'cidade',p_dados->>'uf',(p_dados->>'quartos')::integer,(p_dados->>'banheiros')::integer,(p_dados->>'vagas')::integer,(p_dados->>'area_m2')::numeric,p_dados->>'endereco',(p_dados->>'proprietario_id')::uuid,(p_dados->>'corretor_id')::uuid,p_dados->>'etapa_captacao',p_dados->>'proximo_passo',(p_dados->>'proximo_contato_em')::timestamptz)
    on conflict (id) do update set finalidade=excluded.finalidade,tipo=excluded.tipo,bairro=excluded.bairro,cidade=excluded.cidade,uf=excluded.uf,quartos=excluded.quartos,banheiros=excluded.banheiros,vagas=excluded.vagas,area_m2=excluded.area_m2,endereco=excluded.endereco,proprietario_id=excluded.proprietario_id,corretor_id=excluded.corretor_id,etapa_captacao=excluded.etapa_captacao,proximo_passo=excluded.proximo_passo,proximo_contato_em=excluded.proximo_contato_em;
  -- Etapa já gravada: reativar uma captação recém-publicada passa agora pela guarda do catálogo.
  update public.catalog_products set ativo=(p_dados->>'ativo')::boolean where organization_id=p_org and id=v_produto;
  return v_imovel;
end
$f$;
revoke execute on function public.fn_imobiliaria_imovel_salvar(uuid,uuid,jsonb) from public, anon;
grant execute on function public.fn_imobiliaria_imovel_salvar(uuid,uuid,jsonb) to authenticated;

-- PostgREST também é uma porta de escrita. Novos vínculos conferem disponibilidade; editar
-- só o corretor de uma visita histórica preserva os vínculos e não reabre sua agenda.
create or replace function public.fn_imobiliaria_conferir_visita()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $f$
declare v_contato uuid; v_status text; v_inicio timestamptz;
begin
  if tg_op='UPDATE' and new.organization_id=old.organization_id and new.imovel_id=old.imovel_id and new.appointment_id=old.appointment_id then return new; end if;
  if not exists (
    select 1 from public.imob_imoveis i join public.catalog_products p on p.organization_id=i.organization_id and p.id=i.produto_id
      where i.organization_id=new.organization_id and i.id=new.imovel_id and i.etapa_captacao='publicado' and p.ativo
  ) then raise exception 'imobiliaria_imovel_indisponivel' using errcode='22023'; end if;
  select contact_id,status,starts_at into v_contato,v_status,v_inicio from public.calendar_appointments where organization_id=new.organization_id and id=new.appointment_id;
  if v_contato is null or v_status not in ('pending','confirmed') or v_inicio<=now() then raise exception 'imobiliaria_agendamento_indisponivel' using errcode='22023'; end if;
  if not exists (select 1 from public.contacts where organization_id=new.organization_id and id=v_contato and not is_anonymized and is_merged_into is null) then
    raise exception 'imobiliaria_contato_indisponivel' using errcode='22023';
  end if;
  return new;
end
$f$;
revoke execute on function public.fn_imobiliaria_conferir_visita() from public, anon;
grant execute on function public.fn_imobiliaria_conferir_visita() to authenticated, service_role;

-- O status próprio do imóvel deve valer inclusive quando a etapa muda pelo PostgREST.
-- Definer de efeito FIXO: só desativa o produto da MESMA org ligado à linha que disparou.
-- agent não pode mudar imóvel por RLS; função não é RPC (returns trigger) e não recebe parâmetros.
create or replace function public.fn_imobiliaria_desativar_catalogo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if new.etapa_captacao <> 'publicado' then
    update public.catalog_products set ativo=false where organization_id=new.organization_id and id=new.produto_id and ativo;
  end if;
  return new;
end
$f$;
revoke execute on function public.fn_imobiliaria_desativar_catalogo() from public, anon, authenticated;
grant execute on function public.fn_imobiliaria_desativar_catalogo() to service_role;

-- O catálogo comum também tem escrita própria. Esta guarda do NÚCLEO fica fora da
-- provisionadora e tolera ausência das tabelas opcionais: zero módulo continua operante.
-- Só impede ativar produto ligado a imóvel não publicado; nenhum item comum muda.
create or replace function public.fn_catalogo_respeitar_disponibilidade_imobiliaria()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_indisponivel boolean;
begin
  if not new.ativo or to_regclass('public.imob_imoveis') is null then return new; end if;
  execute 'select exists(select 1 from public.imob_imoveis where organization_id=$1 and produto_id=$2 and etapa_captacao<>''publicado'')'
    into v_indisponivel using new.organization_id,new.id;
  if v_indisponivel then new.ativo:=false; end if;
  return new;
end
$f$;
revoke execute on function public.fn_catalogo_respeitar_disponibilidade_imobiliaria() from public, anon, authenticated;
grant execute on function public.fn_catalogo_respeitar_disponibilidade_imobiliaria() to service_role;
drop trigger if exists catalogo_disponibilidade_imobiliaria on public.catalog_products;
create trigger catalogo_disponibilidade_imobiliaria before insert or update of ativo on public.catalog_products for each row execute function public.fn_catalogo_respeitar_disponibilidade_imobiliaria();

-- Atualizar instalação existente converge só onde já instalada; não ativa automaticamente.
do $f$ begin
  if exists (select 1 from public.modulos_instalados where modulo='imobiliaria' and estado='ativo') then
    perform public.fn_imobiliaria_provisionar();
  end if;
end
$f$;
