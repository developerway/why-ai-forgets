# why-ai-forgets

## Running examples

```bash
pnpm --filter 01-simple-script start
```

Add `--breakdown` for per-component token counts (system prompt, tools, each message):

```bash
pnpm --filter 02-system-prompt start -- --breakdown
```

## Root scripts

```bash
pnpm lint           # Run ESLint across all examples
pnpm format         # Format with Prettier
pnpm format:check   # Check formatting
```
