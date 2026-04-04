import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
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
  });


  for (const block of response.content) {
    console.log(block);
  }
}

main().catch(console.error);
