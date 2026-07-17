create table if not exists push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  constraint push_subscriptions_user_endpoint_unique unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);
