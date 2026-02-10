# Two-Layer Cake: Agentic Planning and Execution SDK

## Formal Specification v1

---

## 1. System Overview

### 1.1 Purpose

Two-Layer Cake is a TypeScript/Node.js SDK that provides a hierarchical multi-agent architecture for building AI-powered applications. It interprets user objectives, decomposes them into executable sub-tasks, assigns those tasks to specialized agents, and coordinates execution through centralized planning and orchestration.

### 1.2 Product Type

- **Type:** Developer framework/SDK (npm package)
- **Runtime:** TypeScript/Node.js backend
- **Package name:** `two-layer-cake`
- **Package scope:** `@two-layer-cake/*` for plugin packages

### 1.3 Architectural Layers

The system consists of two layers:

- **Layer 1:** Top-Level Planning and Orchestration Layer
- **Layer 2:** Specialized Execution Agent Layer

**Control Model:**

- Centralized planning with distributed execution
- Centralized monitoring with continuous feedback
- Dynamic reassignment and adaptation
- Recursive sub-planning with configurable depth limits

### 1.4 Monorepo Structure

```
two-layer-cake/
  packages/
    core/                 # Main SDK: orchestrator, planner, base agents, built-in tools
    adapter-claude/       # @two-layer-cake/adapter-claude
    adapter-openai/       # @two-layer-cake/adapter-openai
    agent-browser/        # @two-layer-cake/agent-browser (v2+)
    agent-mcp/            # @two-layer-cake/agent-mcp (v2+)
```

---

## 2. SDK Public API

### 2.1 API Design Philosophy

The SDK exposes a **high-level orchestrator** as the primary interface. Internal components (Task Interpreter, Decomposer, Assigner, Monitor) are hidden behind the orchestrator. Customization is provided through:

- **Plugin hooks** for intercepting lifecycle events
- **Config-based agent definitions** (`defineAgent()`) as the primary pattern
- **`BaseAgent` class** as an escape hatch for advanced use cases
- **Template-based prompt customization** for the planner

### 2.2 Core Usage

```typescript
import { Orchestrator, defineAgent } from 'two-layer-cake';
import { ClaudeAdapter } from 'two-layer-cake/adapters/claude';
import { OpenAIAdapter } from 'two-layer-cake/adapters/openai';

const orchestrator = new Orchestrator({
  planner: {
    llm: new ClaudeAdapter({ model: 'claude-sonnet-4-5-20250929' }),
    mode: 'single-shot', // or 'stepwise'
  },
  agents: [ResearcherAgent, AnalyzerAgent, myCustomAgent],
  tools: myToolRegistry,
  hooks: {
    afterPlan: (plan) => { /* inspect/modify */ },
    onError: (error, context) => { /* override strategy */ },
  },
  limits: {
    maxTokensPerPlan: 100_000,
    maxTokensPerAgent: 20_000,
    planTimeout: 300_000, // 5 min
    subtaskTimeout: 60_000, // 1 min
  },
  maxConcurrency: 5,
  maxPlanDepth: 2,
});

// One-shot execution
const result = await orchestrator.run('Analyze the Q4 sales data and create a report');

// Streaming execution
for await (const event of orchestrator.stream('...')) {
  console.log(event); // { type: 'agent:started', agentId, subtaskId, ... }
}
```

### 2.3 Session Model

The orchestrator is **stateless by default**. Each `run()` call is independent. Developers can pass previous results as context manually. Session/conversation memory is out of scope for v1.

---

## 3. Layer 1: Top-Level Planning Agent

### 3.1 Responsibilities

The Planning Agent SHALL:

- Interpret user objectives into structured tasks
- Decompose tasks into a DAG of manageable subtasks
- Assign subtasks to appropriate specialized agents based on auto-injected agent capability descriptions
- Track execution progress and state
- Handle objective changes and unexpected execution errors
- Coordinate inter-agent context passing
- Update and maintain execution plans dynamically
- Support recursive sub-planning with depth limits

### 3.2 Planning Mode

**Default: Single-shot planning.** One LLM call produces the full structured plan (interpretation + subtask DAG + agent assignments). This optimizes for latency and cost.

**Optional: Stepwise mode.** Breaks planning into separate sequential LLM calls (interpret → decompose → assign) for debugging and validation. Activated via `mode: 'stepwise'` configuration.

### 3.3 Planner Prompt Customization

The planner prompt is built from **composable template sections**:

1. System preamble
2. Available agents and their capabilities (auto-injected from agent registry)
3. Available tools and their descriptions (auto-injected from tool registry)
4. Decomposition guidelines and constraints
5. Output format specification

Developers can override individual sections while keeping SDK defaults for the rest.

Agent descriptions and capabilities are **automatically injected** into the planner prompt from the agent registry — no manual prompt editing required.

### 3.4 Plan Output Schema

```typescript
const PlanSchema = z.object({
  interpretation: z.string(),
  subtasks: z.array(z.object({
    id: z.string(),
    description: z.string(),
    agentType: z.string(),
    dependsOn: z.array(z.string()).default([]),
    priority: z.enum(['high', 'medium', 'low']).default('medium'),
    estimatedComplexity: z.enum(['simple', 'moderate', 'complex']).optional(),
    contextFromPrevious: z.string().optional(),
  })),
  reasoning: z.string().optional(),
});
```

### 3.5 Plan Lifecycle State Machine

**Plan States:**

```
PLANNING → EXECUTING → COMPLETED
                    → FAILED
                    → CANCELLED
```

**Subtask States:**

```
PENDING → BLOCKED → RUNNING → COMPLETED
                            → FAILED
                            → SKIPPED
```

- `BLOCKED`: Subtask is waiting on dependency completion
- `SKIPPED`: Planner decided to skip (e.g., dependency failed, subtask no longer relevant)

### 3.6 Dynamic Adaptation

#### 3.6.1 Re-planning Triggers

Re-planning occurs when:

1. **Agent-flagged results:** An agent signals that its result may invalidate the current plan
2. **Unrecoverable errors:** After retry exhaustion and rule-based handling fails

Re-planning does NOT occur after every subtask completion (cost optimization).

#### 3.6.2 Error Handling

**Rule-based defaults with LLM escalation:**

1. Transient errors → Configurable retry with exponential backoff (default: 3 retries)
2. After retry exhaustion → Escalate to planner LLM for decision (reassign, skip, restructure, or fail)
3. Developers can override error handling strategy via `onError` hook

### 3.7 Recursive Planning

Agents can invoke the planner to further decompose complex subtasks into sub-plans.

- **Default max depth:** 2 (original plan + one level of sub-planning), configurable
- **Token budget:** Sub-plans share the parent plan's token budget (consuming from the same pool)
- **Abort propagation:** Cancelling a parent plan automatically cancels all sub-plans
- **DAG validation:** Applied at each planning level

### 3.8 Context Sharing

**Planner-mediated only.** Agents receive context exclusively through what the planner places in the subtask description and attached data (via `contextFromPrevious`). Agents do not directly share state with each other. The planner synthesizes cross-agent context during re-planning or when constructing subtask inputs.

---

## 4. Layer 2: Specialized Execution Agents

### 4.1 Common Agent Architecture

```
Agent
├── Input Interface
├── Tool Interface (scoped from ToolRegistry)
├── Interpreter (LLM-driven)
├── Execution Engine
└── Output Interface (events + streaming)
```

**Execution Pipeline:**

```
subtask input → interpreter → tool/LLM execution → result → output
```

### 4.2 Agent Definition API

**Primary: Config-based (`defineAgent()`)**

```typescript
const myAgent = defineAgent({
  name: 'my-agent',
  description: 'Performs custom analysis on structured data',
  capabilities: ['data-analysis', 'summarization'],
  tools: ['web-search', 'http-fetch'], // Scoped tool access
  llm: optionalLLMOverride, // Defaults to orchestrator's LLM
  execute: async (subtask, context) => {
    // context provides: tools, llm, abortSignal, logger, emitEvent
    const data = await context.tools.invoke('http-fetch', { url: subtask.data.url });
    const analysis = await context.llm.complete([...]);
    return { status: 'success', data: analysis };
  },
});
```

**Advanced: Class-based (`BaseAgent`)**

```typescript
class MyComplexAgent extends BaseAgent {
  name = 'complex-agent';
  description = 'Agent with complex lifecycle management';
  capabilities = ['analysis'];

  async execute(subtask: Subtask, context: AgentContext): Promise<SubtaskResult<MyResultType>> {
    // Full lifecycle control
  }

  async onInit() { /* setup */ }
  async onDestroy() { /* cleanup */ }
}
```

### 4.3 Built-in Agent Types (Core Package)

#### 4.3.1 Researcher Agent

LLM-driven agent that orchestrates information gathering using available tools.

- **Capabilities:** Multi-source querying, data extraction, insight generation, summarization
- **Tools:** Uses whatever tools are registered in the scoped registry (web search, HTTP fetch, etc.)
- **Value:** Orchestration logic for research workflows, not bundled data sources

#### 4.3.2 Analyzer Agent

LLM-driven agent for data processing and reasoning.

- **Capabilities:** Structured/unstructured data analysis, multi-format processing, summarization
- **Tools:** Uses registered analysis and processing tools

#### 4.3.3 Answer Generator Agent (Optional Built-in)

LLM-driven agent that aggregates subtask outputs into a coherent final response.

- **Default behavior:** Takes all subtask results and uses LLM to synthesize a response
- **Override:** Developers can replace via `onPlanComplete` hook or by providing a custom Answer Generator agent
- **Optional:** Can be disabled if developers handle result aggregation themselves

### 4.4 Plugin Agent Types (Separate Packages)

#### 4.4.1 Browser Use Agent (`@two-layer-cake/agent-browser`) — v2+

- **Capabilities:** Web browsing, search execution, content extraction, browser automation
- **Dependencies:** Puppeteer or Playwright (heavy dependency, hence separate package)

#### 4.4.2 MCP Manager Agent (`@two-layer-cake/agent-mcp`) — v2+

- **Capabilities:** MCP tool discovery, invocation, and lifecycle management
- **MCP Client:** Consume tools from external MCP servers
- **MCP Server:** Expose SDK agents as tools to other MCP-compatible systems
- **Full bidirectional MCP interoperability**

---

## 5. Tool System

### 5.1 Tool Definition API

```typescript
const searchTool = defineTool({
  name: 'web-search',
  description: 'Search the web for information',
  riskLevel: 'network', // 'read-only' | 'write' | 'execute' | 'network'
  parameters: z.object({
    query: z.string(),
    maxResults: z.number().optional().default(10),
  }),
  execute: async (params, context) => {
    // context provides: abortSignal, logger
    return { results: [...] };
  },
});
```

### 5.2 Tool Registry

```typescript
const registry = new ToolRegistry();
registry.register(searchTool);
registry.register(httpFetchTool);
registry.register(textExtractTool);
```

**Scoping:** Each agent is configured with which tools it can access. The orchestrator creates scoped tool views per agent based on the agent's `tools` array.

### 5.3 Tool Permissions

Each tool declares a `riskLevel`:

| Level | Description | Examples |
|-------|-------------|----------|
| `read-only` | Reads data, no side effects | File read, database query |
| `write` | Modifies data | File write, database insert |
| `execute` | Executes code or commands | Code interpreter, shell exec |
| `network` | Makes network requests | HTTP fetch, web search, API calls |

Developers configure which risk levels require confirmation via the hook system. Confirmation requests are emitted as events that the developer's application can handle (e.g., prompting a user for approval).

### 5.4 Built-in Tools (Core Package)

1. **HTTP Fetch Tool** — Makes HTTP requests and returns response data. Risk level: `network`.
2. **Text Extraction Tool** — Extracts and structures text from various formats. Risk level: `read-only`.
3. **Web Search Tool (Configurable Wrapper)** — Skeleton tool for web search. Developers plug in their preferred search API (Brave, Tavily, SerpAPI, custom) via a configuration adapter. Risk level: `network`.

```typescript
import { createWebSearchTool } from 'two-layer-cake';

const searchTool = createWebSearchTool({
  adapter: async (query, options) => {
    // Developer implements their search API integration
    const response = await fetch(`https://api.search-provider.com/search?q=${query}`);
    return response.json();
  },
});
```

---

## 6. LLM Abstraction

### 6.1 LLM Adapter Interface

```typescript
interface LLMAdapter {
  // Core completion
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;

  // Streaming completion
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;

  // Structured output (for plan generation, tool calls)
  completeStructured<T>(
    messages: Message[],
    schema: ZodSchema<T>,
    options?: CompletionOptions
  ): Promise<T>;

  // Token counting (for budget enforcement)
  countTokens(messages: Message[]): Promise<number>;
}
```

### 6.2 Built-in Adapters

- `@two-layer-cake/adapter-claude` — Anthropic Claude (Claude Sonnet 4.5, Claude Opus 4.6, etc.)
- `@two-layer-cake/adapter-openai` — OpenAI (GPT-4o, o1, etc.)

### 6.3 Custom Adapters

Developers can implement the `LLMAdapter` interface for any LLM provider or use third-party libraries to satisfy it.

### 6.4 Multi-Provider Configuration

Different agents can use different LLM providers:

```typescript
const orchestrator = new Orchestrator({
  planner: {
    llm: new ClaudeAdapter({ model: 'claude-sonnet-4-5-20250929' }),
  },
  agents: [
    defineAgent({
      name: 'researcher',
      llm: new OpenAIAdapter({ model: 'gpt-4o' }), // Override per agent
      // ...
    }),
  ],
});
```

---

## 7. Execution Engine

### 7.1 DAG-Based Parallel Execution

The planner produces a dependency graph (DAG) of subtasks. The executor:

1. Validates the DAG is acyclic (see §7.2)
2. Identifies subtasks with no unmet dependencies
3. Runs independent subtasks in parallel (up to `maxConcurrency`)
4. As subtasks complete, unblocks dependent subtasks
5. Continues until all subtasks complete, fail, or are skipped

**Default max concurrency:** 5 parallel subtask executions, configurable.

### 7.2 DAG Validation

Circular dependency detection occurs at **two points**:

1. **After plan generation** — Immediately after the planner LLM produces the plan
2. **After `afterPlan` hook** — After developer hook modifications to the plan

Validation throws a clear error identifying the cycle if detected.

### 7.3 Timeouts and Cancellation

**AbortController-based** cancellation, idiomatic to Node.js:

- **Per-subtask timeout:** Configurable, passed to agent via `context.abortSignal`
- **Per-plan timeout:** Overall plan execution timeout
- **Developer-initiated cancellation:** `orchestrator.cancel(planId)` propagates abort signals
- **Recursive propagation:** Cancelling a parent plan cancels all sub-plans

### 7.4 Token Budget Enforcement

- **Per-plan budget:** Maximum tokens across all LLM calls in a plan (including sub-plans)
- **Per-agent budget:** Maximum tokens for a single agent execution
- **Shared budget for recursion:** Sub-plans consume from the parent plan's remaining budget
- **On budget exceeded:** Emit event, then either pause (awaiting developer decision) or fail gracefully (configurable)

---

## 8. Communication

### 8.1 Event-Based Communication

Lifecycle events emitted via `EventEmitter`:

```typescript
interface OrchestratorEvents {
  'plan:created': (plan: Plan) => void;
  'plan:executing': (plan: Plan) => void;
  'plan:completed': (plan: Plan, result: AggregatedResult) => void;
  'plan:failed': (plan: Plan, error: ErrorDetail) => void;
  'plan:cancelled': (plan: Plan) => void;

  'subtask:started': (subtask: Subtask) => void;
  'subtask:completed': (subtask: Subtask, result: SubtaskResult) => void;
  'subtask:failed': (subtask: Subtask, error: ErrorDetail) => void;
  'subtask:skipped': (subtask: Subtask, reason: string) => void;

  'agent:started': (agentId: string, subtaskId: string) => void;
  'agent:progress': (agentId: string, progress: unknown) => void;
  'agent:completed': (agentId: string, subtaskId: string) => void;

  'replan:triggered': (reason: string, plan: Plan) => void;
  'budget:warning': (usage: BudgetUsage) => void;
  'budget:exceeded': (usage: BudgetUsage) => void;
}
```

### 8.2 Streaming Support

Agents that produce incremental results (e.g., long-form text generation) use `AsyncIterable` for streaming:

```typescript
for await (const event of orchestrator.stream('...')) {
  // Lifecycle events + partial results interleaved
  if (event.type === 'agent:progress') {
    process.stdout.write(event.data); // Stream partial output
  }
}
```

---

## 9. Lifecycle Hooks

Six hook points for SDK consumers to intercept and customize behavior:

| Hook | Trigger | Can Modify |
|------|---------|------------|
| `beforePlan` | After objective received, before LLM planning call | Objective, constraints |
| `afterPlan` | After plan generated, before execution starts | Plan structure, subtasks, assignments |
| `beforeAgentExecute` | Before each agent starts a subtask | Subtask input; can skip execution |
| `afterAgentExecute` | After each agent completes a subtask | Result transformation, side effects |
| `onError` | On error, before rule-based/LLM error handling | Error handling strategy override |
| `onPlanComplete` | After all subtasks complete | Final aggregated result transformation |

```typescript
const orchestrator = new Orchestrator({
  hooks: {
    beforePlan: async (objective, context) => {
      return { ...objective, constraints: [...objective.constraints, 'use metric units'] };
    },
    afterPlan: async (plan) => {
      // Inspect or modify plan before execution
      // DAG is re-validated after this hook returns
      return plan;
    },
    onError: async (error, context) => {
      if (error.code === 'RATE_LIMIT') {
        return { strategy: 'retry', delay: 5000 };
      }
      return null; // Fall through to default handling
    },
    onPlanComplete: async (plan, results) => {
      // Custom result aggregation instead of default Answer Generator
      return myCustomAggregation(results);
    },
  },
});
```

---

## 10. Data Structures

### 10.1 Task Object

```typescript
interface Task {
  id: string;
  objective: string;
  plan: Plan;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
}

type PlanStatus = 'PLANNING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
```

### 10.2 Plan Object

```typescript
interface Plan {
  id: string;
  interpretation: string;
  subtasks: Subtask[];
  reasoning?: string;
  parentPlanId?: string; // For recursive sub-plans
  depth: number;         // Current recursion depth
}
```

### 10.3 Subtask Object

```typescript
interface Subtask {
  id: string;
  description: string;
  agentType: string;
  assignedAgentId?: string;
  dependsOn: string[];
  priority: 'high' | 'medium' | 'low';
  estimatedComplexity?: 'simple' | 'moderate' | 'complex';
  contextFromPrevious?: string;
  status: SubtaskStatus;
  result?: SubtaskResult<unknown>;
  error?: ErrorDetail;
}

type SubtaskStatus = 'PENDING' | 'BLOCKED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
```

### 10.4 SubtaskResult (Generic)

```typescript
interface SubtaskResult<T> {
  status: 'success' | 'partial' | 'failed';
  data: T;
  errors?: ErrorDetail[];
  metadata?: {
    durationMs: number;
    llmTokensUsed?: number;
    toolsInvoked?: string[];
  };
}
```

### 10.5 ErrorDetail

```typescript
interface ErrorDetail {
  code: string;           // e.g., 'TOOL_TIMEOUT', 'LLM_RATE_LIMIT', 'AGENT_FAILURE'
  message: string;
  retryable: boolean;
  source: 'agent' | 'tool' | 'llm' | 'system';
  original?: unknown;
}
```

### 10.6 Agent Object

```typescript
interface AgentDefinition {
  name: string;
  description: string;
  capabilities: string[];
  tools?: string[];       // Scoped tool access list
  llm?: LLMAdapter;      // Override per-agent LLM
  execute: (subtask: Subtask, context: AgentContext) => Promise<SubtaskResult<unknown>>;
}
```

---

## 11. State Management

### 11.1 In-Memory Default

Plans and execution state are stored in-memory by default. State lives and dies with the Node.js process.

### 11.2 PlanStore Adapter Interface

```typescript
interface PlanStore {
  save(task: Task): Promise<void>;
  load(taskId: string): Promise<Task | null>;
  update(taskId: string, changes: Partial<Task>): Promise<void>;
  delete(taskId: string): Promise<void>;
  list(filter?: TaskFilter): Promise<Task[]>;
}
```

Developers implement this interface to persist plans to any backing store (database, file system, Redis, etc.).

```typescript
const orchestrator = new Orchestrator({
  store: new MyPostgresPlanStore(dbConnection),
  // ...
});
```

---

## 12. Observability

### 12.1 Structured Event Logging

All lifecycle events (§8.1) are emitted as structured events with consistent shape:

```typescript
interface StructuredEvent {
  timestamp: Date;
  type: string;
  planId: string;
  subtaskId?: string;
  agentId?: string;
  data: unknown;
  traceContext?: TraceContext;
}
```

### 12.2 OpenTelemetry Compatibility

- Expose `TraceContext` (trace ID, span ID) on all events
- OpenTelemetry is an **optional peer dependency**, not a required dependency
- When OTel is available, the SDK creates spans for:
  - Plan lifecycle (planning → executing → completed)
  - Each subtask execution
  - Each tool invocation
  - Each LLM call
- Integrates with existing observability stacks (Datadog, Grafana, Honeycomb, etc.)

---

## 13. Security

### 13.1 Tool Permission System

Tools declare risk levels (`read-only`, `write`, `execute`, `network`). Developers configure which risk levels require confirmation:

```typescript
const orchestrator = new Orchestrator({
  permissions: {
    autoApprove: ['read-only'],
    requireConfirmation: ['write', 'execute', 'network'],
    onConfirmation: async (tool, params, context) => {
      // Developer handles confirmation (e.g., prompt user)
      return userApproved;
    },
  },
});
```

### 13.2 Agent Tool Scoping

Agents can only access tools explicitly listed in their `tools` configuration. The registry creates scoped views per agent, preventing unauthorized tool access.

### 13.3 Prompt Injection Mitigation

- Tool parameters are validated against Zod schemas before execution
- Agent results are treated as untrusted input by the planner
- Developers can inspect and sanitize data in `afterAgentExecute` hooks

---

## 14. Testing Support

### 14.1 MockLLMAdapter

```typescript
import { MockLLMAdapter } from 'two-layer-cake/testing';

const mock = new MockLLMAdapter();
mock.onComplete(() => ({ content: 'mocked response' }));
mock.onCompleteStructured((schema) => ({
  interpretation: 'test',
  subtasks: [{ id: '1', description: 'test task', agentType: 'researcher', dependsOn: [] }],
}));
```

### 14.2 TestOrchestrator

Runs synchronously with deterministic behavior for testing:

```typescript
import { TestOrchestrator } from 'two-layer-cake/testing';

const orchestrator = new TestOrchestrator({
  agents: [myAgent],
  llm: mockLLM,
});

const result = await orchestrator.run('test objective');
expect(result.plan.subtasks).toHaveLength(2);
expect(orchestrator.agentCalls).toContainEqual({ agent: 'researcher', subtaskId: '1' });
```

### 14.3 Assertion Utilities

Utilities for asserting on plan structure, agent invocations, tool calls, and event sequences.

---

## 15. Versioning and Compatibility

### 15.1 Semantic Versioning

The SDK follows **strict semver**. Public API changes follow:

- **Major:** Breaking changes to stable APIs
- **Minor:** New features, new stable APIs
- **Patch:** Bug fixes only

### 15.2 Stability Tiers

| Tier | Guarantee | Example |
|------|-----------|---------|
| **Stable** | No breaking changes in minor versions | `Orchestrator`, `defineAgent`, `defineTool` |
| **Beta** | May change with deprecation warnings in minor versions | Template prompt sections, advanced hook APIs |
| **Experimental** | May change without warning | Internal utilities, undocumented APIs |

APIs are marked with `@stable`, `@beta`, or `@experimental` JSDoc tags.

---

## 16. v1 Scope

### 16.1 In Scope

- Core orchestrator with single-shot planning (+ optional stepwise)
- DAG-based parallel subtask execution (max concurrency: 5, configurable)
- Built-in agents: Researcher, Analyzer, Answer Generator (optional)
- Config-based custom agent definition (`defineAgent()`) + `BaseAgent` class
- Scoped tool registry with permission levels and confirmation hooks
- Built-in tools: HTTP Fetch, Text Extraction, Web Search (configurable wrapper)
- 6 lifecycle hooks (beforePlan, afterPlan, beforeAgentExecute, afterAgentExecute, onError, onPlanComplete)
- Event-based communication with async iterable streaming
- In-memory state with `PlanStore` adapter interface
- Rule-based error handling with LLM escalation, partial results
- Recursive planning (default depth 2, shared token budget)
- Configurable token/cost limits and AbortController-based timeouts
- Structured event logging with OpenTelemetry-compatible traces
- Built-in LLM adapters for Claude and OpenAI
- Custom LLM adapter interface
- Mock adapter, TestOrchestrator, and assertion utilities
- Template-based planner prompt customization
- Auto-injected agent capability descriptions
- Dual-point DAG cycle validation
- Semver with stability tiers

### 16.2 Out of Scope (Planned for Later)

- Cross-process/distributed agent execution (worker threads, containers)
- Browser agent plugin (`@two-layer-cake/agent-browser`)
- MCP agent plugin with client + server support (`@two-layer-cake/agent-mcp`)
- Session/conversation memory across `run()` calls
- Additional LLM adapters (Google, Mistral, Cohere, etc.)
- Visual plan debugging UI
- Embeddings support in LLM adapter interface
- Shared context store for direct agent-to-agent data sharing

---

## 17. Execution Workflow

### 17.1 End-to-End Flow

```
Step 1: Developer calls orchestrator.run(objective)
Step 2: beforePlan hook fires (can modify objective)
Step 3: Planner LLM generates structured plan (single-shot or stepwise)
Step 4: DAG validation (cycle detection)
Step 5: afterPlan hook fires (can modify plan)
Step 6: DAG re-validation (post-hook)
Step 7: Executor starts: identifies ready subtasks, respects maxConcurrency
Step 8: For each subtask:
         a. beforeAgentExecute hook fires
         b. Agent executes subtask with scoped tools and context
         c. Agent returns SubtaskResult (success/partial/failed)
         d. afterAgentExecute hook fires
Step 9: On completion: unblock dependent subtasks, check for re-plan signals
Step 10: On error: rule-based retry → LLM escalation → onError hook override
Step 11: When all subtasks done: Answer Generator aggregates (if enabled)
Step 12: onPlanComplete hook fires (can transform final result)
Step 13: Return result to developer
```

### 17.2 Re-planning Flow

```
Agent flags result for re-planning OR unrecoverable error occurs
  → Planner LLM receives: original plan + completed results + flag/error context
  → Planner produces updated plan (new subtasks, modified assignments, skips)
  → DAG validation on updated plan
  → afterPlan hook fires on updated plan
  → Executor continues with updated plan
```

---

*End of Specification*
