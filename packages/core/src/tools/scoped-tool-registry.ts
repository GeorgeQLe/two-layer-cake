import type { ToolDefinition, RiskLevel, ToolContext } from '../types/index.js';
import type { ScopedToolAccess } from '../types/agent.js';
import type { PermissionsConfig } from '../types/config.js';
import type { ToolRegistry } from './tool-registry.js';
import { ToolAccessDeniedError, ToolConfirmationDeniedError } from '../errors/sdk-errors.js';

export class ScopedToolRegistry implements ScopedToolAccess {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly allowedTools: string[],
    private readonly agentName: string,
    private readonly permissions: PermissionsConfig,
    private readonly context: ToolContext,
  ) {}

  async invoke<T = unknown>(toolName: string, params: unknown): Promise<T> {
    if (!this.has(toolName)) {
      throw new ToolAccessDeniedError(toolName, this.agentName);
    }

    const tool = this.registry.get(toolName)!;

    // Validate params via Zod schema
    const validated = tool.parameters.parse(params);

    // Check permissions
    await this.checkPermission(tool);

    const result = await tool.execute(validated, this.context);
    return result as T;
  }

  list(): string[] {
    return this.allowedTools.filter((name) => this.registry.has(name));
  }

  has(toolName: string): boolean {
    return this.allowedTools.includes(toolName) && this.registry.has(toolName);
  }

  private async checkPermission(tool: ToolDefinition): Promise<void> {
    const { autoApprove = [], requireConfirmation = [], onConfirmation } = this.permissions;

    if (autoApprove.includes(tool.riskLevel as RiskLevel)) {
      return;
    }

    if (requireConfirmation.includes(tool.riskLevel as RiskLevel) && onConfirmation) {
      const approved = await onConfirmation(tool.name, {}, {
        riskLevel: tool.riskLevel as RiskLevel,
      });
      if (!approved) {
        throw new ToolConfirmationDeniedError(tool.name);
      }
    }
  }
}
