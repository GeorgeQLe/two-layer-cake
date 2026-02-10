import { defineAgent } from '../define-agent.js';
import type { AgentDefinition } from '../../types/index.js';

export const researcherAgent: AgentDefinition = defineAgent({
  name: 'researcher',
  description:
    'LLM-driven research agent that orchestrates information gathering using available tools. Capable of multi-source querying, data extraction, insight generation, and summarization.',
  capabilities: ['research', 'data-extraction', 'summarization', 'multi-source-querying'],
  tools: ['web-search', 'http-fetch', 'text-extraction'],
  execute: async (subtask, context) => {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a research agent. Your task is to gather and synthesize information.
Available tools: ${context.tools.list().join(', ')}
Respond with a comprehensive research summary.`,
      },
      {
        role: 'user' as const,
        content: subtask.description + (subtask.contextFromPrevious
          ? `\n\nContext from previous tasks:\n${subtask.contextFromPrevious}`
          : ''),
      },
    ];

    const result = await context.llm.complete(messages);

    return {
      status: 'success',
      data: result.content,
      metadata: {
        durationMs: 0,
        llmTokensUsed: result.tokensUsed.input + result.tokensUsed.output,
      },
    };
  },
});
