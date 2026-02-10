import { defineAgent } from '../define-agent.js';
import type { AgentDefinition, SubtaskResult } from '../../types/index.js';

export const answerGeneratorAgent: AgentDefinition = defineAgent({
  name: 'answer-generator',
  description:
    'LLM-driven aggregator agent that takes subtask results and produces a coherent final response.',
  capabilities: ['aggregation', 'synthesis', 'response-generation'],
  execute: async (subtask, context) => {
    const messages = [
      {
        role: 'system' as const,
        content: `You are an answer generator. Your task is to synthesize multiple subtask results into a coherent, well-structured final response. Focus on creating a unified narrative from the provided data.`,
      },
      {
        role: 'user' as const,
        content: subtask.description + (subtask.contextFromPrevious
          ? `\n\nSubtask results to aggregate:\n${subtask.contextFromPrevious}`
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

export function aggregateResults(
  results: Map<string, SubtaskResult<unknown>>,
): string {
  const parts: string[] = [];

  for (const [subtaskId, result] of results) {
    if (result.status === 'success' || result.status === 'partial') {
      parts.push(`[${subtaskId}]: ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`);
    }
  }

  return parts.join('\n\n');
}
