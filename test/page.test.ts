import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { openPage, PAGE_URL, type Host } from "../src/page";

describe("brain page", () => {
  it("openPage opens the page url", async () => {
    const opened: string[] = [];
    const host: Host = {
      showInformationMessage: async () => undefined,
      openExternal: async (u) => void opened.push(u),
    };
    await openPage(host);
    expect(PAGE_URL).toBe("http://leanagent.localhost:8770");
    expect(opened).toEqual(["http://leanagent.localhost:8770"]);
  });

  it("activation shows no deprecation message and stores no deprecationShownFor", () => {
    const root = path.join(__dirname, "..");
    expect(fs.existsSync(path.join(root, "src", "deprecation.ts"))).toBe(false);
    const src = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf8");
    expect(src).not.toContain("noticeOnce");
    expect(src).not.toContain("deprecation");
    expect(src).not.toContain("deprecationShownFor");
  });
});
