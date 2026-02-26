/**
 * Basic Usage Example — two-layer-cake SDK
 *
 * Demonstrates:
 *   - Creating an Orchestrator with MockLLMAdapter
 *   - Using built-in agents (researcher → analyzer)
 *   - Listening for events via getEventBus().onStructured()
 *   - Reading the AggregatedResult
 *
 * Run: npx tsx examples/basic-usage.ts
 */

import { Orchestrator, type StructuredEvent, type AggregatedResult } from 'two-layer-cake';
import { MockLLMAdapter } from 'two-layer-cake/testing';

async function main() {
  // --- 1. Set up the mock LLM ---

  const llm = new MockLLMAdapter();

  // The planner calls completeStructured() to generate a plan.
  // Return a 2-subtask DAG: researcher (root) → analyzer (depends on researcher).
  llm.onCompleteStructured(() => ({
    interpretation: 'Research and analyze market trends',
    subtasks: [
      {
        id: 'research',
        description: 'Gather recent data on AI market trends',
        agentType: 'researcher',
        dependsOn: [],
        priority: 'high' as const,
      },
      {
        id: 'analyze',
        description: 'Analyze the gathered data and identify key patterns',
        agentType: 'analyzer',
        dependsOn: ['research'],
        priority: 'medium' as const,
      },
    ],
    reasoning: 'First gather data, then analyze it.',
  }));

  // Built-in agents call llm.complete() during execution.
  // The first call is the researcher, the second is the analyzer.
  llm
    .onComplete(() => ({
      content:
        'The AI market grew 35% YoY in 2025, driven by enterprise adoption of multi-agent systems.',
      tokensUsed: { input: 50, output: 40 },
      finishReason: 'stop' as const,
    }))
    .onComplete(() => ({
      content: 'Key insight: Multi-agent orchestration is the fastest-growing segment at 62% CAGR.',
      tokensUsed: { input: 80, output: 60 },
      finishReason: 'stop' as const,
    }));

  // --- 2. Create the orchestrator ---

  const orchestrator = new Orchestrator({
    planner: { llm },
    // Built-in agents (researcher, analyzer, answer-generator) are registered automatically.
    // You can also pass custom agents here.
    permissions: { autoApprove: ['read-only', 'network'] },
    limits: { maxTokensPerPlan: 100_000 },
    maxConcurrency: 3,
  });

  // --- 3. Listen for events ---

  const eventLog: string[] = [];

  orchestrator.getEventBus().onStructured((event: StructuredEvent) => {
    eventLog.push(`[${event.type}] ${event.subtaskId ?? event.planId}`);
  });

  // --- 4. Run the orchestrator ---

  console.log('Starting orchestration...\n');

  const result: AggregatedResult = await orchestrator.run(
    'Research and analyze current AI market trends',
  );

  // --- 5. Inspect the result ---

  console.log(`Plan: ${result.plan.interpretation}`);
  console.log(`Subtasks completed: ${result.results.size}`);
  console.log(`Total tokens used: ${result.totalTokensUsed}`);
  console.log(`Duration: ${result.totalDurationMs}ms\n`);

  for (const [subtaskId, subtaskResult] of result.results) {
    console.log(`  [${subtaskId}] status=${subtaskResult.status}`);
    console.log(`    data: ${String(subtaskResult.data).slice(0, 80)}...`);
  }

  console.log(`\nEvent log (${eventLog.length} events):`);
  for (const entry of eventLog) {
    console.log(`  ${entry}`);
  }
}

main().catch(console.error);
