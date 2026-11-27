-- A match belongs to the week of its FIRST report (PRD §2, DESIGN.md §5).
-- Before this migration the result used the week of the confirming (second) report, so a
-- match reported Sunday 23:59:59 and confirmed Monday 00:00:01 counted in the new week.
--
-- Expand-only: a nullable column, no backfill. Rows written before this migration have
-- week_id NULL; for those the week is derived from created_at (UTC ISO week, DB clock).
ALTER TABLE match_reports ADD COLUMN week_id int;

CREATE OR REPLACE FUNCTION report_match(
  p_match_id text, p_reporter text, p_opponent text, p_winner text, p_week_id int, p_points int
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  theirs match_reports%ROWTYPE;
  match_week int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id));

  INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id, week_id)
  VALUES (p_match_id, p_reporter, p_opponent, p_winner, p_week_id)
  ON CONFLICT (match_id, reporter_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO theirs FROM match_reports WHERE match_id = p_match_id AND reporter_id = p_opponent;
  IF NOT FOUND THEN
    RETURN 'waiting_for_opponent';
  END IF;
  IF theirs.opponent_id <> p_reporter OR theirs.winner_id <> p_winner THEN
    RETURN 'disputed'; -- keep both reports for later dispute handling
  END IF;

  -- theirs is the earlier report (ours was just inserted), so its week is the match week.
  match_week := COALESCE(theirs.week_id, to_char(theirs.created_at AT TIME ZONE 'UTC', 'IYYYIW')::int);

  INSERT INTO match_results (match_id, week_id, winner_id, loser_id)
  VALUES (p_match_id, match_week, p_winner, CASE WHEN p_winner = p_reporter THEN p_opponent ELSE p_reporter END)
  ON CONFLICT (match_id) DO NOTHING;
  IF FOUND THEN
    UPDATE league_members
       SET points = points + p_points, last_win_at = now()
     WHERE week_id = match_week AND player_id = p_winner;
  END IF;
  RETURN 'recorded';
END $$;
