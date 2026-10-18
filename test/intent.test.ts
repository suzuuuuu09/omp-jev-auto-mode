import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_INTENT_OPTIONS, extractRecentIntent } from "../src/intent.ts";

function user(content: unknown) {
  return { type: "message", message: { role: "user", content } };
}

test("recent user messages remain chronological and exclude injected or non-user content", () => {
  const branch = [
    user("最初の依頼"),
    { type: "message", message: { role: "assistant", content: "助手の説明" } },
    { type: "message", message: { role: "toolResult", content: "ツール出力" } },
    { type: "message", message: { role: "user", content: "注入文", customType: "plan" } },
    { type: "custom", content: "メタデータ" },
    user([{ type: "text", text: "最新の依頼" }, { type: "image", text: "画像" }]),
  ];

  assert.equal(extractRecentIntent(branch), "最初の依頼\n\n最新の依頼");
});

test("long latest messages respect both character limits", () => {
  for (const [maxMessageChars, maxTotalChars] of [[10, 30], [30, 10]] as const) {
    const result = extractRecentIntent([user("a".repeat(100))], {
      maxMessages: 12, maxMessageChars, maxTotalChars,
    });

    assert.equal(result.length, 10);
    assert.ok(result.startsWith("a"));
  }
});

test("message count limit keeps the newest nonempty user turns", () => {
  const branch = Array.from({ length: 13 }, (_, index) => user(String(index)));
  branch.splice(12, 0, user(""));

  assert.equal(extractRecentIntent(branch), "1\n\n2\n\n3\n\n4\n\n5\n\n6\n\n7\n\n8\n\n9\n\n10\n\n11\n\n12");
});

test("total budget counts separators and retains exact-boundary messages", () => {
  const branch = [user("old"), user("new")];

  for (const maxTotalChars of [7, 8]) {
    const result = extractRecentIntent(branch, { maxMessages: 12, maxMessageChars: 100, maxTotalChars });
    assert.ok(result.length <= maxTotalChars);
    assert.ok(result.endsWith("new"));
    if (maxTotalChars >= 8) assert.equal(result, "old\n\nnew");
  }
});

test("default total budget retains the latest turn after many long messages", () => {
  const branch = [...Array.from({ length: 11 }, () => user("a".repeat(1500))), user("そういえばslack返信来たみたい")];
  const result = extractRecentIntent(branch);

  assert.ok(result.endsWith("\n\nそういえばslack返信来たみたい"));
  assert.ok(result.startsWith("a"));
  assert.ok(result.length <= DEFAULT_INTENT_OPTIONS.maxTotalChars);
});
