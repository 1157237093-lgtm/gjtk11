const OPTION_ORDER = "ABCDEFGH".split("");

export function parsePaperPdfText(text, filename = "paper.pdf") {
  const paperTitle = filename.replace(/\.pdf$/i, "");
  const paperId = normalizePaperId(paperTitle);
  const questions = parseQuestions(text).map((question, index) => ({
    paperId,
    paperTitle,
    questionNo: String(question.questionNo || index + 1),
    no: String(question.questionNo || index + 1),
    type: question.type,
    stem: question.stem,
    question: question.stem,
    options: question.options,
    correctAnswer: "",
    answer: "",
    explanation: "",
  }));

  if (!questions.length) {
    throw new Error("未识别到题目。");
  }

  return { paperId, paperTitle, questions };
}

export function parseAnswerPdfText(text, filename = "answer.pdf") {
  const paperTitle = filename.replace(/\.pdf$/i, "");
  const paperId = normalizePaperId(paperTitle);
  const answers = parseAnswers(text);

  if (!answers.length) {
    throw new Error("未识别到答案。");
  }

  return {
    paperId,
    paperTitle,
    answers: answers.map((answer) => ({
      questionNo: answer.questionNo,
      no: answer.questionNo,
      correctAnswer: answer.correctAnswer,
      answer: answer.correctAnswer,
      explanation: answer.explanation,
      type: answer.correctAnswer.length > 1 ? "多选题" : "单选题",
    })),
  };
}

export function parseHistoricalTruthPdfText(text, filename = "historical.pdf") {
  const payload = parsePaperPdfText(text, filename);
  payload.paperId = payload.paperId.includes("2025") ? "historical-2025" : `historical-${payload.paperId}`;
  payload.paperTitle = payload.paperTitle.includes("历年") ? payload.paperTitle : `历年真题-${payload.paperTitle}`;
  payload.questions = payload.questions.map((question) => ({
    ...question,
    paperId: payload.paperId,
    paperTitle: payload.paperTitle,
  }));
  return { papers: [payload] };
}

function parseQuestions(text) {
  const compact = compactPdfText(text);
  const sectionRanges = buildSectionRanges(compact);
  const questions = [];

  for (const section of sectionRanges) {
    const source = compact.slice(section.start, section.end);
    const spans = findQuestionSpans(source);
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      const next = spans[index + 1]?.start || source.length;
      const block = source.slice(span.afterNo, next);
      const parsed = parseQuestionBlock(span.no, block, section.type);
      if (parsed) questions.push(parsed);
    }
  }

  return questions;
}

function parseAnswers(text) {
  const normalized = text.replace(/\r/g, "\n");
  const compact = compactPdfText(text);
  const answers = [];
  const compactPattern = /(\d{1,3})\s*[\.、．]\s*【?答案】?\s*[:：]?\s*([A-H]{1,8})[。\.]?([\s\S]*?)(?=\d{1,3}\s*[\.、．]\s*【?答案】?\s*[:：]?\s*[A-H]{1,8}|$)/g;
  let compactMatch;
  while ((compactMatch = compactPattern.exec(compact))) {
    answers.push({
      questionNo: String(compactMatch[1]),
      correctAnswer: normalizeChoiceText(compactMatch[2]),
      explanation: compactMatch[3].trim(),
    });
  }
  if (answers.length) return answers;

  const blockPattern = /(?:^|\n)\s*(\d{1,3})[\.、．]\s*(?:答案|正确答案)?\s*[:：]?\s*([A-H]{1,8})([\s\S]*?)(?=\n\s*\d{1,3}[\.、．]\s*(?:答案|正确答案)?\s*[:：]?\s*[A-H]{1,8}|\s*$)/gi;
  let match;
  while ((match = blockPattern.exec(normalized))) {
    answers.push({
      questionNo: String(match[1]),
      correctAnswer: normalizeChoiceText(match[2]),
      explanation: match[3].trim(),
    });
  }

  const fallbackPattern = /(\d{1,3})\s*[:：、\.]\s*([A-H]{1,8})/gi;
  while ((match = fallbackPattern.exec(normalized))) {
    answers.push({
      questionNo: String(match[1]),
      correctAnswer: normalizeChoiceText(match[2]),
      explanation: "",
    });
  }
  return answers;
}

function parseQuestionBlock(questionNo, block, type) {
  const optionMatches = [...block.matchAll(/([A-H])\s*[\.\、．]\s*/g)];
  const optionStarts = optionMatches.filter((match, index) => index < 8 && (!index || match.index > optionMatches[index - 1].index + 4));
  const firstOption = optionStarts[0];
  if (!firstOption || optionStarts.length < 2) return null;

  const stem = cleanText(block.slice(0, firstOption.index));
  const options = optionStarts.map((match, index) => {
    const next = optionStarts[index + 1]?.index || block.length;
    return { key: match[1].toUpperCase(), text: cleanText(block.slice(match.index + match[0].length, next)) };
  });

  if (!stem || !options.some((option) => option.key === "A") || !options.some((option) => option.key === "B")) return null;
  return { questionNo: String(questionNo), stem, options, type };
}

function buildSectionRanges(text) {
  const markers = [...text.matchAll(/[一二三四五六七八九十]、\s*(单选题|多选题)/g)];
  if (!markers.length) return [{ start: 0, end: text.length, type: "单选题" }];
  return markers.map((match, index) => ({
    start: match.index + match[0].length,
    end: markers[index + 1]?.index || text.length,
    type: match[1] === "多选题" ? "多选题" : "单选题",
  }));
}

function findQuestionSpans(text) {
  const candidates = [...text.matchAll(/(\d{1,3})\s*[\.\、．]\s*/g)].map((match) => ({
    no: Number(match[1]),
    start: match.index,
    afterNo: match.index + match[0].length,
  }));
  const spans = [];
  let expected = null;

  for (const candidate of candidates) {
    if (expected !== null && candidate.no !== expected) continue;
    const nextNo = expected === null ? candidate.no + 1 : expected + 1;
    const probe = text.slice(candidate.afterNo, candidates.find((item) => item.no === nextNo && item.start > candidate.start)?.start || Math.min(text.length, candidate.afterNo + 900));
    if (!/[A-H]\s*[\.\、．]/.test(probe)) continue;
    spans.push(candidate);
    expected = candidate.no + 1;
  }
  return spans;
}

function compactPdfText(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let output = "";
  for (const line of lines) {
    if (/^[A-Za-z0-9]$/.test(line) && /[A-Za-z0-9]$/.test(output)) {
      output += line;
    } else {
      output += line;
    }
  }
  return output.replace(/\s+/g, " ");
}

function cleanText(text) {
  return String(text || "")
    .replace(/本课程由“凯叔”原创研发.*?减少竞争压力！/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChoiceText(value) {
  return [...new Set(String(value || "").toUpperCase().match(/[A-H]/g) || [])]
    .sort((a, b) => OPTION_ORDER.indexOf(a) - OPTION_ORDER.indexOf(b))
    .join("");
}

function normalizePaperId(text) {
  const issue = String(text || "").match(/第\s*([一二三四五六七八九十百\d]+)\s*期/);
  if (issue) return `period-${toArabic(issue[1]) || issue[1]}`;
  return String(text || "paper")
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toArabic(value) {
  if (/^\d+$/.test(value)) return value;
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return "10";
  const ten = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (ten) return String((digits[ten[1]] || 1) * 10 + (digits[ten[2]] || 0));
  return digits[value] ? String(digits[value]) : "";
}
