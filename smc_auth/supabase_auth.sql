-- Supabase/PostgreSQL base para autenticação corporativa SMC.
-- Não expor service_role no frontend.

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text,
  email text not null unique,
  setor text,
  perfil text not null default 'visualizador',
  status text not null default 'pendente',
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz,
  maquina text,
  observacao text
);

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

create index if not exists idx_usuarios_email on public.usuarios (lower(email));
create index if not exists idx_usuarios_status on public.usuarios (status);
create index if not exists idx_logs_usuario on public.logs_auditoria (lower(usuario_email));
create index if not exists idx_logs_data on public.logs_auditoria (data_hora desc);

create or replace function public.check_login_access(p_usuario text, p_maquina text default null, p_ip inet default null)
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

  if position('@' in v_usuario) > 0 then
    if right(v_usuario, length('@globaleletronics.ind.br')) <> '@globaleletronics.ind.br' then
      insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
      values (v_usuario, 'login bloqueado por domínio inválido', 'bloqueado', p_maquina, p_ip);
      return jsonb_build_object('ok', false, 'code', 'invalid_domain', 'message', 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.');
    end if;
    v_usuario := replace(v_usuario, '@globaleletronics.ind.br', '');
  end if;

  if v_usuario !~ '^[a-z0-9._-]{2,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_user', 'message', 'Usuário corporativo inválido.');
  end if;

  v_email := v_usuario || '@globaleletronics.ind.br';

  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
  values (v_email, 'tentativa de login', 'tentativa', p_maquina, p_ip);

  -- Regra obrigatória: só valida se o e-mail existir na tabela usuarios.
  select * into v_user from public.usuarios where lower(email) = v_email limit 1;
  if not found then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
    values (v_email, 'login bloqueado por usuário inexistente', 'bloqueado', p_maquina, p_ip);
    return jsonb_build_object('ok', false, 'code', 'not_registered', 'message', 'E-mail corporativo não cadastrado. Clique em Solicitar acesso.', 'can_request_access', true);
  end if;

  if v_user.status = 'pendente' then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
    values (v_email, 'login bloqueado por usuário pendente', 'bloqueado', p_maquina, p_ip);
    return jsonb_build_object('ok', false, 'code', 'pending', 'message', 'Usuário pendente de aprovação. Solicite liberação ao administrador.');
  end if;

  if v_user.status = 'bloqueado' then
    insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
    values (v_email, 'login bloqueado por usuário bloqueado', 'bloqueado', p_maquina, p_ip);
    return jsonb_build_object('ok', false, 'code', 'blocked', 'message', 'Usuário bloqueado. Entre em contato com o administrador.');
  end if;

  if v_user.status <> 'aprovado' then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'Status inválido.');
  end if;

  update public.usuarios set ultimo_login = now(), maquina = p_maquina where lower(email) = v_email;
  insert into public.logs_auditoria(usuario_email, acao, status, maquina, ip)
  values (v_email, 'login aprovado', 'aprovado', p_maquina, p_ip);

  return jsonb_build_object('ok', true, 'code', 'approved', 'message', 'Acesso liberado.', 'user', jsonb_build_object('email', v_user.email, 'nome', v_user.nome, 'perfil', v_user.perfil, 'setor', v_user.setor, 'status', v_user.status));
end;
$$;
