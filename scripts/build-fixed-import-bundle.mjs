import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePaperPdfText, parseAnswerPdfText, parseHistoricalTruthPdfText } from "../src/parser-core.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = path.join(PROJECT_DIR, "config/local-paths.json");
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_DIR, "config/local-paths.example.json");
const MANUAL_HISTORICAL_ANSWER_VERSION = "historical-2025-answers-20260429-v1";
const HISTORICAL_2025_ANSWERS = "D B A D A B A D C B C C A C B D C D A B C D A D A C D C C A B C A B A D C B A D B D A C A A B C A D B D B B C A D D B A D A D B C D A C C A ABC ABD ACD ABC ABD BD AC ABD ABC ABC ABCD ABCD BC ABD AB".split(" ");

function fail(message, details = []) {
  console.error(["build-fixed-import-bundle 配置错误：", message, ...details.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

function readLocalPaths() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`缺少 ${path.relative(PROJECT_DIR, CONFIG_PATH)}`, [
      `请复制 ${path.relative(PROJECT_DIR, EXAMPLE_CONFIG_PATH)} 为 config/local-paths.json`,
      "然后把题本目录、答案目录、历年真题文件和输出路径改成本机真实路径。",
    ]);
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    fail(`无法解析 ${path.relative(PROJECT_DIR, CONFIG_PATH)}。`, [
      error instanceof Error ? error.message : String(error),
      "请确认 JSON 没有注释、尾逗号或未转义的反斜杠。",
    ]);
  }
}

function requiredPath(config, key) {
  const value = String(config[key] || "").trim();
  if (!value) {
    fail(`缺少 ${key} 配置。`, [`请在 ${path.relative(PROJECT_DIR, CONFIG_PATH)} 中补充 ${key}。`]);
  }
  return path.resolve(value);
}

function loadLocalPaths() {
  const config = readLocalPaths();
  const localPaths = {
    paperDir: requiredPath(config, "paperDir"),
    answerDir: requiredPath(config, "answerDir"),
    historicalTruthFile: requiredPath(config, "historicalTruthFile"),
    outJs: requiredPath(config, "outputBundle"),
    outReport: requiredPath(config, "outputReport"),
  };
  const missingDirs = [["paperDir", localPaths.paperDir], ["answerDir", localPaths.answerDir]].filter(([, dirPath]) => !fs.existsSync(dirPath));
  if (missingDirs.length) {
    fail("输入目录不存在。", missingDirs.map(([key, dirPath]) => `${key}: ${dirPath}`));
  }
  if (fs.existsSync(localPaths.historicalTruthFile) && !fs.statSync(localPaths.historicalTruthFile).isFile()) {
    fail("historicalTruthFile 不是文件。", [`historicalTruthFile: ${localPaths.historicalTruthFile}`]);
  }
  return localPaths;
}

const { paperDir: PAPER_DIR, answerDir: ANSWER_DIR, historicalTruthFile: HISTORICAL_TRUTH_FILE, outJs: OUT_JS, outReport: OUT_REPORT } = loadLocalPaths();

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
  return fs.readdirSync(dirPath).filter((name) => matcher(name)).sort(naturalSort).map((name) => path.join(dirPath, name));
}

function buildVersion(filePaths) {
  if (!filePaths.length) {
    return "fixed-empty";
  }
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
      const payload = kind === "paper" ? parsePaperPdfText(text, path.basename(filePath)) : parseAnswerPdfText(text, path.basename(filePath));
      items.push(payload);
    } catch (error) {
      errors.push({
        file: path.basename(filePath),
        path: filePath,
        kind,
        error: error instanceof Error ? error.message : String(error),
        hint: "请检查 PDF 是否可复制文本、文件名是否包含期次信息，以及解析规则是否覆盖该版式。",
      });
    }
  }

  return { items, errors };
}

async function parseHistoricalTruthFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      items: [],
      errors: [
        {
          file: path.basename(filePath),
          path: filePath,
          kind: "historical-truth",
          error: "文件不存在，已跳过历年真题导入。",
          hint: "如果暂时不导入历年真题，可以先放一个正确路径的 PDF，或后续把该输入改成可选配置。",
        },
      ],
    };
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
          path: filePath,
          kind: "historical-truth",
          error: error instanceof Error ? error.message : String(error),
          hint: "请检查历年真题 PDF 是否可复制文本，或调整 parseHistoricalTruthPdfText 的版式规则。",
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

if (!paperFiles.length) {
  console.warn(`未在题本目录找到匹配 PDF：${PAPER_DIR}`);
}
if (!answerFiles.length) {
  console.warn(`未在答案目录找到匹配 PDF：${ANSWER_DIR}`);
}

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

fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
fs.writeFileSync(OUT_JS, `window.__AUTO_IMPORT_BUNDLE__ = ${JSON.stringify(bundle, null, 2)};\n`);
fs.writeFileSync(OUT_REPORT, `${JSON.stringify(bundle.report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      out: OUT_JS,
      report: OUT_REPORT,
      version: bundle.version,
      paperFiles: paperFiles.length,
      historicalTruthFiles: historicalTruthFiles.length,
      answerFiles: answerFiles.length,
      importedPapers: bundle.report.importedPaperCount,
      historicalTruthPapers: bundle.report.historicalTruthPaperCount,
      importedAnswers: bundle.report.importedAnswerCount,
      errors: bundle.report.errors.length,
      errorHints: bundle.report.errors.map((item) => ({
        kind: item.kind,
        file: item.file,
        error: item.error,
        hint: item.hint,
      })),
    },
    null,
    2
  )
);
