import { tool } from "../../dist/tool.js";

export default tool({
	description: "Test tool to verify MCP loader works",
	args: {
		message: tool.schema.string().optional(),
	},
	execute: async ({ message = "Hello from MCP Tool Loader!" }) => {
		return `Test successful: ${message}`;
	},
});

export const echo = tool({
	description: "Echo back a message",
	args: {
		text: tool.schema.string(),
	},
	execute: ({ text }) => `Echo: ${text}`,
});

export const getTime = tool({
	description: "Get current UTC time",
	args: {
		format: tool.schema.enum(["iso", "unix", "utc"]).optional(),
	},
	execute: async ({ format = "iso" }) => {
		const now = new Date();
		switch (format) {
			case "unix":
				return String(now.getTime());
			case "utc":
				return now.toUTCString();
			default:
				return now.toISOString();
		}
	},
});

export const hotReloadTest = tool({
	description: "Test that hot reload is working",
	args: {
		name: tool.schema.string().optional(),
	},
	execute: async ({ name = "World" }) => {
		return `🔥 Hot reload works! Hello ${name}, the time is ${new Date().toLocaleTimeString()}`;
	},
});

export const liveTest = tool({
	description: "Live reload test - added without restart",
	args: {},
	execute: async () => {
		return `✨ Live reload successful! This tool was added at ${new Date().toLocaleTimeString()} without restarting!`;
	},
});
