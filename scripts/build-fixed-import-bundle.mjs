import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePaperPdfText, parseAnswerPdfText, parseHistoricalTruthPdfText } from "../src/parser-core.js";

const ROOT_DIR = "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs";
const PAPER_DIR = path.join(ROOT_DIR, "Downloads");
const ANSWER_DIR = path.join(ROOT_DIR, "答案解");
const HISTORICAL_TRUTH_FILE = path.join(ROOT_DIR, "历年真题.pdf");
const OUT_JS = path.resolve("/Users/a66/Documents/Codex/2026-04-20-1-2-3-4-5-6/autoload-data.js");
const OUT_REPORT = path.resolve("/Users/a66/Documents/Codex/2026-04-20-1-2-3-4-5-6/data/autoload-report.json");
const MANUAL_HISTORICAL_ANSWER_VERSION = "historical-2025-answers-20260429-v1";
const HISTORICAL_2025_ANSWERS = [
  "D",
  "B",
  "A",
  "D",
  "A",
  "B",
  "A",
  "D",
  "C",
  "B",
  "C",
  "C",
  "A",
  "C",
  "B",
  "D",
  "C",
  "D",
  "A",
  "B",
  "C",
  "D",
  "A",
  "D",
  "A",
  "C",
  "D",
  "C",
  "C",
  "A",
  "B",
  "C",
  "A",
  "B",
  "A",
  "D",
  "C",
  "B",
  "A",
  "D",
  "B",
  "D",
  "A",
  "C",
  "A",
  "A",
  "B",
  "C",
  "A",
  "D",
  "B",
  "D",
  "B",
  "B",
  "C",
  "A",
  "D",
  "D",
  "B",
  "A",
  "D",
  "A",
  "D",
  "B",
  "C",
  "D",
  "A",
  "C",
  "C",
  "A",
  "ABC",
  "ABD",
  "ACD",
  "ABC",
  "ABD",
  "BD",
  "AC",
  "ABD",
  "ABC",
  "ABC",
  "ABCD",
  "ABCD",
  "BC",
  "ABD",
  "AB",
];

function naturalSort(a, b) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

function isPaperFile(name) {
  return /\.pdf$/i.test(name) && /题本/i.test(name) && /(时政刷题|公基时政刷题|模考)/i.test(name);
}

function isAnswerFile(name) {
  return /\.pdf$/i.test(name) && /(答案解析|解析)/i.test(name) && /(时政刷题|公基时政刷题|模考)/i.test(name);
}

async function extractPdfText(filePath) {
  const loadingTask = getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).filter(Boolean).join("\n"));
  }

  return pages.join("\n");
}

function collectFiles(dirPath, matcher) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((name) => matcher(name))
    .sort(naturalSort)
    .map((name) => path.join(dirPath, name));
}

function buildVersion(filePaths) {
  const fingerprint = filePaths
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return `${path.basename(filePath)}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|");
  return `fixed-${Buffer.from(fingerprint).toString("base64").replace(/[+/=]/g, "").slice(0, 24)}`;
}

async function parseFiles(filePaths, kind) {
  const items = [];
  const errors = [];

  for (const filePath of filePaths) {
    try {
      const text = await extractPdfText(filePath);
      const payload =
        kind === "paper"
          ? parsePaperPdfText(text, path.basename(filePath))
          : parseAnswerPdfText(text, path.basename(filePath));
      items.push(payload);
    } catch (error) {
      errors.push({
        file: path.basename(filePath),
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { items, errors };
}

async function parseHistoricalTruthFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { items: [], errors: [] };
  }

  try {
    const text = await extractPdfText(filePath);
    const payload = parseHistoricalTruthPdfText(text, path.basename(filePath));
    return { items: payload.papers, errors: [] };
  } catch (error) {
    return {
      items: [],
      errors: [
        {
          file: path.basename(filePath),
          kind: "historical-truth",
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function buildHistorical2025AnswerPayload(papers) {
  const paper = papers.find((item) => item.paperId === "historical-2025");
  if (!paper) {
    return null;
  }

  return {
    paperId: paper.paperId,
    paperTitle: paper.paperTitle,
    answers: HISTORICAL_2025_ANSWERS.map((answer, index) => ({
      questionNo: String(index + 1),
      correctAnswer: answer,
      explanation: "",
      type: index + 1 >= 71 ? "多选题" : "单选题",
    })),
    parserMeta: {
      source: "manual-photo-answer-key",
      version: MANUAL_HISTORICAL_ANSWER_VERSION,
    },
  };
}

const paperFiles = collectFiles(PAPER_DIR, isPaperFile);
const answerFiles = collectFiles(ANSWER_DIR, isAnswerFile);
const historicalTruthFiles = fs.existsSync(HISTORICAL_TRUTH_FILE) ? [HISTORICAL_TRUTH_FILE] : [];
const [paperResult, answerResult, historicalResult] = await Promise.all([
  parseFiles(paperFiles, "paper"),
  parseFiles(answerFiles, "answer"),
  parseHistoricalTruthFile(HISTORICAL_TRUTH_FILE),
]);
const allPapers = [...paperResult.items, ...historicalResult.items];
const historicalAnswerPayloads = [buildHistorical2025AnswerPayload(allPapers)].filter(Boolean);

const bundle = {
  version: `${buildVersion([...paperFiles, ...answerFiles, ...historicalTruthFiles])}-${MANUAL_HISTORICAL_ANSWER_VERSION}`,
  generatedAt: new Date().toISOString(),
  source: {
    paperDir: PAPER_DIR,
    answerDir: ANSWER_DIR,
    historicalTruthFile: HISTORICAL_TRUTH_FILE,
  },
  report: {
    paperFileCount: paperFiles.length + historicalTruthFiles.length,
    answerFileCount: answerFiles.length,
    historicalTruthPaperCount: historicalResult.items.length,
    historicalTruthAnswerCount: historicalAnswerPayloads.length,
    importedPaperCount: allPapers.length,
    importedAnswerCount: answerResult.items.length + historicalAnswerPayloads.length,
    errors: [...paperResult.errors, ...answerResult.errors, ...historicalResult.errors],
  },
  papers: allPapers,
  answers: [...answerResult.items, ...historicalAnswerPayloads],
};

fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
fs.writeFileSync(OUT_JS, `window.__AUTO_IMPORT_BUNDLE__ = ${JSON.stringify(bundle, null, 2)};\n`);
fs.writeFileSync(OUT_REPORT, `${JSON.stringify(bundle.report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      out: OUT_JS,
      version: bundle.version,
      paperFiles: paperFiles.length,
      historicalTruthFiles: historicalTruthFiles.length,
      answerFiles: answerFiles.length,
      importedPapers: bundle.report.importedPaperCount,
      historicalTruthPapers: bundle.report.historicalTruthPaperCount,
      importedAnswers: bundle.report.importedAnswerCount,
      errors: bundle.report.errors.length,
    },
    null,
    2
  )
);
