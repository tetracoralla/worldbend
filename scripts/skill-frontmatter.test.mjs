import assert from "node:assert/strict";
import test from "node:test";

import { skillFrontmatter } from "./skill-frontmatter.mjs";

test("reads Skill frontmatter from LF and Windows CRLF checkouts", () => {
  const lf = "---\nname: worldbend\ndescription: Transform geometry\n---\n# Worldbend\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  assert.equal(skillFrontmatter(lf), skillFrontmatter(crlf));
  assert.match(skillFrontmatter(crlf), /^name: worldbend$/m);
});

test("rejects Markdown without leading YAML frontmatter", () => {
  assert.equal(skillFrontmatter("# Worldbend\n"), null);
});
