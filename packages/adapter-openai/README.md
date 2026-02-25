# @two-layer-cake/adapter-openai

OpenAI LLM adapter for the [two-layer-cake](https://github.com/GeorgeQLe/two-layer-cake) SDK.

## Installation

```bash
npm install two-layer-cake @two-layer-cake/adapter-openai openai
```

## Configuration

```typescript
import { OpenAIAdapter } from '@two-layer-cake/adapter-openai';

const adapter = new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
  maxTokens: 4096,
});
```

### Config Options

| Option      | Type     | Default | Description                 |
| ----------- | -------- | ------- | --------------------------- |
| `apiKey`    | `string` | —       | OpenAI API key (required)   |
| `model`     | `string` | —       | Model ID (required)         |
| `maxTokens` | `number` | `4096`  | Maximum tokens per response |

## Usage

```typescript
import { Orchestrator } from 'two-layer-cake';
import { OpenAIAdapter } from '@two-layer-cake/adapter-openai';

const llm = new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

const orchestrator = new Orchestrator({
  planner: { llm, mode: 'single-shot' },
});

const result = await orchestrator.run('Summarize the latest AI research trends');
console.log(result.aggregatedOutput);
```

## Features

- Full `LLMAdapter` interface: `complete()`, `stream()`, `completeStructured()`
- Token counting via character-based estimation
- Streaming support with usage reporting
- Structured output via OpenAI's `zodResponseFormat` API

## License

MIT
