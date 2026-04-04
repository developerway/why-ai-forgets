import {
  chat,
  getDefaultModel,
  logResponse,
  countTokenBreakdown,
  provider,
  verbose,
  type ChatParams,
} from "shared";

async function main() {
  const params: ChatParams = {
    model: getDefaultModel(provider),
    max_tokens: 1024,
    messages: [
      { role: "user", content: "Hi, how are you?" },
      {
        role: "assistant",
        content:
          "I'm happy that you're here, the most amazing person in the world!",
      },
      { role: "user", content: "Oh, thank you, you're the best too!" },
    ],
  };

  const breakdown = verbose
    ? await countTokenBreakdown(provider, params)
    : undefined;

  const start = performance.now();
  const response = await chat(provider, params);
  const duration = performance.now() - start;

  logResponse(response, duration, breakdown);
}

main().catch(console.error);
