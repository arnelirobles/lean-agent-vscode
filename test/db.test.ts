import { beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/db";
import type { Dbs } from "../src/db";
import { defaultTestsDbPath } from "../src/brainCli";
import { BRAIN_SCHEMA, brainDb, iso, NOW, seededDbs, TESTS_SCHEMA, testsDb } from "./fixture";


let d: Dbs;
beforeAll(async () => { d = await seededDbs(); });

describe("db queries", () => {
  it("reads the session that filed an item and whether it is still open", async () => {
    const q = db.getItem(d.brain!, 2)!;
    expect(q.session_id).toBe("0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    expect(q.session_cwd).toBe("/work/core");
    expect(db.sessionState(d.brain!, "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toBe("open");
    expect(db.sessionState(d.brain!, "ended-1")).toBe("ended");
    expect(db.sessionState(d.brain!, "nobody")).toBe("unknown");
    const old = await brainDb();
    old.run("DROP TABLE sessions");
    expect(db.sessionState(old, "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toBe("unknown");
  });

  it("reads the schema version", () => {
    expect(db.schemaVersion(d.brain!)).toBe(BRAIN_SCHEMA);
    expect(db.schemaVersion(d.tests!)).toBe(TESTS_SCHEMA);
  });

  it("lists activity newest first and says which failed", () => {
    const a = db.activity(d.brain!);
    expect(a.map((r) => r.action)).toEqual(["vm exec <b>x</b>", "stack release", "deploy", "odd"]);
    expect(a[0].ok).toBe(false);
    expect(a[0].error).toBe("exit 1 <script>");
    expect(a[1].ok).toBe(true);
  });

  it("reads no activity from a brain with no activities table", async () => {
    const noTable = await brainDb();
    noTable.run("DROP TABLE activities");
    expect(db.activity(noTable)).toEqual([]);
  });

  it("lists open items only, and the fixture is not empty", () => {
    const items = db.openItems(d.brain!);
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.status === "open")).toBe(true);
    expect(items.map((i) => i.ref)).not.toContain("Closed.Recent");
  });

  it("counts real and flaky, scoped by project case-insensitively", () => {
    const all = db.openCounts(d.brain!);
    expect(all).toEqual({ counts: { real: 3, flaky: 2 }, scoped: false });
    const core = db.openCounts(d.brain!, ["CORE"]);
    expect(core).toEqual({ counts: { real: 3, flaky: 1 }, scoped: true });
    const none = db.openCounts(d.brain!, ["nosuch"]);
    expect(none.scoped).toBe(false);
    expect(none.counts.real).toBe(3);
  });

  it("waiting picks question-like kinds present, newest first, and skips tickets", () => {
    expect(db.waitingKinds(d.brain!).sort()).toEqual(["blocker", "pending", "question"]);
    const w = db.waiting(d.brain!);
    expect(w.map((i) => i.ref)).toEqual(["p1", "need-key", "q1"]);
  });

  it("headline numbers", () => {
    const h = db.headline(d, NOW);
    expect(h.realOpen).toBe(3);
    expect(h.flakyOpen).toBe(2);
    expect(h.closed7d).toBe(1);
    expect(h.runs7d).toBe(3);
    expect(h.testSeconds7d).toBe(600);
  });

  it("cycles", () => {
    const c = db.cycles(d);
    const c1 = c.find((x) => x.cycle === "c1")!;
    expect(c1).toMatchObject({ jobs: 2, passed: 98, failed: 2, flaky_filed: 1, stalls: 0 });
    expect(c1.duration_s).toBe(400);
    expect(c.find((x) => x.cycle === "c2")).toMatchObject({ jobs: 2, stalls: 1, flaky_filed: 1 });
  });

  it("suites have median, last, history and lane wait", () => {
    const s = db.suites(d);
    const a = s.find((x) => x.test_project.includes("A.Tests"))!;
    expect(a.runs).toBe(3);
    expect(a.median_s).toBe(200);
    expect(a.last_s).toBe(200);
    expect(a.history).toEqual([100, 300, 200]);
    expect(a.mean_lane_wait_s).toBeCloseTo(5);
    expect(s[0].test_project).toContain("B.Tests"); // slowest first
  });

  it("flakiest is ranked by occurrences", () => {
    const f = db.flakiest(d.brain!);
    expect(f.map((i) => i.ref)).toEqual(["F.Often", "F.Rare"]);
  });

  it("load points are oldest first and mark stalled runs", () => {
    const l = db.loadPoints(d.tests!);
    expect(l.length).toBe(4);
    expect(l[0].started).toBeLessThan(l[3].started);
    expect(l.filter((p) => p.stalled).length).toBe(1);
  });

  it("stale counts open items not seen for 14 days by kind", () => {
    const s = db.stale(d.brain!, NOW);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "test-fail", n: 2 });
  });

  it("queue", () => {
    const q = db.queue(d.tests!);
    expect(q.running).toHaveLength(1);
    expect(q.queued).toHaveLength(1);
    expect(q.finished).toHaveLength(1);
    expect(db.jobElapsed(q.running[0], NOW)).toBe(300);
    expect(db.jobElapsed(q.finished[0], NOW)).toBe(100);
    expect(db.shortTestName(q.running[0].test_project)).toBe("B.Tests");
  });

  it("queue carries which lane may run a job, and the host of a running one", () => {
    const qid = db.queue(d.tests!).queued[0].id;
    d.tests!.run(`UPDATE jobs SET platform='remote' WHERE id=?`, [qid]);
    d.tests!.run(`UPDATE jobs SET host='dev' WHERE status='running'`);
    const q = db.queue(d.tests!);
    expect(q.queued[0].platform).toBe("remote");
    expect(q.running[0].host).toBe("dev");
    expect(db.laneLabel(q.queued[0])).toBe("remote only");
    expect(db.laneLabel({ ...q.queued[0], platform: "apple" })).toBe("this machine only");
    expect(db.laneLabel({ ...q.queued[0], platform: "" })).toBe("");
    expect(db.jobContext(q.queued[0])).toBe("job.queued.remote");
    expect(db.jobContext({ ...q.queued[0], platform: "apple" })).toBe("job.queued.apple");
    expect(db.jobContext({ ...q.queued[0], platform: "" })).toBe("job.queued.any");
    expect(db.jobContext(q.running[0])).toBe("job.running");
    d.tests!.run(`UPDATE jobs SET platform='', host=''`);
  });

  it("lists queued jobs in the order the drainer takes them", () => {
    const first = db.queue(d.tests!).queued[0].id;
    d.tests!.run(`INSERT INTO jobs (project, repo_dir, test_project, status, enqueued_at) VALUES ('core','/r','D.csproj','queued',?)`, [iso(50)]);
    const later = db.queue(d.tests!).queued[1].id;
    d.tests!.run(`UPDATE jobs SET priority=2 WHERE id=?`, [later]);
    const q = db.queue(d.tests!);
    expect(q.queued.map((j) => j.id)).toEqual([later, first]);
    expect(q.queued.map((j) => j.priority)).toEqual([2, 0]);
    d.tests!.run(`DELETE FROM jobs WHERE id=?`, [later]);
  });

  it("getItem returns all fields and tags", () => {
    const i = db.getItem(d.brain!, 1)!;
    expect(i.ref).toBe("need-key");
    expect(i.tags).toEqual(["urgent", "user"]);
    expect(db.getItem(d.brain!, 9999)).toBeUndefined();
  });

  it("formats time", () => {
    expect(db.formatDuration(65)).toBe("1m 5s");
    expect(db.formatDuration(7260)).toBe("2h 1m");
    expect(db.relativeTime(new Date((NOW - 7200) * 1000).toISOString(), NOW)).toBe("2h ago");
  });

  it("handles empty tables", async () => {
    const e = { brain: await brainDb(), tests: await testsDb() };
    const data = db.dashboard(e, NOW);
    expect(data.waiting).toEqual([]);
    expect(data.cycles).toEqual([]);
    expect(data.suites).toEqual([]);
    expect(data.load).toEqual([]);
    expect(data.headline).toEqual({ realOpen: 0, flakyOpen: 0, closed7d: 0, runs7d: 0, testSeconds7d: 0 });
    expect(db.openCounts(e.brain).counts).toEqual({ real: 0, flaky: 0 });
  });
});

describe("dashboard queue", () => {
  it("carries the queue", async () => {
    const e = await seededDbs();
    expect(db.dashboard(e, NOW).queue).toEqual(db.queue(e.tests!));
  });
});

describe("tests.db path", () => {
  it("is the setting, then LEAN_TESTS_DB, then the default", () => {
    expect(defaultTestsDbPath("/a.db", { LEAN_TESTS_DB: "/b.db" }, "/h")).toBe("/a.db");
    expect(defaultTestsDbPath("", { LEAN_TESTS_DB: "/b.db" }, "/h")).toBe("/b.db");
    expect(defaultTestsDbPath("", {}, "/h")).toBe("/h/.local/share/lean/tests.db");
  });
});

describe("reading brain.db and tests.db", () => {
  it("seeds a brain at BRAIN_SCHEMA and a tests db at TESTS_SCHEMA", async () => {
    const { brain, tests } = await seededDbs();
    expect(db.schemaVersion(brain!)).toBe(BRAIN_SCHEMA);
    expect(db.schemaVersion(tests!)).toBe(TESTS_SCHEMA);
    expect(db.openItems(brain!).length).toBeGreaterThan(5);
    expect(db.queue(tests!).running).toHaveLength(1);
    expect(db.queue(tests!).queued[0]).toMatchObject({ routable: true, priority: 0, platform: "" });
  });

  it("counts flaky items filed in brain against the runs in tests", async () => {
    const dbs = await seededDbs();
    dbs.brain!.run(`INSERT INTO items (project, kind, ref, title, cycle, first_seen, last_seen) VALUES ('core','flaky','F.Second','F.Second','c1',?,?)`, [iso(60), iso(60)]);
    const c = db.cycles(dbs);
    expect(c.find((x) => x.cycle === "c1")).toMatchObject({ jobs: 2, passed: 98, failed: 2, flaky_filed: 2 });
    expect(c.find((x) => x.cycle === "c2")).toMatchObject({ jobs: 2, stalls: 1, flaky_filed: 1 });
  });

  it("with no brain, cycles still lists the runs with no flaky filed, and the items view says to install brain", async () => {
    const { tests } = await seededDbs();
    const dbs = { tests };
    expect(db.cycles(dbs).map((c) => c.flaky_filed)).toEqual([0, 0]);
    expect(db.suites(dbs).length).toBe(2);
    expect(db.itemsMessage(dbs)).toBe("Install brain to see items.");
    expect(db.queueMessage(dbs)).toBe("");
    const data = db.dashboard(dbs, NOW);
    expect(data.waiting).toEqual([]);
    expect(data.headline).toMatchObject({ realOpen: 0, flakyOpen: 0, closed7d: 0, runs7d: 3 });
  });

  it("with no tests db, the queue view says to install lean-agent-tools and the items still list", async () => {
    const { brain } = await seededDbs();
    const dbs = { brain };
    expect(db.queueMessage(dbs)).toBe("Install lean-agent-tools to see the test queue.");
    expect(db.itemsMessage(dbs)).toBe("");
    expect(db.openItems(brain!).length).toBeGreaterThan(5);
    expect(db.cycles(dbs)).toEqual([]);
    const data = db.dashboard(dbs, NOW);
    expect(data.queue).toEqual({ running: [], queued: [], finished: [], today: [] });
    expect(data.headline).toMatchObject({ realOpen: 3, closed7d: 1, runs7d: 0 });
  });

  it("with neither file the dashboard is empty and both views say what to install", () => {
    expect(db.itemsMessage({})).toBe("Install brain to see items.");
    expect(db.queueMessage({})).toBe("Install lean-agent-tools to see the test queue.");
    expect(db.dashboard({}, NOW).cycles).toEqual([]);
  });

  it("says nothing about the schema when both files are known", async () => {
    expect(db.KNOWN_BRAIN_SCHEMA).toBe(9);
    expect(db.KNOWN_TESTS_SCHEMA).toBe(1);
    expect(db.schemaNote(await seededDbs())).toBe("");
    expect(db.schemaNote({})).toBe("");
  });

  it("says when tests.db is newer than the extension knows", async () => {
    const dbs = { brain: await brainDb(), tests: await testsDb(2) };
    expect(db.schemaNote(dbs)).toBe("tests.db is newer than this extension knows. Update Lean Brain.");
  });

  it("says when brain.db is newer than the extension knows", async () => {
    const dbs = { brain: await brainDb(10), tests: await testsDb() };
    expect(db.schemaNote(dbs)).toBe("brain.db is newer than this extension knows. Update Lean Brain.");
  });

  it("tells an upgrader to import the queue when tests.db is missing and brain.db still has jobs", async () => {
    const brain = await brainDb();
    brain.run("CREATE TABLE jobs (id INTEGER PRIMARY KEY)");
    expect(db.queueMessage({ brain })).toBe("Run `test-phase queue import` once to move the queue to tests.db.");
  });

  it("keeps the install message when tests.db is missing and brain.db has no jobs table", async () => {
    expect(db.queueMessage({ brain: await brainDb() })).toBe("Install lean-agent-tools to see the test queue.");
  });

  it("drops the tests.db banner when the queue view already explains it, and keeps brain's note", () => {
    const notes = db.statusNotes;
    const banner = "No tests.db database at /x/tests.db.";
    expect(notes({}, "No brain.db database at /x/brain.db.", banner, true)).toBe("No brain.db database at /x/brain.db.");
    expect(notes({}, "", banner, true)).toBe("");
    expect(notes({}, "", "The tests.db database could not be read (boom).", false)).toBe("The tests.db database could not be read (boom).");
  });
});
