// 플랫폼 고정 영역 — 수정하지 마세요.
import type { z, ZodRawShape } from 'zod';

/** One tool = one file under src/tools/. `run` returns text or any JSON-able value. */
export interface ToolDef<S extends ZodRawShape = ZodRawShape> {
  /** Tool id the agent calls (snake_case). */
  name: string;
  title: string;
  /** Tells the agent when to use the tool. Be specific. */
  description: string;
  /** zod fields of the input object, e.g. `{ city: z.string() }`. */
  input: S;
  run(args: z.infer<z.ZodObject<S>>): Promise<unknown> | unknown;
}

export const defineTool = <S extends ZodRawShape>(t: ToolDef<S>): ToolDef<S> => t;
