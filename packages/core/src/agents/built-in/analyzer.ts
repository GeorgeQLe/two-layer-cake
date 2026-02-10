import { defineAgent } from '../define-agent.js';
import type { AgentDefinition } from '../../types/index.js';

export const analyzerAgent: AgentDefinition = defineAgent({
  name: 'analyzer',
  description:
    'LLM-driven analysis agent for data processing and reasoning. Handles structured and unstructured data analysis, multi-format processing, and summarization.',
  capabilities: ['data-analysis', 'reasoning', 'summarization', 'data-processing'],
  tools: ['text-extraction'],
  execute: async (subtask, context) => {
    const messages = [
      {
        role: 'system' as const,
        content: `You are an analysis agent. Your task is to analyze data, identify patterns, and provide structured insights.
Available tools: ${context.tools.list().join(', ')}
Provide clear, well-structured analysis.`,
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
