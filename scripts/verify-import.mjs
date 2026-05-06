import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePaperPdfText, parseAnswerPdfText } from "../src/parser-core.js";

const files = {
  q11: "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs/Downloads/27.时政刷题 第十一期（3月30日）题本.pdf",
  q10: "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs/Downloads/25.26时政刷题 第十期（3月16日）题本.pdf",
  a6: "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs/答案解/14.26时政刷题 第六期（1月15日）答案解析.pdf",
};

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
}

console.log("STORE_PAPERS", store.papers.map((paper) => `${paper.paperId}:${paper.paperTitle}`).join(" | "));
console.log(
  "STORE_COUNTS",
  Object.fromEntries(store.papers.map((paper) => [paper.paperId, store.questions.filter((q) => q.paperId === paper.paperId).length]))
);
console.log("UNIQUE_KEYS", new Set(store.questions.map(questionKey)).size);
