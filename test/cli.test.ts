import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { answerArgs, closeArgs, defaultDbPath, findBrain, findTestPhase, moveArgs, reopenArgs, resumeArgs, routeArgs, runTestPhase, testPhaseCanMove, unprefix } from "../src/brainCli";

function exe(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "#!/bin/sh\n");
  fs.chmodSync(p, 0o755);
}

describe("brain cli", () => {
  it("builds argument arrays", () => {
    expect(closeArgs(7, "fixed")).toEqual(["close", "7", "--resolution", "fixed"]);
    expect(closeArgs(7, "not-a-bug")).toEqual(["close", "7", "--wontfix", "--resolution", "not-a-bug"]);
    expect(reopenArgs(7)).toEqual(["reopen", "7"]);
    expect(resumeArgs("p")).toEqual(["resume", "--project", "p"]);
    expect(resumeArgs()).toEqual(["resume"]);
    expect(routeArgs(7, "remote")).toEqual(["queue", "route", "7", "--to", "remote"]);
    expect(routeArgs(7, "any")).toEqual(["queue", "route", "7", "--to", "any"]);
    expect(moveArgs(7, "up")).toEqual(["queue", "move", "7", "up"]);
    expect(moveArgs(7, "down")).toEqual(["queue", "move", "7", "down"]);
    expect(answerArgs(7, "use 8080\nnot 80", false)).toEqual(["close", "7", "--resolution", "answered", "--note=use 8080\nnot 80"]);
    expect(answerArgs(7, "--skip", false)).toEqual(["close", "7", "--resolution", "answered", "--note=--skip"]);
    expect(answerArgs(7, "yes", true)).toEqual(["close", "7", "--resolution", "answered", "--note=yes", "--delivered"]);
  });

  it("db path: setting, then LEAN_BRAIN_DB, then the default", () => {
    expect(defaultDbPath("/a.db", { LEAN_BRAIN_DB: "/b.db" }, "/h")).toBe("/a.db");
    expect(defaultDbPath("", { LEAN_BRAIN_DB: "/b.db" }, "/h")).toBe("/b.db");
    expect(defaultDbPath("", {}, "/h")).toBe("/h/.local/share/lean/brain.db");
  });

  it("finds brain: setting, then PATH, then the newest brain plugin in any marketplace", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const cache = path.join(home, ".claude", "plugins", "cache");
    exe(path.join(cache, "market-a", "brain", "1.9.0", "tools", "brain"));
    exe(path.join(cache, "market-b", "brain", "1.10.0", "tools", "brain"));
    exe(path.join(cache, "market-a", "brain", "1.2.0", "tools", "brain"));
    expect(findBrain("", { PATH: "" }, home)).toBe(path.join(cache, "market-b", "brain", "1.10.0", "tools", "brain"));
    const bin = path.join(home, "bin");
    exe(path.join(bin, "brain"));
    expect(findBrain("", { PATH: bin }, home)).toBe(path.join(bin, "brain"));
    const set = path.join(home, "mine");
    exe(set);
    expect(findBrain(set, { PATH: bin }, home)).toBe(set);
    expect(findBrain(path.join(home, "missing"), { PATH: bin }, home)).toBeUndefined();
    expect(findBrain("", { PATH: "" }, path.join(home, "empty"))).toBeUndefined();
  });

  it("does not find brain in the lean-agent-tools plugin any more", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const cache = path.join(home, ".claude", "plugins", "cache");
    exe(path.join(cache, "lean-agent-tools", "lean-agent-tools", "1.15.0", "tools", "brain"));
    expect(findBrain("", { PATH: "" }, home)).toBeUndefined();
  });

  it("finds test-phase: setting, then PATH, then the newest lean-agent-tools plugin", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const cache = path.join(home, ".claude", "plugins", "cache");
    exe(path.join(cache, "market-a", "lean-agent-tools", "2.9.0", "tools", "test-phase"));
    exe(path.join(cache, "market-b", "lean-agent-tools", "2.10.0", "tools", "test-phase"));
    exe(path.join(cache, "market-a", "lean-agent-tools", "2.2.0", "tools", "test-phase"));
    expect(findTestPhase("", { PATH: "" }, home)).toBe(path.join(cache, "market-b", "lean-agent-tools", "2.10.0", "tools", "test-phase"));
    const bin = path.join(home, "bin");
    exe(path.join(bin, "test-phase"));
    expect(findTestPhase("", { PATH: bin }, home)).toBe(path.join(bin, "test-phase"));
    const set = path.join(home, "mine");
    exe(set);
    expect(findTestPhase(set, { PATH: bin }, home)).toBe(set);
    expect(findTestPhase(path.join(home, "missing"), { PATH: bin }, home)).toBeUndefined();
    expect(findTestPhase("", { PATH: "" }, path.join(home, "empty"))).toBeUndefined();
  });

  it("knows whether test-phase has queue move from its queue help", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const help = (name: string, cmds: string) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, `#!/bin/sh\n[ "$1 $2" = "queue --help" ] && echo "usage: test-phase queue [-h] {${cmds}} ..."\n`);
      fs.chmodSync(p, 0o755);
      return p;
    };
    expect(await testPhaseCanMove(help("new", "add,list,cancel,bump,move,next"))).toBe(true);
    expect(await testPhaseCanMove(help("old", "add,list,cancel,bump,next,route"))).toBe(false);
    expect(await testPhaseCanMove(path.join(dir, "missing"))).toBe(false);
  });

  it("runs queue move and route through test-phase with LEAN_TESTS_DB set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const tp = path.join(dir, "test-phase");
    fs.writeFileSync(tp, '#!/bin/sh\necho "$@ db=$LEAN_TESTS_DB"\n');
    fs.chmodSync(tp, 0o755);
    const move = await runTestPhase(tp, moveArgs(7, "up"), "/t/tests.db");
    expect(move.ok).toBe(true);
    expect(move.stdout.trim()).toBe("queue move 7 up db=/t/tests.db");
    const route = await runTestPhase(tp, routeArgs(7, "remote"), "/t/tests.db");
    expect(route.stdout.trim()).toBe("queue route 7 --to remote db=/t/tests.db");
    const missing = await runTestPhase(path.join(dir, "missing"), ["queue"], "/t/tests.db");
    expect(missing.ok).toBe(false);
  });

  it("passes LEAN_BRAIN_DB to test-phase when given a brain db path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const tp = path.join(dir, "test-phase");
    fs.writeFileSync(tp, '#!/bin/sh\necho "brain=$LEAN_BRAIN_DB tests=$LEAN_TESTS_DB"\n');
    fs.chmodSync(tp, 0o755);
    const r = await runTestPhase(tp, ["queue"], "/t/tests.db", undefined, "/t/brain.db");
    expect(r.stdout.trim()).toBe("brain=/t/brain.db tests=/t/tests.db");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "extension.ts"), "utf8");
    expect(src.match(/cli\.runTestPhase\([^\n]*dbPath\(\)/g)?.length).toBe(2);
  });

  it("skips relative PATH entries when looking for a tool", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
    const cwd = process.cwd();
    const rel = fs.mkdtempSync(path.join(os.tmpdir(), "lb-rel-"));
    exe(path.join(rel, "bin", "brain"));
    exe(path.join(rel, "bin", "test-phase"));
    try {
      process.chdir(rel);
      expect(findBrain("", { PATH: "bin" }, home)).toBeUndefined();
      expect(findTestPhase("", { PATH: `.${path.delimiter}bin` }, home)).toBeUndefined();
      const abs = path.join(rel, "bin");
      expect(findBrain("", { PATH: `bin${path.delimiter}${abs}` }, home)).toBe(path.join(abs, "brain"));
    } finally {
      process.chdir(cwd);
    }
  });

  it("the extension sends move and route to test-phase, not brain", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "extension.ts"), "utf8");
    const body = (name: string) => src.slice(src.indexOf(`async function ${name}(`)).split(/\n  }\n/)[0];
    for (const fn of ["routeJob", "moveJob"]) {
      expect(body(fn)).toContain("cli.runTestPhase(");
      expect(body(fn)).not.toContain("runBrain");
    }
    expect(src).not.toContain("brainCanMove");
  });

  it("refresh catches a failing view update and logs it, and the status bar gets the getter", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "extension.ts"), "utf8");
    const body = src.slice(src.indexOf("const refresh = async"), src.indexOf("const claude = new ClaudeTerminal"));
    expect(body).toMatch(/try \{[\s\S]*status\.update\([\s\S]*\} catch \(e\) \{[\s\S]*log\.appendLine/);
    expect(body).toContain("status.update(dbs,");
  });

  it("strips one leading test-phase: so the caller's own prefix shows once", () => {
    expect(unprefix("test-phase: x")).toBe("x");
    expect(unprefix("x")).toBe("x");
    expect(unprefix("test-phase: test-phase: x")).toBe("test-phase: x");
    expect(`test-phase: ${unprefix("test-phase: brain.db still has 2 queued jobs\n")}`).toBe("test-phase: brain.db still has 2 queued jobs");
  });
});
