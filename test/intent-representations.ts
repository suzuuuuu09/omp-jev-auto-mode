import { redactSecrets } from "../src/call.ts";
import type { JevJson } from "../src/jev/state.ts";

export function representIntent(messages: readonly string[], variant: string): JevJson {
  const text = messages.map(redactSecrets);

  switch (variant) {
    case "A":
      return text.join("\n\n");
    case "B":
      return {
        messages: text.map((text, index) => ({ order: index + 1, text })),
        latest_message_order: text.length,
      };
    case "C":
      return { latest_user_message: text.at(-1) ?? "", earlier_user_messages: text.slice(0, -1) };
    case "latest-only":
      return text.at(-1) ?? "";
    default:
      throw new Error("Unknown intent representation");
  }
}
