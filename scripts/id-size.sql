-- C7 sensitivity to ID format (make id-size -> evidence/id-size.txt). Read-only: temp tables only.
-- The seed uses UUID match ids (36-char text, as the phone sends them) and short player ids
-- ('p123'). Production player ids may be UUIDs. Same 200k rows copied three ways, each table
-- built the same way (CTAS + PK), so the ratios are comparable; absolute bytes/row are lower
-- than the live tables' because a fresh build has no page splits.
\set n 200000
CREATE TEMP TABLE rep_seeded AS
  SELECT match_id, reporter_id, opponent_id, winner_id, created_at FROM match_reports LIMIT :n;
CREATE TEMP TABLE rep_uuid_text AS
  SELECT match_id, md5(reporter_id)::uuid::text AS reporter_id, md5(opponent_id)::uuid::text AS opponent_id,
         md5(winner_id)::uuid::text AS winner_id, created_at FROM rep_seeded;
CREATE TEMP TABLE rep_uuid_type AS
  SELECT match_id::uuid, md5(reporter_id)::uuid AS reporter_id, md5(opponent_id)::uuid AS opponent_id,
         md5(winner_id)::uuid AS winner_id, created_at FROM rep_seeded;
CREATE TEMP TABLE res_seeded AS
  SELECT match_id, week_id, winner_id, loser_id, created_at FROM match_results LIMIT :n;
CREATE TEMP TABLE res_uuid_text AS
  SELECT match_id, week_id, md5(winner_id)::uuid::text AS winner_id, md5(loser_id)::uuid::text AS loser_id, created_at FROM res_seeded;
CREATE TEMP TABLE res_uuid_type AS
  SELECT match_id::uuid, week_id, md5(winner_id)::uuid AS winner_id, md5(loser_id)::uuid AS loser_id, created_at FROM res_seeded;
ALTER TABLE rep_seeded ADD PRIMARY KEY (match_id, reporter_id);
ALTER TABLE rep_uuid_text ADD PRIMARY KEY (match_id, reporter_id);
ALTER TABLE rep_uuid_type ADD PRIMARY KEY (match_id, reporter_id);
ALTER TABLE res_seeded ADD PRIMARY KEY (match_id);
ALTER TABLE res_uuid_text ADD PRIMARY KEY (match_id);
ALTER TABLE res_uuid_type ADD PRIMARY KEY (match_id);
VACUUM ANALYZE rep_seeded, rep_uuid_text, rep_uuid_type, res_seeded, res_uuid_text, res_uuid_type;

SELECT t AS table_copy, count AS rows,
       round(pg_total_relation_size(t::regclass)::numeric / count, 1) AS total_bytes_per_row,
       round(pg_total_relation_size(t::regclass)::numeric / first_value(pg_total_relation_size(t::regclass))
             OVER (PARTITION BY left(t, 3) ORDER BY t <> left(t, 3) || '_seeded'), 2) AS vs_seeded
  FROM (VALUES ('rep_seeded'), ('rep_uuid_text'), ('rep_uuid_type'), ('res_seeded'), ('res_uuid_text'), ('res_uuid_type')) v(t)
  CROSS JOIN LATERAL (SELECT :n::bigint AS count) c
 ORDER BY left(t, 3) DESC, t <> left(t, 3) || '_seeded', t;
