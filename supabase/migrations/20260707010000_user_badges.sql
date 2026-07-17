create table if not exists user_badges (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz default now(),
  constraint user_badges_user_badge_unique unique (user_id, badge_id)
);

create index if not exists user_badges_user_id_idx on user_badges(user_id);
