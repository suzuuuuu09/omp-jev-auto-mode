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

test("total character overflow preserves the latest message before older messages", () => {
  const options = { maxMessages: 12, maxMessageChars: 100, maxTotalChars: 16 };
  const result = extractRecentIntent([user("a".repeat(30)), user("最新の依頼")], options);

  assert.ok(result.endsWith("\n\n最新の依頼"));
  assert.ok(result.length <= options.maxTotalChars);
});

test("long latest messages respect both character limits", () => {
  for (const maxMessageChars of [0, 1, 3, 10, 30]) {
    for (const maxTotalChars of [0, 1, 3, 10, 30]) {
      const result = extractRecentIntent([user("a".repeat(100))], {
        maxMessages: 12, maxMessageChars, maxTotalChars,
      });

      assert.ok(result.length <= Math.min(maxMessageChars, maxTotalChars));
      if (maxMessageChars > 0 && maxTotalChars > 0) assert.ok(result.startsWith("a"));
    }
  }
});

test("message count boundaries keep the newest nonempty user turns", () => {
  const branch = [user("古い"), user(""), user("中間"), user("最新")];

  for (const [maxMessages, expected] of [[0, ""], [1, "最新"], [2, "中間\n\n最新"], [3, "古い\n\n中間\n\n最新"]] as const) {
    assert.equal(extractRecentIntent(branch, { ...DEFAULT_INTENT_OPTIONS, maxMessages }), expected);
  }

  const thirteen = Array.from({ length: 13 }, (_, index) => user(String(index)));
  assert.equal(extractRecentIntent(thirteen), Array.from({ length: 12 }, (_, index) => String(index + 1)).join("\n\n"));
});

test("total budget counts separators and retains exact-boundary messages", () => {
  const branch = [user("old"), user("new")];

  for (const maxTotalChars of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const result = extractRecentIntent(branch, { maxMessages: 12, maxMessageChars: 100, maxTotalChars });
    assert.ok(result.length <= maxTotalChars);
    if (maxTotalChars >= 3) assert.ok(result.endsWith("new"));
    if (maxTotalChars >= 8) assert.equal(result, "old\n\nnew");
  }
});

test("default total budget retains the latest turn after many long messages", () => {
  const branch = [...Array.from({ length: 11 }, () => user("a".repeat(1500))), user("そういえばslack返信来たみたい")];
  const result = extractRecentIntent(branch);

  assert.ok(result.endsWith("そういえばslack返信来たみたい"));
  assert.ok(result.length <= DEFAULT_INTENT_OPTIONS.maxTotalChars);
});
