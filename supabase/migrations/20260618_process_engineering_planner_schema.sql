-- Planner interno da Engenharia de Processo
-- Aplicado no Supabase em 2026-06-18.
-- Mantem tabelas antigas e adiciona estrutura evolutiva para solicitacoes/tarefas.

alter table public.usuarios_smc
  add column if not exists user_code text,
  add column if not exists department text default 'Engenharia de Processo',
  add column if not exists role text,
  add column if not exists status text default 'active';

update public.usuarios_smc
set user_code = coalesce(nullif(user_code, ''), lower(split_part(email, '@', 1))),
    department = coalesce(nullif(department, ''), 'Engenharia de Processo'),
    role = coalesce(nullif(role, ''), perfil),
    status = case when ativo then 'active' else 'inactive' end,
    atualizado_em = now()
where email is not null;

create index if not exists usuarios_smc_department_status_idx on public.usuarios_smc (department, status);
create unique index if not exists usuarios_smc_user_code_unique_idx on public.usuarios_smc (user_code) where user_code is not null;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  status text not null default 'Não iniciada',
  priority text not null default 'Média',
  category text not null default 'Engenharia de Processo',
  task_type text not null,
  requester_id uuid references public.usuarios_smc(id),
  responsible_id uuid not null references public.usuarios_smc(id),
  created_by uuid references public.usuarios_smc(id),
  requester_user_code text,
  responsible_user_code text,
  created_by_user_code text,
  start_date timestamptz,
  due_date timestamptz,
  completed_at timestamptz,
  pause_reason text,
  total_tracked_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_members (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.usuarios_smc(id),
  user_code text,
  created_at timestamptz not null default now(),
  unique(task_id, user_id)
);

create table if not exists public.task_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.usuarios_smc(id) on delete cascade,
  task_type text not null,
  category text not null default 'Engenharia de Processo',
  can_create boolean not null default true,
  can_execute boolean not null default false,
  can_edit boolean not null default false,
  can_complete boolean not null default false,
  can_change_responsible boolean not null default false,
  can_add_members boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, task_type, category)
);

create table if not exists public.task_time_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.usuarios_smc(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes integer,
  pause_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists task_time_sessions_one_active_idx
  on public.task_time_sessions(task_id)
  where ended_at is null;

create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  recipient_user_id uuid not null references public.usuarios_smc(id),
  priority text not null,
  message text not null,
  viewed boolean not null default false,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

create table if not exists public.task_observations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.usuarios_smc(id),
  user_code text,
  observation text not null,
  created_at timestamptz not null default now()
);

create index if not exists tasks_responsible_status_idx on public.tasks(responsible_id, status);
create index if not exists tasks_created_at_idx on public.tasks(created_at desc);
create index if not exists task_notifications_recipient_idx on public.task_notifications(recipient_user_id, viewed, created_at desc);
create index if not exists task_members_task_idx on public.task_members(task_id);
create index if not exists task_observations_task_idx on public.task_observations(task_id, created_at desc);

alter table public.tasks enable row level security;
alter table public.task_members enable row level security;
alter table public.task_permissions enable row level security;
alter table public.task_time_sessions enable row level security;
alter table public.task_notifications enable row level security;
alter table public.task_observations enable row level security;
