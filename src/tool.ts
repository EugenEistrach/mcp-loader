import { z } from "zod";

export interface ToolContext {
  [key: string]: unknown;
}

type ZodRawShape = { [k: string]: z.ZodTypeAny };

export function tool<TArgs extends ZodRawShape = {}, TReturn = unknown>(config: {
  description: string;
  args?: TArgs;
  execute: (args: z.infer<z.ZodObject<TArgs>>, context?: ToolContext) => Promise<TReturn> | TReturn;
}) {
  return config;
}

tool.schema = z;