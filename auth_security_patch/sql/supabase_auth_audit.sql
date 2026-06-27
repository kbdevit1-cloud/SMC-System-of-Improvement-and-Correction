-- Supabase/PostgreSQL: autenticação interna por domínio corporativo + auditoria.
-- Ajuste nomes de schema/policies conforme seu projeto.
-- NÃO coloque service_role no frontend.

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text,
  email text not null unique,
  setor text,
  perfil text not null default 'visualizador'
    check (perfil in ('master', 'admin', 'engenharia', 'producao', 'visualizador')),
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'bloqueado')),
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz,
  maquina text,
  observacao text,
  constraint usuarios_email_corporativo_chk
    check (lower(email) like '%@globaleletronics.ind.br')
);

create index if not exists idx_usuarios_email on public.usuarios (lower(email));
create index if not exists idx_usuarios_status on public.usuarios (status);
create index if not exists idx_usuarios_perfil on public.usuarios (perfil);

create table if not exists public.logs_auditoria (
  id bigserial primary key,
  usuario_email text,
  acao text not null,
  status text not null,
  data_hora timestamptz not null default now(),
  maquina text,
  ip inet,
  detalhes jsonb
);

create index if not exists idx_logs_usuario on public.logs_auditoria (lower(usuario_email));
create index if not exists idx_logs_acao on public.logs_auditoria (acao);
create index if not exists idx_logs_data on public.logs_auditoria (data_hora desc);

create or replace function public.normalize_global_email(input_email text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(input_email, '')), '\s+', '', 'g'));
$$;

create or replace function public.is_global_email(input_email text)
returns boolean
language sql
immutable
as $$
  select public.normalize_global_email(input_email) ~ '^[a-z0-9._-]{2,80}@globaleletronics\.ind\.br$';
$$;

create or replace function public.is_admin_or_master(input_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    where lower(u.email) = public.normalize_global_email(input_email)
      and u.status = 'aprovado'
      and u.perfil in ('admin', 'master')
  );
$$;

create or replace function public.is_master(input_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    where lower(u.email) = public.normalize_global_email(input_email)
      and u.status = 'aprovado'
      and u.perfil = 'master'
  );
$$;

create or replace function public.create_access_request(
  p_nome text,
  p_usuario text,
  p_setor text default null,
  p_observacao text default null,
  p_maquina text default null,
  p_ip inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text;
  v_email text;
  v_existing public.usuarios%rowtype;
begin
  v_usuario := lower(regexp_replace(trim(coalesce(p_usuario, '')), '\s+', '', 'g'));

  if position('@' in v_usuario) > 0 then
    if right(v_usuario, length('@globaleletronics.ind.br')) <> '@globaleletronics.ind.br' then
      insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
      values (v_usuario, 'login bloqueado por domínio inválido', 'bloqueado', p_maquina, p_ip, jsonb_build_object('origem', 'solicitacao_acesso'));
      return jsonb_build_object('ok', false, 'code', 'invalid_domain', 'message', 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.');
    end if;
    v_usuario := replace(v_usuario, '@globaleletronics.ind.br', '');
  end if;

  if v_usuario !~ '^[a-z0-9._-]{2,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_user', 'message', 'Usuário corporativo inválido.');
  end if;

  v_email := v_usuario || '@globaleletronics.ind.br';

  select * into v_existing from public.usuarios where lower(email) = v_email limit 1;
  if found then
    if v_existing.status = 'aprovado' then
      return jsonb_build_object('ok', false, 'code', 'already_approved', 'message', 'Usuário já aprovado. Faça login.');
    elsif v_existing.status = 'bloqueado' then
      return jsonb_build_object('ok', false, 'code', 'blocked', 'message', 'Usuário bloqueado. Entre em contato com o administrador.');
    else
      return jsonb_build_object('ok', true, 'code', 'already_pending', 'message', 'Solicitação enviada. Aguarde aprovação do administrador.');
    end if;
  end if;

  insert into public.usuarios(nome, email, setor, perfil, status, maquina, observacao)
  values (trim(p_nome), v_email, nullif(trim(coalesce(p_setor, '')), ''), 'visualizador', 'pendente', p_maquina, nullif(trim(coalesce(p_observacao, '')), ''));

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
  values (v_email, 'solicitação de acesso criada', 'pendente', p_maquina, p_ip, jsonb_build_object('nome', p_nome, 'setor', p_setor));

  return jsonb_build_object('ok', true, 'code', 'request_created', 'message', 'Solicitação enviada. Aguarde aprovação do administrador.');
end;
$$;


create or replace function public.check_login_access(
  p_usuario text,
  p_maquina text default null,
  p_ip inet default null,
  p_windows_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text;
  v_email text;
  v_user public.usuarios%rowtype;
begin
  v_usuario := lower(regexp_replace(trim(coalesce(p_usuario, '')), '\s+', '', 'g'));

  if v_usuario = '' then
    return jsonb_build_object('ok', false, 'code', 'empty_user', 'message', 'Informe seu usuário corporativo.');
  end if;

  if position('@' in v_usuario) > 0 then
    if right(v_usuario, length('@globaleletronics.ind.br')) <> '@globaleletronics.ind.br' then
      insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
      values (v_usuario, 'login bloqueado por domínio inválido', 'bloqueado', p_maquina, p_ip, jsonb_build_object('windows_email', p_windows_email));
      return jsonb_build_object('ok', false, 'code', 'invalid_domain', 'message', 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.');
    end if;
    v_usuario := replace(v_usuario, '@globaleletronics.ind.br', '');
  end if;

  if v_usuario !~ '^[a-z0-9._-]{2,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_user', 'message', 'Usuário corporativo inválido.');
  end if;

  v_email := v_usuario || '@globaleletronics.ind.br';

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
  values (v_email, 'tentativa de login', 'tentativa', p_maquina, p_ip, jsonb_build_object('windows_email', p_windows_email));

  -- Regra obrigatória: a validação de acesso só acontece se o e-mail existir na tabela usuarios.
  select * into v_user from public.usuarios where lower(email) = v_email limit 1;
  if not found then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
    values (v_email, 'login bloqueado por usuário inexistente', 'bloqueado', p_maquina, p_ip, jsonb_build_object('motivo', 'email_corporativo_nao_cadastrado'));
    return jsonb_build_object(
      'ok', false,
      'code', 'not_registered',
      'message', 'E-mail corporativo não cadastrado. Clique em Solicitar acesso.',
      'can_request_access', true,
      'usuario', v_usuario
    );
  end if;

  if v_user.status = 'pendente' then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
    values (v_email, 'login bloqueado por usuário pendente', 'bloqueado', p_maquina, p_ip);
    return jsonb_build_object('ok', false, 'code', 'pending', 'message', 'Usuário pendente de aprovação. Solicite liberação ao administrador.', 'can_request_access', true);
  end if;

  if v_user.status = 'bloqueado' then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
    values (v_email, 'login bloqueado por usuário bloqueado', 'bloqueado', p_maquina, p_ip);
    return jsonb_build_object('ok', false, 'code', 'blocked', 'message', 'Usuário bloqueado. Entre em contato com o administrador.');
  end if;

  if v_user.status <> 'aprovado' then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'Status de usuário inválido.');
  end if;

  update public.usuarios
  set ultimo_login = now(), maquina = p_maquina
  where lower(email) = v_email;

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
  values (v_email, 'login aprovado', 'aprovado', p_maquina, p_ip, jsonb_build_object('perfil', v_user.perfil, 'setor', v_user.setor));

  return jsonb_build_object(
    'ok', true,
    'code', 'approved',
    'message', 'Acesso liberado.',
    'user', jsonb_build_object(
      'email', v_user.email,
      'nome', v_user.nome,
      'perfil', v_user.perfil,
      'setor', v_user.setor,
      'status', v_user.status
    )
  );
end;
$$;

create or replace function public.admin_set_user_status(
  p_admin_email text,
  p_target_email text,
  p_status text,
  p_observacao text default null,
  p_maquina text default null,
  p_ip inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.usuarios%rowtype;
  v_target public.usuarios%rowtype;
  v_action text;
begin
  select * into v_admin from public.usuarios where lower(email) = public.normalize_global_email(p_admin_email) and status = 'aprovado' limit 1;
  if not found or v_admin.perfil not in ('admin', 'master') then
    return jsonb_build_object('ok', false, 'message', 'Acesso restrito a administradores.');
  end if;

  if p_status not in ('pendente', 'aprovado', 'bloqueado') then
    return jsonb_build_object('ok', false, 'message', 'Status inválido.');
  end if;

  select * into v_target from public.usuarios where lower(email) = public.normalize_global_email(p_target_email) limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Usuário não encontrado.');
  end if;

  if v_target.perfil = 'master' and v_admin.perfil <> 'master' then
    return jsonb_build_object('ok', false, 'message', 'Admin não pode alterar usuário master.');
  end if;

  update public.usuarios
  set status = p_status,
      observacao = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), observacao)
  where lower(email) = lower(v_target.email);

  v_action := case p_status
    when 'aprovado' then 'aprovação de usuário'
    when 'bloqueado' then 'bloqueio de usuário'
    else 'alteração de status'
  end;

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
  values (v_target.email, v_action, p_status, p_maquina, p_ip, jsonb_build_object('admin', v_admin.email, 'observacao', p_observacao));

  return jsonb_build_object('ok', true, 'message', 'Status alterado.');
end;
$$;

create or replace function public.admin_set_user_profile(
  p_admin_email text,
  p_target_email text,
  p_perfil text,
  p_maquina text default null,
  p_ip inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.usuarios%rowtype;
  v_target public.usuarios%rowtype;
  v_old text;
begin
  select * into v_admin from public.usuarios where lower(email) = public.normalize_global_email(p_admin_email) and status = 'aprovado' limit 1;
  if not found or v_admin.perfil not in ('admin', 'master') then
    return jsonb_build_object('ok', false, 'message', 'Acesso restrito a administradores.');
  end if;

  if p_perfil not in ('master', 'admin', 'engenharia', 'producao', 'visualizador') then
    return jsonb_build_object('ok', false, 'message', 'Perfil inválido.');
  end if;

  select * into v_target from public.usuarios where lower(email) = public.normalize_global_email(p_target_email) limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Usuário não encontrado.');
  end if;

  if v_admin.perfil <> 'master' and (v_target.perfil = 'master' or p_perfil in ('master', 'admin')) then
    return jsonb_build_object('ok', false, 'message', 'Somente master pode criar/alterar admin ou master.');
  end if;

  v_old := v_target.perfil;
  update public.usuarios set perfil = p_perfil where lower(email) = lower(v_target.email);

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip, detalhes)
  values (v_target.email, 'alteração de perfil', 'ok', p_maquina, p_ip, jsonb_build_object('admin', v_admin.email, 'perfil_anterior', v_old, 'perfil_novo', p_perfil));

  return jsonb_build_object('ok', true, 'message', 'Perfil alterado.');
end;
$$;

alter table public.usuarios enable row level security;
alter table public.logs_auditoria enable row level security;

-- Observação:
-- Se estiver usando Supabase Auth, adapte auth.jwt()->>'email' conforme seu token.
-- As policies abaixo são base para leitura/escrita via usuário autenticado.

create policy if not exists "usuarios_select_admin_master"
  on public.usuarios
  for select
  using (public.is_admin_or_master(auth.jwt() ->> 'email'));

create policy if not exists "usuarios_self_select"
  on public.usuarios
  for select
  using (lower(email) = public.normalize_global_email(auth.jwt() ->> 'email'));

create policy if not exists "logs_select_admin_master"
  on public.logs_auditoria
  for select
  using (public.is_admin_or_master(auth.jwt() ->> 'email'));

-- Não crie policy pública de update/insert direto em usuarios para o frontend.
-- Use RPCs security definer acima ou backend próprio com service_role guardado fora do frontend.
