-- One report = one round trip. Same steps the route used to send one by one (7 round trips
-- for the confirming report): load test run 3 showed per-round-trip overhead was the largest
-- avoidable CPU cost on the 1-vCPU box (evidence/03-knee.txt, evidence/04-profile.txt).
--
-- Called as a single statement in autocommit, so the advisory lock is held until that
-- statement's transaction commits. Under READ COMMITTED each statement in a PL/pgSQL function
-- takes a fresh snapshot, so the SELECT after the lock sees the other player's committed report.
CREATE FUNCTION report_match(
  p_match_id text, p_reporter text, p_opponent text, p_winner text, p_week_id int, p_points int
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  theirs match_reports%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id));

  INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id)
  VALUES (p_match_id, p_reporter, p_opponent, p_winner)
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

  INSERT INTO match_results (match_id, week_id, winner_id, loser_id)
  VALUES (p_match_id, p_week_id, p_winner, CASE WHEN p_winner = p_reporter THEN p_opponent ELSE p_reporter END)
  ON CONFLICT (match_id) DO NOTHING;
  IF FOUND THEN
    UPDATE league_members
       SET points = points + p_points, last_win_at = now()
     WHERE week_id = p_week_id AND player_id = p_winner;
  END IF;
  RETURN 'recorded';
END $$;
