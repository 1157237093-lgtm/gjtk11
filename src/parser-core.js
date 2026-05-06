export const WRONG_REASONS = [
  "材料主题抓错",
  "关键词没抓住",
  "动作词误判",
  "题干任务误判",
  "选项重心看偏",
  "选项边界不清",
  "知识点缺失",
  "做对但无法解释",
  "审题粗心",
  "其他",
];

const QUESTION_TYPE_PATTERN = "(单选题|多选题|单项选择题|多项选择题|判断题|材料题|不定项选择题)";
const OPTION_LABELS = ["A", "B", "C", "D"];
const MAX_OPTION_TEXT_LENGTH = 160;
const HARD_STOP_PATTERN = /(提交判题|解析[:：]|答案[:：]|正确答案[:：])/;
const NOISE_LINE_PATTERN = /^(?:[VＶ]\s*[:：]\s*[A-Za-z0-9]+|详情咨询[＋+]?|本课程由“凯叔”原创研发.*|本课程仅限本人使用.*)$/;

export function parsePaperPdfText(text, fileName = "") {
  const cleanedText = cleanPdfText(text);
  const metadata = extractPaperMetadata(cleanedText, fileName);
  const lines = cleanedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const questions = [];
  const quarantine = [];
  let currentType = "单选题";
  let currentQuestion = null;

  const finalizeCurrentQuestion = () => {
    if (!currentQuestion) {
      return;
    }

    const finalized = finalizeQuestion(currentQuestion, metadata);
    if (finalized.quarantine) {
      quarantine.push(finalized.quarantine);
    } else {
      questions.push(finalized.question);
    }
    currentQuestion = null;
  };

  for (const rawLine of lines) {
    const candidates = splitPotentialQuestionLines(rawLine, currentQuestion);

    for (const line of candidates) {
      const typeHeading = extractTypeHeading(line);
      if (typeHeading) {
        finalizeCurrentQuestion();
        currentType = typeHeading;
        continue;
      }

      if (isMetadataLine(line, metadata)) {
        continue;
      }

      const questionStart = extractQuestionStart(line);
      if (questionStart) {
        if (currentQuestion && !isLaterQuestionStart(questionStart.questionNo, currentQuestion)) {
          currentQuestion.content.push(line);
          continue;
        }

        finalizeCurrentQuestion();

        currentQuestion = {
          paperId: metadata.paperId,
          paperTitle: metadata.paperTitle,
          module: metadata.module,
          questionNo: normalizeQuestionNo(questionStart.questionNo),
          type: currentType,
          content: questionStart.rest ? [questionStart.rest] : [],
        };
        continue;
      }

      if (currentQuestion) {
        currentQuestion.content.push(line);
      }
    }
  }

  finalizeCurrentQuestion();

  if (!questions.length && quarantine.length === 0) {
    throw new Error("未能从题本 PDF 中解析出任何题目。");
  }

  return {
    paperId: metadata.paperId,
    paperTitle: metadata.paperTitle,
    description: `来自 PDF：${fileName || metadata.paperTitle}`,
    questions,
    quarantine,
    parserMeta: metadata,
  };
}

export function parseAnswerPdfText(text, fileName = "") {
  const cleanedText = cleanPdfText(text);
  const metadata = extractPaperMetadata(cleanedText, fileName);
  const lines = cleanedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const answers = [];
  let currentType = "单选题";
  let current = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    current.explanation = normalizeParagraph(current.explanationLines.join("\n"));
    delete current.explanationLines;
    answers.push(current);
  };

  for (const line of lines) {
    const typeHeading = extractTypeHeading(line);
    if (typeHeading) {
      currentType = typeHeading;
      continue;
    }

    if (isMetadataLine(line, metadata)) {
      continue;
    }

    const answerStart = line.match(
      /^(\d{1,3})[.、](?!\d)\s*【?\s*答案\s*】?\s*[:：]?\s*([A-D]+)\s*[。.]?\s*(?:(?:解析|答案解析)\s*[:：]?\s*)?(.*)$/
    );
    if (answerStart) {
      pushCurrent();
      current = {
        questionNo: normalizeQuestionNo(answerStart[1]),
        type: currentType,
        correctAnswer: normalizeAnswerValue(answerStart[2]),
        explanationLines: [answerStart[3] || ""],
      };
      continue;
    }

    if (current) {
      current.explanationLines.push(line);
    }
  }

  pushCurrent();

  if (!answers.length) {
    throw new Error("未能从答案 PDF 中解析出任何答案。");
  }

  return {
    paperId: metadata.paperId,
    paperTitle: metadata.paperTitle,
    answers: answers.map((item) => ({
      questionNo: item.questionNo,
      correctAnswer: item.correctAnswer,
      explanation: item.explanation,
      type: item.type,
    })),
    parserMeta: metadata,
  };
}

export function parseHistoricalTruthPdfText(text, fileName = "历年真题.pdf") {
  const cleanedText = cleanPdfText(text);
  const lines = cleanedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const papers = [];
  let currentPaper = null;
  let currentQuestion = null;
  let currentType = "单选题";

  const finalizeCurrentQuestion = () => {
    if (!currentPaper || !currentQuestion) {
      return;
    }

    const finalized = finalizeQuestion(currentQuestion, currentPaper.metadata);
    if (finalized.quarantine) {
      currentPaper.quarantine.push(finalized.quarantine);
    } else {
      currentPaper.questions.push(finalized.question);
    }
    currentQuestion = null;
  };

  const finalizeCurrentPaper = () => {
    if (!currentPaper) {
      return;
    }

    finalizeCurrentQuestion();
    if (currentPaper.questions.length > 0 || currentPaper.quarantine.length > 0) {
      papers.push({
        paperId: currentPaper.metadata.paperId,
        paperTitle: currentPaper.metadata.paperTitle,
        description: `来自 PDF：${fileName}`,
        questions: currentPaper.questions,
        quarantine: currentPaper.quarantine,
        parserMeta: currentPaper.metadata,
      });
    }
    currentPaper = null;
  };

  for (const rawLine of lines) {
    const line = sanitizeHistoricalLine(rawLine);
    if (!line || isHistoricalNoiseLine(line)) {
      continue;
    }

    const yearHeading = extractHistoricalYearHeading(line);
    if (yearHeading) {
      finalizeCurrentPaper();
      currentPaper = {
        metadata: createHistoricalMetadata(yearHeading.year, fileName, line),
        questions: [],
        quarantine: [],
      };
      currentType = "单选题";
      continue;
    }

    if (!currentPaper) {
      continue;
    }

    const typeHeading = extractTypeHeading(line);
    if (typeHeading) {
      finalizeCurrentQuestion();
      currentType = typeHeading;
      continue;
    }

    const inlineType = extractInlineHistoricalQuestionType(line);
    const questionStart = extractHistoricalQuestionStart(line, currentQuestion, currentPaper);
    if (questionStart) {
      finalizeCurrentQuestion();
      currentQuestion = {
        paperId: currentPaper.metadata.paperId,
        paperTitle: currentPaper.metadata.paperTitle,
        module: currentPaper.metadata.module,
        questionNo: normalizeQuestionNo(questionStart.questionNo),
        type: inlineType || currentType,
        content: questionStart.rest ? [questionStart.rest] : [],
      };
      continue;
    }

    if (currentQuestion) {
      currentQuestion.content.push(line);
    }
  }

  finalizeCurrentPaper();

  if (!papers.length) {
    throw new Error("未能从历年真题 PDF 中解析出任何年份题本。");
  }

  return {
    source: fileName,
    papers,
  };
}

export function cleanPdfText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (line === "凯叔讲公基") {
        return false;
      }
      if (/^本课程由“凯叔”原创研发/.test(line)) {
        return false;
      }
      if (/^本课程仅限本人使用/.test(line)) {
        return false;
      }
      if (/^\d+$/.test(line)) {
        return false;
      }
      return true;
    })
    .join("\n");
}

export function extractPaperMetadata(text, fileName = "") {
  const scope = `${fileName}\n${text.slice(0, 2000)}`;
  const headerLine = text
    .split("\n")
    .find((line) => line.includes("时政刷题") && !line.includes("专项"));

  const directTitle =
    scope.match(/专项([一二三四五六七八九十百零〇两\d]+)\s*[（(]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[）)]/) ||
    scope.match(/第([一二三四五六七八九十百零〇两\d]+)期\s*[（(]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[）)]/) ||
    scope.match(/模考([一二三四五六七八九十百零〇两\d]+)\s*[（(]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[）)]/);

  if (!directTitle) {
    throw new Error("未识别出期次标题。");
  }

  const issueLabel = directTitle[1];
  const month = Number(directTitle[2]);
  const day = Number(directTitle[3]);
  const issueNumber = chineseOrArabicToNumber(issueLabel);
  const cnIssue = numberToChinese(issueNumber);
  const isMock = /模考/.test(directTitle[0]);

  return {
    paperId: isMock ? `mock-${issueNumber}-${month}-${day}` : `issue-${issueNumber}-${month}-${day}`,
    paperTitle: isMock ? `模考${cnIssue}（${month}月${day}日）` : `专项${cnIssue}（${month}月${day}日）`,
    issueNumber,
    issueLabel: cnIssue,
    month,
    day,
    isMock,
    module: headerLine || "时政刷题",
  };
}

export function extractTypeHeading(line) {
  const match = line.match(new RegExp(`^(?:[一二三四五六七八九十]+、\\s*)?${QUESTION_TYPE_PATTERN}`));
  if (!match) {
    return null;
  }
  if (match[1] === "单项选择题") {
    return "单选题";
  }
  if (match[1] === "多项选择题") {
    return "多选题";
  }
  return match[1];
}

function extractQuestionStart(line) {
  const match = String(line || "").match(/^(?:Q\s*(\d{1,3})|(\d{1,3})[.、])\s*(.*)$/i);
  if (!match) {
    return null;
  }

  const questionNo = match[1] || match[2];
  const rest = String(match[3] || "").trim();
  if (/^\d/.test(rest) && !/^(?:\d{2,}|\d\s*[年月])/.test(rest)) {
    return null;
  }

  return {
    questionNo,
    rest,
  };
}

export function normalizeAnswerValue(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
  }

  const text = String(value || "").trim().replace(/\s+/g, "");
  if (text.length > 1) {
    return [...new Set(text.split("").filter(Boolean))].sort();
  }
  return text;
}

export function normalizeQuestionNo(value) {
  const digits = String(value || "")
    .replace(/[【】\[\]第题\s.。、:：]/g, "")
    .replace(/^0+(\d)/, "$1")
    .trim();

  return digits;
}

export function finalizeQuestion(question, metadata) {
  const block = normalizeQuestionBlock(question.content.join("\n"));
  const lines = block
    .split("\n")
    .map((line) => sanitizeQuestionLine(line))
    .filter(Boolean);
  const questionNo = normalizeQuestionNo(question.questionNo);
  const issues = [];
  let type = question.type;
  let section = "stem";
  let currentOption = null;
  const stemParts = [];
  const optionEntries = [];
  const explanationParts = [];

  const pushOptionText = (text) => {
    if (!currentOption) {
      return;
    }
    const normalized = normalizeParagraph(text);
    if (normalized) {
      currentOption.parts.push(normalized);
    }
  };

  const finalizeOption = () => {
    if (!currentOption) {
      return;
    }
    optionEntries.push({
      label: currentOption.label,
      text: normalizeParagraph(currentOption.parts.join(" ")),
      parts: [...currentOption.parts],
    });
    currentOption = null;
  };

  for (const line of lines) {
    const typeHeading = extractTypeHeading(line);
    if (typeHeading) {
      issues.push(`检测到新的题型标识：${typeHeading}`);
      break;
    }

    const questionStart = extractQuestionStart(line);
    if (
      questionStart &&
      normalizeQuestionNo(questionStart.questionNo) !== questionNo &&
      isLaterQuestionStart(questionStart.questionNo, question)
    ) {
      issues.push(`检测到下一题题号：${normalizeQuestionNo(questionStart.questionNo)}`);
      break;
    }

    const explanationStart = extractExplanationStart(line);
    if (explanationStart) {
      finalizeOption();
      section = "explanation";
      if (explanationStart.rest) {
        explanationParts.push(normalizeParagraph(explanationStart.rest));
      }
      continue;
    }

    if (section === "explanation") {
      const boundary = splitByHardBoundary(line, question);
      if (boundary.before) {
        explanationParts.push(normalizeParagraph(boundary.before));
      }
      if (boundary.boundary) {
        issues.push(`解析区检测到${boundary.reason}`);
        break;
      }
      continue;
    }

    const optionStart = extractOptionStart(line);
    if (optionStart) {
      if (section === "stem" && !optionStart.rest && !isOptionSectionReady(stemParts)) {
        continue;
      }

      const previous = currentOption || optionEntries[optionEntries.length - 1];
      if (previous) {
        const previousIndex = OPTION_LABELS.indexOf(previous.label);
        const nextIndex = OPTION_LABELS.indexOf(optionStart.label);
        if (nextIndex <= previousIndex) {
          issues.push(`选项标签回退或重复：${previous.label} 后又出现 ${optionStart.label}`);
          break;
        }
      }

      finalizeOption();
      section = "option";
      currentOption = {
        label: optionStart.label,
        parts: [],
      };
      const boundary = splitByHardBoundary(optionStart.rest, question);
      if (boundary.before) {
        pushOptionText(boundary.before);
      }
      if (boundary.boundary) {
        issues.push(`选项 ${optionStart.label} 中检测到${boundary.reason}`);
        break;
      }
      continue;
    }

    if (currentOption) {
      const boundary = splitByHardBoundary(line, question);
      if (boundary.before) {
        pushOptionText(boundary.before);
      }
      if (boundary.boundary) {
        issues.push(`选项 ${currentOption.label} 中检测到${boundary.reason}`);
        break;
      }
      continue;
    }

    const boundary = splitByHardBoundary(line, question);
    if (boundary.before) {
      stemParts.push(normalizeParagraph(boundary.before));
    }
    if (boundary.boundary) {
      issues.push(`题干中检测到${boundary.reason}`);
      break;
    }
  }

  finalizeOption();

  const repairedOptionEntries = repairMissingOptionLabels(optionEntries);
  const parsedQuestion = {
    paperId: metadata.paperId,
    paperTitle: metadata.paperTitle,
    questionNo,
    type,
    stem: normalizeParagraph(stripExplicitTypePrefix(stemParts.join(" "))),
    options: repairedOptionEntries.map(({ label, text }) => ({ label, text })),
    correctAnswer: null,
    explanation: normalizeParagraph(explanationParts.join(" ")),
    module: question.module || metadata.module,
    status: "unanswered",
    userAnswer: null,
    isWrong: false,
    wrongReason: null,
    updatedAt: null,
  };
  const validationIssues = validateParsedQuestion(parsedQuestion);
  issues.push(...validationIssues);

  if (issues.length > 0) {
    return {
      quarantine: createQuarantineRecord(question, metadata, issues, block, parsedQuestion),
    };
  }

  return {
    question: parsedQuestion,
  };
}

export function validateParsedQuestion(question) {
  const issues = [];
  const stem = String(question?.stem || "");
  const explanation = String(question?.explanation || "");
  const options = Array.isArray(question?.options) ? question.options : [];
  const labels = options.map((item) => item.label);
  const duplicateLabels = labels.filter((label, index) => labels.indexOf(label) !== index);
  const embeddedQuestionPattern = /(?:^|\s)(?:Q\s*\d{1,3}|\d{1,3}[.、])\s*(?:[^\d]|\d{4}\s*年)/i;
  const typePattern = new RegExp(`(?:^|\\s)(?:[一二三四五六七八九十]+、\\s*)?${QUESTION_TYPE_PATTERN}`);
  const illegalOptionMarkerPattern = /(^|\s)[E-Z][.．、]/i;

  if (!stem) {
    issues.push("题干为空");
  }
  if (options.length !== OPTION_LABELS.length) {
    issues.push(`选项数量异常：${options.length}，应为 ${OPTION_LABELS.length}`);
  }
  if (labels.length === OPTION_LABELS.length && labels.some((label, index) => label !== OPTION_LABELS[index])) {
    issues.push(`选项标签顺序异常：${labels.join("/")}`);
  }
  if (duplicateLabels.length > 0) {
    issues.push(`options 出现重复标签：${[...new Set(duplicateLabels)].join("/")}`);
  }
  if (embeddedQuestionPattern.test(stem)) {
    issues.push("题干中出现新的题号，疑似串题");
  }
  if (typePattern.test(stem)) {
    issues.push("题干中出现新的题型标识，疑似串题");
  }
  if (embeddedQuestionPattern.test(explanation)) {
    issues.push("解析中出现新的题号，疑似串题");
  }

  for (const option of options) {
    const text = String(option?.text || "");
    if (!OPTION_LABELS.includes(String(option?.label || ""))) {
      issues.push(`选项标签非法：${String(option?.label || "空")}`);
    }
    if (!text) {
      issues.push(`选项 ${option.label} 为空`);
    }
    if (text.length > MAX_OPTION_TEXT_LENGTH) {
      issues.push(`选项 ${option.label} 过长（${text.length} 字），疑似串题`);
    }
    if (embeddedQuestionPattern.test(text)) {
      issues.push(`选项 ${option.label} 中出现新的题号，疑似串题`);
    }
    if (typePattern.test(text)) {
      issues.push(`选项 ${option.label} 中出现新的题型标识，疑似串题`);
    }
    if (HARD_STOP_PATTERN.test(text)) {
      issues.push(`选项 ${option.label} 中出现解析/答案标识，疑似串题`);
    }
    if (illegalOptionMarkerPattern.test(text)) {
      issues.push(`选项 ${option.label} 中出现非 A-D 选项标识，疑似串题`);
    }
  }

  return [...new Set(issues)];
}

function normalizeQuestionBlock(text) {
  return text
    .replace(/\n+/g, "\n")
    .replace(/\s*([A-D])[.．、]\s*/g, "\n$1.")
    .replace(/(^|\s)([A-D])(?=(?:[\u4e00-\u9fff0-9"'（(]))/g, "$1\n$2")
    .replace(/\s*(解析[:：]|答案[:：]|正确答案[:：])\s*/g, "\n$1")
    .replace(/\n+/g, "\n")
    .trim();
}

function splitPotentialQuestionLines(line, currentQuestion = null) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return [];
  }

  if (!hasParsedOptions(currentQuestion)) {
    return [normalizedLine];
  }

  const segments = [];
  let rest = normalizedLine;

  while (rest) {
    const boundary = findEmbeddedBoundary(rest, currentQuestion);
    if (!boundary) {
      segments.push(rest.trim());
      break;
    }

    const head = rest.slice(0, boundary.index).trim();
    if (head) {
      segments.push(head);
    }
    rest = rest.slice(boundary.index).trim();
  }

  return segments.filter(Boolean);
}

function findEmbeddedBoundary(line, currentQuestion) {
  const candidates = [];
  const questionPattern = /\s+(?=(?:Q\s*\d{1,3}|\d{1,3}[.、]))/gi;
  let match;

  while ((match = questionPattern.exec(line))) {
    const candidateIndex = match.index + match[0].length;
    const candidate = line.slice(candidateIndex).trim();
    const questionStart = extractQuestionStart(candidate);
    if (questionStart && isLaterQuestionStart(questionStart.questionNo, currentQuestion)) {
      candidates.push({ index: candidateIndex });
      break;
    }
  }

  const typePattern = new RegExp(`\\s+(?=(?:[一二三四五六七八九十]+、\\s*)?${QUESTION_TYPE_PATTERN})`, "g");
  const typeMatch = typePattern.exec(line);
  if (typeMatch) {
    candidates.push({ index: typeMatch.index + typeMatch[0].length });
  }

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((left, right) => left.index - right.index)[0];
}

function hasParsedOptions(question) {
  return Boolean(question?.content?.some((line) => /(^|\s)[A-D][.．、]\s*/.test(String(line))));
}

function isLaterQuestionStart(questionNo, currentQuestion) {
  if (!currentQuestion) {
    return true;
  }

  const currentNo = Number.parseInt(normalizeQuestionNo(currentQuestion.questionNo), 10);
  const nextNo = Number.parseInt(normalizeQuestionNo(questionNo), 10);

  if (!Number.isFinite(currentNo) || !Number.isFinite(nextNo)) {
    return false;
  }

  return nextNo === currentNo + 1;
}

function normalizeParagraph(text) {
  return String(text || "")
    .replace(/[VＶ]\s*[:：]\s*[A-Za-z0-9]+/gi, " ")
    .replace(/详情咨询[＋+]?\s*/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([，。；：！？])\s*/g, "$1")
    .trim();
}

function sanitizeQuestionLine(line) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text || NOISE_LINE_PATTERN.test(text)) {
    return "";
  }
  return text;
}

function isOptionSectionReady(stemParts) {
  const stem = normalizeParagraph(Array.isArray(stemParts) ? stemParts.join(" ") : stemParts);
  return /（\s*）|\(\s*\)|下列|属于|不属于|正确|错误|体现|表明|说明|有（|为（|是（/.test(stem);
}

function sanitizeHistoricalLine(line) {
  return String(line || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[⼀一]\s*[.．]\s*/g, "一、")
    .replace(/\s+/g, " ")
    .trim();
}

function isHistoricalNoiseLine(line) {
  const text = String(line || "").trim();
  return (
    !text ||
    /^B\s*$/.test(text) ||
    /^站关注李铁$/.test(text) ||
    /^免费提供公考/.test(text) ||
    /^CCTALK$/.test(text) ||
    /^搜索李铁公考/.test(text) ||
    /^进群学习加微信$/.test(text) ||
    /^sxdsxdsx2$/i.test(text) ||
    /^Ps\s*$/i.test(text) ||
    /^河南三支历年真题$/.test(text) ||
    /\.{5,}/.test(text)
  );
}

function extractHistoricalYearHeading(line) {
  const text = normalizeParagraph(line);
  const match = text.match(
    /^(202[0-9])\s*(?:年)?\s*(?=.*(?:河南|三支|三支一扶))(?=.*(?:考试|公共基础知识|试题|真题))/
  );
  return match ? { year: match[1] } : null;
}

function createHistoricalMetadata(year, fileName, headingLine) {
  return {
    paperId: `historical-${year}`,
    paperTitle: `${year} 年河南三支一扶历年真题`,
    issueNumber: Number(year),
    issueLabel: String(year),
    year: String(year),
    month: null,
    day: null,
    isMock: false,
    module: `${year} 年真题`,
    sourceFileName: fileName,
    sourceHeading: headingLine,
  };
}

function extractInlineHistoricalQuestionType(line) {
  const text = String(line || "");
  if (/[（(]\s*(?:多选|多选题|多项选择题)\s*[)）]/.test(text)) {
    return "多选题";
  }
  if (/[（(]\s*(?:单选|单选题|单项选择题)\s*[)）]/.test(text)) {
    return "单选题";
  }
  return null;
}

function extractHistoricalQuestionStart(line, currentQuestion, currentPaper) {
  const match = String(line || "").match(/^(\d{1,3})[.．、]\s*(.*)$/);
  if (!match) {
    return null;
  }

  const questionNo = normalizeQuestionNo(match[1]);
  const nextNo = Number.parseInt(questionNo, 10);
  if (!Number.isFinite(nextNo)) {
    return null;
  }

  if (!currentQuestion) {
    const importedCount = Number(currentPaper?.questions?.length || 0) + Number(currentPaper?.quarantine?.length || 0);
    if (importedCount === 0 && nextNo !== 1) {
      return null;
    }
    if (importedCount > 0 && nextNo !== importedCount + 1) {
      return null;
    }
  } else if (!isLaterQuestionStart(questionNo, currentQuestion)) {
    return null;
  }

  return {
    questionNo,
    rest: String(match[2] || "").trim(),
  };
}

function stripExplicitTypePrefix(text) {
  return String(text || "")
    .replace(/^[（(]\s*(?:单选|多选|单选题|多选题)\s*[)）]\s*/, "")
    .replace(new RegExp(`^(?:${QUESTION_TYPE_PATTERN})\\s*`), "")
    .trim();
}

function extractOptionStart(line) {
  const text = String(line || "");
  const match = text.match(/^([A-D])(?:(?:[.．、]|\s+)\s*(.*)|(.*))$/);
  if (!match) {
    return null;
  }
  const hasSeparator = Boolean(match[2] !== undefined);
  const rest = String(match[2] ?? match[3] ?? "").trim();
  if (!hasSeparator && /^[A-Z]/.test(rest)) {
    return null;
  }
  if (!hasSeparator && rest && !/^[\u4e00-\u9fff0-9A-Z"'（(]/.test(rest)) {
    return null;
  }
  return {
    label: match[1],
    rest,
  };
}

function repairMissingOptionLabels(optionEntries) {
  if (!Array.isArray(optionEntries) || optionEntries.length !== OPTION_LABELS.length - 1) {
    return optionEntries;
  }

  const labels = optionEntries.map((item) => item.label);
  const missingIndex = OPTION_LABELS.findIndex((label) => !labels.includes(label));
  if (missingIndex <= 0) {
    return optionEntries;
  }

  const previousLabel = OPTION_LABELS[missingIndex - 1];
  const previousIndex = optionEntries.findIndex((item) => item.label === previousLabel);
  const previous = optionEntries[previousIndex];
  if (!previous || !Array.isArray(previous.parts) || previous.parts.length < 2) {
    return optionEntries;
  }

  const repairedPrevious = {
    ...previous,
    text: normalizeParagraph(previous.parts.slice(0, -1).join(" ")),
    parts: previous.parts.slice(0, -1),
  };
  const inferred = {
    label: OPTION_LABELS[missingIndex],
    text: normalizeParagraph(previous.parts.at(-1)),
    parts: [previous.parts.at(-1)],
  };

  return [
    ...optionEntries.slice(0, previousIndex),
    repairedPrevious,
    inferred,
    ...optionEntries.slice(previousIndex + 1),
  ].sort((left, right) => OPTION_LABELS.indexOf(left.label) - OPTION_LABELS.indexOf(right.label));
}

function extractExplanationStart(line) {
  const match = String(line || "").match(/^(解析[:：]|答案[:：]|正确答案[:：])\s*(.*)$/);
  if (!match) {
    return null;
  }
  return {
    marker: match[1],
    rest: String(match[2] || "").trim(),
  };
}

function splitByHardBoundary(text, currentQuestion) {
  const source = String(text || "").trim();
  if (!source) {
    return {
      before: "",
      boundary: null,
      reason: "",
    };
  }

  const boundaryCandidates = [];
  const inlineQuestionPattern = /\s+(?=(?:Q\s*\d{1,3}|\d{1,3}[.、]))/gi;
  let match;
  while ((match = inlineQuestionPattern.exec(source))) {
    const candidateIndex = match.index + match[0].length;
    const candidate = source.slice(candidateIndex).trim();
    const questionStart = extractQuestionStart(candidate);
    if (questionStart && isLaterQuestionStart(questionStart.questionNo, currentQuestion)) {
      boundaryCandidates.push({
        index: candidateIndex,
        reason: `下一题题号 ${normalizeQuestionNo(questionStart.questionNo)}`,
      });
      break;
    }
  }

  const typePattern = new RegExp(`\\s+(?=(?:[一二三四五六七八九十]+、\\s*)?${QUESTION_TYPE_PATTERN})`, "g");
  const typeMatch = typePattern.exec(source);
  if (typeMatch) {
    boundaryCandidates.push({
      index: typeMatch.index + typeMatch[0].length,
      reason: "新的题型标识",
    });
  }

  const markerPattern = /\s+(?=(提交判题|解析[:：]|答案[:：]|正确答案[:：]))/g;
  const markerMatch = markerPattern.exec(source);
  if (markerMatch) {
    boundaryCandidates.push({
      index: markerMatch.index + markerMatch[0].length,
      reason: `停止标识 ${markerMatch[1]}`,
    });
  }

  if (!boundaryCandidates.length) {
    return {
      before: source,
      boundary: null,
      reason: "",
    };
  }

  const boundary = boundaryCandidates.sort((left, right) => left.index - right.index)[0];
  return {
    before: source.slice(0, boundary.index).trim(),
    boundary: source.slice(boundary.index).trim(),
    reason: boundary.reason,
  };
}

function createQuarantineRecord(question, metadata, issues, rawBlock, parsedQuestion) {
  return {
    paperId: metadata.paperId,
    paperTitle: metadata.paperTitle,
    questionNo: normalizeQuestionNo(question.questionNo),
    type: parsedQuestion?.type || question.type || "未识别",
    issues: [...new Set(issues)],
    stemPreview: String(parsedQuestion?.stem || "").slice(0, 120),
    rawBlock,
    parsedQuestion: parsedQuestion || null,
  };
}

function isMetadataLine(line, metadata) {
  return (
    line === metadata.paperTitle ||
    line.includes(metadata.module) ||
    /^专项[一二三四五六七八九十百零〇两\d]+[（(]/.test(line) ||
    /^模考[一二三四五六七八九十百零〇两\d]+[（(]/.test(line)
  );
}

function chineseOrArabicToNumber(input) {
  if (/^\d+$/.test(String(input))) {
    return Number(input);
  }

  const chars = String(input).replace("两", "二");
  const digitMap = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (chars === "十") {
    return 10;
  }

  if (chars.includes("十")) {
    const [head, tail] = chars.split("十");
    const tens = head ? digitMap[head] : 1;
    const ones = tail ? digitMap[tail] : 0;
    return tens * 10 + ones;
  }

  return digitMap[chars] || 0;
}

function numberToChinese(num) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (num <= 10) {
    return num === 10 ? "十" : digits[num];
  }
  if (num < 20) {
    return `十${digits[num % 10]}`;
  }
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}
