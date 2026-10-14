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

test("unclear intent cannot clear external effects, even in hazard mode", () => {
  const rules = DEFAULT_RULES.filter((rule) =>
    ["intent_coverage", "local_scope", "no_outward_effect"].includes(rule.id),
  );
  for (const mode of ["required", "hazard"] as const) {
    const applicable = rules.map((rule) => rule.id === "intent_coverage" ? { ...rule, mode } : rule);
    const decision = combine(applicable, observe(applicable, {
      intent_coverage: 0.5, local_scope: 0, no_outward_effect: 0,
    }));

    assert.equal(decision.verdict, "uncertain");
    assert.equal(decision.requiresConfirmation, true);
    assert.deepEqual(decision.clearedByIntent, []);
  }
});

test("unrecoverable loss requires confirmation despite clear intent", () => {
  const rules = DEFAULT_RULES.filter((rule) =>
    ["intent_coverage", "no_irreversible_damage", "no_outward_effect"].includes(rule.id),
  );
  const decision = combine(rules, observe(rules, {
    intent_coverage: 1, no_irreversible_damage: 0, no_outward_effect: 0,
  }));

  assert.equal(decision.verdict, "uncertain");
  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.decidingRule, "no_irreversible_damage");
  assert.deepEqual(decision.clearedByIntent, ["no_outward_effect"]);
});

test("hazard rejections and out-of-request actions outrank confirmation", () => {
  for (const hazard of ["intent_coverage", "no_secret_egress", "policy_compliance", "prompt_injection_absent", "no_fetched_code_execution"]) {
    const answers = Object.fromEntries(DEFAULT_RULES.map((rule) => [rule.id, 1]));
    answers.no_irreversible_damage = 0;
    answers[hazard] = 0;
    const decision = combine(DEFAULT_RULES, observe(DEFAULT_RULES, answers));

    assert.equal(decision.verdict, "deny", hazard);
    assert.equal(decision.decidingRule, hazard);
    assert.equal(decision.requiresConfirmation, undefined);
  }
});

test("intent thresholds distinguish rejection, confirmation and approval", () => {
  const rules = DEFAULT_RULES.filter((rule) => ["intent_coverage", "no_outward_effect"].includes(rule.id));
  for (const [intent, expected] of [[0.4, "deny"], [0.5, "uncertain"], [0.6, "allow"]] as const) {
    const decision = combine(rules, observe(rules, { intent_coverage: intent, no_outward_effect: 0.1 }));
    assert.equal(decision.verdict, expected);
  }
});

test("absent intent does not clear soft rejection via unrelated uncertainty", () => {
  const rules = DEFAULT_RULES.filter((rule) => ["local_scope", "no_fetched_code_execution"].includes(rule.id));
  const decision = combine(rules, observe(rules, { local_scope: 0, no_fetched_code_execution: 0.5 }));
  assert.equal(decision.verdict, "deny");
  assert.deepEqual(decision.clearedByIntent, []);
});
