import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const jsTarget = path.join(projectRoot, "pdf.worker.min.js");
const mjsTarget = path.join(projectRoot, "pdf.worker.min.mjs");

fs.rmSync(jsTarget, { force: true });
fs.rmSync(mjsTarget, { force: true });
fs.copyFileSync(source, jsTarget);
fs.copyFileSync(source, mjsTarget);
console.log(`Copied worker: ${source} -> ${jsTarget}`);
console.log(`Copied worker: ${source} -> ${mjsTarget}`);
