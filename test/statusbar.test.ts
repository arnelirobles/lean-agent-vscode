import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const item = { text: "", tooltip: "", color: undefined as unknown, command: "", name: "", show() {}, dispose() {} };
vi.mock("vscode", () => ({
  window: { createStatusBarItem: () => item },
  StatusBarAlignment: { Left: 1 },
  ThemeColor: class { constructor(public id: string) {} },
}));

import { StatusBar } from "../src/views/statusBar";
import { seededDbs } from "./fixture";

describe("StatusBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads the current databases on each tick, not the ones it was given", async () => {
    const first = await seededDbs();
    const second = await seededDbs();
    second.brain!.run("DELETE FROM items WHERE kind='test-fail'");
    let current = first;
    const bar = new StatusBar();
    bar.update(() => current, [], "");
    expect(item.text).toContain("3");
    first.brain!.close();
    first.tests!.close();
    current = second;
    vi.advanceTimersByTime(5000);
    expect(item.text).toContain("$(pass) 0");
    bar.dispose();
  });

  it("shows the note in the tooltip", async () => {
    const bar = new StatusBar();
    const d = await seededDbs();
    bar.update(() => d, [], "Install lean-agent-tools to see the test queue.");
    expect(String(item.tooltip)).toContain("Install lean-agent-tools to see the test queue.");
    bar.dispose();
  });
});
