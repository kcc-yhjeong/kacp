import type { ZodRawShape } from 'zod';

/** One tool = one file (04-api.md §6). No permission logic here — the api decides. */
export interface ToolDef<S extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  run(token: string, args: { [K in keyof S]: unknown }): Promise<unknown>;
}

export const defineTool = <S extends ZodRawShape>(t: ToolDef<S>) => t;
