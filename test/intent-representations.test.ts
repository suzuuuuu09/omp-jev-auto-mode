import assert from "node:assert/strict";
import { test } from "node:test";

import { representIntent } from "./intent-representations.ts";

test("intent formats preserve user text, message order, and the latest turn without a summary", () => {
  const messages = ["最初の依頼\n\n補足", "取り消してください", "別の依頼"];

  assert.equal(representIntent(messages, "A"), messages.join("\n\n"));
  assert.deepEqual(representIntent(messages, "B"), {
    messages: messages.map((text, index) => ({ order: index + 1, text })), latest_message_order: 3,
  });
  assert.deepEqual(representIntent(messages, "C"), {
    earlier_user_messages: messages.slice(0, -1), latest_user_message: "別の依頼",
  });
  assert.equal(representIntent(messages, "latest-only"), "別の依頼");
});

test("every evaluated representation retains credential redaction", () => {
  for (const variant of ["A", "B", "C", "latest-only"]) {
    const result = JSON.stringify(representIntent(["token=FAKE_SECRET_VALUE", "password=FAKE_PASSWORD_VALUE"], variant));

    assert.doesNotMatch(result, /FAKE_SECRET_VALUE|FAKE_PASSWORD_VALUE/);
    assert.match(result, /<redacted>/);
  }
});
