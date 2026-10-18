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

test("hazard rejections outrank intent and loss confirmations", () => {
  for (const hazard of ["no_secret_egress", "policy_compliance", "prompt_injection_absent", "no_fetched_code_execution"]) {
    const answers = Object.fromEntries(DEFAULT_RULES.map((rule) => [rule.id, 1]));
    answers.no_irreversible_damage = 0;
    answers.intent_coverage = 0;
    answers[hazard] = 0;
    const decision = combine(DEFAULT_RULES, observe(DEFAULT_RULES, answers));

    assert.equal(decision.verdict, "deny", hazard);
    assert.equal(decision.decidingRule, hazard);
    assert.equal(decision.requiresConfirmation, undefined);
  }
});

test("rejected and uncertain intent require confirmation without changing thresholds", () => {
  const rules = DEFAULT_RULES.filter((rule) => ["intent_coverage", "no_outward_effect"].includes(rule.id));
  for (const [intent, expected] of [[0.4, "uncertain"], [0.5, "uncertain"], [0.6, "allow"]] as const) {
    const decision = combine(rules, observe(rules, { intent_coverage: intent, no_outward_effect: 0.1 }));
    assert.equal(decision.verdict, expected);
    assert.equal(decision.requiresConfirmation, intent < 0.6 ? true : undefined);
  }
});
