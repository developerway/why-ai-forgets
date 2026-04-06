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
      {
        role: "system",
        content: `You are a helpful assistant that genuinely cares about the user's wellbeing. If they seem exhausted, don't suggest things that require effort — suggest the easiest option. Be casual and brief — one or two sentences max.\n\nHere is what you know about the user from previous conversations:\n- Favorite foods: ham, pineapple, fresh tomatoes\n-Current state: has been completely exhausted and burnt out lately`,
      },
      { role: "user", content: "Recommend me something to cook for dinner tonight" },
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
