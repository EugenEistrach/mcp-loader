import { tool } from "../../dist/tool.js";

export const info = tool({
	description: "Get information about the current Claude Code session",
	args: {},
	execute: async (_, context) => {
		const meta = context?._meta || {};

		return {
			toolUseId: meta["claudecode/toolUseId"] || "Unknown",
			sessionId: context?.sessionId || "No session ID available",
			requestId: context?.requestId || "Unknown",
			hasNotificationCapability:
				typeof context?.sendNotification === "function",
			hasRequestCapability: typeof context?.sendRequest === "function",
			timestamp: new Date().toISOString(),
		};
	},
});

export const notify = tool({
	description: "Send a notification through MCP",
	args: {
		message: tool.schema.string().describe("The notification message"),
		level: tool.schema
			.enum(["info", "warning", "error"])
			.optional()
			.default("info")
			.describe("Notification level"),
	},
	execute: async ({ message, level = "info" }, context) => {
		if (context?.sendNotification) {
			try {
				// Try to send a logging notification
				await context.sendNotification({
					method: "notifications/message",
					params: {
						level,
						message,
						data: {
							timestamp: new Date().toISOString(),
							source: "mcp-tool-loader",
						},
					},
				});
				return `Notification sent: ${message} (level: ${level})`;
			} catch (error) {
				return `Failed to send notification: ${error}`;
			}
		}
		return "Notification capability not available in context";
	},
});

export const request = tool({
	description: "Make a request through MCP protocol",
	args: {
		method: tool.schema.string().describe("The MCP method to call"),
	},
	execute: async ({ method }, context) => {
		if (context?.sendRequest) {
			try {
				const result = await context.sendRequest({
					method,
					params: {},
				});
				return {
					success: true,
					method,
					result,
				};
			} catch (error) {
				return {
					success: false,
					method,
					error: String(error),
				};
			}
		}
		return "Request capability not available in context";
	},
});
