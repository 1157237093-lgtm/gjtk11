import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePaperPdfText, parseAnswerPdfText, normalizeQuestionNo } from "../src/parser-core.js";

const paperPath =
  process.argv[2] || "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs/Downloads/5.26时政时政刷题 第三期（11月28日）题本.pdf";
const answerPath =
  process.argv[3] || "/Users/a66/Library/Mobile Documents/com~apple~CloudDocs/答案解/6.26时政时政刷题 第三期（11月28日）答案解析.pdf";

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

const paperText = await extractPdfText(paperPath);
const answerText = await extractPdfText(answerPath);
const paperPayload = parsePaperPdfText(paperText, paperPath.split("/").pop());
const answerPayload = parseAnswerPdfText(answerText, answerPath.split("/").pop());

const paperNos = paperPayload.questions.map((question) => normalizeQuestionNo(question.questionNo));
const answerNos = answerPayload.answers.map((answer) => normalizeQuestionNo(answer.questionNo));

const matched = paperNos.filter((questionNo) => answerNos.includes(questionNo));
const unmatchedPaper = paperNos.filter((questionNo) => !answerNos.includes(questionNo));
const unmatchedAnswer = answerNos.filter((questionNo) => !paperNos.includes(questionNo));

console.log("题本总题数", paperPayload.questions.length);
console.log("答案文件实际解析出多少条答案", answerPayload.answers.length);
console.log("解析出的前 10 条答案样本", JSON.stringify(answerPayload.answers.slice(0, 10), null, 2));
console.log("已匹配题号列表", matched.join(","));
console.log("未匹配题号列表", unmatchedPaper.join(","));
console.log("答案有但题本无的题号", unmatchedAnswer.join(","));
console.log(
  "每一道未匹配题的原因",
  JSON.stringify(
    unmatchedPaper.map((questionNo) => ({ questionNo, reason: "答案文件未解析到该题号" })),
    null,
    2
  )
);
