/* eslint-disable local/max-nesting-depth */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import {
	Node,
	Project,
	type SourceFile,
	SyntaxKind,
	TypeFormatFlags,
	type ts,
} from "ts-morph";
import { tool } from "../../dist/tool.js";

// Top-level regex patterns for performance
const OMIT_ID_REGEX = /Omit<\{[^}]*_id:\s*Id<"Data(\w+)">/;
const ID_DATA_REGEX = /Id<"Data(\w+)">/;

interface TypeInfo {
	hash: string;
	typeString: string;
	count: number;
	suggestedName?: string;
	finalName?: string;
}

interface ExportInfo {
	name: string;
	kind: "function" | "type" | "interface" | "class" | "const" | "enum";
	signature: string;
	typeHash?: string;
	startLine: number;
	endLine: number;
}

class TypeDeduplicator {
	private readonly typeMap = new Map<string, TypeInfo>();
	private readonly typeChecker: ts.TypeChecker;

	constructor(typeChecker: ts.TypeChecker) {
		this.typeChecker = typeChecker;
	}

	cleanTypeString(typeStr: string): string {
		// Remove import() statements with paths
		typeStr = typeStr.replace(/import\("[^"]+"\)\./g, "");
		// Clean up Convex Id types
		typeStr = typeStr.replace(/import\("[^"]+\/values\/value"\)\.Id/g, "Id");
		// Normalize whitespace
		typeStr = typeStr.replace(/\s+/g, " ").trim();
		return typeStr;
	}

	private generateTypeName(typeStr: string, context?: string): string {
		// Extract meaningful name from type structure
		if (typeStr.includes("Omit<")) {
			const match = typeStr.match(OMIT_ID_REGEX);
			if (match) {
				return `${match[1]}Input`;
			}
		}

		if (typeStr.includes('Id<"')) {
			const match = typeStr.match(ID_DATA_REGEX);
			if (match) {
				return `${match[1]}Doc`;
			}
		}

		if (typeStr.includes("{ en: string; de: string; }")) {
			return "LocalizedString";
		}

		if (context) {
			return `${context}Type`;
		}

		// Generate generic name
		return "SharedType";
	}

	registerType(node: Node, context?: string): string {
		if (!Node.isTyped(node)) {
			return "unknown";
		}

		// First try to get the type as written in code
		const typeNode = node.getTypeNode();
		if (typeNode) {
			let typeStr = typeNode.getText();
			typeStr = this.cleanTypeString(typeStr);

			// Skip simple types
			if (typeStr.length < 80 && !typeStr.includes("{")) {
				return typeStr;
			}

			// Create hash
			const hash = createHash("md5").update(typeStr).digest("hex");

			// Track usage
			if (this.typeMap.has(hash)) {
				const info = this.typeMap.get(hash);
				if (info) {
					info.count++;
					return info.finalName || typeStr;
				}
			}

			// Register new type
			this.typeMap.set(hash, {
				hash,
				typeString: typeStr,
				count: 1,
				suggestedName: this.generateTypeName(typeStr, context),
			});

			return typeStr;
		}

		// Fallback for inferred types
		const type = node.getType();
		const symbol = type.getSymbol();

		// If this has a symbol name, use it
		if (symbol) {
			const symbolName = symbol.getName();
			// Skip generic object type
			if (symbolName === "__type" || symbolName === "__object") {
				// For const objects, try to get a concise representation
				if (Node.isVariableDeclaration(node)) {
					return "{ ... }";
				}
			} else {
				return this.cleanTypeString(symbolName);
			}
		}

		// Last resort: minimal expansion
		const tsType = type.compilerType;
		const tsNode = node.compilerNode as ts.Node;

		const formatFlags =
			TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
			TypeFormatFlags.InTypeAlias;

		let typeStr = this.typeChecker.typeToString(tsType, tsNode, formatFlags);
		typeStr = this.cleanTypeString(typeStr);

		// Skip simple types
		if (typeStr.length < 80 && !typeStr.includes("{")) {
			return typeStr;
		}

		// Create hash
		const hash = createHash("md5").update(typeStr).digest("hex");

		// Track usage
		if (this.typeMap.has(hash)) {
			const info = this.typeMap.get(hash);
			if (info) {
				info.count++;
				return info.finalName || typeStr;
			}
		}

		// Register new type
		this.typeMap.set(hash, {
			hash,
			typeString: typeStr,
			count: 1,
			suggestedName: this.generateTypeName(typeStr, context),
		});

		return typeStr;
	}

	finalizeTypes(): Map<string, TypeInfo> {
		// Identify types to deduplicate
		const sharedTypes = new Map<string, TypeInfo>();
		const usedNames = new Set<string>();

		for (const [hash, info] of this.typeMap) {
			// Only deduplicate if used 2+ times and complex
			if (
				info.count >= 2 &&
				(info.typeString.length > 100 || info.typeString.includes("{"))
			) {
				let name = info.suggestedName || "SharedType";
				let counter = 1;

				// Handle name collisions
				while (usedNames.has(name)) {
					name = `${info.suggestedName}${counter++}`;
				}

				usedNames.add(name);
				info.finalName = name;
				sharedTypes.set(hash, info);
			}
		}

		return sharedTypes;
	}

	getReturnType(node: Node): string {
		if (!Node.isReturnTyped(node)) {
			return "void";
		}

		// Get return type WITHOUT NoTruncation flag - let TS truncate naturally
		const returnType = node.getReturnType();
		const tsType = returnType.compilerType;
		const tsNode = node.compilerNode as ts.Node;

		// Don't use NoTruncation for return types - let TypeScript decide
		const formatFlags =
			TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
			TypeFormatFlags.InTypeAlias;

		const typeStr = this.typeChecker.typeToString(tsType, tsNode, formatFlags);
		return this.cleanTypeString(typeStr);
	}

	getTypeReference(node: Node): string {
		if (!Node.isTyped(node)) {
			return "unknown";
		}

		// First try to get the type as written in code (not expanded)
		const typeNode = node.getTypeNode();
		if (typeNode) {
			// Use the actual text from the source code
			let typeText = typeNode.getText();
			typeText = this.cleanTypeString(typeText);

			// Check if this was deduplicated
			const hash = createHash("md5").update(typeText).digest("hex");
			const typeInfo = this.typeMap.get(hash);
			if (typeInfo?.finalName) {
				return typeInfo.finalName;
			}

			return typeText;
		}

		// Fallback to type checker (for inferred types)
		const type = node.getType();
		const symbol = type.getSymbol();

		// If this type has a symbol (named type), use the symbol name
		if (symbol) {
			const symbolName = symbol.getName();
			// Check if this is a type alias or interface
			if (symbolName === "__type" || symbolName === "__object") {
				// For object literals, show a concise form
				const typeStr = this.typeChecker.typeToString(type.compilerType);
				if (typeStr.includes("{") && typeStr.length > 100) {
					return "{ ... }";
				}
			} else {
				return this.cleanTypeString(symbolName);
			}
		}

		// Last resort: use the type checker with flags to preserve aliases
		const tsType = type.compilerType;
		const tsNode = node.compilerNode as ts.Node;

		const formatFlags =
			TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
			TypeFormatFlags.UseTypeOfFunction |
			TypeFormatFlags.InTypeAlias;

		let typeStr = this.typeChecker.typeToString(tsType, tsNode, formatFlags);
		typeStr = this.cleanTypeString(typeStr);

		// Check if this type was deduplicated
		const hash = createHash("md5").update(typeStr).digest("hex");
		const typeInfo = this.typeMap.get(hash);

		if (typeInfo?.finalName) {
			return typeInfo.finalName;
		}

		return typeStr;
	}
}

function formatTypeWithBiome(typeDeclaration: string): string {
	// Create a temporary file
	const tmpFile = join(tmpdir(), `type-${Date.now()}.ts`);

	try {
		// Write type declaration to temp file
		writeFileSync(tmpFile, typeDeclaration);

		// Format with biome
		execSync(`npx @biomejs/biome format --write ${tmpFile}`, {
			stdio: "pipe",
		});

		// Read formatted result
		const formatted = readFileSync(tmpFile, "utf8");
		return formatted.trim();
	} catch (error) {
		// If biome fails, return original
		console.warn("Biome formatting failed, using original");
		return typeDeclaration;
	} finally {
		// Clean up temp file
		try {
			unlinkSync(tmpFile);
		} catch {}
	}
}

function processFile(
	sourceFile: SourceFile,
	deduplicator: TypeDeduplicator,
	filterFunctionsOnly: boolean,
	filterTypesOnly: boolean,
): ExportInfo[] {
	const exports: ExportInfo[] = [];
	const exportedDeclarations = sourceFile.getExportedDeclarations();

	for (const [name, declarations] of exportedDeclarations) {
		for (const decl of declarations) {
			if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) {
				if (filterTypesOnly) {
					continue; // Skip functions if only showing types
				}
				const params = Node.isParametered(decl) ? decl.getParameters() : [];
				const paramStrs = params.map((p) => {
					const paramName = p.getName();
					const isOptional = p.isOptional();
					const type = deduplicator.getTypeReference(p);
					const defaultValue = p.getInitializer()?.getText();

					let paramStr = paramName;
					if (isOptional && !defaultValue) {
						paramStr += "?";
					}
					paramStr += `: ${type}`;
					if (defaultValue) {
						paramStr += ` = ${defaultValue}`;
					}
					return paramStr;
				});

				const returnType = deduplicator.getReturnType(decl);

				exports.push({
					name,
					kind: "function",
					signature: `${name}(${paramStrs.join(", ")}): ${returnType}`,
					startLine: decl.getStartLineNumber(),
					endLine: decl.getEndLineNumber(),
				});
			} else if (Node.isTypeAliasDeclaration(decl)) {
				if (filterFunctionsOnly) {
					continue; // Skip types if only showing functions
				}
				const typeStr = deduplicator.registerType(decl, name);
				exports.push({
					name,
					kind: "type",
					signature: `type ${name} = ${typeStr}`,
					startLine: decl.getStartLineNumber(),
					endLine: decl.getEndLineNumber(),
				});
			} else if (Node.isInterfaceDeclaration(decl)) {
				if (filterFunctionsOnly) {
					continue; // Skip interfaces if only showing functions
				}
				const props: string[] = [];

				for (const prop of decl.getProperties()) {
					const propName = prop.getName();
					const isOptional = prop.hasQuestionToken();
					const type = deduplicator.getTypeReference(prop);
					props.push(`  ${propName}${isOptional ? "?" : ""}: ${type}`);
				}

				for (const method of decl.getMethods()) {
					const methodName = method.getName();
					const params = method.getParameters();
					const paramStrs = params.map((p) => {
						const paramName = p.getName();
						const type = deduplicator.getTypeReference(p);
						return `${paramName}: ${type}`;
					});
					const returnType = deduplicator.getReturnType(method);
					props.push(`  ${methodName}(${paramStrs.join(", ")}): ${returnType}`);
				}

				exports.push({
					name,
					kind: "interface",
					signature:
						props.length > 0
							? `interface ${name}\n${props.join("\n")}`
							: `interface ${name}`,
					startLine: decl.getStartLineNumber(),
					endLine: decl.getEndLineNumber(),
				});
			} else if (Node.isClassDeclaration(decl)) {
				if (filterFunctionsOnly) {
					continue; // Classes are like types
				}
				const className = decl.getName() || "Anonymous";
				const members: string[] = [];

				const publicMethods = decl
					.getMethods()
					.filter((m) => !m.hasModifier(SyntaxKind.PrivateKeyword));

				for (const method of publicMethods) {
					const methodName = method.getName();
					const isStatic = method.hasModifier(SyntaxKind.StaticKeyword);
					const params = method.getParameters();
					const paramStrs = params.map((p) => {
						const paramName = p.getName();
						const type = deduplicator.getTypeReference(p);
						return `${paramName}: ${type}`;
					});
					const returnType = deduplicator.getReturnType(method);
					const prefix = isStatic ? "static " : "";
					members.push(
						`  ${prefix}${methodName}(${paramStrs.join(", ")}): ${returnType}`,
					);
				}

				exports.push({
					name: className,
					kind: "class",
					signature:
						members.length > 0
							? `class ${className}\n${members.join("\n")}`
							: `class ${className}`,
					startLine: decl.getStartLineNumber(),
					endLine: decl.getEndLineNumber(),
				});
			} else if (Node.isVariableDeclaration(decl)) {
				if (filterTypesOnly) {
					continue; // Skip variables if only showing types
				}
				const varStmt = decl.getVariableStatement();
				if (varStmt) {
					const initializer = decl.getInitializer();
					let signature = "";

					if (initializer) {
						// Check if it's an arrow function or function expression
						if (
							Node.isArrowFunction(initializer) ||
							Node.isFunctionExpression(initializer)
						) {
							// Extract function signature
							const params = initializer.getParameters();
							const paramStrs = params.map((p) => {
								const paramName = p.getName();
								const isOptional = p.isOptional();
								const type = deduplicator.getTypeReference(p);
								const defaultValue = p.getInitializer()?.getText();

								let paramStr = paramName;
								if (isOptional && !defaultValue) {
									paramStr += "?";
								}
								paramStr += `: ${type}`;
								if (defaultValue) {
									paramStr += ` = ${defaultValue}`;
								}
								return paramStr;
							});

							const returnType = deduplicator.getReturnType(initializer);
							signature = `const ${name}(${paramStrs.join(", ")}): ${returnType}`;
						}
						// Check if it's a Convex function call
						else if (Node.isCallExpression(initializer)) {
							const callName = initializer.getExpression().getText();
							// Check for all Convex function types
							const convexFunctions = [
								"mutation",
								"query",
								"action",
								"internalMutation",
								"internalQuery",
								"internalAction",
								"httpAction",
							];

							if (convexFunctions.includes(callName)) {
								// Extract args and returns from Convex function
								let argsText = "";
								let returnsText = "";

								const configArg = initializer.getArguments()[0];
								if (configArg && Node.isObjectLiteralExpression(configArg)) {
									// Extract args
									const argsProperty = configArg.getProperty("args");
									if (argsProperty && Node.isPropertyAssignment(argsProperty)) {
										const argsInit = argsProperty.getInitializer();
										if (argsInit) {
											argsText = argsInit.getText();
										}
									}

									// Extract returns validator if present
									const returnsProperty = configArg.getProperty("returns");
									if (
										returnsProperty &&
										Node.isPropertyAssignment(returnsProperty)
									) {
										const returnsInit = returnsProperty.getInitializer();
										if (returnsInit) {
											returnsText = returnsInit.getText();
										}
									}
								}

								// Build signature - show as export with Convex function type
								signature = `export ${name} [${callName}]`;
								if (argsText) {
									signature += `(args: ${argsText})`;
								}
								if (returnsText) {
									signature += ` → ${returnsText}`;
								}
							} else {
								// Regular function call or other expression
								const initText = initializer.getText();
								if (initText.length > 50) {
									signature = `const ${name} = ${initText.substring(0, 50)}...`;
								} else {
									signature = `const ${name} = ${initText}`;
								}
							}
						} else {
							// Other const (object, primitive, etc)
							const initText = initializer.getText();
							if (initText.length > 50) {
								signature = `const ${name} = ${initText.substring(0, 50)}...`;
							} else {
								signature = `const ${name} = ${initText}`;
							}
						}
					} else {
						// No initializer
						signature = `const ${name}`;
					}

					exports.push({
						name,
						kind: "const",
						signature,
						startLine: decl.getStartLineNumber(),
						endLine: decl.getEndLineNumber(),
					});
				}
			} else if (Node.isEnumDeclaration(decl)) {
				if (filterFunctionsOnly) {
					continue; // Enums are like types
				}
				const members = decl.getMembers().map((m) => m.getName());
				const signature =
					members.length <= 5
						? `enum ${name} { ${members.join(", ")} }`
						: `enum ${name} { ${members.slice(0, 3).join(", ")}, ... (${members.length} total) }`;

				exports.push({
					name,
					kind: "enum",
					signature,
					startLine: decl.getStartLineNumber(),
					endLine: decl.getEndLineNumber(),
				});
			}
		}
	}

	return exports;
}

async function generateCodeMap(
	targetPath: string,
	functionsOnly: boolean,
	typesOnly: boolean,
): Promise<string> {
	let output = "";
	const log = (msg: string = "") => {
		output += msg + "\n";
	};
	const project = new Project({
		tsConfigFilePath: join(process.cwd(), "tsconfig.json"),
	});

	const absolutePath = isAbsolute(targetPath)
		? targetPath
		: join(process.cwd(), targetPath);

	// Check if target is a file or directory
	const isFile =
		existsSync(absolutePath) && statSync(absolutePath).isFile();

	if (isFile) {
		// Single file
		project.addSourceFileAtPath(absolutePath);
	} else {
		// Directory - include both .ts and .tsx files
		const patterns = [
			join(absolutePath, "**/*.ts"),
			join(absolutePath, "**/*.tsx"),
		];
		project.addSourceFilesAtPaths(patterns);
	}

	const sourceFiles = project
		.getSourceFiles()
		.filter((sf) => !sf.getFilePath().includes("node_modules"))
		.filter((sf) => !sf.getFilePath().endsWith(".test.ts"))
		.filter((sf) => !sf.getFilePath().endsWith(".d.ts"));

	const typeChecker = project.getTypeChecker().compilerObject;
	const deduplicator = new TypeDeduplicator(typeChecker);

	// Phase 1: First pass - register ALL types across ALL files
	for (const sourceFile of sourceFiles) {
		const exportedDeclarations = sourceFile.getExportedDeclarations();
		for (const [name, declarations] of exportedDeclarations) {
			for (const decl of declarations) {
				// Register all complex types
				if (Node.isTyped(decl)) {
					deduplicator.registerType(decl, name);
				}
				// Register parameter and return types
				if (Node.isParametered(decl)) {
					for (const param of decl.getParameters()) {
						deduplicator.registerType(param);
					}
				}
			}
		}
	}

	// Phase 2: Finalize deduplicated types
	const sharedTypes = deduplicator.finalizeTypes();

	// Phase 3: Second pass - collect exports using deduplicated type names
	const fileExports = new Map<string, ExportInfo[]>();

	for (const sourceFile of sourceFiles) {
		const exports = processFile(
			sourceFile,
			deduplicator,
			functionsOnly,
			typesOnly,
		);
		if (exports.length > 0) {
			// For single files, use basename; for directories use relative path
			const filePath = isFile
				? basename(sourceFile.getFilePath())
				: relative(absolutePath, sourceFile.getFilePath());
			fileExports.set(filePath, exports);
		}
	}

	// Phase 4: Output
	log(`Code Map for: ${targetPath}`);
	log("=".repeat(50));

	// Output shared types if any
	if (sharedTypes.size > 0) {
		log(`\n// ===== Shared Types (${sharedTypes.size} types) =====`);

		// Sort by usage count
		const sortedTypes = Array.from(sharedTypes.values()).sort(
			(a, b) => b.count - a.count,
		);

		for (const typeInfo of sortedTypes) {
			const typeDecl = `type ${typeInfo.finalName} = ${typeInfo.typeString}`;
			const formatted = formatTypeWithBiome(typeDecl);
			log(formatted);
			log(`// Used ${typeInfo.count} times\n`);
		}

		log("// ===== Code Map =====");
	}

	// Output file exports
	for (const [filePath, exports] of fileExports) {
		log(`\n${filePath}:`);
		for (const exp of exports) {
			const lineRange = `L${exp.startLine}-${exp.endLine}`;
			if (exp.signature.includes("\n")) {
				// Multi-line signatures (interfaces, classes)
				const lines = exp.signature.split("\n");
				log(`  ${lineRange}: ${lines[0]}`);
				for (let i = 1; i < lines.length; i++) {
					log(`  ${" ".repeat(lineRange.length + 2)}${lines[i]}`);
				}
			} else {
				log(`  ${lineRange}: ${exp.signature}`);
			}
		}
	}

	return output;
}

export default tool({
	description:
		"View code map showing all exports and signatures from TypeScript files",
	args: {
		path: tool.schema
			.string()
			.describe(
				"Path to folder or file (e.g. 'convex/v2/api' or 'src/5-shared/ui/button.tsx')",
			),
		filter: tool.schema
			.enum(["all", "functions", "types"])
			.optional()
			.default("all")
			.describe(
				"Filter exports: all, functions (including mutations/queries), or types/interfaces",
			),
	},
	execute: async ({ path, filter = "all" }) => {
		const showFunctionsOnly = filter === "functions";
		const showTypesOnly = filter === "types";

		try {
			return await generateCodeMap(path, showFunctionsOnly, showTypesOnly);
		} catch (error) {
			if (error.message?.includes("Cannot find module")) {
				return `Error: Path not found: ${path}`;
			}
			return `Error generating code map: ${error.message || error}`;
		}
	},
});
