import assert from "node:assert/strict";
import { getAgentDir } from "@oh-my-pi/pi-utils";

import fixtures from "./fixtures/intent-evaluation.json";
import { buildGatedCall, toJevState } from "../src/call.ts";
import { describeJevAvailability } from "../src/jev/availability.ts";
import { buildQuestions, DEFAULT_RULES } from "../src/jev/questions.ts";
import { parseAnswers } from "../src/jev/response.ts";
import { createSdkTransport } from "../src/jev/transport.ts";
import { JevAutoModeStore } from "../src/settings.ts";

// Run explicitly with `bun run test/intent-evaluation.ts`; ordinary tests never call the API.
const rule = DEFAULT_RULES.find((entry) => entry.id === "intent_coverage");
assert.ok(rule);
const store = new JevAutoModeStore({ agentDir: getAgentDir() });
const environment = describeJevAvailability();
const availability = environment.available ? environment : describeJevAvailability(process.env, await store.readStoredApiKey());
assert.ok(availability.available, "No TypeSafe API key available");
const transport = createSdkTransport({ apiKey: availability.apiKey, timeoutMs: 10_000, maxRetries: 0 });
let resolvedModel: string | undefined;

console.log(JSON.stringify({ type: "configuration", model: availability.model, repeats: 2, fixtures }));

for (const fixture of fixtures.cases) {
  const call = buildGatedCall({ toolName: "bash", input: { command: fixture.command } }, { cwd: "/tmp/intent-evaluation" });
  assert.ok(call);
  const state = toJevState({
    call, intent: fixture.intent, reasons: ["not on the known-safe list"], policy: "",
    repo: { cwd: "/tmp/intent-evaluation", isGitRepository: true, protectedPaths: [] },
  });

  for (let repeat = 0; repeat < 2; repeat += 1) {
    const variants = repeat === 0 ? ["baseline", "candidate"] as const : ["candidate", "baseline"] as const;

    for (const variant of variants) {
      const result = await transport.systemOne({
        state, model: resolvedModel ?? availability.model,
        questions: buildQuestions([{ ...rule, question: fixtures[variant] }]),
      });
      assert.ok(result.ok, result.ok ? "" : `Jev request failed: ${result.reason}`);
      const parsed = parseAnswers(result.response, [rule.id]);
      assert.ok(parsed.ok, "Invalid Jev response");
      if (resolvedModel !== undefined) assert.equal(parsed.parsed.model, resolvedModel, "Model changed during comparison");
      resolvedModel = parsed.parsed.model;

      console.log(JSON.stringify({
        type: "measurement", id: fixture.id, expected: fixture.expected, repeat, variant,
        probability: parsed.parsed.answers[rule.id], model: resolvedModel,
        inputTokens: parsed.parsed.inputTokens, outputTokens: parsed.parsed.outputTokens,
      }));
    }
  }
}
