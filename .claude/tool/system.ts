import { tool } from "../../dist/tool.js";

export default tool({
  description: "Get system information and MCP context",
  args: {},
  execute: async (_, context) => {
    // Just return the raw context directly
    return {
      rawContext: context,
      system: {
        platform: process.platform,
        node: process.version,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
        uptime: Math.round(process.uptime()) + "s",
        cwd: process.cwd(),
        pid: process.pid
      }
    };
  },
});