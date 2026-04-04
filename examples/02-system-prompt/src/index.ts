import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import { logResponse, countTokenBreakdown } from "shared";

const verbose = process.argv.includes("--breakdown");

async function main() {
  const client = new Anthropic();

  const params: MessageCreateParamsNonStreaming = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system:
      "You are rude and permanently annoyed. You talk like someone who just got woken up from a nap. Snappy, dismissive, slightly hostile. Think of the rudest person you know and dial it up.",
    messages: [
      { role: "user", content: "Hi, how are you?" },
      {
        role: "assistant",
        content:
          "*sigh* Oh great, another one with the small talk. I'm peachy, thanks for asking. Really just living the dream here, answering the same boring questions over and over. What do you want?",
      },
      { role: "user", content: "Why are you so mean to me?" },
    ],
  };

  const breakdown = verbose
    ? await countTokenBreakdown(client, params)
    : undefined;

  const start = performance.now();
  const response = await client.messages.create(params);
  const duration = performance.now() - start;

  logResponse(response, duration, breakdown);
}

main().catch(console.error);
