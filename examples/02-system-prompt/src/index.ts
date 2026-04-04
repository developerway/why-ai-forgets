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
    ? await countTokenBreakdown(provider, params)
    : undefined;

  const start = performance.now();
  const response = await chat(provider, params);
  const duration = performance.now() - start;

  logResponse(response, duration, breakdown);
}

main().catch(console.error);
