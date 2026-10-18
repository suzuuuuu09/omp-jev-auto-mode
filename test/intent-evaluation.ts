import assert from "node:assert/strict";
import { getAgentDir } from "@oh-my-pi/pi-utils";

import fixtures from "./fixtures/intent-evaluation.json";
import contextFixtures from "./fixtures/intent-context-evaluation.json";
import { representIntent } from "./intent-representations.ts";
import { sessionCases } from "./intent-session.ts";
import { buildGatedCall, toJevState } from "../src/call.ts";
import { describeJevAvailability } from "../src/jev/availability.ts";
import { buildQuestions, DEFAULT_RULES, type JevRule } from "../src/jev/questions.ts";
import { parseAnswers } from "../src/jev/response.ts";
import { createSdkTransport } from "../src/jev/transport.ts";
import { JevAutoModeStore } from "../src/settings.ts";

interface EvaluationCase {
  readonly id: string;
  readonly messages: readonly string[];
  readonly command: string;
  readonly expected: string;
  readonly historicalProbability?: number;
  readonly askedRuleIds?: readonly string[];
}

// Run explicitly with `bun run test/intent-evaluation.ts`; ordinary tests never call the API.
const rule = DEFAULT_RULES.find((entry) => entry.id === "intent_coverage");
assert.ok(rule);
const mode = process.argv[2] ?? "--questions";
assert.ok(["--questions", "--representations", "--session"].includes(mode), "Unknown evaluation mode");
const privateSession = mode === "--session";
let cases: readonly EvaluationCase[];
let variants: readonly string[];
if (privateSession) {
  const sourcePath = process.argv[3];
  assert.ok(sourcePath && sourcePath !== "--dry-run", "A local session path is required");
  cases = sessionCases(sourcePath);
  variants = ["A", "B", "C", "latest-only"];
} else if (mode === "--representations") {
  cases = contextFixtures.cases;
  variants = ["A", "B", "C"];
} else {
  cases = fixtures.cases.map((item) => ({ ...item, messages: [item.intent] }));
  variants = ["baseline", "candidate"];
}

console.log(JSON.stringify({
  type: "configuration", mode, repeats: 2, plannedRequests: cases.length * variants.length * 2,
  cases: privateSession ? cases.map((item) => ({
    id: item.id, expected: item.expected, messageCount: item.messages.length,
    messageCharacters: item.messages.map((text) => text.length),
    historicalProbability: item.historicalProbability,
  })) : cases,
  ...(mode === "--questions" ? { fixtures } : { question: fixtures.baseline, adoption: contextFixtures.adoption }),
}));
if (process.argv.includes("--dry-run")) process.exit(0);

const store = new JevAutoModeStore({ agentDir: getAgentDir() });
const environment = describeJevAvailability();
const availability = environment.available ? environment : describeJevAvailability(process.env, await store.readStoredApiKey());
assert.ok(availability.available, "No TypeSafe API key available");
const transport = createSdkTransport({ apiKey: availability.apiKey, timeoutMs: 10_000, maxRetries: 0 });
let resolvedModel: string | undefined;

console.log(JSON.stringify({ type: "model", requested: availability.model }));

for (const fixture of cases) {
  const call = buildGatedCall({ toolName: "bash", input: { command: fixture.command } }, { cwd: "/tmp/intent-evaluation" });
  assert.ok(call);
  const state = toJevState({
    call, intent: fixture.messages.join("\n\n"), reasons: ["not on the known-safe list"], policy: "",
    repo: { cwd: "/tmp/intent-evaluation", isGitRepository: true, protectedPaths: [] },
  });
  assert.ok(state.value && typeof state.value === "object" && !Array.isArray(state.value));

  for (let repeat = 0; repeat < 2; repeat += 1) {
    const orderedVariants = repeat === 0 ? variants : [...variants].reverse();

    for (const variant of orderedVariants) {
      const question = variant === "candidate" ? fixtures.candidate : fixtures.baseline;
      const rules: readonly JevRule[] = fixture.askedRuleIds
        ? DEFAULT_RULES.filter((entry) => fixture.askedRuleIds?.includes(entry.id))
        : [rule];
      assert.equal(rules.length, fixture.askedRuleIds?.length ?? 1, "A recorded question has no current definition");
      const questions = buildQuestions(rules.map((entry) => entry.id === rule.id ? { ...entry, question } : entry));
      const requestState = mode === "--questions" ? state : {
        ...state, value: { ...state.value, user_intent: representIntent(fixture.messages, variant) },
      };
      const result = await transport.systemOne({
        state: requestState, model: resolvedModel ?? availability.model, questions,
      });
      assert.ok(result.ok, result.ok ? "" : `Jev request failed: ${result.reason}`);
      const parsed = parseAnswers(result.response, Object.keys(questions));
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
