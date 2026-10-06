import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { build } from "vite-plus";

/** Bundle the browser renderer locally; diagrams never depend on a CDN or a second origin. */
export async function generateMermaidScript() {
  const mobileRoot = NodePath.resolve(import.meta.dirname, "..");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodePath.join(mobileRoot, "src/features/markdown/mermaid.browser.ts"),
        name: "T3Mermaid",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const chunk = bundles
    .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Mermaid build did not emit a script.");
  const root = NodePath.join(mobileRoot, ".generated/mermaid");
  await NodeFSP.mkdir(root, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, "index.js"),
    `module.exports = ${JSON.stringify(chunk.code)};\n`,
  );
  await NodeFSP.writeFile(NodePath.join(root, "package.json"), '{"main":"index.js"}\n');
}
