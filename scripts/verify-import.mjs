import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePaperPdfText, parseAnswerPdfText } from "../src/parser-core.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = path.join(PROJECT_DIR, "config/local-paths.json");
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_DIR, "config/local-paths.example.json");

function fail(message, details = []) {
  console.error(["verify-import 配置错误：", message, ...details.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

function readLocalPaths() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`缺少 ${path.relative(PROJECT_DIR, CONFIG_PATH)}`, [
      `请复制 ${path.relative(PROJECT_DIR, EXAMPLE_CONFIG_PATH)} 为 config/local-paths.json`,
      "然后把 verifyFiles 中的样例 PDF 路径改成本机真实文件。",
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

function validateVerifyFiles(config) {
  const files = config.verifyFiles;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    fail("缺少 verifyFiles 配置。", ["需要至少配置一个题本 PDF 和一个答案解析 PDF。"]);
  }

  const entries = Object.entries(files).filter(([, filePath]) => String(filePath || "").trim());
  if (!entries.length) {
    fail("verifyFiles 为空。", ["请在 config/local-paths.json 中填入用于验证导入的 PDF 文件路径。"]);
  }

  const missing = entries.filter(([, filePath]) => !fs.existsSync(filePath));
  if (missing.length) {
    fail("verifyFiles 中存在找不到的文件。", missing.map(([key, filePath]) => `${key}: ${filePath}`));
  }

  return Object.fromEntries(entries);
}

const files = validateVerifyFiles(readLocalPaths());
const store = { papers: [], questions: [] };

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

function questionKey(question) {
  return `${question.paperId}::${question.questionNo}`;
}

function importPaper(payload) {
  store.papers = store.papers.filter((paper) => paper.paperId !== payload.paperId);
  store.papers.push({ paperId: payload.paperId, paperTitle: payload.paperTitle });
  const others = store.questions.filter((question) => question.paperId !== payload.paperId);
  store.questions = [...others, ...payload.questions];
}

function importAnswers(payload) {
  const paper = store.papers.find((item) => item.paperId === payload.paperId);
  if (!paper) {
    throw new Error("期次不匹配或缺少对应题本");
  }

  const answerMap = new Map(payload.answers.map((item) => [item.questionNo, item]));
  let hits = 0;
  store.questions = store.questions.map((question) => {
    if (question.paperId !== payload.paperId) {
      return question;
    }
    const answer = answerMap.get(question.questionNo);
    if (!answer) {
      return question;
    }
    hits += 1;
    return {
      ...question,
      correctAnswer: answer.correctAnswer,
      explanation: answer.explanation,
    };
  });
  if (!hits) {
    throw new Error("期次不匹配或缺少对应题本");
  }
}

for (const [key, filePath] of Object.entries(files)) {
  try {
    const text = await extractPdfText(filePath);
    if (key.startsWith("q")) {
      const payload = parsePaperPdfText(text, path.basename(filePath));
      importPaper(payload);
      console.log("IMPORTED_PAPER", payload.paperId, payload.paperTitle, payload.questions.length);
    } else {
      const payload = parseAnswerPdfText(text, path.basename(filePath));
      try {
        importAnswers(payload);
        console.log("IMPORTED_ANSWER", payload.paperId, payload.answers.length);
      } catch (error) {
        console.log("ANSWER_IMPORT_ERROR", payload.paperId, error.message);
      }
    }
  } catch (error) {
    console.error(
      [
        "VERIFY_FILE_ERROR",
        key,
        filePath,
        error instanceof Error ? error.message : String(error),
        "请确认该文件是可读取的 PDF，并且文件名包含可识别的期次信息。",
      ].join("\n")
    );
    process.exitCode = 1;
  }
}

console.log("STORE_PAPERS", store.papers.map((paper) => `${paper.paperId}:${paper.paperTitle}`).join(" | "));
console.log(
  "STORE_COUNTS",
  Object.fromEntries(store.papers.map((paper) => [paper.paperId, store.questions.filter((q) => q.paperId === paper.paperId).length]))
);
console.log("UNIQUE_KEYS", new Set(store.questions.map(questionKey)).size);
