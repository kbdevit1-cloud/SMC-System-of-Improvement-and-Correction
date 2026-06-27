alter table public.solicitacoes
  add column if not exists local_id text,
  add column if not exists sync_status text default 'synced',
  add column if not exists last_sync_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text,
  add column if not exists responsible_id uuid references public.usuarios_smc(id),
  add column if not exists responsible_email text,
  add column if not exists responsible_user_code text,
  add column if not exists due_date timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists task_id uuid;

alter table public.tasks
  add column if not exists solicitation_id uuid references public.solicitacoes(id),
  add column if not exists local_id text,
  add column if not exists sync_status text default 'synced',
  add column if not exists last_sync_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text;

create unique index if not exists solicitacoes_local_id_uidx on public.solicitacoes(local_id) where local_id is not null;
create unique index if not exists tasks_local_id_uidx on public.tasks(local_id) where local_id is not null;
create index if not exists solicitacoes_responsible_id_idx on public.solicitacoes(responsible_id);
create index if not exists tasks_solicitation_id_idx on public.tasks(solicitation_id);

alter table public.solicitacoes
  drop constraint if exists solicitacoes_task_id_fkey;
alter table public.solicitacoes
  add constraint solicitacoes_task_id_fkey foreign key (task_id) references public.tasks(id);
