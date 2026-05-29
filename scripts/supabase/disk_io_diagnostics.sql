-- Supabase Disk IO diagnostics for PolyWeather.
-- Run sections independently if your project does not expose every stats view.

-- 1) Tables with high sequential scan pressure.
select
  schemaname,
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  n_dead_tup
from pg_stat_user_tables
where schemaname = 'public'
order by seq_tup_read desc
limit 30;

-- 2) Largest public tables and indexes.
select
  relname,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size
from pg_catalog.pg_statio_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 30;

-- 3) Slow/high-read statements, if pg_stat_statements is available.
select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  shared_blks_read,
  shared_blks_hit,
  temp_blks_read,
  temp_blks_written,
  left(query, 500) as query_sample
from pg_stat_statements
order by shared_blks_read desc, total_exec_time desc
limit 30;

-- 4) Dead tuple pressure that can trigger heavier autovacuum work.
select
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by n_dead_tup desc
limit 30;

-- 5) Indexes that still read the most disk blocks.
select
  s.schemaname,
  s.relname,
  s.indexrelname,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  io.idx_blks_read,
  io.idx_blks_hit,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size
from pg_stat_user_indexes s
join pg_statio_user_indexes io
  on io.indexrelid = s.indexrelid
where s.schemaname = 'public'
order by io.idx_blks_read desc, s.idx_scan desc
limit 50;

-- 6) Large non-unique indexes with no recorded scans since stats reset.
-- Treat this as a candidate list only; confirm with production traffic history
-- before dropping anything.
select
  s.schemaname,
  s.relname,
  s.indexrelname,
  s.idx_scan,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
  i.indisunique,
  i.indisprimary
from pg_stat_user_indexes s
join pg_index i
  on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
  and s.idx_scan = 0
  and not i.indisprimary
  and not i.indisunique
order by pg_relation_size(s.indexrelid) desc
limit 30;
