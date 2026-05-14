-- Create llm_logs table for logging LLM interactions
create table llm_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  prompt jsonb not null,
  response text not null,
  model text not null,
  latency_ms integer not null,
  cluster_id uuid references complaint_clusters(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table llm_logs enable row level security;

-- Create policy: Only service role can insert
create policy "Service role can insert llm_logs"
  on llm_logs
  for insert
  using (false); -- Prevent direct inserts from anon/authenticated users
  with check (false); -- Only service role bypasses RLS

-- Create policy: Users can read their own logs
create policy "Users can read own llm_logs"
  on llm_logs
  for select
  using (auth.uid() = user_id);

-- Create indexes for better query performance
create index idx_llm_logs_user_id on llm_logs(user_id);
create index idx_llm_logs_created_at on llm_logs(created_at);
create index idx_llm_logs_cluster_id on llm_logs(cluster_id);