create table if not exists user_goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  goal_type text not null check (goal_type in ('weekly_xp', 'accuracy_target', 'streak_days')),
  target_value numeric not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint user_goals_user_type_unique unique (user_id, goal_type)
);

create index if not exists user_goals_user_id_idx on user_goals(user_id);
