import { describe, expect, it, vi } from "vitest";
import { REQUIRED, checkPlugins, missingPlugins, setupCommands, type SetupHost } from "../src/setup";

const CLAUDE = "/fake/bin/claude";
const q = "'/fake/bin/claude'";

const entry = (id: string, enabled = true, scope = "user") => ({
  id, scope, enabled, projectEnabled: false, version: "1.0.0", installPath: `/fake/cache/${id}`,
  installedAt: "2026-01-01T00:00:00Z", lastUpdated: "2026-01-01T00:00:00Z", mcpServers: {},
});
const list = (...e: object[]) => JSON.stringify(e);
const all = [entry("lean-agent@lean-agent"), entry("lean-agent-tools@lean-agent-tools"), entry("brain@brain")];
const market = (...names: string[]) => JSON.stringify(names.map((name) => ({
  name, source: "github", repo: `arnelirobles/${name}`, installLocation: `/fake/marketplaces/${name}`,
})));

describe("missingPlugins", () => {
  it("finds nothing missing when all three are enabled", () => {
    expect(missingPlugins(list(...all))).toEqual([]);
  });

  it("names brain when it is not listed", () => {
    expect(missingPlugins(list(all[0], all[1])).map((p) => p.id)).toEqual(["brain@brain"]);
  });

  it("names brain when it is disabled", () => {
    expect(missingPlugins(list(all[0], all[1], entry("brain@brain", false))).map((p) => p.id)).toEqual(["brain@brain"]);
  });

  it("counts a plugin as installed when any scope entry is enabled", () => {
    const e = list(all[0], all[1], entry("brain@brain", false, "project"), entry("brain@brain", true, "user"));
    expect(missingPlugins(e)).toEqual([]);
  });

  it("ignores projectEnabled", () => {
    const off = { ...entry("brain@brain", false), projectEnabled: true };
    expect(missingPlugins(list(all[0], all[1], off)).map((p) => p.id)).toEqual(["brain@brain"]);
  });

  it("holds the three required plugins", () => {
    expect(REQUIRED).toEqual([
      { id: "lean-agent@lean-agent", marketplace: "lean-agent", repo: "arnelirobles/lean-agent" },
      { id: "lean-agent-tools@lean-agent-tools", marketplace: "lean-agent-tools", repo: "arnelirobles/lean-agent-tools" },
      { id: "brain@brain", marketplace: "brain", repo: "arnelirobles/brain" },
    ]);
  });
});

describe("setupCommands", () => {
  const brain = REQUIRED.filter((p) => p.id === "brain@brain");

  it("adds the marketplace then installs when the marketplace is not listed", () => {
    expect(setupCommands(brain, market("lean-agent"), CLAUDE)).toEqual([
      `${q} plugin marketplace add arnelirobles/brain`,
      `${q} plugin install brain@brain --scope user`,
    ]);
  });

  it("only installs when the marketplace is listed", () => {
    expect(setupCommands(brain, market("brain"), CLAUDE)).toEqual([`${q} plugin install brain@brain --scope user`]);
  });

  it("writes a quote in the path as '\\'' on posix", () => {
    expect(setupCommands(brain, market("brain"), "/o'neil/claude", "darwin")).toEqual([
      "'/o'\\''neil/claude' plugin install brain@brain --scope user",
    ]);
  });

  it("uses the call operator and single quotes with doubled quotes on win32", () => {
    expect(setupCommands(brain, market("brain"), "C:\\Program Files\\claude.exe", "win32")).toEqual([
      "& 'C:\\Program Files\\claude.exe' plugin install brain@brain --scope user",
    ]);
    expect(setupCommands(brain, market("brain"), "C:\\a'b\\claude.exe", "win32")).toEqual([
      "& 'C:\\a''b\\claude.exe' plugin install brain@brain --scope user",
    ]);
  });

  it("leaves a dollar sign and a backtick in a win32 path literal", () => {
    expect(setupCommands(brain, market("brain"), "C:\\$HOME\\`x\\claude.exe", "win32")).toEqual([
      "& 'C:\\$HOME\\`x\\claude.exe' plugin install brain@brain --scope user",
    ]);
  });

  it("falls back to bare claude when no path is given", () => {
    expect(setupCommands(brain, market("brain"))).toEqual(["claude plugin install brain@brain --scope user"]);
  });

  it("gives every command for all three with an empty marketplace list", () => {
    expect(setupCommands(REQUIRED, "[]", CLAUDE)).toHaveLength(6);
  });
});

interface Fake { host: SetupHost; ask: ReturnType<typeof vi.fn>; terminal: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>; sent: string[]; show: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> }

function fake(opts: { claude?: string | null; plugins?: string; markets?: string; pick?: string; listFail?: "code" | "throw" } = {}): Fake {
  const sent: string[] = [];
  const show = vi.fn();
  const terminal = vi.fn(() => ({ sendText: (t: string) => { sent.push(t); }, show }));
  const ask = vi.fn(async () => opts.pick);
  const copy = vi.fn(async () => {});
  const log = vi.fn();
  const run = vi.fn(async (_cmd: string, args: string[]) => {
    if (args[1] === "list" && opts.listFail === "throw") throw new Error("timed out");
    if (args[1] === "list" && opts.listFail === "code") return { code: 1, stdout: "" };
    if (args[1] === "list") return { code: 0, stdout: opts.plugins ?? list(...all) };
    return { code: 0, stdout: opts.markets ?? "[]" };
  });
  const host: SetupHost = { claude: opts.claude === null ? undefined : (opts.claude ?? "/fake/bin/claude"), run, ask, terminal, copy, log };
  return { host, ask, terminal, copy, log, sent, show, run };
}

const noBrain = list(all[0], all[1]);

describe("checkPlugins", () => {
  it("shows no notice when all three are installed", async () => {
    const f = fake();
    await checkPlugins(f.host);
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("says nothing on a manual check unless asked, and confirms when manual", async () => {
    const f = fake();
    await checkPlugins(f.host, true);
    expect(f.ask).toHaveBeenCalledWith("Lean Brain: lean-agent, lean-agent-tools and brain are installed.");
  });

  it("asks with the names and the Install and Not now buttons", async () => {
    const f = fake({ plugins: noBrain });
    await checkPlugins(f.host);
    expect(f.ask).toHaveBeenCalledWith("Lean Brain needs brain.", "Install", "Not now");
  });

  it("joins several names with a comma", async () => {
    const f = fake({ plugins: list(all[0]) });
    await checkPlugins(f.host);
    expect(f.ask).toHaveBeenCalledWith("Lean Brain needs lean-agent-tools, brain.", "Install", "Not now");
  });

  it("reads both lists with a 15 s limit", async () => {
    const f = fake({ plugins: noBrain });
    await checkPlugins(f.host);
    expect(f.run).toHaveBeenCalledWith("/fake/bin/claude", ["plugin", "list", "--json"], 15000);
    expect(f.run).toHaveBeenCalledWith("/fake/bin/claude", ["plugin", "marketplace", "list", "--json"], 15000);
  });

  it("does not make the terminal until Install is clicked", async () => {
    const f = fake({ plugins: noBrain, pick: "Not now" });
    await checkPlugins(f.host);
    expect(f.terminal).not.toHaveBeenCalled();
    expect(f.copy).not.toHaveBeenCalled();
  });

  it("Install opens Lean Brain setup, sends each command, then the restart echo", async () => {
    const f = fake({ plugins: noBrain, markets: market("lean-agent", "lean-agent-tools"), pick: "Install" });
    await checkPlugins(f.host);
    expect(f.terminal).toHaveBeenCalledWith("Lean Brain setup");
    expect(f.show).toHaveBeenCalled();
    expect(f.sent).toEqual([
      `${q} plugin marketplace add arnelirobles/brain`,
      `${q} plugin install brain@brain --scope user`,
      "echo Restart open Claude Code sessions to load the new plugins.",
    ]);
  });

  it("Not now stores nothing, so the next activation asks again", async () => {
    const f = fake({ plugins: noBrain, pick: "Not now" });
    await checkPlugins(f.host);
    await checkPlugins(f.host);
    expect(f.ask).toHaveBeenCalledTimes(2);
  });

  it("with no claude, offers Copy commands and copies every line without a terminal", async () => {
    const f = fake({ claude: null, pick: "Copy commands" });
    await checkPlugins(f.host);
    expect(f.ask).toHaveBeenCalledWith("Lean Brain needs lean-agent, lean-agent-tools, brain.", "Copy commands", "Not now");
    expect(f.run).not.toHaveBeenCalled();
    expect(f.copy).toHaveBeenCalledWith(setupCommands(REQUIRED, "[]").join("\n"));
    expect(f.terminal).not.toHaveBeenCalled();
  });

  it("with no claude, Not now copies nothing", async () => {
    const f = fake({ claude: null, pick: "Not now" });
    await checkPlugins(f.host);
    expect(f.copy).not.toHaveBeenCalled();
  });

  it("a plugin list that exits non-zero shows no notice and logs one line", async () => {
    const f = fake({ listFail: "code" });
    await checkPlugins(f.host);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls[0][0]).toContain("plugin list");
  });

  it("a plugin list that times out shows no notice and logs one line", async () => {
    const f = fake({ listFail: "throw" });
    await checkPlugins(f.host, true);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls[0][0]).toContain("plugin list");
  });

  it("plugin list output that is not JSON shows no notice and logs one line", async () => {
    const f = fake({ plugins: "not json" });
    await checkPlugins(f.host);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
  });

  it("a failing marketplace list shows no notice and logs one line naming it", async () => {
    const f = fake({ plugins: noBrain });
    f.run.mockImplementation(async (_c: string, args: string[]) =>
      args[1] === "list" ? { code: 0, stdout: noBrain } : { code: 2, stdout: "" });
    await checkPlugins(f.host);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls[0][0]).toContain("marketplace list");
  });

  it("marketplace list output that is not JSON shows no notice and logs one line", async () => {
    const f = fake({ plugins: noBrain, markets: "{{" });
    await checkPlugins(f.host);
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls[0][0]).toContain("marketplace list");
  });
});
