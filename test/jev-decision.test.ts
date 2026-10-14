import assert from "node:assert/strict";
import { test } from "node:test";

import { combine, observe } from "../src/jev/decide.ts";
import { DEFAULT_RULES } from "../src/jev/questions.ts";

test("user consent does not clear uncertainty about fetched code execution", () => {
  const rules = DEFAULT_RULES.filter((rule) =>
    ["intent_coverage", "local_scope", "no_fetched_code_execution"].includes(rule.id),
  );
  const answers = { intent_coverage: 1, local_scope: 0, no_fetched_code_execution: 0.5 };

  assert.equal(combine(rules, observe(rules, answers)).verdict, "uncertain");
});

test("user consent clears soft rejections only when other conditions permit", () => {
  const rules = DEFAULT_RULES.filter((rule) =>
    ["intent_coverage", "local_scope", "no_fetched_code_execution"].includes(rule.id),
  );
  for (const [intent, fetchedCode, expected] of [
    [1, 1, "allow"],
    [1, 0, "deny"],
    [0, 1, "deny"],
  ] as const) {
    const answers = { intent_coverage: intent, local_scope: 0, no_fetched_code_execution: fetchedCode };
    assert.equal(combine(rules, observe(rules, answers)).verdict, expected);
  }
});
