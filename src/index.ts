import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { watch } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, join, resolve } from "path";
import { pathToFileURL } from "url";
import type { z } from "zod";

// Type for our tool definition
interface ToolDefinition {
	description: string;
	args?: Record<string, z.ZodTypeAny>;
	execute: (args: unknown, context?: unknown) => Promise<unknown> | unknown;
}

// Type guard to check if something is a tool definition
function isToolDefinition(value: unknown): value is ToolDefinition {
	return (
		typeof value === "object" &&
		value !== null &&
		"description" in value &&
		"execute" in value &&
		typeof (value as ToolDefinition).description === "string" &&
		typeof (value as ToolDefinition).execute === "function"
	);
}

// Configuration
const toolDir = resolve(process.argv[2] || ".claude/tool");
const hotReload =
	process.env.MCP_NO_HOT_RELOAD !== "true" &&
	!process.argv.includes("--no-hot-reload");

if (hotReload) {
	console.error(`Hot reload enabled for ${toolDir}`);
} else {
	console.error(`Hot reload disabled for ${toolDir}`);
}

// Create MCP server with capabilities
const server = new McpServer({
	name: "mcp-loader",
	version: "0.1.0",
	capabilities: hotReload
		? {
				tools: { listChanged: true },
			}
		: undefined,
});

// Track registered tools for cleanup
const registeredTools = new Map<string, Set<string>>();

// Function to unregister tools from a file
function unregisterFileTools(file: string) {
	const baseName = file.replace(/\.(ts|js)$/, "");
	const toolNames = registeredTools.get(baseName);

	if (toolNames) {
		console.error(
			`Unregistering tools from ${file}: ${Array.from(toolNames).join(", ")}`,
		);
		// Access the internal _registeredTools object to remove tools
		// This is a workaround since MCP SDK doesn't provide an unregister method
		if ((server as any)._registeredTools) {
			toolNames.forEach((name) => {
				delete (server as any)._registeredTools[name];
			});
		}
		registeredTools.delete(baseName);
	}
}

// Function to register a tool with the server
function registerTool(name: string, tool: ToolDefinition, baseName: string) {
	// Track the tool
	if (!registeredTools.has(baseName)) {
		registeredTools.set(baseName, new Set());
	}
	registeredTools.get(baseName)!.add(name);

	const schema =
		tool.args && Object.keys(tool.args).length > 0 ? tool.args : undefined;
	console.error(`Registering tool: ${name}`);

	if (schema) {
		server.tool(
			name,
			tool.description,
			schema as any,
			async (args: unknown, extra: any) => {
				const result = await tool.execute(args, extra);
				return {
					content: [
						{
							type: "text" as const,
							text:
								typeof result === "string"
									? result
									: JSON.stringify(result, null, 2),
						},
					],
				};
			},
		);
	} else {
		// For tools with no args, callback only receives 'extra' parameter
		server.tool(name, tool.description, async (extra: any) => {
			const result = await tool.execute({}, extra);
			return {
				content: [
					{
						type: "text" as const,
						text:
							typeof result === "string"
								? result
								: JSON.stringify(result, null, 2),
					},
				],
			};
		});
	}
}

// Function to load a single tool file
async function loadToolFile(file: string) {
	if (!file.endsWith(".ts") && !file.endsWith(".js")) return;

	const filePath = join(toolDir, file);
	const baseName = file.replace(/\.(ts|js)$/, "");

	// First unregister any existing tools from this file
	unregisterFileTools(file);

	try {
		// Check if file still exists (for delete events)
		await stat(filePath);

		const fileUrl = pathToFileURL(filePath).href;

		// Add cache buster for dynamic imports when hot reloading
		const importUrl = hotReload ? `${fileUrl}?t=${Date.now()}` : fileUrl;
		const module = await import(importUrl);

		// Handle default export
		if (module.default && isToolDefinition(module.default)) {
			registerTool(baseName, module.default, baseName);
		}

		// Handle named exports
		Object.entries(module).forEach(([key, value]) => {
			if (key !== "default" && isToolDefinition(value)) {
				registerTool(`${baseName}_${key}`, value as ToolDefinition, baseName);
			}
		});
	} catch (e: any) {
		if (e.code === "ENOENT") {
			console.error(`File deleted: ${file}`);
		} else {
			console.error(`Failed to load ${file}:`, e.message || e);
		}
	}
}

// Function to load all tools
async function loadAllTools() {
	try {
		const files = await readdir(toolDir);
		for (const file of files) {
			await loadToolFile(file);
		}
	} catch (e) {
		console.error(`No tools found in ${toolDir}:`, e);
	}
}

// Initial load
await loadAllTools();

// Set up file watching if hot reload is enabled
if (hotReload) {
	console.error("Setting up file watcher...");

	// Debounce mechanism to avoid multiple reloads
	let reloadTimeout: NodeJS.Timeout | null = null;
	const pendingReloads = new Set<string>();

	const scheduleReload = () => {
		if (reloadTimeout) {
			clearTimeout(reloadTimeout);
		}

		reloadTimeout = setTimeout(async () => {
			const files = Array.from(pendingReloads);
			pendingReloads.clear();

			for (const file of files) {
				await loadToolFile(file);
			}

			// Notify clients that tool list has changed
			if (files.length > 0) {
				console.error("Sending tools/list_changed notification");
				try {
					// McpServer exposes the underlying server instance
					if (
						server.server &&
						typeof server.server.sendToolListChanged === "function"
					) {
						await server.server.sendToolListChanged();
					} else {
						console.error("sendToolListChanged method not available");
					}
				} catch (e) {
					console.error("Failed to send list_changed notification:", e);
				}
			}
		}, 100); // 100ms debounce
	};

	watch(toolDir, async (eventType, filename) => {
		console.error(`[File Watcher] Event: ${eventType}, Filename: ${filename}`);
		if (filename && (filename.endsWith(".ts") || filename.endsWith(".js"))) {
			console.error(`[File Watcher] Scheduling reload for: ${filename}`);
			pendingReloads.add(filename);
			scheduleReload();
		}
	});

	console.error("File watcher active");
}

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
	`MCP Loader started (hot reload: ${hotReload ? "enabled" : "disabled"})`,
);
console.error("File watcher active");
