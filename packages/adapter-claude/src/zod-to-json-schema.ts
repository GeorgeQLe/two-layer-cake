import type { ZodType } from 'zod';

/**
 * Minimal Zod-to-JSON-Schema converter. Handles common Zod types without
 * pulling in a full library. Walks the Zod internal `_def` tree and emits
 * a JSON Schema draft-07 compatible object.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: ZodType): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def;
  const typeName: string | undefined = def?.typeName;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };

    case 'ZodNumber':
      return { type: 'number' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodLiteral':
      return { type: typeof def.value, const: def.value };

    case 'ZodEnum':
      return { type: 'string', enum: def.values };

    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(def.values) };

    case 'ZodArray':
      return { type: 'array', items: convert(def.type) };

    case 'ZodObject': {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = value as ZodType;
        properties[key] = convert(fieldSchema);
        if (!isOptional(fieldSchema)) {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = {
        type: 'object',
        properties,
      };
      if (required.length > 0) {
        result.required = required;
      }
      result.additionalProperties = false;
      return result;
    }

    case 'ZodOptional':
      return convert(def.innerType);

    case 'ZodNullable': {
      const inner = convert(def.innerType);
      return { ...inner, nullable: true };
    }

    case 'ZodDefault':
      return convert(def.innerType);

    case 'ZodUnion': {
      const options = (def.options as ZodType[]).map(convert);
      return { anyOf: options };
    }

    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: convert(def.valueType),
      };

    case 'ZodTuple': {
      const items = (def.items as ZodType[]).map(convert);
      return { type: 'array', prefixItems: items, items: false };
    }

    case 'ZodEffects':
      // .refine(), .transform(), etc. -- pass through to the inner schema
      return convert(def.schema);

    case 'ZodLazy':
      return convert(def.getter());

    default:
      // Fallback: return empty schema (accepts anything)
      return {};
  }
}

function isOptional(schema: ZodType): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def;
  const typeName: string | undefined = def?.typeName;
  if (typeName === 'ZodOptional') return true;
  if (typeName === 'ZodDefault') return true;
  return false;
}
