// All SQL in one place. Items, tags, sessions and activities are in brain.db; runs and jobs are in tests.db. Times: items and jobs use ISO strings (2026-01-02T03:04:05Z), runs use epoch seconds.

export const SCHEMA_VERSION = `SELECT value FROM meta WHERE key='schema_version'`;

export const OPEN_ITEMS = `
  SELECT id, project, kind, ref, title, severity, cycle, occurrences, first_seen, last_seen, status
  FROM items WHERE status='open' ORDER BY project, kind, last_seen DESC, id DESC`;

export const ITEM = `SELECT * FROM items WHERE id=?`;
export const SESSION = `SELECT ended_at FROM sessions WHERE id=?`;
export const ITEM_TAGS = `SELECT tag FROM tags WHERE item_id=? ORDER BY tag`;

export const LANE_TODAY = `
  SELECT host, status, COUNT(*) AS n FROM (SELECT status, ended_at, host FROM jobs)
  WHERE status IN ('done','failed') AND ended_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')
  GROUP BY host, status`;

export const RUNNING_JOBS = `
  SELECT id, cycle, project, test_project, status, tier, enqueued_at, started_at, ended_at, reason, platform, host, 1 AS routable, priority
  FROM jobs WHERE status='running' ORDER BY id`;
export const QUEUED_JOBS = `
  SELECT id, cycle, project, test_project, status, tier, enqueued_at, started_at, ended_at, reason, platform, host, 1 AS routable, priority
  FROM jobs WHERE status='queued' ORDER BY priority DESC, id`;
export const FINISHED_JOBS = `
  SELECT id, cycle, project, test_project, status, tier, enqueued_at, started_at, ended_at, reason, platform, host, 1 AS routable, priority
  FROM jobs WHERE status IN ('done','failed','cancelled') ORDER BY COALESCE(ended_at, enqueued_at) DESC, id DESC LIMIT 10`;

export const HAS_JOBS = `SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='jobs'`;
export const HAS_COPY_MARKER = `SELECT 1 AS x FROM meta WHERE key='copied_from_brain'`;
export const LIVE_OLD_JOBS = `SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')`;
export const HAS_ACTIVITIES = `SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='activities'`;

export const ACTIVITY = `
  SELECT id, source, ts, action, project, target, ok, duration_ms, error, host
  FROM activities ORDER BY ts DESC, id DESC LIMIT 100`;

export const WAITING = `
  SELECT id, project, kind, ref, title, severity, occurrences, first_seen, last_seen
  FROM items WHERE status='open' AND kind IN (%KINDS%) ORDER BY last_seen DESC, id DESC`;

export const OPEN_KINDS = `SELECT kind, COUNT(*) AS n FROM items WHERE status='open' GROUP BY kind ORDER BY n DESC`;

export const OPEN_COUNT_BY_KIND_PROJECT = `
  SELECT project, kind, COUNT(*) AS n FROM items WHERE status='open' GROUP BY project, kind`;

export const CLOSED_SINCE = `SELECT COUNT(*) AS n FROM items WHERE status IN ('closed','wontfix') AND closed_at >= ?`;
export const RUNS_SINCE = `SELECT COUNT(*) AS n, COALESCE(SUM(duration_s),0) AS total_s FROM runs WHERE started >= ?`;

export const CYCLES = `
  SELECT cycle, COUNT(*) AS jobs, COALESCE(SUM(passed),0) AS passed, COALESCE(SUM(failed),0) AS failed,
         COALESCE(SUM(duration_s),0) AS duration_s, COALESCE(SUM(stalled),0) AS stalls,
         COALESCE(MAX(started),0) AS last_started
  FROM runs GROUP BY cycle ORDER BY last_started DESC LIMIT 12`;

export const FLAKY_BY_CYCLE = `SELECT cycle, COUNT(*) AS n FROM items WHERE kind='flaky' GROUP BY cycle`;

export const SUITE_RUNS = `
  SELECT project, test_project, duration_s, lane_wait_s, started, id FROM runs
  WHERE tier IN ('fast','full') AND duration_s IS NOT NULL ORDER BY id`;

export const FLAKIEST = `
  SELECT id, project, ref, title, occurrences, last_seen FROM items
  WHERE kind='flaky' AND status='open' ORDER BY occurrences DESC, last_seen DESC LIMIT 15`;

export const LOAD = `
  SELECT id, test_project, started, load_start, load_end, stalled FROM runs
  WHERE started IS NOT NULL AND (load_start IS NOT NULL OR load_end IS NOT NULL) ORDER BY started DESC LIMIT 200`;

export const STALE = `
  SELECT kind, COUNT(*) AS n, MIN(last_seen) AS oldest FROM items
  WHERE status='open' AND last_seen < ? GROUP BY kind ORDER BY n DESC`;
