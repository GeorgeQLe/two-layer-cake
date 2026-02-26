/**
 * Custom Agent Example — two-layer-cake SDK
 *
 * Demonstrates:
 *   - Defining a custom tool with Zod params via defineTool()
 *   - Defining a functional agent via defineAgent() that invokes tools
 *   - Defining a class-based agent via BaseAgent with toDefinition()
 *   - Using contextFromPrevious for inter-agent data flow
 *   - Wiring everything into an Orchestrator
 *
 * Run: npx tsx examples/custom-agent.ts
 */

import { z } from 'zod';
import {
  Orchestrator,
  defineAgent,
  defineTool,
  BaseAgent,
  type Subtask,
  type AgentContext,
  type SubtaskResult,
} from 'two-layer-cake';
import { MockLLMAdapter } from 'two-layer-cake/testing';

// --- 1. Define a custom tool ---

const databaseQueryTool = defineTool({
  name: 'database-query',
  description: 'Query the product database for matching items',
  riskLevel: 'read-only',
  parameters: z.object({
    category: z.string().describe('Product category to search'),
    limit: z.number().default(5).describe('Max results to return'),
  }),
  execute: async (params) => {
    // In a real app, this would query an actual database.
    return {
      products: [
        { name: `${params.category} Widget A`, price: 29.99, rating: 4.5 },
        { name: `${params.category} Widget B`, price: 49.99, rating: 4.8 },
        { name: `${params.category} Pro`, price: 99.99, rating: 4.9 },
      ].slice(0, params.limit),
    };
  },
});

// --- 2. Define a functional agent (uses defineAgent) ---

const productResearcher = defineAgent({
  name: 'product-researcher',
  description: 'Researches products by querying the database and summarizing results via LLM',
  capabilities: ['research', 'data-extraction'],
  tools: ['database-query'],
  execute: async (subtask, context) => {
    // Invoke the custom tool
    const queryResult = await context.tools.invoke<{
      products: Array<{ name: string; price: number; rating: number }>;
    }>('database-query', { category: 'Smart Home', limit: 3 });

    // Ask the LLM to summarize the tool output
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a product research agent. Summarize the product data.',
      },
      {
        role: 'user' as const,
        content: `${subtask.description}\n\nProduct data:\n${JSON.stringify(queryResult.products, null, 2)}`,
      },
    ];

    const llmResult = await context.llm.complete(messages);

    return {
      status: 'success' as const,
      data: llmResult.content,
      metadata: {
        durationMs: 0,
        llmTokensUsed: llmResult.tokensUsed.input + llmResult.tokensUsed.output,
        toolsInvoked: ['database-query'],
      },
    };
  },
});

// --- 3. Define a class-based agent (extends BaseAgent) ---

class ReportWriterAgent extends BaseAgent {
  readonly name = 'report-writer';
  readonly description =
    'Writes a formatted report from analyzed data, using context from previous subtasks';
  readonly capabilities = ['summarization', 'result-synthesis'];

  async execute(subtask: Subtask, context: AgentContext): Promise<SubtaskResult<unknown>> {
    // Access data from upstream subtasks via contextFromPrevious
    const previousContext = subtask.contextFromPrevious ?? 'No prior context available.';

    const messages = [
      {
        role: 'system' as const,
        content: 'You are a report writer. Create a concise executive summary.',
      },
      {
        role: 'user' as const,
        content: `Write a report based on:\n${previousContext}`,
      },
    ];

    const llmResult = await context.llm.complete(messages);

    return {
      status: 'success' as const,
      data: llmResult.content,
      metadata: {
        durationMs: 0,
        llmTokensUsed: llmResult.tokensUsed.input + llmResult.tokensUsed.output,
      },
    };
  }
}

// --- 4. Set up the mock LLM and run ---

async function main() {
  const llm = new MockLLMAdapter();

  // Planner: return a 2-step plan (research → report)
  llm.onCompleteStructured(() => ({
    interpretation: 'Research products then write a report',
    subtasks: [
      {
        id: 'research',
        description: 'Find top-rated smart home products',
        agentType: 'product-researcher',
        dependsOn: [],
        priority: 'high' as const,
      },
      {
        id: 'report',
        description: 'Write an executive summary of the findings',
        agentType: 'report-writer',
        dependsOn: ['research'],
        priority: 'medium' as const,
      },
    ],
  }));

  // Agent LLM calls: first for researcher, second for report writer
  llm
    .onComplete(() => ({
      content:
        'Top products: Smart Home Widget B ($49.99, 4.8★) and Smart Home Pro ($99.99, 4.9★).',
      tokensUsed: { input: 60, output: 45 },
      finishReason: 'stop' as const,
    }))
    .onComplete(() => ({
      content:
        'Executive Summary: The smart home market offers compelling options. The Pro tier leads in quality.',
      tokensUsed: { input: 90, output: 50 },
      finishReason: 'stop' as const,
    }));

  // --- 5. Wire everything into the Orchestrator ---

  const reportWriter = new ReportWriterAgent();

  const orchestrator = new Orchestrator({
    planner: { llm },
    agents: [productResearcher, reportWriter.toDefinition()],
    tools: [databaseQueryTool],
    permissions: { autoApprove: ['read-only'] },
    limits: { maxTokensPerPlan: 100_000 },
    maxConcurrency: 2,
  });

  // --- 6. Run and display results ---

  console.log('Running custom agent orchestration...\n');

  const result = await orchestrator.run('Research smart home products and write a report');

  console.log(`Plan: ${result.plan.interpretation}`);
  console.log(`Subtasks completed: ${result.results.size}`);
  console.log(`Total tokens used: ${result.totalTokensUsed}\n`);

  for (const [id, subtaskResult] of result.results) {
    console.log(`  [${id}] status=${subtaskResult.status}`);
    console.log(`    data: ${subtaskResult.data}`);
    if (subtaskResult.metadata?.toolsInvoked?.length) {
      console.log(`    tools used: ${subtaskResult.metadata.toolsInvoked.join(', ')}`);
    }
    console.log();
  }
}

main().catch(console.error);
