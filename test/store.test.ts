import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../src/store";
import { brainDb, sqlJs, testsDb } from "./fixture";

const wasm = path.join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lb-store-"));

async function metaOnly(file: string) {
  const SQL = await sqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("INSERT INTO meta VALUES ('schema_version','9')");
  fs.writeFileSync(file, Buffer.from(db.export()));
}

describe("Store", () => {
  it("sets missing and a note when the file is not there", async () => {
    const store = new Store(wasm, "brain.db");
    const file = path.join(tmp(), "brain.db");
    expect(await store.refresh(file)).toBe(false);
    expect(store.missing).toBe(true);
    expect(store.note).toBe(`No brain.db database at ${file}.`);
    expect(store.database).toBeUndefined();
  });

  it("loads a brain file with items and a tests file with jobs", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "brain.db"), Buffer.from((await brainDb()).export()));
    fs.writeFileSync(path.join(dir, "tests.db"), Buffer.from((await testsDb()).export()));
    const brain = new Store(wasm, "brain.db");
    const tests = new Store(wasm, "tests.db");
    expect(await brain.refresh(path.join(dir, "brain.db"))).toBe(true);
    expect(await tests.refresh(path.join(dir, "tests.db"))).toBe(true);
    expect(brain.note).toBe("");
  });

  it("reports a file with only a meta table as could not be read and keeps the last good data", async () => {
    const dir = tmp();
    const file = path.join(dir, "brain.db");
    fs.writeFileSync(file, Buffer.from((await brainDb()).export()));
    const store = new Store(wasm, "brain.db");
    expect(await store.refresh(file)).toBe(true);
    const good = store.database;
    await metaOnly(file);
    expect(await store.refresh(file)).toBe(false);
    expect(store.note).toContain("The brain.db database could not be read");
    expect(store.note).toContain("Showing the last good data");
    expect(store.database).toBe(good);
    expect(() => good!.exec("SELECT count(*) FROM items")).not.toThrow();
  });

  it("reports a meta-only file as could not be read when there is no earlier data", async () => {
    const file = path.join(tmp(), "tests.db");
    await metaOnly(file);
    const store = new Store(wasm, "tests.db");
    expect(await store.refresh(file)).toBe(false);
    expect(store.note).toContain("The tests.db database could not be read");
    expect(store.missing).toBe(false);
    expect(store.database).toBeUndefined();
  });

  it("rejects a tests file for the brain store and a brain file for the tests store", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "brain.db"), Buffer.from((await brainDb()).export()));
    fs.writeFileSync(path.join(dir, "tests.db"), Buffer.from((await testsDb()).export()));
    const brain = new Store(wasm, "brain.db");
    const tests = new Store(wasm, "tests.db");
    expect(await brain.refresh(path.join(dir, "tests.db"))).toBe(false);
    expect(await tests.refresh(path.join(dir, "brain.db"))).toBe(false);
  });

  it("closes the database it opened when the file is not a database", async () => {
    const file = path.join(tmp(), "brain.db");
    fs.writeFileSync(file, "this is not a database, just text that is long enough to look like a header....");
    const store = new Store(wasm, "brain.db");
    await store.init();
    const real = (store as any).sql.Database;
    const closes: ReturnType<typeof vi.fn>[] = [];
    (store as any).sql = {
      Database: class extends real {
        constructor(bytes: Uint8Array) {
          super(bytes);
          const spy = vi.fn(() => (real.prototype.close as () => void).call(this));
          (this as any).close = spy;
          closes.push(spy);
        }
      },
    };
    expect(await store.refresh(file)).toBe(false);
    expect(closes.length).toBe(2);
    for (const c of closes) expect(c).toHaveBeenCalledTimes(1);
  });
});
