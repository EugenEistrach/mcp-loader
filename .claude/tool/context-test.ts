import { tool } from "../../dist/tool.js";

export const trackUsage = tool({
  description: "Track tool usage with context information",
  args: {
    action: tool.schema.string().describe("What action was performed"),
  },
  execute: async ({ action }, context) => {
    const toolUseId = context?._meta?.['claudecode/toolUseId'] || 'unknown';
    const requestId = context?.requestId || 'unknown';
    const timestamp = new Date().toISOString();

    // In a real app, you could save this to a database or file
    const usage = {
      action,
      toolUseId,
      requestId,
      timestamp,
      hasSignal: !!context?.signal,
      canNotify: typeof context?.sendNotification === 'function',
      canRequest: typeof context?.sendRequest === 'function',
    };

    return {
      message: `Tracked action: ${action}`,
      usage,
      contextAvailable: !!context,
    };
  },
});

export const withTimeout = tool({
  description: "Execute something with timeout using AbortSignal from context",
  args: {
    delayMs: tool.schema.number().describe("How long to wait in milliseconds"),
  },
  execute: async ({ delayMs }, context) => {
    const signal = context?.signal;

    if (!signal) {
      return "No AbortSignal available in context";
    }

    try {
      // Use the AbortSignal to implement timeout
      const timeoutPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(`Completed after ${delayMs}ms`), delayMs);

        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Operation aborted'));
        });
      });

      const result = await timeoutPromise;
      return result;
    } catch (error: any) {
      return `Operation aborted: ${error.message}`;
    }
  },
});

export const contextInfo = tool({
  description: "Get detailed information about the MCP context",
  args: {},
  execute: async (_, context) => {
    if (!context) {
      return "No context available";
    }

    const info: any = {
      hasContext: true,
      availableKeys: Object.keys(context),
      capabilities: {
        canAbort: !!context.signal,
        canNotify: typeof context.sendNotification === 'function',
        canRequest: typeof context.sendRequest === 'function',
      },
      metadata: {},
    };

    // Extract metadata
    if (context._meta) {
      Object.entries(context._meta).forEach(([key, value]) => {
        // Only include serializable values
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          info.metadata[key] = value;
        }
      });
    }

    // Add request info
    if (context.requestId) {
      info.requestId = context.requestId;
    }

    if (context.sessionId) {
      info.sessionId = context.sessionId;
    }

    return info;
  },
});