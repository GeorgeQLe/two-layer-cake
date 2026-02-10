import type { HookMap } from '../types/index.js';

type HookName = keyof HookMap;

export class HookRunner {
  constructor(private readonly hooks: HookMap) {}

  async run<K extends HookName>(
    hookName: K,
    ...args: Parameters<NonNullable<HookMap[K]>>
  ): Promise<ReturnType<NonNullable<HookMap[K]>> | null> {
    const hook = this.hooks[hookName];
    if (!hook) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (hook as (...a: any[]) => any)(...args);
    return result ?? null;
  }

  hasHook(hookName: HookName): boolean {
    return this.hooks[hookName] != null;
  }
}
