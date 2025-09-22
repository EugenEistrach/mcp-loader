import { tool } from "../../dist/tool.js";

export default tool({
  description: "Demo tool with enum and default value",
  args: {
    message: tool.schema.string().describe("Message to format"),
    style: tool.schema.enum(["uppercase", "lowercase", "capitalize"]).default("lowercase").describe("Text style"),
    prefix: tool.schema.enum(["info", "warn", "error", "debug"]).default("info").describe("Message prefix type"),
  },
  execute: ({ message, style, prefix }) => {
    let formatted = message;

    switch (style) {
      case "uppercase":
        formatted = message.toUpperCase();
        break;
      case "lowercase":
        formatted = message.toLowerCase();
        break;
      case "capitalize":
        formatted = message.charAt(0).toUpperCase() + message.slice(1).toLowerCase();
        break;
    }

    const prefixes = {
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
      debug: "🔍",
    };

    return `${prefixes[prefix]} [${prefix.toUpperCase()}] ${formatted}`;
  },
});