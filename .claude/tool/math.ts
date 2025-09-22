import { tool } from "../../dist/tool.js";

export const add = tool({
  description: "Add two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number(),
  },
  execute: ({ a, b }) => `${a} + ${b} = ${a + b}`,
});

export const multiply = tool({
  description: "Multiply two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number(),
  },
  execute: ({ a, b }) => `${a} × ${b} = ${a * b}`,
});

export const divide = tool({
  description: "Divide two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number(),
  },
  execute: ({ a, b }) => {
    if (b === 0) throw new Error("Division by zero");
    return `${a} ÷ ${b} = ${a / b}`;
  },
});