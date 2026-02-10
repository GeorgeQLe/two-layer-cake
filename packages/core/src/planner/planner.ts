import type {
  LLMAdapter,
  Plan,
  Subtask,
  SubtaskResult,
  PlannerConfig,
} from '../types/index.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { HookRunner } from '../hooks/hook-runner.js';
import { PromptBuilder } from './prompt-builder.js';
import { PlanSchema, type PlanSchemaOutput } from './plan-schema.js';
import { PlanValidationError } from '../errors/sdk-errors.js';

let planIdCounter = 0;

function generatePlanId(): string {
  return `plan-${++planIdCounter}-${Date.now().toString(36)}`;
}

export class Planner {
  private readonly llm: LLMAdapter;
  private readonly mode: 'single-shot' | 'stepwise';
  private readonly promptBuilder: PromptBuilder;
  private readonly hookRunner: HookRunner;

  constructor(
    config: PlannerConfig,
    agentRegistry: AgentRegistry,
    toolRegistry: ToolRegistry,
    hookRunner: HookRunner,
  ) {
    this.llm = config.llm;
    this.mode = config.mode ?? 'single-shot';
    this.promptBuilder = new PromptBuilder(
      agentRegistry,
      toolRegistry,
      config.promptOverrides,
    );
    this.hookRunner = hookRunner;
  }

  async plan(
    objective: string,
    parentPlanId?: string,
    depth = 0,
  ): Promise<Plan> {
    // Run beforePlan hook
    let context = { objective };
    const hookResult = await this.hookRunner.run('beforePlan', context);
    if (hookResult) {
      context = hookResult;
    }

    let planOutput: PlanSchemaOutput;

    if (this.mode === 'stepwise') {
      planOutput = await this.planStepwise(context.objective);
    } else {
      planOutput = await this.planSingleShot(context.objective);
    }

    const plan: Plan = {
      id: generatePlanId(),
      interpretation: planOutput.interpretation,
      subtasks: planOutput.subtasks.map((s) => toSubtask(s)),
      reasoning: planOutput.reasoning,
      parentPlanId,
      depth,
    };

    return plan;
  }

  async replan(
    plan: Plan,
    results: Map<string, SubtaskResult<unknown>>,
    trigger: string,
    objective: string,
  ): Promise<Plan> {
    const currentPlanSummary = plan.subtasks
      .map((s) => `${s.id} [${s.status}]: ${s.description}`)
      .join('\n');

    const completedResults: string[] = [];
    for (const [id, result] of results) {
      completedResults.push(
        `${id}: ${result.status} - ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`,
      );
    }

    const messages = this.promptBuilder.buildReplanPrompt(
      objective,
      currentPlanSummary,
      completedResults.join('\n'),
      trigger,
    );

    const planOutput = await this.llm.completeStructured(messages, PlanSchema);

    const newPlan: Plan = {
      id: plan.id,
      interpretation: planOutput.interpretation,
      subtasks: planOutput.subtasks.map((s) => toSubtask(s)),
      reasoning: planOutput.reasoning,
      parentPlanId: plan.parentPlanId,
      depth: plan.depth,
    };

    return newPlan;
  }

  private async planSingleShot(objective: string): Promise<PlanSchemaOutput> {
    const messages = this.promptBuilder.buildPlanPrompt(objective);
    return this.llm.completeStructured(messages, PlanSchema);
  }

  private async planStepwise(objective: string): Promise<PlanSchemaOutput> {
    // Step 1: Interpret
    const interpretMessages = this.promptBuilder.buildPlanPrompt(objective);
    interpretMessages[0]!.content += '\n\nStep 1: First, provide your interpretation of the objective. Respond with just the interpretation text.';

    const interpretResult = await this.llm.complete(interpretMessages);
    const interpretation = interpretResult.content;

    // Step 2: Decompose
    const decomposeMessages = this.promptBuilder.buildPlanPrompt(objective);
    decomposeMessages[0]!.content +=
      `\n\nStep 2: Given the interpretation "${interpretation}", decompose into subtasks.`;

    const planOutput = await this.llm.completeStructured(decomposeMessages, PlanSchema);

    return {
      ...planOutput,
      interpretation,
    };
  }
}

function toSubtask(s: PlanSchemaOutput['subtasks'][number]): Subtask {
  const dependsOn = s.dependsOn ?? [];
  return {
    id: s.id,
    description: s.description,
    agentType: s.agentType,
    dependsOn,
    priority: s.priority ?? 'medium',
    estimatedComplexity: s.estimatedComplexity,
    contextFromPrevious: s.contextFromPrevious,
    status: dependsOn.length > 0 ? 'BLOCKED' : 'PENDING',
  };
}

export function resetPlanIdCounter(): void {
  planIdCounter = 0;
}
