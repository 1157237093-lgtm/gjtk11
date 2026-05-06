const STORE_KEY = "question-practice-station:v1";
const OPTION_ORDER = "ABCDEFGH".split("");
const TANGLED_STATUS = new Set(["两个选项纠结", "多个选项纠结"]);

const state = normalizeState(loadState());
let selectedPaperId = state.papers[0]?.id || "";
let selectedIndex = 0;

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  pdfKind: document.querySelector("#pdfKind"),
  targetPaper: document.querySelector("#targetPaper"),
  importLog: document.querySelector("#importLog"),
  demoBtn: document.querySelector("#demoBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  paperCount: document.querySelector("#paperCount"),
  questionCount: document.querySelector("#questionCount"),
  doneCount: document.querySelector("#doneCount"),
  wrongCount: document.querySelector("#wrongCount"),
  diagnosisGrid: document.querySelector("#diagnosisGrid"),
  paperList: document.querySelector("#paperList"),
  questionMeta: document.querySelector("#questionMeta"),
  emptyState: document.querySelector("#emptyState"),
  questionView: document.querySelector("#questionView"),
  questionStem: document.querySelector("#questionStem"),
  optionList: document.querySelector("#optionList"),
  confidenceStatus: document.querySelector("#confidenceStatus"),
  primaryWrongReason: document.querySelector("#primaryWrongReason"),
  secondaryWrongTags: document.querySelector("#secondaryWrongTags"),
  hesitationOptions: document.querySelector("#hesitationOptions"),
  decisiveKeyword: document.querySelector("#decisiveKeyword"),
  eliminatedOption: document.querySelector("#eliminatedOption"),
  eachOptionReason: document.querySelector("#eachOptionReason"),
  eliminationReason: document.querySelector("#eliminationReason"),
  wrongThinking: document.querySelector("#wrongThinking"),
  nextRule: document.querySelector("#nextRule"),
  twoChoiceFields: document.querySelector("#twoChoiceFields"),
  perOptionJudgement: document.querySelector("#perOptionJudgement"),
  answerBox: document.querySelector("#answerBox"),
  showAnswerBtn: document.querySelector("#showAnswerBtn"),
  markWrongBtn: document.querySelector("#markWrongBtn"),
  markCardBtn: document.querySelector("#markCardBtn"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && Array.isArray(saved.papers) && Array.isArray(saved.questions)) {
      return saved;
    }
  } catch {
    localStorage.removeItem(STORE_KEY);
  }
  return { papers: [], questions: [], progress: {}, recitationCards: [] };
}

function normalizeState(saved) {
  return {
    papers: Array.isArray(saved.papers) ? saved.papers.map(normalizePaper) : [],
    questions: Array.isArray(saved.questions) ? saved.questions.map(normalizeQuestion) : [],
    progress: normalizeProgressMap(saved.progress),
    recitationCards: Array.isArray(saved.recitationCards) ? saved.recitationCards : [],
  };
}

function normalizePaper(paper) {
  return {
    id: paper.id || paper.paperId || "",
    title: paper.title || paper.paperTitle || paper.id || paper.paperId || "未命名题本",
    count: paper.count,
  };
}

function normalizeProgressMap(progress = {}) {
  return Object.fromEntries(Object.entries(progress || {}).map(([key, value]) => [key, normalizeProgress(value)]));
}

function normalizeProgress(item = {}) {
  const primaryWrongReason = item.primaryWrongReason || item.wrongReason || "";
  return {
    ...item,
    confidenceStatus: item.confidenceStatus || "确定",
    primaryWrongReason,
    wrongReason: item.wrongReason || primaryWrongReason,
    secondaryWrongTags: normalizeTags(item.secondaryWrongTags),
    hesitationOptions: normalizeChoiceText(item.hesitationOptions),
    decisiveKeyword: item.decisiveKeyword || "",
    wrongThinking: item.wrongThinking || "",
    nextRule: item.nextRule || "",
    selectedVsCorrectDiff: item.selectedVsCorrectDiff || "",
    eachOptionReason: item.eachOptionReason || "",
    eliminatedOption: normalizeChoiceText(item.eliminatedOption),
    eliminationReason: item.eliminationReason || "",
    perOptionJudgement: item.perOptionJudgement || {},
    missedOptions: normalizeTags(item.missedOptions),
    overSelectedOptions: normalizeTags(item.overSelectedOptions),
    multiSelectErrorType: item.multiSelectErrorType || "",
    learningDiagnosis: item.learningDiagnosis || "",
    retestPriority: item.retestPriority || "",
    reviewDueAt: item.reviewDueAt || "",
    recitationCardId: item.recitationCardId || "",
  };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} ${message}`;
  els.importLog.prepend(item);
}

function normalizeId(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function questionKey(question) {
  return `${question.paperId}::${question.no}`;
}

function activeQuestions() {
  return state.questions.filter((question) => question.paperId === selectedPaperId);
}

function upsertPaper(paper) {
  const normalized = normalizePaper(paper);
  const existing = state.papers.find((item) => item.id === normalized.id);
  if (existing) {
    Object.assign(existing, normalized);
  } else {
    state.papers.push(normalized);
  }
}

function importQuestions(paper, questions) {
  upsertPaper({ ...paper, count: questions.length });
  state.questions = state.questions.filter((question) => question.paperId !== paper.id);
  state.questions.push(...questions.map((question) => ({ ...question, paperId: paper.id })));
  selectedPaperId = paper.id;
  selectedIndex = 0;
  saveState();
  render();
}

function importAnswers(paperId, answers) {
  const answerMap = new Map(answers.map((answer) => [String(answer.no || answer.questionNo), answer]));
  let hits = 0;
  state.questions = state.questions.map((question) => {
    if (question.paperId !== paperId) return question;
    const answer = answerMap.get(String(question.no));
    if (!answer) return question;
    hits += 1;
    return { ...question, answer: answer.answer || answer.correctAnswer, explanation: answer.explanation || question.explanation || "" };
  });
  saveState();
  render();
  return hits;
}

async function readJson(file) {
  const payload = JSON.parse(await file.text());
  if (Array.isArray(payload.papers) && Array.isArray(payload.questions)) {
    state.papers = payload.papers.map(normalizePaper);
    state.questions = payload.questions.map(normalizeQuestion);
    state.progress = normalizeProgressMap(payload.progress || {});
    state.recitationCards = Array.isArray(payload.recitationCards) ? payload.recitationCards : [];
    selectedPaperId = state.papers[0]?.id || "";
    selectedIndex = 0;
    saveState();
    render();
    return;
  }
  if (Array.isArray(payload.questions)) {
    const paper = payload.paper || {
      id: payload.paperId || normalizeId(file.name),
      title: payload.paperTitle || file.name.replace(/\.json$/i, ""),
    };
    importQuestions(
      { id: paper.id || paper.paperId || normalizeId(paper.title), title: paper.title || paper.paperTitle || file.name },
      payload.questions.map(normalizeQuestion)
    );
    return;
  }
  throw new Error("JSON 格式需要包含 questions 数组。");
}

function normalizeQuestion(item, index = 0) {
  return {
    paperId: item.paperId || item.paper_id || "",
    no: String(item.no || item.questionNo || index + 1),
    type: item.type || (String(item.answer || item.correctAnswer || "").length > 1 ? "多选题" : "单选题"),
    stem: item.stem || item.question || item.title || "",
    options: normalizeOptions(item.options),
    answer: normalizeChoiceText(item.answer || item.correctAnswer || ""),
    explanation: item.explanation || "",
  };
}

function normalizeOptions(options) {
  if (Array.isArray(options)) {
    return options.map((option, index) => {
      if (typeof option === "string") return { key: OPTION_ORDER[index] || String(index + 1), text: option };
      return { key: option.key || option.label || OPTION_ORDER[index] || String(index + 1), text: option.text || option.value || "" };
    });
  }
  if (options && typeof options === "object") {
    return Object.entries(options).map(([key, text]) => ({ key, text: String(text) }));
  }
  return [];
}

async function readPdf(file, kind) {
  const text = await extractPdfText(file);
  if (kind === "answer") {
    const paperId = els.targetPaper.value || selectedPaperId;
    if (!paperId) throw new Error("请先导入题本，再导入答案 PDF。");
    const hits = importAnswers(paperId, parseAnswers(text));
    log(`${file.name} 匹配答案 ${hits} 题`);
    return;
  }
  const paper = { id: normalizeId(file.name), title: file.name.replace(/\.pdf$/i, "") };
  const questions = parseQuestions(text).map(normalizeQuestion);
  if (!questions.length) throw new Error("没有识别到题目，请改用 JSON 导入或检查 PDF 是否可复制文本。");
  importQuestions(paper, questions);
  log(`${file.name} 导入 ${questions.length} 题`);
}

async function extractPdfText(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).filter(Boolean).join("\n"));
  }
  return pages.join("\n");
}

function parseQuestions(text) {
  const lines = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const questions = [];
  let current = null;

  for (const line of lines) {
    const questionMatch = line.match(/^(\d{1,3})[\.、．]\s*(.+)$/);
    const optionMatch = line.match(/^([A-H])[\.\、．]\s*(.+)$/i);
    if (questionMatch) {
      if (current) questions.push(current);
      current = { no: questionMatch[1], stem: questionMatch[2], options: [], answer: "", explanation: "" };
    } else if (optionMatch && current) {
      current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
    } else if (current) {
      current.stem = `${current.stem}\n${line}`;
    }
  }
  if (current) questions.push(current);
  return questions;
}

function parseAnswers(text) {
  const answers = [];
  const pattern = /(?:^|\n)\s*(\d{1,3})[\.、．]\s*(?:答案|正确答案)?\s*[:：]?\s*([A-H]{1,8})([\s\S]*?)(?=\n\s*\d{1,3}[\.、．]\s*(?:答案|正确答案)?\s*[:：]?\s*[A-H]{1,8}|\s*$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    answers.push({ no: match[1], answer: normalizeChoiceText(match[2]), explanation: match[3].trim() });
  }
  return answers;
}

async function handleFiles(files) {
  for (const file of files) {
    try {
      if (/\.json$/i.test(file.name) || file.type.includes("json")) {
        await readJson(file);
        log(`${file.name} 导入完成`);
      } else if (/\.pdf$/i.test(file.name) || file.type.includes("pdf")) {
        await readPdf(file, els.pdfKind.value);
      } else {
        log(`${file.name} 已跳过：不支持的文件类型`);
      }
    } catch (error) {
      log(`${file.name} 导入失败：${error.message}`);
    }
  }
}

function render() {
  const questions = activeQuestions();
  const current = questions[selectedIndex];
  const progressItems = Object.values(state.progress).map(normalizeProgress);
  const done = progressItems.filter((item) => item.done).length;
  const wrong = progressItems.filter((item) => item.wrong).length;

  els.paperCount.textContent = state.papers.length;
  els.questionCount.textContent = state.questions.length;
  els.doneCount.textContent = done;
  els.wrongCount.textContent = wrong;
  renderDashboard();

  els.targetPaper.innerHTML = state.papers.map((paper) => `<option value="${escapeHtml(paper.id)}">${escapeHtml(paper.title)}</option>`).join("");
  els.targetPaper.value = selectedPaperId;

  els.paperList.innerHTML = state.papers.length
    ? state.papers
        .map((paper) => {
          const count = state.questions.filter((question) => question.paperId === paper.id).length;
          const active = paper.id === selectedPaperId ? " primary" : "";
          return `<button class="paper-item${active}" data-paper="${escapeHtml(paper.id)}"><span>${escapeHtml(paper.title)}</span><small>${count} 题</small></button>`;
        })
        .join("")
    : "<p>暂无题本</p>";

  els.emptyState.classList.toggle("hidden", Boolean(current));
  els.questionView.classList.toggle("hidden", !current);
  els.questionMeta.textContent = current ? `${state.papers.find((paper) => paper.id === selectedPaperId)?.title || ""} · 第 ${selectedIndex + 1} / ${questions.length} 题` : "尚未导入题目";

  if (!current) return;
  const progress = normalizeProgress(state.progress[questionKey(current)]);
  const selected = new Set(choiceArray(progress.choice));
  els.questionStem.textContent = `${current.no}. ${current.stem}`;
  els.optionList.innerHTML = current.options
    .map((option) => `<button class="option${selected.has(option.key) ? " selected" : ""}" data-choice="${escapeHtml(option.key)}">${escapeHtml(option.key)}. ${escapeHtml(option.text)}</button>`)
    .join("");
  syncForm(progress, current);
  els.answerBox.classList.add("hidden");
  els.answerBox.textContent = buildAnswerText(current, progress);
}

function renderDashboard() {
  const progressEntries = Object.entries(state.progress).map(([key, value]) => [key, normalizeProgress(value)]);
  const done = progressEntries.filter(([, item]) => item.done);
  const correct = done.filter(([key, item]) => isCorrectByKey(key, item));
  const sureCorrect = correct.filter(([, item]) => item.confidenceStatus === "确定");
  const guessedCorrect = correct.filter(([, item]) => item.guessedCorrect || item.confidenceStatus === "蒙的");
  const twoChoice = done.filter(([, item]) => TANGLED_STATUS.has(item.confidenceStatus));
  const twoChoiceWrong = twoChoice.filter(([key, item]) => !isCorrectByKey(key, item));
  const multi = done.filter(([key]) => isMultiQuestion(getQuestionByKey(key)));
  const missedCount = sumLengths(multi.map(([, item]) => item.missedOptions));
  const overCount = sumLengths(multi.map(([, item]) => item.overSelectedOptions));
  const reasonTop = topCounts(done.map(([, item]) => item.primaryWrongReason || item.wrongReason).filter(Boolean), 5);
  const tagTop = topCounts(done.flatMap(([, item]) => item.secondaryWrongTags || []), 10);
  const total = done.length || 0;

  els.diagnosisGrid.innerHTML = [
    metric("真实正确率", percent(sureCorrect.length, total)),
    metric("表面正确率", percent(correct.length, total)),
    metric("蒙对题", guessedCorrect.length),
    metric("二选一错误率", percent(twoChoiceWrong.length, twoChoice.length)),
    metric("多选漏选数", missedCount),
    metric("多选错选数", overCount),
    listMetric("Top 5 高频错因", reasonTop),
    listMetric("Top 10 高频易混标签", tagTop),
  ].join("");
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function listMetric(label, rows) {
  const body = rows.length
    ? `<ol>${rows.map(([name, count]) => `<li>${escapeHtml(name)} <small>${count}</small></li>`).join("")}</ol>`
    : "<small>暂无记录</small>";
  return `<div class="metric list"><strong>${escapeHtml(label)}</strong>${body}</div>`;
}

function syncForm(progress, question) {
  els.confidenceStatus.value = progress.confidenceStatus || "确定";
  els.primaryWrongReason.value = progress.primaryWrongReason || "";
  els.secondaryWrongTags.value = (progress.secondaryWrongTags || []).join("，");
  els.hesitationOptions.value = progress.hesitationOptions || "";
  els.decisiveKeyword.value = progress.decisiveKeyword || "";
  els.eliminatedOption.value = progress.eliminatedOption || "";
  els.eachOptionReason.value = progress.eachOptionReason || "";
  els.eliminationReason.value = progress.eliminationReason || "";
  els.wrongThinking.value = progress.wrongThinking || "";
  els.nextRule.value = progress.nextRule || "";
  els.twoChoiceFields.classList.toggle("hidden", !TANGLED_STATUS.has(progress.confidenceStatus));
  renderPerOptionJudgement(question, progress);
}

function renderPerOptionJudgement(question, progress) {
  if (!isMultiQuestion(question)) {
    els.perOptionJudgement.innerHTML = "";
    return;
  }
  const labels = ["必选", "排除", "不确定"];
  els.perOptionJudgement.innerHTML = question.options
    .map((option) => {
      const value = progress.perOptionJudgement?.[option.key] || "";
      return `<div class="per-option-row"><strong>${escapeHtml(option.key)}</strong>${labels
        .map((label) => `<button class="judge${value === label ? " active" : ""}" type="button" data-judge-key="${escapeHtml(option.key)}" data-judge-value="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
        .join("")}</div>`;
    })
    .join("");
}

function collectFormValues() {
  return {
    confidenceStatus: els.confidenceStatus.value,
    primaryWrongReason: els.primaryWrongReason.value,
    wrongReason: els.primaryWrongReason.value,
    secondaryWrongTags: normalizeTags(els.secondaryWrongTags.value),
    hesitationOptions: normalizeChoiceText(els.hesitationOptions.value),
    decisiveKeyword: els.decisiveKeyword.value.trim(),
    eliminatedOption: normalizeChoiceText(els.eliminatedOption.value),
    eachOptionReason: els.eachOptionReason.value.trim(),
    eliminationReason: els.eliminationReason.value.trim(),
    wrongThinking: els.wrongThinking.value.trim(),
    nextRule: els.nextRule.value.trim(),
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function setProgress(patch, shouldRender = true) {
  const current = activeQuestions()[selectedIndex];
  if (!current) return;
  const key = questionKey(current);
  const merged = normalizeProgress({ ...(state.progress[key] || {}), ...patch });
  state.progress[key] = deriveProgress(current, merged);
  saveState();
  if (shouldRender) render();
}

function deriveProgress(question, progress) {
  const answer = normalizeChoiceText(question.answer);
  const selected = normalizeChoiceText(progress.choice);
  const isCorrect = Boolean(answer) && selected === answer;
  const selectedOptions = choiceArray(selected);
  const answerOptions = choiceArray(answer);
  const missedOptions = answerOptions.filter((option) => !selectedOptions.includes(option));
  const overSelectedOptions = selectedOptions.filter((option) => !answerOptions.includes(option));
  const multiSelectErrorType = isMultiQuestion(question) ? getMultiSelectErrorType(missedOptions, overSelectedOptions, selectedOptions.length, answerOptions.length) : "";
  const selectedVsCorrectDiff = answer ? `已选 ${selected || "未选"} / 正确 ${answer}` : "";
  const guessedCorrect = isCorrect && progress.confidenceStatus !== "确定";
  const primaryWrongReason = progress.primaryWrongReason || progress.wrongReason || inferWrongReason(multiSelectErrorType);
  return {
    ...progress,
    wrong: progress.done && answer ? !isCorrect : Boolean(progress.wrong),
    guessedCorrect,
    primaryWrongReason,
    wrongReason: progress.wrongReason || primaryWrongReason,
    selectedVsCorrectDiff,
    missedOptions,
    overSelectedOptions,
    multiSelectErrorType,
    learningDiagnosis: buildLearningDiagnosis(primaryWrongReason, progress.secondaryWrongTags, multiSelectErrorType),
    retestPriority: getRetestPriority({ ...progress, wrong: progress.done && answer ? !isCorrect : Boolean(progress.wrong), guessedCorrect, multiSelectErrorType }),
    reviewDueAt: progress.reviewDueAt || buildReviewDueAt(progress.done && answer ? !isCorrect : Boolean(progress.wrong), guessedCorrect),
  };
}

function inferWrongReason(multiSelectErrorType) {
  if (multiSelectErrorType === "漏选") return "多选漏选";
  if (multiSelectErrorType === "错选") return "多选错选";
  if (multiSelectErrorType === "漏选+错选") return "多选漏选";
  return "";
}

function buildLearningDiagnosis(primaryWrongReason, tags, multiSelectErrorType) {
  return [primaryWrongReason, multiSelectErrorType, ...(tags || [])].filter(Boolean).join(" / ");
}

function getRetestPriority(progress) {
  if (progress.wrong && TANGLED_STATUS.has(progress.confidenceStatus)) return "高";
  if (progress.wrong || progress.guessedCorrect || progress.multiSelectErrorType) return "中";
  return "低";
}

function buildReviewDueAt(wrong, guessedCorrect) {
  if (!wrong && !guessedCorrect) return "";
  const date = new Date();
  date.setDate(date.getDate() + (wrong ? 1 : 3));
  return date.toISOString().slice(0, 10);
}

function getMultiSelectErrorType(missedOptions, overSelectedOptions, selectedCount, answerCount) {
  if (!missedOptions.length && !overSelectedOptions.length) return "";
  if (!selectedCount || overSelectedOptions.length >= selectedCount + answerCount) return "全错";
  if (missedOptions.length && overSelectedOptions.length) return "漏选+错选";
  if (missedOptions.length) return "漏选";
  return "错选";
}

function validateBeforeAnswer() {
  const progress = normalizeProgress({ ...(getCurrentProgress() || {}), ...collectFormValues() });
  if (!TANGLED_STATUS.has(progress.confidenceStatus)) return true;
  const missing = [
    ["纠结选项", progress.hesitationOptions],
    ["各选项理由", progress.eachOptionReason],
    ["定胜关键词", progress.decisiveKeyword],
    ["淘汰项", progress.eliminatedOption],
    ["淘汰理由", progress.eliminationReason],
  ].filter(([, value]) => !String(value || "").trim());
  if (!missing.length) return true;
  alert(`二选一/多选纠结题，对答案前请补全：${missing.map(([name]) => name).join("、")}`);
  return false;
}

function getCurrentProgress() {
  const current = activeQuestions()[selectedIndex];
  return current ? state.progress[questionKey(current)] || {} : {};
}

function buildAnswerText(question, progress) {
  const fields = [
    `答案：${question.answer || "未导入"}`,
    question.explanation || "暂无解析",
    progress.selectedVsCorrectDiff ? `选择差异：${progress.selectedVsCorrectDiff}` : "",
    progress.multiSelectErrorType ? `多选错误：${progress.multiSelectErrorType}；漏选 ${progress.missedOptions.join("") || "无"}；错选 ${progress.overSelectedOptions.join("") || "无"}` : "",
    progress.primaryWrongReason ? `主错因：${progress.primaryWrongReason}` : "",
    progress.secondaryWrongTags?.length ? `易混标签：${progress.secondaryWrongTags.join("、")}` : "",
    progress.hesitationOptions ? `纠结选项：${progress.hesitationOptions}` : "",
    progress.eachOptionReason ? `各选项理由：${progress.eachOptionReason}` : "",
    progress.decisiveKeyword ? `定胜关键词：${progress.decisiveKeyword}` : "",
    progress.eliminatedOption || progress.eliminationReason ? `淘汰：${progress.eliminatedOption || "未填"}；${progress.eliminationReason || "未填理由"}` : "",
    progress.wrongThinking ? `错误思路：${progress.wrongThinking}` : "",
    progress.nextRule ? `下次规则：${progress.nextRule}` : "",
  ];
  return fields.filter(Boolean).join("\n\n");
}

function toggleChoice(choice) {
  const current = activeQuestions()[selectedIndex];
  const progress = normalizeProgress({ ...getCurrentProgress(), ...collectFormValues() });
  if (isMultiQuestion(current)) {
    const selected = new Set(choiceArray(progress.choice));
    if (selected.has(choice)) selected.delete(choice);
    else selected.add(choice);
    return normalizeChoiceText([...selected].join(""));
  }
  return choice;
}

function generateRecitationCard(question, progress) {
  if (!progress.wrong && !progress.guessedCorrect) {
    alert("规则卡默认用于错题或蒙对题，请先判题。");
    return;
  }
  const id = `card-${questionKey(question).replace(/[^\w-]+/g, "-")}-${Date.now().toString(36)}`;
  const card = {
    id,
    title: trimText(progress.primaryWrongReason || "错题规则卡", 18),
    category: "错题回流库",
    questionEye: trimText(progress.decisiveKeyword || question.stem, 24),
    confusingPoint: trimText((progress.secondaryWrongTags || []).join("、") || progress.selectedVsCorrectDiff, 28),
    rule: trimText(progress.nextRule || progress.eliminationReason || progress.wrongThinking || "回看题眼，先排除绝对化和无关项。", 42),
    nextTime: progress.reviewDueAt || buildReviewDueAt(progress.wrong, progress.guessedCorrect),
    sourceQuestionKey: questionKey(question),
    tags: [...new Set([progress.primaryWrongReason, ...(progress.secondaryWrongTags || [])].filter(Boolean))].slice(0, 6),
  };
  state.recitationCards = [card, ...state.recitationCards.filter((item) => item.sourceQuestionKey !== card.sourceQuestionKey)];
  setProgress({ recitationCardId: id, card: true }, true);
}

function buildExportPayload() {
  const progress = normalizeProgressMap(state.progress);
  const questionsByKey = new Map(state.questions.map((question) => [questionKey(question), question]));
  const wrongQuestions = Object.entries(progress)
    .filter(([, item]) => item.wrong || item.guessedCorrect)
    .map(([key, item]) => ({
      ...questionsByKey.get(key),
      progress: item,
      wrongReason: item.wrongReason,
      primaryWrongReason: item.primaryWrongReason,
      secondaryWrongTags: item.secondaryWrongTags,
      hesitationOptions: item.hesitationOptions,
      decisiveKeyword: item.decisiveKeyword,
      wrongThinking: item.wrongThinking,
      nextRule: item.nextRule,
      selectedVsCorrectDiff: item.selectedVsCorrectDiff,
      eachOptionReason: item.eachOptionReason,
      eliminatedOption: item.eliminatedOption,
      eliminationReason: item.eliminationReason,
      perOptionJudgement: item.perOptionJudgement,
      missedOptions: item.missedOptions,
      overSelectedOptions: item.overSelectedOptions,
      multiSelectErrorType: item.multiSelectErrorType,
      learningDiagnosis: item.learningDiagnosis,
      retestPriority: item.retestPriority,
      reviewDueAt: item.reviewDueAt,
      recitationCardId: item.recitationCardId,
    }));
  return {
    ...state,
    progress,
    exportedAt: new Date().toISOString(),
    exportSchemaVersion: 2,
    wrongQuestions,
  };
}

function isCorrectByKey(key, progress) {
  const question = getQuestionByKey(key);
  return Boolean(question?.answer) && normalizeChoiceText(progress.choice) === normalizeChoiceText(question.answer);
}

function getQuestionByKey(key) {
  return state.questions.find((question) => questionKey(question) === key);
}

function isMultiQuestion(question) {
  if (!question) return false;
  return String(question.type || "").includes("多选") || normalizeChoiceText(question.answer).length > 1;
}

function normalizeChoiceText(value) {
  return choiceArray(value).join("");
}

function choiceArray(value) {
  return [...new Set(String(value || "").toUpperCase().match(/[A-H]/g) || [])].sort((a, b) => OPTION_ORDER.indexOf(a) - OPTION_ORDER.indexOf(b));
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function percent(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function sumLengths(items) {
  return items.reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
}

function topCounts(items, limit) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, limit);
}

function trimText(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function persistTrainingFields() {
  setProgress(collectFormValues(), false);
  renderDashboard();
  els.twoChoiceFields.classList.toggle("hidden", !TANGLED_STATUS.has(els.confidenceStatus.value));
}

els.fileInput.addEventListener("change", (event) => handleFiles([...event.target.files]));
els.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropzone.classList.add("drag");
});
els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("drag"));
els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropzone.classList.remove("drag");
  handleFiles([...event.dataTransfer.files]);
});
els.paperList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-paper]");
  if (!button) return;
  selectedPaperId = button.dataset.paper;
  selectedIndex = 0;
  render();
});
els.optionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choice]");
  if (!button) return;
  const current = activeQuestions()[selectedIndex];
  const choice = toggleChoice(button.dataset.choice);
  setProgress({ ...collectFormValues(), choice, done: true });
});
els.perOptionJudgement.addEventListener("click", (event) => {
  const button = event.target.closest("[data-judge-key]");
  if (!button) return;
  const progress = normalizeProgress(getCurrentProgress());
  const next = { ...(progress.perOptionJudgement || {}) };
  next[button.dataset.judgeKey] = next[button.dataset.judgeKey] === button.dataset.judgeValue ? "" : button.dataset.judgeValue;
  setProgress({ perOptionJudgement: next });
});
[
  els.confidenceStatus,
  els.primaryWrongReason,
  els.secondaryWrongTags,
  els.hesitationOptions,
  els.decisiveKeyword,
  els.eliminatedOption,
  els.eachOptionReason,
  els.eliminationReason,
  els.wrongThinking,
  els.nextRule,
].forEach((input) => input.addEventListener("input", persistTrainingFields));
els.showAnswerBtn.addEventListener("click", () => {
  if (els.answerBox.classList.contains("hidden") && !validateBeforeAnswer()) return;
  const current = activeQuestions()[selectedIndex];
  setProgress(collectFormValues(), false);
  els.answerBox.textContent = buildAnswerText(current, normalizeProgress(getCurrentProgress()));
  els.answerBox.classList.toggle("hidden");
});
els.markWrongBtn.addEventListener("click", () => setProgress({ ...collectFormValues(), wrong: true, done: true }));
els.markCardBtn.addEventListener("click", () => {
  const current = activeQuestions()[selectedIndex];
  setProgress(collectFormValues(), false);
  generateRecitationCard(current, normalizeProgress(getCurrentProgress()));
});
els.prevBtn.addEventListener("click", () => {
  selectedIndex = Math.max(0, selectedIndex - 1);
  render();
});
els.nextBtn.addEventListener("click", () => {
  selectedIndex = Math.min(activeQuestions().length - 1, selectedIndex + 1);
  render();
});
els.demoBtn.addEventListener("click", () => {
  importQuestions(
    { id: "demo", title: "演示题本" },
    [
      {
        no: "1",
        type: "单选题",
        stem: "行政机关公开政府信息，应当坚持什么原则？",
        options: [
          { key: "A", text: "公开为常态、不公开为例外" },
          { key: "B", text: "不公开为常态、公开为例外" },
          { key: "C", text: "只公开收费信息" },
          { key: "D", text: "只公开内部信息" },
        ],
        answer: "A",
        explanation: "演示数据仅用于查看练习流程，不是真实题库内容。",
      },
      {
        no: "2",
        type: "多选题",
        stem: "下列属于行政复议受案范围的是哪些？",
        options: [
          { key: "A", text: "行政处罚决定" },
          { key: "B", text: "行政强制措施" },
          { key: "C", text: "内部人事任免" },
          { key: "D", text: "行政许可决定" },
        ],
        answer: "ABD",
        explanation: "演示多选仅用于查看逐项判断和漏选/错选统计。",
      },
    ]
  );
  log("已载入演示数据");
});
els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wrong-questions-latest.json";
  link.click();
  URL.revokeObjectURL(url);
});
els.clearBtn.addEventListener("click", () => {
  if (!confirm("确认清空当前浏览器里的题库和练习记录？")) return;
  localStorage.removeItem(STORE_KEY);
  state.papers = [];
  state.questions = [];
  state.progress = {};
  state.recitationCards = [];
  selectedPaperId = "";
  selectedIndex = 0;
  render();
});

saveState();
render();
