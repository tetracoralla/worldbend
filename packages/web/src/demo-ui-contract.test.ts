import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");

describe("Web demo product boundary", () => {
  it("keeps developer output behind one icon-only expert disclosure", () => {
    const disclosureStart = html.indexOf('<button id="developer-toggle"');
    const disclosureEnd = html.indexOf("</aside>", disclosureStart);
    const disclosure = html.slice(disclosureStart, disclosureEnd);

    expect(disclosureStart).toBeGreaterThan(-1);
    expect(disclosure).toContain('aria-label="Developer mode"');
    expect(disclosure).toContain('aria-expanded="false"');
    expect(disclosure).toContain('aria-controls="developer-output"');
    expect(disclosure).toContain('data-icon-id="icon-park:code"');
    expect(disclosure).not.toContain(">Code<");
    expect(disclosure).toContain('aria-label="Developer output"');
    expect(disclosure).toContain('id="developer-output"');
    expect(disclosure).toContain("hidden");
  });
});
