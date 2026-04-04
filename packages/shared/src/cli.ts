import type { Provider } from "./provider.js";

export const provider: Provider = process.argv.includes("--openai")
  ? "openai"
  : "anthropic";

export const verbose = process.argv.includes("--breakdown");
