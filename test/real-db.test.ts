import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import * as Q from "../src/queries";
import { Store } from "../src/store";
import { brainDb, testsDb } from "./fixture";

// Runs against databases built by the real brain and test-phase CLIs (scripts/fixture-dbs.sh).
const dir = process.env.LEAN_FIXTURE_DIR;
const wasm = path.join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");

// Which database each query runs on, taken from how src/db.ts uses it.
const WHERE: Record<string, Array<"brain" | "tests">> = {
  SCHEMA_VERSION: ["brain", "tests"],
  OPEN_ITEMS: ["brain"],
  ITEM: ["brain"],
  SESSION: ["brain"],
  ITEM_TAGS: ["brain"],
  LANE_TODAY: ["tests"],
  RUNNING_JOBS: ["tests"],
  QUEUED_JOBS: ["tests"],
  FINISHED_JOBS: ["tests"],
  HAS_JOBS: ["brain"],
  HAS_COPY_MARKER: ["tests"],
  // Runs on the jobs table lean-agent-tools 1.x left in brain.db, only after HAS_JOBS finds it.
  // brain 1.0 never creates that table, so there is no real file to run it on; db.test.ts covers it.
  LIVE_OLD_JOBS: [],
  HAS_ACTIVITIES: ["brain"],
  ACTIVITY: ["brain"],
  WAITING: ["brain"],
  OPEN_KINDS: ["brain"],
  OPEN_COUNT_BY_KIND_PROJECT: ["brain"],
  CLOSED_SINCE: ["brain"],
  RUNS_SINCE: ["tests"],
  CYCLES: ["tests"],
  FLAKY_BY_CYCLE: ["brain"],
  SUITE_RUNS: ["tests"],
  FLAKIEST: ["brain"],
  LOAD: ["tests"],
  STALE: ["brain"],
};

function columns(db: Database, table: string): string[] {
  const res = db.exec(`PRAGMA table_info(${table})`);
  return res.length ? res[0].values.map((v) => String(v[1])) : [];
}

function tables(db: Database): string[] {
  const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return res.length ? res[0].values.map((v) => String(v[0])) : [];
}

describe.skipIf(!dir)("extension against real brain and test-phase databases", () => {
  const real: { brain?: Database; tests?: Database } = {};

  beforeAll(async () => {
    const brain = new Store(wasm, "brain.db");
    const tests = new Store(wasm, "tests.db");
    for (const [store, file] of [[brain, "brain.db"], [tests, "tests.db"]] as const) {
      if (!fs.existsSync(path.join(dir!, file))) {
        throw new Error(`${file} not found in ${dir}; run scripts/fixture-dbs.sh first`);
      }
      expect(await store.refresh(path.join(dir!, file))).toBe(true);
    }
    real.brain = brain.database;
    real.tests = tests.database;
  });

  it("maps every exported query to a database", () => {
    const exported = Object.entries(Q).filter(([, v]) => typeof v === "string").map(([k]) => k).sort();
    expect(Object.keys(WHERE).sort()).toEqual(exported);
  });

  for (const name of Object.keys(WHERE)) {
    for (const which of WHERE[name]) {
      it(`${name} prepares and steps on ${which}.db`, () => {
        const db = real[which]!;
        let sql = (Q as Record<string, unknown>)[name] as string;
        if (name === "WAITING") sql = sql.replace("%KINDS%", "?");
        const stmt = db.prepare(sql);
        try {
          stmt.step();
        } finally {
          stmt.free();
        }
      });
    }
  }

  for (const [label, make, which] of [
    ["brain", brainDb, "brain"],
    ["tests", testsDb, "tests"],
  ] as const) {
    it(`every ${label} fixture column exists in the real file`, async () => {
      const fixture = await make();
      const db = real[which]!;
      const have = tables(db);
      for (const table of tables(fixture)) {
        expect(have, `table ${table} is missing from the real ${label}.db`).toContain(table);
        const real_cols = columns(db, table);
        for (const col of columns(fixture, table)) {
          expect(real_cols, `column ${table}.${col} is missing from the real ${label}.db`).toContain(col);
        }
      }
    });
  }

  it("the files hold the filed rows", () => {
    expect(fs.existsSync(path.join(dir!, "brain.db"))).toBe(true);
    const kinds = real.brain!.exec(`SELECT kind FROM items WHERE project='demo' AND cycle='c1' ORDER BY kind`);
    expect(kinds[0].values.map((v) => v[0])).toEqual(["flaky", "test-fail"]);
    const runs = real.tests!.exec(`SELECT COUNT(*) FROM runs WHERE cycle='c1' AND project='demo'`);
    expect(Number(runs[0].values[0][0])).toBe(1);
  });
});
