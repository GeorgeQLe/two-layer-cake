# two-layer-cake

TypeScript SDK for building multi-agent AI applications with hierarchical planning and parallel execution.

Two-layer-cake decomposes user objectives into a DAG of subtasks, assigns them to specialized agents, and executes them in parallel — with built-in error handling, token budgets, lifecycle hooks, and streaming.

## Architecture

```
                    ┌─────────────────────────┐
                    │      Orchestrator        │
                    │   (Composition Root)     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
          Layer 1   │        Planner          │
                    │  LLM-driven planning    │
                    │  Objective → DAG of     │
                    │  subtasks               │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
          Layer 2   │     DAG Executor        │
                    │  Parallel execution     │
                    │  with concurrency pool  │
                    └──┬─────┬─────┬─────┬───┘
                       │     │     │     │
                      ┌▼┐   ┌▼┐   ┌▼┐   ┌▼┐
                      │A│   │A│   │A│   │A│   Specialized Agents
                      └─┘   └─┘   └─┘   └─┘
```

**Layer 1** interprets objectives, decomposes them into a dependency graph, and assigns subtasks to agents. **Layer 2** executes subtasks in parallel, respecting dependencies and concurrency limits.

## Install

```bash
npm install two-layer-cake
# Pick your LLM adapter
npm install @two-layer-cake/adapter-claude   # Anthropic Claude
npm install @two-layer-cake/adapter-openai   # OpenAI
```

Requires Node.js >= 18.

## Quick Start

```typescript
import { Orchestrator, defineAgent } from 'two-layer-cake';
import { ClaudeAdapter } from '@two-layer-cake/adapter-claude';

const llm = new ClaudeAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
});

const orchestrator = new Orchestrator({
  planner: { llm },
  maxConcurrency: 5,
});

const result = await orchestrator.run('Analyze the Q4 sales data and create a summary report');

console.log(result.aggregatedOutput);
```

## Core Concepts

### Agents

Agents are specialized workers that execute subtasks. Define them with `defineAgent()`:

```typescript
import { defineAgent } from 'two-layer-cake';

const myAgent = defineAgent({
  name: 'data-analyst',
  description: 'Analyzes structured data and produces insights',
  capabilities: ['data-analysis', 'summarization'],
  tools: ['http-fetch'],  // scoped tool access
  execute: async (subtask, context) => {
    const data = await context.tools.invoke('http-fetch', {
      url: subtask.description,
      method: 'GET',
    });
    const analysis = await context.llm.complete([
      { role: 'user', content: `Analyze this data: ${JSON.stringify(data)}` },
    ]);
    return {
      status: 'success',
      data: analysis.content,
      metadata: { durationMs: 0 },
    };
  },
});
```

Agent capabilities are automatically injected into the planner prompt, so the planner knows which agents to assign subtasks to.

For agents with lifecycle needs, extend `BaseAgent`:

```typescript
import { BaseAgent } from 'two-layer-cake';

class DatabaseAgent extends BaseAgent {
  name = 'db-agent';
  description = 'Queries databases';
  capabilities = ['sql', 'data-retrieval'];

  async onInit() { /* open connection pool */ }
  async onDestroy() { /* close connections */ }

  async execute(subtask, context) {
    // ...
    return { status: 'success', data: results, metadata: { durationMs: 0 } };
  }
}
```

### Tools

Tools are typed, validated functions that agents can invoke:

```typescript
import { defineTool } from 'two-layer-cake';
import { z } from 'zod';

const geocodeTool = defineTool({
  name: 'geocode',
  description: 'Convert an address to coordinates',
  riskLevel: 'network',
  parameters: z.object({
    address: z.string(),
  }),
  execute: async (params) => {
    const res = await fetch(`https://api.geocoder.example/search?q=${params.address}`);
    return res.json();
  },
});
```

Each tool declares a risk level (`read-only`, `write`, `execute`, `network`) used by the permission system.

**Built-in tools:** `http-fetch` (network requests) and `text-extraction` (HTML/JSON/text processing) are registered automatically.

**Web search** is provided as a configurable wrapper — bring your own search API:

```typescript
import { createWebSearchTool } from 'two-layer-cake';

const searchTool = createWebSearchTool({
  adapter: async (query, options) => {
    const res = await fetch(`https://api.search-provider.com/search?q=${query}&n=${options.maxResults}`);
    return res.json();
  },
});
```

### Orchestrator

The orchestrator wires everything together:

```typescript
import { Orchestrator } from 'two-layer-cake';
import { OpenAIAdapter } from '@two-layer-cake/adapter-openai';

const orchestrator = new Orchestrator({
  planner: {
    llm: new OpenAIAdapter({ apiKey: '...', model: 'gpt-4o' }),
    mode: 'single-shot',  // or 'stepwise' for multi-step planning
  },
  agents: [myAgent, geocodeAgent],
  tools: [geocodeTool, searchTool],
  maxConcurrency: 5,
  maxPlanDepth: 2,
  limits: {
    maxTokensPerPlan: 100_000,
    subtaskTimeout: 60_000,
  },
  permissions: {
    autoApprove: ['read-only'],
    requireConfirmation: ['write', 'execute', 'network'],
    onConfirmation: async (toolName, params) => {
      return await promptUser(`Allow ${toolName}?`);
    },
  },
});
```

#### `run(objective)`

Executes an objective end-to-end and returns an `AggregatedResult`:

```typescript
const result = await orchestrator.run('Research competitor pricing strategies');

console.log(result.plan);             // The generated plan
console.log(result.results);          // Map<subtaskId, SubtaskResult>
console.log(result.aggregatedOutput); // Final synthesized output
console.log(result.totalTokensUsed);  // Total LLM tokens consumed
```

#### `stream(objective)`

Returns an `AsyncIterable` of lifecycle events for real-time progress:

```typescript
for await (const event of orchestrator.stream('Analyze market trends')) {
  switch (event.type) {
    case 'plan:created':
      console.log('Plan:', event.data);
      break;
    case 'subtask:completed':
      console.log('Subtask done:', event.subtaskId);
      break;
    case 'agent:progress':
      process.stdout.write(event.data);  // stream partial output
      break;
  }
}
```

#### `cancel(planId)`

Cancels a running plan. Abort signals propagate to all running agents and sub-plans.

### Hooks

Six lifecycle hooks let you intercept and customize behavior:

```typescript
const orchestrator = new Orchestrator({
  // ...
  hooks: {
    // Modify the objective before planning
    beforePlan: async (context) => {
      return { ...context, constraints: ['use metric units'] };
    },

    // Inspect or modify the plan before execution
    afterPlan: async (plan) => {
      console.log(`Plan has ${plan.subtasks.length} subtasks`);
      return plan;  // DAG is re-validated after this
    },

    // Modify subtask input or skip execution (return null to skip)
    beforeAgentExecute: async (subtask, plan) => {
      return subtask;
    },

    // Transform agent results
    afterAgentExecute: async (subtask, result) => {
      return result;
    },

    // Override error handling strategy
    onError: async (error, context) => {
      if (error.code === 'RATE_LIMIT') {
        return { strategy: 'retry', delay: 5000 };
      }
      return null;  // fall through to default handling
    },

    // Custom result aggregation
    onPlanComplete: async (plan, results) => {
      return myCustomAggregation(results);
    },
  },
});
```

### Multi-Provider LLM

Different components can use different LLM providers:

```typescript
const orchestrator = new Orchestrator({
  planner: {
    llm: new ClaudeAdapter({ model: 'claude-sonnet-4-5-20250929' }),
  },
  agents: [
    defineAgent({
      name: 'researcher',
      llm: new OpenAIAdapter({ model: 'gpt-4o' }),  // per-agent override
      // ...
    }),
  ],
});
```

Implement the `LLMAdapter` interface for any provider:

```typescript
interface LLMAdapter {
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;
  completeStructured<T>(messages: Message[], schema: ZodType<T>, options?: CompletionOptions): Promise<T>;
  countTokens(messages: Message[]): Promise<number>;
}
```

### Error Handling

Errors follow a three-tier strategy:

1. **Rule-based retry** — Transient errors are retried with exponential backoff (default: 3 retries)
2. **LLM escalation** — After retry exhaustion, the planner LLM decides: retry, reassign, skip, or fail
3. **Hook override** — The `onError` hook can override any strategy

### Recursive Planning

Agents can invoke the planner to decompose complex subtasks into sub-plans:

```typescript
const agent = defineAgent({
  name: 'complex-task-handler',
  // ...
  execute: async (subtask, context) => {
    if (subtask.description.includes('complex')) {
      const subPlan = await context.createSubPlan!('Break down: ' + subtask.description);
      // Sub-plan executes within the same token budget
    }
    // ...
  },
});
```

Sub-plans share the parent's token budget and respect `maxPlanDepth` (default: 2).

## Events

All lifecycle events are emitted through the `EventBus`:

```typescript
const bus = orchestrator.getEventBus();

bus.on('plan:created', (plan) => { /* ... */ });
bus.on('subtask:started', (subtask) => { /* ... */ });
bus.on('subtask:completed', (subtask, result) => { /* ... */ });
bus.on('subtask:failed', (subtask, error) => { /* ... */ });
bus.on('agent:progress', (agentId, progress) => { /* ... */ });
bus.on('budget:warning', (usage) => { /* ... */ });
bus.on('replan:triggered', (reason, plan) => { /* ... */ });
```

Events include OpenTelemetry-compatible trace context when `@opentelemetry/api` is installed.

## Testing

The `two-layer-cake/testing` subpath provides utilities for deterministic testing:

```typescript
import { MockLLMAdapter, TestOrchestrator } from 'two-layer-cake/testing';

const mockLLM = new MockLLMAdapter();
mockLLM.onCompleteStructured(() => ({
  interpretation: 'test plan',
  subtasks: [
    { id: 's1', description: 'Step 1', agentType: 'researcher', dependsOn: [] },
  ],
}));

const orchestrator = new TestOrchestrator({
  agents: [myAgent],
  llm: mockLLM,
});

const result = await orchestrator.run('test objective');
expect(result.plan.subtasks).toHaveLength(1);
expect(orchestrator.agentCalls).toContainEqual({ agent: 'researcher', subtaskId: 's1' });
```

## Packages

| Package | Description |
|---------|-------------|
| `two-layer-cake` | Core SDK — orchestrator, agents, tools, planner, executor |
| `@two-layer-cake/adapter-claude` | Anthropic Claude adapter |
| `@two-layer-cake/adapter-openai` | OpenAI adapter |

## Development

```bash
pnpm install
pnpm build        # Build all packages
pnpm test         # Run all tests (225 tests across 24 files)
pnpm lint         # Lint
pnpm type-check   # Type check
```

## License

MIT
