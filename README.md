# MCP Loader

Drop `.ts` or `.js` files in a folder. They become MCP tools. That's it.

## Quick Start

```typescript
// .claude/tool/math.ts
import { tool } from "mcp-loader";

export const add = tool({
  description: "Add two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number(),
  },
  execute: ({ a, b }) => a + b,
});
```

Add to `.mcp.json`:
```json
{
  "mcpServers": {
    "tools": {
      "command": "npx",
      "args": ["mcp-loader", ".claude/tool"]
    }
  }
}
```

Done. Tools work in Claude.

## Install

Global install:
```bash
npm install -g mcp-loader
```

Or as a dev dependency:
```bash
npm install --save-dev mcp-loader
```

Or just use npx (no install):
```bash
npx mcp-loader .claude/tool
```

## Features

- **Hot reload** - Save file, tool updates (disable with `MCP_NO_HOT_RELOAD=true`)
- **Multiple tools per file** - Use named exports
- **MCP context** - Second param in execute has request info
- **TypeScript** - Full type safety

## Note

After changing tools, refresh with `/mcp` in Claude Code or restart Claude Desktop.

Uses bundled Zod v3 for schemas. Custom Zod versions may conflict.

## License

MIT