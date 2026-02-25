# @two-layer-cake/adapter-claude

Claude (Anthropic) LLM adapter for the [two-layer-cake](https://github.com/GeorgeQLe/two-layer-cake) SDK.

## Installation

```bash
npm install two-layer-cake @two-layer-cake/adapter-claude @anthropic-ai/sdk
```

## Configuration

```typescript
import { ClaudeAdapter } from '@two-layer-cake/adapter-claude';

const adapter = new ClaudeAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
});
```

### Config Options

| Option      | Type     | Default | Description                  |
| ----------- | -------- | ------- | ---------------------------- |
| `apiKey`    | `string` | —       | Anthropic API key (required) |
| `model`     | `string` | —       | Model ID (required)          |
| `maxTokens` | `number` | `4096`  | Maximum tokens per response  |

## Usage

```typescript
import { Orchestrator } from 'two-layer-cake';
import { ClaudeAdapter } from '@two-layer-cake/adapter-claude';

const llm = new ClaudeAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',
});

const orchestrator = new Orchestrator({
  planner: { llm, mode: 'single-shot' },
});

const result = await orchestrator.run('Analyze the pros and cons of TypeScript');
console.log(result.aggregatedOutput);
```

## Features

- Full `LLMAdapter` interface: `complete()`, `stream()`, `completeStructured()`
- Token counting via `countTokens()` (uses Anthropic SDK when available)
- Streaming support with token usage reporting
- Structured output via Anthropic's tool-use API with Zod schema validation

## License

MIT
