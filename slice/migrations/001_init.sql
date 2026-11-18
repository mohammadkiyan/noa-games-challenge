-- one row per player per week; points go up when they win
CREATE TABLE league_members (
  week_id    int  NOT NULL,          -- e.g. 202647 (ISO year+week), global reset
  player_id  text NOT NULL,
  league_id  int  NOT NULL,          -- unique per week
  tier       int  NOT NULL DEFAULT 0,
  points     int  NOT NULL DEFAULT 0,
  last_win_at timestamptz,
  PRIMARY KEY (week_id, player_id)
);
-- serves: GET leaderboard (top 50 of one league, ordered)
CREATE INDEX league_board_idx
  ON league_members (league_id, points DESC, last_win_at ASC NULLS LAST, player_id);

-- both players report; PK makes "same report twice" a no-op
CREATE TABLE match_reports (
  match_id    text NOT NULL,
  reporter_id text NOT NULL,
  opponent_id text NOT NULL,
  winner_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, reporter_id)
);

-- exactly one result per match; points are awarded only when this row is inserted
CREATE TABLE match_results (
  match_id   text PRIMARY KEY,
  week_id    int  NOT NULL,
  winner_id  text NOT NULL,
  loser_id   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
