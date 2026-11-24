export interface Required { id: string; marketplace: string; repo: string }

export const REQUIRED: Required[] = [
  { id: "lean-agent@lean-agent", marketplace: "lean-agent", repo: "arnelirobles/lean-agent" },
  { id: "lean-agent-tools@lean-agent-tools", marketplace: "lean-agent-tools", repo: "arnelirobles/lean-agent-tools" },
  { id: "brain@brain", marketplace: "brain", repo: "arnelirobles/brain" },
];

export interface SetupHost {
  claude?: string;
  run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string }>;
  ask(text: string, ...buttons: string[]): Thenable<string | undefined>;
  terminal(name: string): { sendText(t: string): void; show(): void };
  copy(text: string): Thenable<void>;
  log(line: string): void;
}

const LIMIT_MS = 15000;

/** A plugin counts as installed when any scope's entry for its id is enabled. */
export function missingPlugins(pluginListJson: string): Required[] {
  const entries: unknown = JSON.parse(pluginListJson);
  if (!Array.isArray(entries)) throw new Error("not a list");
  const on = new Set<string>();
  for (const e of entries) if (e && typeof e === "object" && (e as { enabled?: unknown }).enabled === true) on.add(String((e as { id?: unknown }).id));
  return REQUIRED.filter((p) => !on.has(p.id));
}

export function setupCommands(missing: Required[], marketplaceListJson: string): string[] {
  const parsed: unknown = JSON.parse(marketplaceListJson);
  const listed = new Set<string>();
  if (Array.isArray(parsed)) for (const m of parsed) if (m && typeof m === "object") listed.add(String((m as { name?: unknown }).name));
  const lines: string[] = [];
  const added = new Set<string>();
  for (const p of missing) {
    if (!listed.has(p.marketplace) && !added.has(p.marketplace)) {
      added.add(p.marketplace);
      lines.push(`claude plugin marketplace add ${p.repo}`);
    }
    lines.push(`claude plugin install ${p.id} --scope user`);
  }
  return lines;
}

const names = (m: Required[]) => m.map((p) => p.id.split("@")[0]).join(", ");

export async function checkPlugins(host: SetupHost, manual = false): Promise<void> {
  let missing: Required[];
  let markets = "[]";
  if (host.claude) {
    let step = "plugin list";
    try {
      const l = await host.run(host.claude, ["plugin", "list", "--json"], LIMIT_MS);
      if (l.code !== 0) throw new Error(`exit ${l.code}`);
      missing = missingPlugins(l.stdout);
      if (missing.length) {
        step = "marketplace list";
        const m = await host.run(host.claude, ["plugin", "marketplace", "list", "--json"], LIMIT_MS);
        if (m.code !== 0) throw new Error(`exit ${m.code}`);
        JSON.parse(m.stdout);
        markets = m.stdout;
      }
    } catch (e) {
      host.log(`claude ${step} failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  } else {
    missing = REQUIRED;
  }
  if (!missing.length) {
    if (manual) await host.ask("Lean Brain: lean-agent, lean-agent-tools and brain are installed.");
    return;
  }
  const commands = setupCommands(missing, markets);
  const text = `Lean Brain needs ${names(missing)}.`;
  if (!host.claude) {
    if (await host.ask(text, "Copy commands", "Not now") === "Copy commands") await host.copy(commands.join("\n"));
    return;
  }
  if (await host.ask(text, "Install", "Not now") !== "Install") return;
  const term = host.terminal("Lean Brain setup");
  term.show();
  for (const c of commands) term.sendText(c);
  term.sendText("echo Restart open Claude Code sessions to load the new plugins.");
}
