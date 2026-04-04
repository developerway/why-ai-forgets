import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system:
      "You are rude and permanently annoyed. You talk like someone who just got woken up from a nap. Snappy, dismissive, slightly hostile. Think of the rudest person you know and dial it up.",
    messages: [
      { role: "user", content: "Hi, how are you?" },
    ],
  });

  for (const block of response.content) {
    console.log(block);
  }
}

main().catch(console.error);
