# SMC - Supabase para solicitações de acesso

Execute no SQL Editor do Supabase antes de usar a aprovação por ADM/Master.

```sql
create extension if not exists pgcrypto;

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  nome text not null,
  setor text not null,
  motivo text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text
);

create table if not exists public.access_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_email text,
  performed_by text,
  performed_at timestamptz not null default now(),
  details text
);
```

Também mantenha um usuário master ativo em `usuarios_smc`:

```sql
insert into public.usuarios_smc (nome, email, perfil, ativo)
values ('Master SMC', 'trainee.processo@globaleletronics.ind.br', 'master', true)
on conflict (email) do update set perfil = 'master', ativo = true;
```
