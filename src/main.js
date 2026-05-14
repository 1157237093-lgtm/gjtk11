import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
import {
  parsePaperPdfText,
  parseAnswerPdfText,
  normalizeQuestionNo,
  WRONG_REASONS,
  validateParsedQuestion,
} from "./parser-core.js";
import { getObsidianClassification } from "./obsidian-error-classification.js";

const STORAGE_KEY = "staged-question-bank-v1";
const WRONG_EXPORT_SETTINGS_KEY = "wrong-export-settings-v1";
const AUTO_IMPORT_SETTINGS_KEY = "auto-import-settings-v1";
const AUTOLOAD_BUNDLE_VERSION_KEY = "autoload-bundle-version-v1";
const STORE_BACKUP_KEY = "staged-question-bank-backups-v1";
const MAX_STORE_BACKUPS = 8;
const GPT_GONGJI_URL_KEY = "gpt-gongji-url-v1";
const CONFIDENCE_OPTIONS = ["确定", "不确定", "蒙的", "两个选项纠结", "多个选项纠结"];
const RISK_CONFIDENCE_VALUES = ["不确定", "蒙的", "两个选项纠结", "多个选项纠结"];
const GUESS_REASONS = ["蒙的", "猜的", "不确定", "两个选项纠结", "多个选项纠结"];
const TANGLED_CONFIDENCE_VALUES = ["两个选项纠结", "多个选项纠结"];
const PER_OPTION_JUDGEMENT_VALUES = ["必选", "排除", "不确定"];
const RECITATION_CATEGORIES = [
  "问法类",
  "治理类",
  "生态绿色类",
  "消费类",
  "科技创新类",
  "乡村振兴类",
  "民生公共服务类",
  "政策经济类",
  "法律类",
  "公文类",
  "哲学类",
  "固定搭配类",
  "考前口诀类",
  "题眼词库",
  "易混词库",
  "高频考点库",
  "错题回流库",
  "考前速记库",
];
const RECITATION_SOURCES = ["手动导入", "ChatGPT JSON", "错题生成", "错题回流", "错题自动生成", "考前速记"];
const RECITATION_MASTERY_LABELS = ["未背", "看过但不熟", "能背出", "做题能用上", "稳定掌握", "长期掌握"];
const RECITATION_REVIEW_ACTIONS = [
  { key: "again", label: "不会", level: 0, days: 0 },
  { key: "vague", label: "模糊", keepLevel: true, days: 1 },
  { key: "recall", label: "会背", delta: 1, days: null },
  { key: "mastered", label: "已掌握", level: 5, days: 30 },
];
const ABNORMAL_TYPES = [
  "missingStem",
  "missingOptions",
  "invalidAnswer",
  "duplicateQuestionNo",
  "mixedContent",
  "watermarkNoise",
  "answerConflict",
  "parseFailed",
  "missingExplanation",
  "unknown",
];
const WATERMARK_NOISE_PATTERNS = [
  /凯叔讲公基/g,
  /刘小凯/g,
  /本课程由[“"]?凯叔[”"]?原创研发/g,
  /本课程仅限本人使用/g,
  /详情咨询/g,
  /[＋+]?V\s*[:：]\s*[A-Za-z0-9]+/gi,
  /微信\s*[:：]?\s*[A-Za-z0-9]+/gi,
  /sazywd666/gi,
  /B站关注/g,
  /CCTALK/gi,
];
const RULE_TAGS = [
  "材料映射",
  "选项边界",
  "选项层级误判",
  "二选一误判",
  "多选漏选",
  "多选扩张错选",
  "动作词漏看",
  "主体抓错",
  "对象偷换",
  "固定原话",
  "法律争点",
  "消费",
  "文化",
  "民生",
  "治理",
  "生态",
  "科技",
  "产业",
  "三农",
  "法律",
  "公文",
  "哲学",
];
const REVIEW_PROMPTS = [
  ["initialThought", "我最开始以为这题考的是："],
  ["materialFocus", "材料真正强调的是："],
  ["hesitationText", "我纠结的选项是："],
  ["bias", "我看偏的地方是："],
  ["nextTime", "下次遇到同类题，我先看："],
];
const PDF_WORKER_URL = new URL("./pdf.worker.min.js", window.location.href).toString();
const PDF_CMAP_URL = new URL("./node_modules/pdfjs-dist/cmaps/", window.location.href).toString();
const PDF_STANDARD_FONT_URL = new URL(
  "./node_modules/pdfjs-dist/standard_fonts/",
  window.location.href
).toString();
const SHOULD_DISABLE_WORKER_BY_DEFAULT = window.location.protocol === "file:";
const SHOULD_USE_LOCAL_ASSETS = window.location.protocol !== "file:";

pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
if (SHOULD_DISABLE_WORKER_BY_DEFAULT) {
  globalThis.pdfjsWorker = pdfjsWorker;
}

const state = {
  store: loadStore(),
  wrongExport: loadWrongExportSettings(),
  autoImport: loadAutoImportSettings(),
  timingRuntime: {
    timerId: null,
    activePaperId: null,
    activeQuestionKey: null,
    lastTickAt: null,
    lastPersistAt: null,
  },
  pickerState: {
    isPickingDirectory: false,
    isPickingFile: false,
  },
  currentView: "home",
  currentPaperId: null,
  paperMode: "practice",
  paperFilters: {
    module: "all",
    type: "all",
    status: "all",
  },
  wrongFilters: {
    paperId: "all",
    module: "all",
    type: "all",
    reason: "all",
  },
  recitationFilters: {
    category: "all",
    mastery: "all",
    source: "all",
    tag: "all",
    keyword: "",
    dueOnly: false,
    repeatedWrongOnly: false,
    highReasonOnly: false,
    cramOnly: false,
  },
  recitationDrill: {
    cardId: null,
    questionKeys: [],
  },
  recitationFocusCardId: null,
  abnormalFilters: {
    type: "all",
    paperId: "all",
    keyword: "",
  },
  recitationImport: {
    open: false,
    sourceFile: "粘贴文本",
    pendingCards: [],
    pendingFailedCards: [],
    duplicatePolicy: "merge",
    summary: null,
  },
  notebookMode: "wrong",
  notebookDrillMode: false,
};

const elements = {
  messageBar: document.getElementById("message-bar"),
  importFolderStatus: document.getElementById("import-folder-status"),
  importPaperButton: document.getElementById("import-paper-button"),
  importAnswerButton: document.getElementById("import-answer-button"),
  bindImportFolderButton: document.getElementById("bind-import-folder"),
  bindIcloudExportButton: document.getElementById("bind-icloud-export"),
  homeView: document.getElementById("home-view"),
  paperView: document.getElementById("paper-view"),
  wrongView: document.getElementById("wrong-view"),
  recitationView: document.getElementById("recitation-view"),
  abnormalView: document.getElementById("abnormal-view"),
  paperList: document.getElementById("paper-list"),
  emptyHome: document.getElementById("empty-home"),
  globalSummary: document.getElementById("global-summary"),
  globalTimingPanel: document.getElementById("global-timing-panel"),
  todayRecitationPanel: document.getElementById("today-recitation-panel"),
  paperTitle: document.getElementById("paper-title"),
  paperMeta: document.getElementById("paper-meta"),
  paperSummary: document.getElementById("paper-summary"),
  paperTimingPanel: document.getElementById("paper-timing-panel"),
  paperQuestionList: document.getElementById("paper-question-list"),
  emptyPaper: document.getElementById("empty-paper"),
  paperFilterModule: document.getElementById("paper-filter-module"),
  paperFilterType: document.getElementById("paper-filter-type"),
  paperFilterStatus: document.getElementById("paper-filter-status"),
  wrongFilterPaper: document.getElementById("wrong-filter-paper"),
  wrongFilterModule: document.getElementById("wrong-filter-module"),
  wrongFilterType: document.getElementById("wrong-filter-type"),
  wrongFilterReason: document.getElementById("wrong-filter-reason"),
  notebookEyebrow: document.getElementById("notebook-eyebrow"),
  notebookTitle: document.getElementById("notebook-title"),
  notebookSubtitle: document.getElementById("notebook-subtitle"),
  notebookReasonLabel: document.getElementById("notebook-reason-label"),
  wrongSummary: document.getElementById("wrong-summary"),
  wrongInsights: document.getElementById("wrong-insights"),
  quarantineSummary: document.getElementById("quarantine-summary"),
  wrongList: document.getElementById("wrong-list"),
  emptyWrong: document.getElementById("empty-wrong"),
  emptyNotebookTitle: document.getElementById("empty-notebook-title"),
  icloudExportStatus: document.getElementById("icloud-export-status"),
  modePractice: document.getElementById("mode-practice"),
  modeExam: document.getElementById("mode-exam"),
  paperFileInput: document.getElementById("paper-file-input"),
  answerFileInput: document.getElementById("answer-file-input"),
  recitationFileInput: document.getElementById("recitation-file-input"),
  chatgptRecitationJsonInput: document.getElementById("chatgpt-recitation-json-input"),
  recitationSummary: document.getElementById("recitation-summary"),
  recitationList: document.getElementById("recitation-list"),
  emptyRecitation: document.getElementById("empty-recitation"),
  recitationDrillPanel: document.getElementById("recitation-drill-panel"),
  recitationFilterCategory: document.getElementById("recitation-filter-category"),
  recitationFilterMastery: document.getElementById("recitation-filter-mastery"),
  recitationFilterSource: document.getElementById("recitation-filter-source"),
  recitationFilterTag: document.getElementById("recitation-filter-tag"),
  recitationFilterKeyword: document.getElementById("recitation-filter-keyword"),
  recitationImportPanel: document.getElementById("recitation-import-panel"),
  recitationImportText: document.getElementById("recitation-import-text"),
  recitationImportPreview: document.getElementById("recitation-import-preview"),
  recitationDuplicatePolicy: document.getElementById("recitation-duplicate-policy"),
  recitationExportScope: document.getElementById("recitation-export-scope"),
  importChatGPTRecitationJsonButton: document.getElementById("import-chatgpt-recitation-json"),
  abnormalSummary: document.getElementById("abnormal-summary"),
  abnormalList: document.getElementById("abnormal-list"),
  emptyAbnormal: document.getElementById("empty-abnormal"),
  abnormalFilterType: document.getElementById("abnormal-filter-type"),
  abnormalFilterPaper: document.getElementById("abnormal-filter-paper"),
  abnormalFilterKeyword: document.getElementById("abnormal-filter-keyword"),
  abnormalFileInput: document.getElementById("abnormal-file-input"),
};

init();

function init() {
  applyFixedAutoImportBundle();
  migrateReviewFields();
  refreshAnsweredQuestionScores();
  bindEvents();
  window.addEventListener("beforeunload", () => {
    tickPracticeTimer();
    persistTimingOnly();
  });
  exposeWrongExportDebug();
  void hydrateWrongExportHandle();
  exposeAutoImportDebug();
  void hydrateAutoImportHandle();
  renderApp();
}

function bindEvents() {
  elements.importPaperButton.addEventListener("click", async () => {
    await handleImportButtonClick("paper");
  });

  elements.importAnswerButton.addEventListener("click", async () => {
    await handleImportButtonClick("answer");
  });

  elements.paperFileInput.addEventListener("change", async (event) => {
    event.target.value = "";
  });

  elements.answerFileInput.addEventListener("change", async (event) => {
    event.target.value = "";
  });

  elements.recitationFileInput.addEventListener("change", async (event) => {
    event.target.value = "";
  });

  elements.chatgptRecitationJsonInput?.addEventListener("change", async (event) => {
    await handleChatGPTRecitationJsonInputChange(event);
  });

  elements.chatgptRecitationJsonInput?.addEventListener("cancel", () => {
    flashMessage("已取消选择 ChatGPT 背诵卡 JSON。");
  });

  elements.abnormalFileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const payload = JSON.parse(await file.text());
      const result = importRepairedAbnormalJson(payload);
      flashMessage(`已导入修复异常题：回流 ${result.repairedCount} 题，仍异常 ${result.failedCount} 题。`);
      persistStore();
      renderApp();
    } catch (error) {
      flashMessage(`导入修复 JSON 失败：${error.message}`, true);
    }
  });

  document.getElementById("open-wrong-book").addEventListener("click", () => {
    state.currentView = "wrong";
    state.notebookMode = "wrong";
    state.notebookDrillMode = false;
    renderApp();
  });

  document.getElementById("open-wrong-drill").addEventListener("click", () => {
    state.currentView = "wrong";
    state.notebookMode = "wrong";
    state.notebookDrillMode = true;
    state.wrongFilters = {
      paperId: "all",
      module: "all",
      type: "all",
      reason: "all",
    };

    const rows = state.store.questions.filter((question) => question.isWrong);
    rows.forEach(resetQuestionForWrongDrill);
    persistStore();
    flashMessage(
      rows.length ? `已进入错题重刷，共 ${rows.length} 题。已隐藏旧答案和解析，可逐题重做。` : "当前没有错题可重刷。",
      !rows.length
    );
    renderApp();
  });

  document.getElementById("open-guess-book").addEventListener("click", () => {
    state.currentView = "wrong";
    state.notebookMode = "guess";
    state.notebookDrillMode = false;
    state.wrongFilters = {
      paperId: "all",
      module: "all",
      type: "all",
      reason: "all",
    };

    const rows = getFilteredGuessQuestions();
    flashMessage(
      rows.length ? `已进入猜对题库，共 ${rows.length} 题。` : "当前还没有标记蒙的/猜的题。",
      !rows.length
    );
    renderApp();
  });

  document.getElementById("open-risk-book").addEventListener("click", () => {
    state.currentView = "wrong";
    state.notebookMode = "risk";
    state.notebookDrillMode = false;
    state.wrongFilters = {
      paperId: "all",
      module: "all",
      type: "all",
      reason: "all",
    };

    const rows = getFilteredRiskQuestions();
    flashMessage(rows.length ? `已进入高危题库，共 ${rows.length} 题。` : "当前还没有高危题。", !rows.length);
    renderApp();
  });

  document.getElementById("open-recitation-book").addEventListener("click", () => {
    state.currentView = "recitation";
    state.recitationFilters.cramOnly = false;
    state.recitationFocusCardId = null;
    renderApp();
  });

  document.getElementById("open-abnormal-center").addEventListener("click", () => {
    state.currentView = "abnormal";
    renderApp();
  });

  document.getElementById("back-home-from-paper").addEventListener("click", () => {
    state.currentView = "home";
    renderApp();
  });

  document.getElementById("back-home-from-wrong").addEventListener("click", () => {
    state.currentView = "home";
    state.notebookDrillMode = false;
    renderApp();
  });

  document.getElementById("back-home-from-recitation").addEventListener("click", () => {
    state.currentView = "home";
    state.recitationDrill = { cardId: null, questionKeys: [] };
    state.recitationFocusCardId = null;
    renderApp();
  });

  document.getElementById("back-home-from-abnormal").addEventListener("click", () => {
    state.currentView = "home";
    renderApp();
  });

  elements.modePractice.addEventListener("click", () => {
    state.paperMode = "practice";
    renderApp();
  });

  elements.modeExam.addEventListener("click", () => {
    state.paperMode = "exam";
    renderApp();
  });

  elements.paperFilterModule.addEventListener("change", (event) => {
    state.paperFilters.module = event.target.value;
    renderApp();
  });

  elements.paperFilterType.addEventListener("change", (event) => {
    state.paperFilters.type = event.target.value;
    renderApp();
  });

  elements.paperFilterStatus.addEventListener("change", (event) => {
    state.paperFilters.status = event.target.value;
    renderApp();
  });

  document.getElementById("reset-paper-filters").addEventListener("click", () => {
    state.paperFilters = {
      module: "all",
      type: "all",
      status: "all",
    };
    renderApp();
  });

  document.getElementById("submit-exam").addEventListener("click", () => {
    const questions = getFilteredPaperQuestions();
    syncRenderedQuestionTrainingFields(elements.paperQuestionList, questions);
    if (!questions.length) {
      flashMessage("当前筛选下没有题目可交卷。", true);
      return;
    }

    const answeredQuestions = questions.filter((question) => hasUserAnswer(question));
    if (!answeredQuestions.length) {
      flashMessage(
        state.paperMode === "exam" ? "当前筛选下还没有已作答题目，不能交卷。" : "当前筛选下还没有已作答题目，不能对答案。",
        true
      );
      return;
    }
    const missingConfidence = answeredQuestions.filter((question) => !question.confidenceStatus);
    if (missingConfidence.length) {
      flashMessage(`还有 ${missingConfidence.length} 道已作答题未选择信心状态，不能提交。`, true);
      return;
    }
    if (state.paperMode !== "exam") {
      const missingTangledTraining = answeredQuestions.filter((question) => getMissingTangledTrainingFields(question).length);
      if (missingTangledTraining.length) {
        flashMessage(
          `还有 ${missingTangledTraining.length} 道纠结题未补全二选一训练字段，不能对答案。`,
          true
        );
        return;
      }
    }

    let gradedCount = 0;
    let autoCardCount = 0;
    answeredQuestions.forEach((question) => {
      gradeQuestion(question);
      const cardResult = maybeAutoGenerateRecitationCardAfterGrade(question, { trigger: "batch-submit" });
      if (cardResult) {
        autoCardCount += cardResult.created ? 1 : 0;
      }
      gradedCount += 1;
    });

    persistStore();
    const stats = getPaperStats(state.currentPaperId);
    flashMessage(
      state.paperMode === "exam"
        ? `考试模式已交卷，本次判定 ${gradedCount} 题。本期得分 ${stats.scoreText}。${autoCardCount ? ` 已自动生成背诵卡 ${autoCardCount} 张。` : ""}`
        : `练习模式已对答案，本次判定 ${gradedCount} 题。本期得分 ${stats.scoreText}。${autoCardCount ? ` 已自动生成背诵卡 ${autoCardCount} 张。` : ""}`
    );
    renderApp();
  });

  document.getElementById("export-paper-wrong-pdf").addEventListener("click", () => {
    try {
      const result = exportCurrentPaperWrongQuestionsPdf();
      flashMessage(`已打开本期错题 PDF 打印页：${result.paperTitle}，共 ${result.count} 题。`);
    } catch (error) {
      flashMessage(`导出本期错题 PDF 失败：${error.message}`, true);
    }
  });

  elements.wrongFilterPaper.addEventListener("change", (event) => {
    state.wrongFilters.paperId = event.target.value;
    renderApp();
  });

  elements.wrongFilterModule.addEventListener("change", (event) => {
    state.wrongFilters.module = event.target.value;
    renderApp();
  });

  elements.wrongFilterType.addEventListener("change", (event) => {
    state.wrongFilters.type = event.target.value;
    renderApp();
  });

  elements.wrongFilterReason.addEventListener("change", (event) => {
    state.wrongFilters.reason = event.target.value;
    renderApp();
  });

  elements.recitationFilterCategory.addEventListener("change", (event) => {
    state.recitationFilters.category = event.target.value;
    renderApp();
  });

  elements.recitationFilterMastery.addEventListener("change", (event) => {
    state.recitationFilters.mastery = event.target.value;
    renderApp();
  });

  elements.recitationFilterSource.addEventListener("change", (event) => {
    state.recitationFilters.source = event.target.value;
    renderApp();
  });

  elements.recitationFilterTag.addEventListener("change", (event) => {
    state.recitationFilters.tag = event.target.value;
    renderApp();
  });

  elements.recitationFilterKeyword.addEventListener("input", (event) => {
    state.recitationFilters.keyword = event.target.value;
    renderApp();
  });

  document.getElementById("recitation-filter-due").addEventListener("click", () => {
    state.recitationFilters.dueOnly = !state.recitationFilters.dueOnly;
    state.recitationFilters.cramOnly = false;
    renderApp();
  });

  document.getElementById("recitation-filter-wrong").addEventListener("click", () => {
    state.recitationFilters.repeatedWrongOnly = !state.recitationFilters.repeatedWrongOnly;
    state.recitationFilters.cramOnly = false;
    renderApp();
  });

  document.getElementById("recitation-filter-reason").addEventListener("click", () => {
    state.recitationFilters.highReasonOnly = !state.recitationFilters.highReasonOnly;
    state.recitationFilters.cramOnly = false;
    renderApp();
  });

  document.getElementById("show-exam-cram").addEventListener("click", () => {
    state.currentView = "recitation";
    state.recitationFilters.cramOnly = !state.recitationFilters.cramOnly;
    renderApp();
  });

  document.getElementById("reset-recitation-filters").addEventListener("click", () => {
    state.recitationFilters = createDefaultRecitationFilters();
    state.recitationDrill = { cardId: null, questionKeys: [] };
    renderApp();
  });

  document.getElementById("import-recitation-cards").addEventListener("click", async () => {
    state.recitationImport.open = !state.recitationImport.open;
    renderApp();
    if (state.recitationImport.open) {
      elements.recitationImportText?.focus();
    }
  });

  document.getElementById("choose-recitation-file").addEventListener("click", async () => {
    try {
      const file = await pickRecitationFile();
      if (!file) {
        return;
      }
      const result = await importRecitationCardsFile(file);
      flashMessage(`已解析背诵资料：${result.parsedCount} 张，失败 ${result.failedCount || 0} 张，请确认导入。`);
      renderApp();
    } catch (error) {
      flashMessage(`导入背诵卡片失败：${error.message}`, true);
    }
  });

  elements.importChatGPTRecitationJsonButton?.addEventListener("click", async () => {
    const input = elements.chatgptRecitationJsonInput;
    if (!input) {
      flashMessage("未找到 ChatGPT 背诵卡 JSON 文件选择器。", true);
      return;
    }
    input.value = "";
    input.click();
  });

  document.getElementById("parse-recitation-text").addEventListener("click", () => {
    try {
      const text = elements.recitationImportText.value;
      const result = prepareRecitationImport(text, "粘贴文本");
      flashMessage(`已解析背诵资料：${result.parsedCount} 张，失败 ${result.failedCount || 0} 张，请确认导入。`);
      renderApp();
    } catch (error) {
      flashMessage(`解析背诵资料失败：${error.message}`, true);
    }
  });

  document.getElementById("cancel-recitation-import").addEventListener("click", () => {
    state.recitationImport = createEmptyRecitationImportState();
    renderApp();
  });

  document.getElementById("confirm-recitation-import").addEventListener("click", () => {
    const result = applyRecitationImport(elements.recitationDuplicatePolicy.value);
    flashMessage(`已导入 ${result.importedCount} 张，更新 ${result.updatedCount} 张，跳过重复 ${result.skippedCount} 张，失败 ${result.failedCount} 张。`);
    state.recitationImport = createEmptyRecitationImportState();
    persistStore();
    renderApp();
  });

  document.getElementById("export-recitation-markdown").addEventListener("click", () => {
    const cards = getRecitationExportCards(elements.recitationExportScope.value);
    exportBlob(toRecitationMarkdown(cards), `recitation-cards-${elements.recitationExportScope.value}-${Date.now()}.md`, "text/markdown;charset=utf-8");
    flashMessage(`已导出背诵卡片 Markdown：${cards.length} 张。`);
  });

  document.getElementById("export-recitation-json").addEventListener("click", () => {
    const cards = getRecitationExportCards(elements.recitationExportScope.value);
    exportBlob(
      JSON.stringify({ exportedAt: new Date().toISOString(), scope: elements.recitationExportScope.value, cards: cards.map(toRecitationCardExportItem) }, null, 2),
      `recitation-cards-${elements.recitationExportScope.value}-${Date.now()}.json`,
      "application/json;charset=utf-8"
    );
    flashMessage(`已导出背诵卡片 JSON：${cards.length} 张。`);
  });

  document.getElementById("export-recitation-csv").addEventListener("click", () => {
    const cards = getRecitationExportCards(elements.recitationExportScope.value);
    exportBlob(
      toRecitationCsv(cards),
      `recitation-cards-${elements.recitationExportScope.value}-${Date.now()}.csv`,
      "text/csv;charset=utf-8"
    );
    flashMessage(`已导出背诵卡片 CSV：${cards.length} 张。`);
  });

  document.getElementById("export-abnormal-json").addEventListener("click", () => {
    const rows = getFilteredAbnormalItems();
    exportBlob(
      JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, items: rows }, null, 2),
      `abnormal-questions-${Date.now()}.json`,
      "application/json;charset=utf-8"
    );
    flashMessage(`已导出异常题 JSON：${rows.length} 题。`);
  });

  document.getElementById("import-abnormal-json").addEventListener("click", () => {
    elements.abnormalFileInput?.click();
  });

  elements.abnormalFilterType?.addEventListener("change", (event) => {
    state.abnormalFilters.type = event.target.value;
    renderApp();
  });

  elements.abnormalFilterPaper?.addEventListener("change", (event) => {
    state.abnormalFilters.paperId = event.target.value;
    renderApp();
  });

  elements.abnormalFilterKeyword?.addEventListener("input", (event) => {
    state.abnormalFilters.keyword = event.target.value;
    renderApp();
  });

  document.getElementById("export-json").addEventListener("click", () => {
    if (state.notebookMode === "risk") {
      const rows = getFilteredRiskQuestions();
      if (!rows.length) {
        flashMessage("当前筛选下没有高危题可导出。", true);
        return;
      }
      exportBlob(
        JSON.stringify(buildRiskQuestionsJsonExport(rows), null, 2),
        "risk-questions-latest.json",
        "application/json;charset=utf-8"
      );
      flashMessage(`导出高危题 JSON 成功：${rows.length} 条。`);
      return;
    }
    if (state.notebookMode === "guess") {
      const rows = getFilteredGuessQuestions();
      if (!rows.length) {
        flashMessage("当前筛选下没有猜对题可导出。", true);
        return;
      }
      exportBlob(
        JSON.stringify(buildGuessQuestionsJsonExport(rows), null, 2),
        "guessed-questions-latest.json",
        "application/json;charset=utf-8"
      );
      flashMessage(`导出猜对题 JSON 成功：${rows.length} 条。`);
      return;
    }

    const rows = getFilteredWrongQuestions();
    const validation = validateWrongQuestionsForJsonExport(rows);
    if (!rows.length) {
      flashMessage(
        `导出 JSON 已中止：发现 ${validation.issues.length} 条数据异常。${validation.summary}`,
        true
      );
      return;
    }

    const exportPayload = buildWrongQuestionsJsonExport(rows);
    exportBlob(
      JSON.stringify(exportPayload, null, 2),
      "wrong-questions-latest.json",
      "application/json;charset=utf-8"
    );
    if (!validation.ok) {
      flashMessage(
        `导出 JSON 已切换为“有效项 + 异常报告”模式：有效 ${exportPayload.validItems.length} 条，异常 ${exportPayload.invalidItems.length} 条。${validation.summary}`,
        true
      );
      return;
    }
    flashMessage(`导出 JSON 成功：有效 ${exportPayload.validItems.length} 条。`);
  });

  document.getElementById("export-markdown").addEventListener("click", () => {
    const rows = getNotebookQuestions();
    exportBlob(
      state.notebookMode === "guess" ? toGuessMarkdown(rows) : toMarkdown(rows),
      `${state.notebookMode === "guess" ? "guessed" : state.notebookMode === "risk" ? "risk" : "wrong"}-questions-${Date.now()}.md`,
      "text/markdown;charset=utf-8"
    );
  });

  document.getElementById("export-csv").addEventListener("click", () => {
    const rows = getNotebookQuestions();
    exportBlob(
      state.notebookMode === "guess" ? toGuessCsv(rows) : toCsv(rows),
      `${state.notebookMode === "guess" ? "guessed" : state.notebookMode === "risk" ? "risk" : "wrong"}-questions-${Date.now()}.csv`,
      "text/csv;charset=utf-8"
    );
  });

  document.getElementById("set-gpt-gongji-link").addEventListener("click", () => {
    try {
      const targetUrl = configureGptGongjiUrl();
      if (!targetUrl) {
        flashMessage("已取消设置 GPT 公基链接。");
        return;
      }
      flashMessage(`已保存 GPT 公基链接：${targetUrl}`);
    } catch (error) {
      flashMessage(`设置 GPT 公基链接失败：${error.message}`, true);
    }
  });

  document.getElementById("export-gpt-gongji").addEventListener("click", async () => {
    const popup = window.open("about:blank", "_blank", "noopener");

    try {
      const result = await exportWrongQuestionsToGptGongji(popup);
      flashMessage(
        `已复制 ${result.questionCount} 道错题到剪贴板，并打开 GPT 公基页面。请在 GPT 页面里直接粘贴发送。`
      );
    } catch (error) {
      if (popup && !popup.closed) {
        popup.close();
      }
      flashMessage(`导出到 GPT 公基失败：${error.message}`, true);
    }
  });

  document.getElementById("restart-wrong-drill").addEventListener("click", () => {
    const rows = getNotebookQuestions();
    if (!rows.length) {
      flashMessage(
        state.notebookMode === "guess"
          ? "当前筛选下没有猜对题可重刷。"
          : state.notebookMode === "risk"
            ? "当前筛选下没有高危题可重刷。"
            : "当前筛选下没有错题可重刷。",
        true
      );
      return;
    }

    rows.forEach((question) => {
      if (state.notebookMode === "guess") {
        state.notebookDrillMode = false;
        resetQuestionForGuessDrill(question);
      } else if (state.notebookMode === "risk") {
        state.notebookDrillMode = false;
        resetQuestionForRiskDrill(question);
      } else {
        state.notebookDrillMode = true;
        resetQuestionForWrongDrill(question);
      }
    });
    persistStore();
    flashMessage(
      state.notebookMode === "guess"
        ? `已重置当前筛选猜对题 ${rows.length} 题，可重新作答。`
        : state.notebookMode === "risk"
          ? `已重置当前筛选高危题 ${rows.length} 题，可重新作答。`
          : `已重置当前筛选错题 ${rows.length} 题，可重新作答。`
    );
    renderApp();
  });

  document.getElementById("copy-wrong-current").addEventListener("click", async () => {
    const rows = getNotebookQuestions();
    if (!rows.length) {
      flashMessage(
        state.notebookMode === "guess"
          ? "当前筛选下没有猜对题可复制。"
          : state.notebookMode === "risk"
            ? "当前筛选下没有高危题可复制。"
            : "当前筛选下没有错题可复制。",
        true
      );
      return;
    }

    try {
      await copyText(toNotebookQuestionClipboardText(rows, state.notebookMode));
      flashMessage(
        state.notebookMode === "guess"
          ? `已复制当前筛选猜对题 ${rows.length} 题。`
          : state.notebookMode === "risk"
            ? `已复制当前筛选高危题 ${rows.length} 题。`
            : `已复制当前筛选错题 ${rows.length} 题。`
      );
    } catch (error) {
      flashMessage(`复制当前题目失败：${error.message}`, true);
    }
  });

  elements.bindIcloudExportButton.addEventListener("click", async () => {
    try {
      const configured = await configureIcloudWrongExport();
      if (!configured) {
        return;
      }
      flashMessage("已绑定 iCloud 自动导出目录。后续错题变化会自动同步 JSON。");
      renderApp();
    } catch (error) {
      flashMessage(`绑定 iCloud 导出失败：${error.message}`, true);
    }
  });

  document.getElementById("sync-icloud-export").addEventListener("click", async () => {
    try {
      await exportWrongQuestionsToConfiguredDirectory("manual");
      flashMessage("已手动同步错题 JSON 到 iCloud。");
      renderApp();
    } catch (error) {
      flashMessage(`同步错题 JSON 失败：${error.message}`, true);
    }
  });

  document.getElementById("disable-icloud-export").addEventListener("click", async () => {
    await disableWrongExport();
    flashMessage("已关闭 iCloud 自动导出。");
    renderApp();
  });

  elements.bindImportFolderButton.addEventListener("click", async () => {
    try {
      const configured = await configureAutoImportFolder();
      if (!configured) {
        return;
      }
      flashMessage("已绑定自动导入文件夹。");
      renderApp();
    } catch (error) {
      flashMessage(`绑定自动导入文件夹失败：${error.message}`, true);
    }
  });

  document.getElementById("sync-import-folder").addEventListener("click", async () => {
    try {
      if (!hasAnyConfiguredImportDirectory()) {
        flashMessage("先选择 Finder 里的 Downloads 或“答案解”文件夹，授权后会自动扫描。");
        const configured = await configureAutoImportFolder();
        if (!configured) {
          return;
        }
      }
      const result = await scanConfiguredImportFolder("manual");
      flashMessage(
        `扫描完成：新增导入 ${result.importedCount} 个文件，跳过 ${result.skippedCount} 个文件。`
      );
      renderApp();
    } catch (error) {
      flashMessage(`扫描导入失败：${error.message}`, true);
    }
  });

  document.getElementById("disable-import-folder").addEventListener("click", async () => {
    await disableAutoImportFolder();
    flashMessage("已关闭自动导入文件夹。");
    renderApp();
  });
}

async function importPaperFile(file) {
  const payload = await readImportPayload(file, "paper");
  return importPaper(payload);
}

async function importAnswerFile(file) {
  const payload = await readImportPayload(file, "answer");
  return importAnswers(payload);
}

async function importRecitationCardsFile(file) {
  const text = await file.text();
  return prepareRecitationImport(text, file.name || "本地文件");
}

async function importChatGPTRecitationJsonFile(file) {
  if (!/\.json$/i.test(file.name || "")) {
    throw new Error("请选择 .json 文件。");
  }
  const text = await file.text();
  return importChatGPTRecitationCardsDirect(text, file.name || "ChatGPT 背诵卡 JSON");
}

async function handleChatGPTRecitationJsonInputChange(event) {
  const input = event.target;
  const file = input.files?.[0] || null;
  input.value = "";
  if (!file) {
    flashMessage("已取消选择 ChatGPT 背诵卡 JSON。");
    return;
  }
  try {
    const result = await importChatGPTRecitationJsonFile(file);
    flashMessage(
      `已导入 ChatGPT 背诵卡：新增 ${result.importedCount} 张，更新 ${result.updatedCount} 张，失败 ${result.failedCount} 张。`,
      result.importedCount + result.updatedCount === 0 && result.failedCount > 0
    );
    persistStore();
    renderApp();
  } catch (error) {
    flashMessage(error.message || "导入 ChatGPT 背诵卡 JSON 失败。", true);
  }
}

async function readImportPayload(file, kind) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (!isPdf) {
    return JSON.parse(await file.text());
  }

  const text = await extractPdfText(file);
  return kind === "paper" ? parsePaperPdfText(text, file.name) : parseAnswerPdfText(text, file.name);
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let pdf;

  if (SHOULD_DISABLE_WORKER_BY_DEFAULT) {
    pdf = await loadPdfDocument(bytes, true);
  } else {
    try {
      pdf = await loadPdfDocument(bytes, false);
    } catch (error) {
      pdf = await loadPdfDocument(bytes, true, error);
    }
  }

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.map((item) => item.str).filter(Boolean);
    pages.push(items.join("\n"));
  }

  return pages.join("\n");
}

async function loadPdfDocument(bytes, disableWorker, previousError = null) {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      disableWorker,
      useWorkerFetch: false,
      isEvalSupported: false,
      ...(SHOULD_USE_LOCAL_ASSETS
        ? {
            cMapUrl: PDF_CMAP_URL,
            cMapPacked: true,
            standardFontDataUrl: PDF_STANDARD_FONT_URL,
          }
        : {}),
    });
    return await loadingTask.promise;
  } catch (error) {
    if (!disableWorker) {
      throw error;
    }

    if (previousError) {
      throw previousError;
    }

    throw error;
  }
}

function renderApp() {
  tickPracticeTimer();
  renderPickerButtons();
  elements.homeView.hidden = state.currentView !== "home";
  elements.paperView.hidden = state.currentView !== "paper";
  elements.wrongView.hidden = state.currentView !== "wrong";
  elements.recitationView.hidden = state.currentView !== "recitation";
  if (elements.abnormalView) {
    elements.abnormalView.hidden = state.currentView !== "abnormal";
  }
  renderAutoImportStatus();
  renderHomeView();
  renderPaperView();
  renderWrongView();
  renderRecitationView();
  renderAbnormalView();
  updatePracticeTimerState();
}

function renderPickerButtons() {
  const pickerActive = hasActivePicker();
  elements.importPaperButton.disabled = pickerActive;
  elements.importAnswerButton.disabled = pickerActive;
  document.getElementById("import-recitation-cards").disabled = pickerActive;
  document.getElementById("choose-recitation-file").disabled = pickerActive;
  elements.bindImportFolderButton.disabled = pickerActive;
  elements.bindIcloudExportButton.disabled = pickerActive;
  elements.bindIcloudExportButton.textContent =
    state.wrongExport.enabled || state.wrongExport.handleReady || state.wrongExport.folderName
      ? "重新绑定 iCloud 自动导出"
      : "绑定 iCloud 自动导出";
}

function hasActivePicker() {
  return state.pickerState.isPickingDirectory || state.pickerState.isPickingFile;
}

function notifyActivePicker() {
  flashMessage("已有文件选择窗口打开", true);
}

function isPickerAbortError(error) {
  return error?.name === "AbortError";
}

async function withDirectoryPickerLock(task) {
  if (hasActivePicker()) {
    notifyActivePicker();
    return null;
  }

  state.pickerState.isPickingDirectory = true;
  renderApp();

  try {
    return await task();
  } catch (error) {
    if (isPickerAbortError(error)) {
      flashMessage("已取消目录选择。");
      return null;
    }
    throw error;
  } finally {
    state.pickerState.isPickingDirectory = false;
    renderApp();
  }
}

async function withFilePickerLock(task) {
  if (hasActivePicker()) {
    notifyActivePicker();
    return null;
  }

  state.pickerState.isPickingFile = true;
  renderApp();

  try {
    return await task();
  } catch (error) {
    if (isPickerAbortError(error)) {
      flashMessage("已取消文件选择。");
      return null;
    }
    throw error;
  } finally {
    state.pickerState.isPickingFile = false;
    renderApp();
  }
}

async function handleImportButtonClick(kind) {
  const file = await pickImportFile(kind);
  if (!file) {
    return;
  }

  try {
    if (kind === "paper") {
      const result = await importPaperFile(file);
      flashMessage(
        `已导入题本：${result.paperTitle}，共 ${result.importedCount} 题。` +
          `${result.quarantineCount > 0 ? ` 已隔离异常题 ${result.quarantineCount} 题。` : ""}`
      );
    } else {
      const result = await importAnswerFile(file);
      flashMessage(
        `已回填答案：${result.paperTitle}，已解析答案 ${result.parsedAnswerCount} 条，` +
          `已匹配标准答案 ${result.matchedAnswerCount}/${result.total} 题，未匹配 ${result.unmatchedQuestionCount} 题。` +
          `${result.unmatchedQuestionCount > 0 ? ` 未匹配原因：${result.unmatchedReasonSummary}。` : ""}` +
          ` 已判分 ${result.gradedCount} 题，未判分 ${result.ungradedCount} 题。`
      );
    }
    renderApp();
  } catch (error) {
    flashMessage(`${kind === "paper" ? "题本" : "答案"}导入失败：${error.message}`, true);
  }
}

async function pickImportFile(kind) {
  return withFilePickerLock(async () => {
    if (isFilePickerSupported()) {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [createImportFilePickerType(kind)],
      });
      return fileHandle ? fileHandle.getFile() : null;
    }

    return pickImportFileWithInput(kind === "paper" ? elements.paperFileInput : elements.answerFileInput);
  });
}

async function pickRecitationFile() {
  return withFilePickerLock(async () => {
    if (isFilePickerSupported()) {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "背诵资料 txt / md / JSON",
            accept: {
              "text/plain": [".txt"],
              "text/markdown": [".md"],
              "application/json": [".json"],
            },
          },
        ],
      });
      return fileHandle ? fileHandle.getFile() : null;
    }

    return pickImportFileWithInput(elements.recitationFileInput);
  });
}

function isFilePickerSupported() {
  return window.isSecureContext && typeof window.showOpenFilePicker === "function";
}

function createImportFilePickerType(kind) {
  return {
    description: kind === "paper" ? "题本 PDF / JSON" : "答案 PDF / JSON",
    accept: {
      "application/pdf": [".pdf"],
      "application/json": [".json"],
    },
  };
}

function pickImportFileWithInput(input) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      window.removeEventListener("focus", handleFocus, true);
      input.value = "";
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleChange = (event) => {
      const file = event.target.files?.[0] || null;
      finish(() => resolve(file));
    };

    const handleFocus = () => {
      window.setTimeout(() => {
        finish(() => resolve(null));
      }, 0);
    };

    input.addEventListener("change", handleChange, { once: true });
    window.addEventListener("focus", handleFocus, true);

    try {
      input.click();
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function renderHomeView() {
  const papers = [...state.store.papers].sort((a, b) => {
    return String(b.paperId).localeCompare(String(a.paperId), "zh-CN", { numeric: true });
  });
  const globalTimingStats = getGlobalTimingStats(papers);
  const recitationCards = getRecitationCards();
  const abnormalItems = getAbnormalItems();
  const todayText = new Date().toISOString().slice(0, 10);
  const scoreDiagnosisStats = getScoreDiagnosisStats(state.store.questions);

  elements.globalSummary.innerHTML = summaryCardsMarkup([
    { label: "期次数", value: papers.length },
    { label: "总题量", value: state.store.questions.length },
    { label: "总错题", value: state.store.questions.filter((question) => question.isWrong).length },
    { label: "高危题", value: state.store.questions.filter((question) => question.isHighRisk).length },
    { label: "背诵卡", value: recitationCards.length },
    { label: "今日背诵", value: getTodayRecitationCards().length },
    { label: "今日新增背诵卡", value: recitationCards.filter((card) => String(card.createdAt || "").startsWith(todayText)).length },
    { label: "今日到期背诵卡", value: recitationCards.filter(isRecitationCardDue).length },
    { label: "错题自动生成卡", value: recitationCards.filter((card) => card.source === "错题自动生成").length },
    { label: "手动生成卡", value: recitationCards.filter((card) => card.source !== "错题自动生成").length },
    { label: "异常隔离总数", value: abnormalItems.length },
    { label: "已修复异常", value: abnormalItems.filter((item) => item.repairedAt).length },
    { label: "未修复异常", value: abnormalItems.filter((item) => !item.repairedAt).length },
    { label: "重复题数量", value: abnormalItems.filter((item) => item.abnormalType === "duplicateQuestionNo").length },
    { label: "水印污染题", value: abnormalItems.filter((item) => item.abnormalType === "watermarkNoise").length },
    { label: "背诵平均掌握", value: getAverageMasteryText(recitationCards) },
    { label: "做对但不确定", value: state.store.questions.filter((question) => isCorrectButUncertain(question)).length },
    { label: "蒙对题", value: state.store.questions.filter((question) => isGuessedCorrect(question)).length },
    { label: "猜对题", value: state.store.questions.filter((question) => question.isGuessed).length },
    { label: "总计时", value: formatDuration(globalTimingStats.totalSeconds) },
    {
      label: "总已判分",
      value: state.store.questions.filter((question) => isGradedQuestion(question)).length,
    },
    {
      label: "总得分",
      value: getStoreScoreStats().scoreText,
    },
    { label: "材料主题抓错", value: countQuestionsByRiskReason(state.store.questions, "材料主题抓错") },
    { label: "选项边界不清", value: countQuestionsByRiskReason(state.store.questions, "选项边界不清") },
    { label: "二刷仍不确定", value: state.store.questions.filter((question) => question.secondReviewStillUncertain).length },
    { label: "最多犹豫组合", value: getTopHesitationCombo(state.store.questions) },
    { label: "高频错因 Top5", value: topRiskReasonText(state.store.questions) },
    { label: "真实正确率", value: scoreDiagnosisStats.realAccuracyText },
    { label: "表面正确率", value: scoreDiagnosisStats.surfaceAccuracyText },
    { label: "二选一错误率", value: scoreDiagnosisStats.tangledErrorRateText },
    { label: "多选漏选数", value: scoreDiagnosisStats.multiMissedCount },
    { label: "多选错选数", value: scoreDiagnosisStats.multiOverSelectedCount },
    { label: "Top5 提分错因", value: scoreDiagnosisStats.topPrimaryWrongReasonsText },
    { label: "Top10 易混标签", value: scoreDiagnosisStats.topSecondaryWrongTagsText },
  ]);
  renderGlobalTimingPanel(globalTimingStats);
  renderTodayRecitationPanel();

  elements.paperList.innerHTML = papers
    .map((paper) => {
      const stats = getPaperStats(paper.paperId);
      return `
        <article class="paper-card">
          <div class="paper-card-header">
            <div>
              <p class="eyebrow">Paper ${escapeHtml(paper.paperId)}</p>
              <h3>${escapeHtml(paper.paperTitle)}</h3>
            </div>
            <span class="status-badge" data-status="${paper.answerImportedAt ? "correct" : "answered"}">
              ${paper.answerImportedAt ? "答案已导入" : "未导入答案"}
            </span>
          </div>
          <p>${escapeHtml(paper.description || "按期次独立练习，不与其他期次混题。")}</p>
          <div class="paper-card-metrics">
            <span class="metric-pill">题量 ${stats.total}</span>
            <span class="metric-pill">已做 ${stats.answered}</span>
            <span class="metric-pill">已匹配答案 ${stats.matchedAnswerCount}</span>
            <span class="metric-pill">已判分 ${stats.gradedCount}</span>
            <span class="metric-pill">错题 ${stats.wrongCount}</span>
            <span class="metric-pill">高危 ${stats.riskCount}</span>
            <span class="metric-pill">猜对 ${stats.guessCount}</span>
            <span class="metric-pill">得分 ${stats.scoreText}</span>
            <span class="metric-pill">正确率（已判分） ${stats.accuracyText}</span>
            <span class="metric-pill">作答完成度 ${stats.completionText}</span>
          </div>
          <button class="primary" data-action="open-paper" data-paper-id="${escapeHtmlAttr(paper.paperId)}">
            进入本期练习
          </button>
        </article>
      `;
    })
    .join("");

  elements.emptyHome.hidden = papers.length > 0;

  document.querySelectorAll("[data-action='open-paper']").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPaperId = button.dataset.paperId;
      state.currentView = "paper";
      state.paperFilters = { module: "all", type: "all", status: "all" };
      state.paperMode = "practice";
      renderApp();
    });
  });
}

function renderTodayRecitationPanel() {
  const cards = getTodayRecitationCards();
  if (!elements.todayRecitationPanel) {
    return;
  }
  elements.todayRecitationPanel.hidden = false;
  elements.todayRecitationPanel.innerHTML = `
    <div class="insight-row">
      ${insightGroupMarkup("今日背诵", topCountEntries(cards, (card) => card.category, 5))}
      <section class="insight-group">
        <div class="insight-title">建议先背</div>
        <div class="insight-tags">
          ${
            cards.length
              ? cards
                  .slice(0, 8)
                  .map((card) => `<span class="metric-pill">${escapeHtml(card.title)} · ${escapeHtml(masteryText(card.masteryLevel))}</span>`)
                  .join("")
              : `<span class="muted">暂无背诵卡片。可先从错题或高危题生成。</span>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderRecitationView() {
  if (!elements.recitationView || state.currentView !== "recitation") {
    return;
  }

  const allCards = getRecitationCards();
  const cards = getFilteredRecitationCards();
  renderSelect(elements.recitationFilterCategory, "全部分类", RECITATION_CATEGORIES, state.recitationFilters.category);
  renderSelect(elements.recitationFilterMastery, "全部掌握度", ["0", "1", "2", "3", "4", "5"], state.recitationFilters.mastery, (value) => `${value} · ${masteryText(value)}`);
  renderSelect(elements.recitationFilterSource, "全部来源", RECITATION_SOURCES, state.recitationFilters.source);
  renderSelect(elements.recitationFilterTag, "全部标签", RULE_TAGS, state.recitationFilters.tag);
  elements.recitationFilterKeyword.value = state.recitationFilters.keyword;

  document.getElementById("recitation-filter-due").classList.toggle("active", state.recitationFilters.dueOnly);
  document.getElementById("recitation-filter-wrong").classList.toggle("active", state.recitationFilters.repeatedWrongOnly);
  document.getElementById("recitation-filter-reason").classList.toggle("active", state.recitationFilters.highReasonOnly);
  document.getElementById("show-exam-cram").classList.toggle("active", state.recitationFilters.cramOnly);
  renderRecitationImportPanel();

  elements.recitationSummary.innerHTML = summaryCardsMarkup([
    { label: "卡片总数", value: allCards.length },
    { label: "当前筛选", value: cards.length },
    { label: "到期复习", value: allCards.filter(isRecitationCardDue).length },
    { label: "错题回流", value: allCards.filter((card) => card.source === "错题回流" || card.source === "错题生成" || card.category === "错题回流库").length },
    { label: "考前速记", value: allCards.filter((card) => card.category === "考前速记库").length },
    { label: "平均掌握度", value: getAverageMasteryText(allCards) },
  ]);

  renderRecitationDrillPanel();
  elements.recitationList.innerHTML = cards.map(recitationCardMarkup).join("");
  elements.emptyRecitation.hidden = cards.length > 0;
  bindRecitationEvents(cards);
}

function renderRecitationImportPanel() {
  const importState = state.recitationImport;
  elements.recitationImportPanel.hidden = !importState.open;
  if (!importState.open) {
    return;
  }

  elements.recitationDuplicatePolicy.value = importState.duplicatePolicy || "merge";
  document.getElementById("confirm-recitation-import").disabled = !importState.pendingCards.length && !importState.pendingFailedCards.length;
  elements.recitationImportPreview.innerHTML = importState.summary
    ? recitationImportPreviewMarkup(importState.summary, importState.pendingCards)
    : `<p class="muted">粘贴文本后点击“解析并预览”，或点击“选择 txt / md / json”。</p>`;
}

function recitationImportPreviewMarkup(summary, cards) {
  const categoryRows = Object.entries(summary.byCategory || {})
    .map(([category, count]) => `<span class="metric-pill">${escapeHtml(category)} ${count}</span>`)
    .join("");
  return `
    <div class="recitation-import-summary">
      ${summaryCardsMarkup([
        { label: "总卡片数", value: summary.total },
        { label: "分类数量", value: summary.categoryCount },
        { label: "固定搭配卡", value: summary.fixedCount },
        { label: "易混对照卡", value: summary.contrastCount },
        { label: "考前口诀卡", value: summary.cramCount },
        { label: "可能重复", value: summary.duplicateCount },
        { label: "失败卡片", value: summary.failedCount || 0 },
      ])}
      <div class="insight-tags">${categoryRows || `<span class="muted">未识别分类</span>`}</div>
      <div class="recitation-preview-list">
        ${cards
          .slice(0, 8)
          .map(
            (card) => `
              <article class="recitation-preview-card">
                <strong>${escapeHtml(card.title)}</strong>
                <span>${escapeHtml(card.category)} · ${escapeHtml(card.keywords.join("、") || "无关键词")}</span>
              </article>
            `
          )
          .join("")}
        ${cards.length > 8 ? `<p class="muted">还有 ${cards.length - 8} 张未展开显示。</p>` : ""}
      </div>
    </div>
  `;
}

function renderRecitationDrillPanel() {
  const activeCard = getActiveRecitationCard();
  const drillQuestions = getActiveRecitationDrillQuestions();
  elements.recitationDrillPanel.hidden = !activeCard;
  if (!activeCard) {
    elements.recitationDrillPanel.innerHTML = "";
    return;
  }

  elements.recitationDrillPanel.innerHTML = `
    <div class="section-head compact">
      <div>
        <p class="eyebrow">背后即练</p>
        <h3>${escapeHtml(activeCard.title)}</h3>
        <p class="muted">关联题 ${drillQuestions.length} 道。做对且信心为“确定”才会提升掌握度。</p>
      </div>
      <button class="ghost" data-close-recitation-drill="true">收起练题</button>
    </div>
    ${
      drillQuestions.length
        ? `<div class="question-list">${drillQuestions.map((question) => questionCardMarkup(question, "practice", false)).join("")}</div>`
        : `<p class="muted">没有找到关联题。请先给卡片添加关键词，或从具体错题生成背诵卡片。</p>`
    }
  `;
  bindQuestionEvents(elements.recitationDrillPanel, drillQuestions, "practice");
  const closeButton = elements.recitationDrillPanel.querySelector("[data-close-recitation-drill]");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      state.recitationDrill = { cardId: null, questionKeys: [] };
      renderApp();
    });
  }
}

function recitationCardMarkup(card) {
  const isCram = state.recitationFilters.cramOnly;
  const focused = state.recitationFocusCardId === card.cardId;
  const sourceText = [card.questionNo ? `Q${card.questionNo}` : "", card.paperTitle || card.sourceFile || card.source]
    .filter(Boolean)
    .join("｜");
  const tagText = (card.tags || []).join("、") || "未标记";
  const sourceName = card.paperTitle || card.sourceFile || card.source || "未填写";
  const correctDirection = card.correctDirection || card.title || "未填写";
  return `
    <article class="recitation-card ${focused ? "is-focused" : ""}">
      ${focused ? `<div class="recitation-focus-banner">刚生成的背诵卡片</div>` : ""}
      <div class="recitation-card-top">
        ${recitationTopMeta("题号", card.questionNo ? `Q${card.questionNo}` : "未填写")}
        ${recitationTopMeta("来源", sourceName)}
        ${recitationTopMeta("正确方向", correctDirection)}
        ${recitationTopMeta("标签", tagText)}
      </div>
      <div class="paper-card-header recitation-card-heading">
        <div>
          <p class="eyebrow">${escapeHtml(sourceText || card.category)}</p>
          <h3>${escapeHtml(compactText(correctDirection, 64))}</h3>
        </div>
        <span class="status-badge" data-status="${Number(card.masteryLevel) >= 3 ? "correct" : "answered"}">
          ${escapeHtml(masteryText(card.masteryLevel))}
        </span>
      </div>
      <div class="recitation-core-list">
        ${recitationPreviewRow("题眼", card.triggerWords || card.keyword || card.title || "未填写")}
        ${recitationPreviewRow("成立条件", card.condition || "未填写")}
        ${recitationPreviewRow("排除规则", card.excludeRule || "未填写")}
        ${recitationPreviewRow("下次规则", card.nextRule || card.whenToChoose || "未填写")}
      </div>
      <div class="recitation-card-actions">
        ${RECITATION_REVIEW_ACTIONS.map(
          (action) => `<button class="secondary" data-recitation-review="${escapeHtmlAttr(card.cardId)}" data-review-action="${action.key}">${action.label}</button>`
        ).join("")}
        ${
          isCram
            ? ""
            : `
              <details class="recitation-details">
                <summary>展开详情</summary>
                <div class="recitation-fields">
                  <p><strong>原题全文：</strong>${escapeHtml(card.stemBrief || card.sourceText || "未填写")}</p>
                  <p><strong>正面：</strong>${escapeHtml(card.front || "未填写")}</p>
                  <p><strong>back / 完整解析：</strong>${escapeHtml(card.back || "未填写")}</p>
                  <p><strong>长错因：</strong>${escapeHtml(card.mistakeReason || card.commonMistake || "未填写")}</p>
                  <p><strong>长规则：</strong>${escapeHtml(card.coreMeaning || card.recitePoint || card.whenToChoose || "未填写")}</p>
                  <p><strong>关键词：</strong>${escapeHtml(card.keywords.join("、") || "未填写")}</p>
                  <p><strong>正确方向：</strong>${escapeHtml(card.correctDirection || "未填写")}</p>
                  <p><strong>易错方向：</strong>${escapeHtml(card.trapDirection || "未填写")}</p>
                  <p><strong>题干证据词：</strong>${escapeHtml(card.questionSignals || "未填写")}</p>
                  <p><strong>什么时候选：</strong>${escapeHtml(card.whenToChoose || "未填写")}</p>
                  <p><strong>易混词：</strong>${escapeHtml(card.confusingWords || "未填写")}</p>
                  <p><strong>区别：</strong>${escapeHtml(card.difference || "未填写")}</p>
                  <p><strong>典型材料：</strong>${escapeHtml(card.typicalMaterial || "未填写")}</p>
                  <p><strong>关联题目：</strong>${escapeHtml(card.relatedQuestionIds.join("、") || "无")}</p>
                </div>
              </details>
            `
        }
        <button class="ghost" type="button" data-recitation-edit="${escapeHtmlAttr(card.cardId)}">编辑</button>
      </div>
    </article>
  `;
}

function recitationPreviewRow(label, value) {
  const text = String(value || "未填写").replace(/\s+/g, " ").trim() || "未填写";
  const preview = compactText(text, 80);
  const needsExpand = text.length > 80;
  return `
    <div class="recitation-core-row">
      <strong>${escapeHtml(label)}：</strong>
      <span>${escapeHtml(preview)}${needsExpand ? `<details class="inline-expand"><summary>展开</summary><p>${escapeHtml(text)}</p></details>` : ""}</span>
    </div>
  `;
}

function recitationTopMeta(label, value) {
  const text = String(value || "未填写").replace(/\s+/g, " ").trim() || "未填写";
  const preview = compactText(text, 80);
  const needsExpand = text.length > 80;
  return `
    <span class="recitation-meta-chip">
      <strong>${escapeHtml(label)}</strong>
      ${escapeHtml(preview)}
      ${needsExpand ? `<details class="inline-expand"><summary>展开</summary><p>${escapeHtml(text)}</p></details>` : ""}
    </span>
  `;
}

function bindRecitationEvents(cards) {
  const cardMap = new Map(cards.map((card) => [card.cardId, card]));
  elements.recitationList.querySelectorAll("[data-recitation-drill]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = cardMap.get(button.dataset.recitationDrill);
      if (!card) {
        return;
      }
      const questions = getRelatedQuestionsForCard(card);
      state.recitationDrill = {
        cardId: card.cardId,
        questionKeys: questions.slice(0, 5).map(questionKey),
      };
      card.reviewCount += 1;
      card.lastReviewDate = new Date().toISOString();
      card.lastReviewedAt = card.lastReviewDate;
      card.nextReviewDate = nextReviewDateForMastery(card.masteryLevel);
      card.nextReviewAt = card.nextReviewDate;
      persistStore();
      renderApp();
    });
  });

  elements.recitationList.querySelectorAll("[data-recitation-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = cardMap.get(button.dataset.recitationReview);
      if (!card) {
        return;
      }
      applyRecitationReviewAction(card, button.dataset.reviewAction);
      persistStore();
      flashMessage(`已记录背诵状态：${card.title}`);
      renderApp();
    });
  });

  elements.recitationList.querySelectorAll("[data-recitation-must]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = cardMap.get(button.dataset.recitationMust);
      if (!card) {
        return;
      }
      card.isMustMemorize = !card.isMustMemorize;
      card.mustMemorize = card.isMustMemorize;
      card.updatedAt = new Date().toISOString();
      persistStore();
      renderApp();
    });
  });

  elements.recitationList.querySelectorAll("[data-recitation-mastery]").forEach((select) => {
    select.addEventListener("change", () => {
      const card = cardMap.get(select.dataset.recitationMastery);
      if (!card) {
        return;
      }
      card.masteryLevel = clampMasteryLevel(select.value);
      card.mastery = card.masteryLevel;
      card.nextReviewDate = nextReviewDateForMastery(card.masteryLevel);
      card.nextReviewAt = card.nextReviewDate;
      persistStore();
      renderApp();
    });
  });

  elements.recitationList.querySelectorAll("[data-recitation-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = cardMap.get(button.dataset.recitationEdit);
      flashMessage(card ? `编辑功能保留入口：${card.title}` : "未找到背诵卡");
    });
  });
}

function renderPaperView() {
  const paper = state.store.papers.find((item) => item.paperId === state.currentPaperId);
  if (!paper) {
    return;
  }

  const paperQuestions = getPaperQuestions(paper.paperId);
  const filtered = getFilteredPaperQuestions();
  const stats = getPaperStats(paper.paperId);
  const timingStats = getPaperTimingStats(paper.paperId);
  const modules = uniqueValues(paperQuestions.map((question) => question.module));
  const types = uniqueValues(paperQuestions.map((question) => question.type));

  elements.paperTitle.textContent = paper.paperTitle;
  elements.paperMeta.textContent =
    `paperId: ${paper.paperId} · ${paper.answerImportedAt ? "答案已导入" : "答案未导入"} · ` +
    `已匹配标准答案 ${stats.matchedAnswerCount}/${stats.total} 题 · 已判分 ${stats.gradedCount} 题 · ` +
    `得分 ${stats.scoreText} · 未判分 ${stats.ungradedCount} 题`;

  elements.modePractice.classList.toggle("active", state.paperMode === "practice");
  elements.modeExam.classList.toggle("active", state.paperMode === "exam");

  renderSelect(elements.paperFilterModule, "全部模块", modules, state.paperFilters.module);
  renderSelect(elements.paperFilterType, "全部题型", types, state.paperFilters.type);
  elements.paperFilterStatus.value = state.paperFilters.status;

  elements.paperSummary.innerHTML = summaryCardsMarkup([
    { label: "题量", value: stats.total },
    { label: "已做题数", value: stats.answered },
    { label: "已匹配标准答案题数", value: `${stats.matchedAnswerCount}/${stats.total}` },
    { label: "已判分题数", value: stats.gradedCount },
    { label: "正确题数", value: stats.correctCount },
    { label: "错题数", value: stats.wrongCount },
    { label: "高危题数", value: stats.riskCount },
    { label: "做对但不确定", value: stats.uncertainCorrectCount },
    { label: "蒙对题数", value: stats.guessedCorrectCount },
    { label: "猜对题数", value: stats.guessCount },
    { label: "本期得分", value: stats.scoreText },
    { label: "已做题得分率", value: stats.scoreRateText },
    { label: "未判分题数", value: stats.ungradedCount },
    { label: "正确率（基于已判分）", value: stats.accuracyText },
    { label: "作答完成度", value: stats.completionText },
    { label: "本期累计用时", value: formatDuration(timingStats.totalSeconds) },
    { label: "最耗时题", value: timingStats.slowestQuestionLabel },
    { label: "当前筛选", value: filtered.length },
  ]);
  renderPaperTimingPanel(timingStats);

  document.getElementById("submit-exam").disabled = false;
  document.getElementById("submit-exam").textContent =
    state.paperMode === "exam" ? "交卷当前筛选" : "对答案当前筛选";
  elements.paperQuestionList.innerHTML = filtered
    .map((question) => questionCardMarkup(question, state.paperMode, false))
    .join("");
  elements.emptyPaper.hidden = filtered.length > 0;
  bindQuestionEvents(elements.paperQuestionList, filtered, state.paperMode);
}

function renderWrongView() {
  const isGuessBook = state.notebookMode === "guess";
  const isRiskBook = state.notebookMode === "risk";
  const notebookQuestions = isGuessBook
    ? state.store.questions.filter((question) => question.isGuessed)
    : isRiskBook
      ? state.store.questions.filter((question) => question.isHighRisk)
      : state.store.questions.filter((question) => question.isWrong);
  const papers = uniqueValues(notebookQuestions.map((question) => `${question.paperId}@@${question.paperTitle}`)).map(
    (entry) => {
      const [paperId, paperTitle] = entry.split("@@");
      return { value: paperId, label: `${paperId} · ${paperTitle}` };
    }
  );

  elements.notebookEyebrow.textContent = isGuessBook ? "Guess Notebook" : isRiskBook ? "Risk Notebook" : "Wrong Notebook";
  elements.notebookTitle.textContent = isGuessBook ? "猜对题库" : isRiskBook ? "高危题库" : state.notebookDrillMode ? "错题重刷" : "总错题本";
  elements.notebookSubtitle.textContent = isGuessBook
    ? "把做对但不稳的题单独收进来，后续像错题一样重刷。"
    : isRiskBook
      ? "做对但不稳、蒙对、犹豫后做对的题，连续两次确定做对才转入已掌握。"
      : state.notebookDrillMode
        ? "重刷模式下默认隐藏旧答案和解析；提交后做对的自动移出，做错的继续保留。"
        : "跨期复盘，支持按筛选维度导出。";
  elements.notebookReasonLabel.textContent = isGuessBook ? "标记" : isRiskBook ? "错因/犹豫组合" : "错因";
  document.getElementById("restart-wrong-drill").textContent = isGuessBook
    ? "重刷当前猜对题"
    : isRiskBook
      ? "重刷当前高危题"
      : "重刷当前错题";
  document.getElementById("copy-wrong-current").textContent = isGuessBook
    ? "复制当前猜对题"
    : isRiskBook
      ? "复制当前高危题"
      : "复制当前错题";
  elements.emptyNotebookTitle.textContent = isGuessBook
    ? "当前筛选下没有猜对题"
    : isRiskBook
      ? "当前筛选下没有高危题"
      : "当前筛选下没有错题";
  ["bind-icloud-export", "sync-icloud-export", "disable-icloud-export", "set-gpt-gongji-link", "export-gpt-gongji"].forEach(
    (id) => {
      const element = document.getElementById(id);
      if (element) {
        element.hidden = isGuessBook || isRiskBook;
      }
    }
  );

  renderSelect(
    elements.wrongFilterPaper,
    "全部期次",
    papers.map((item) => item.value),
    state.wrongFilters.paperId,
    (value) => papers.find((item) => item.value === value)?.label || value
  );
  renderSelect(
    elements.wrongFilterModule,
    "全部模块",
    uniqueValues(notebookQuestions.map((question) => question.module)),
    state.wrongFilters.module
  );
  renderSelect(
    elements.wrongFilterType,
    "全部题型",
    uniqueValues(notebookQuestions.map((question) => question.type)),
    state.wrongFilters.type
  );
  renderSelect(
    elements.wrongFilterReason,
    isGuessBook ? "全部标记" : isRiskBook ? "全部错因/犹豫组合" : "全部错因",
    isGuessBook ? GUESS_REASONS : isRiskBook ? getRiskFilterValues(notebookQuestions) : WRONG_REASONS,
    state.wrongFilters.reason
  );

  const filtered = getNotebookQuestions();
  const wrongInsights = buildNotebookInsights(filtered, isGuessBook, isRiskBook);
  const quarantineItems = getQuarantineItems();
  elements.wrongSummary.innerHTML = summaryCardsMarkup([
    { label: isGuessBook ? "猜对题数" : isRiskBook ? "高危题数" : "错题数", value: filtered.length },
    { label: isGuessBook ? "已标记" : "已标错因", value: filtered.filter((question) => isGuessBook ? question.guessReason : getQuestionRiskReasons(question).length).length },
    { label: "涉及期次", value: uniqueValues(filtered.map((question) => question.paperId)).length },
    { label: "涉及模块", value: uniqueValues(filtered.map((question) => question.module)).length },
    { label: isGuessBook || isRiskBook ? "已判定正确" : "已判定错题", value: filtered.filter((question) => question.status === (isGuessBook || isRiskBook ? "correct" : "wrong")).length },
    ...(isRiskBook ? [{ label: "关联背诵卡", value: filtered.filter((question) => getRecitationCardForQuestion(question)).length }] : []),
    { label: "异常隔离题", value: quarantineItems.length },
  ]);
  renderWrongInsights(wrongInsights);
  renderQuarantineSummary(quarantineItems);

  elements.wrongList.innerHTML = filtered.map((question) => questionCardMarkup(question, "practice", !isGuessBook && !isRiskBook, isGuessBook, isRiskBook)).join("");
  elements.emptyWrong.hidden = filtered.length > 0;
  bindQuestionEvents(elements.wrongList, filtered, "practice", !isGuessBook && !isRiskBook, isGuessBook, isRiskBook);
  elements.icloudExportStatus.hidden = isGuessBook || isRiskBook;
  if (isGuessBook || isRiskBook) {
    elements.icloudExportStatus.textContent = "";
  } else {
    renderWrongExportStatus();
  }
}

function renderWrongInsights(insights) {
  if (!elements.wrongInsights) {
    return;
  }

  if (!insights.total) {
    elements.wrongInsights.hidden = true;
    elements.wrongInsights.innerHTML = "";
    return;
  }

  elements.wrongInsights.hidden = false;
  elements.wrongInsights.innerHTML = `
    <div class="insight-row">
      ${insightGroupMarkup("错因", insights.byReason)}
      ${insightGroupMarkup("期次", insights.byPaper)}
      ${insightGroupMarkup("模块", insights.byModule)}
    </div>
  `;
}

function renderQuarantineSummary(items) {
  if (!elements.quarantineSummary) {
    return;
  }

  if (!items.length) {
    elements.quarantineSummary.hidden = true;
    elements.quarantineSummary.innerHTML = "";
    return;
  }

  elements.quarantineSummary.hidden = false;
  elements.quarantineSummary.innerHTML = `
    <div class="insight-title">异常题隔离 ${items.length} 题</div>
    <div class="quarantine-list">
      ${items
        .slice(0, 5)
        .map(
          (item) => `
            <div class="quarantine-item">
              <strong>${escapeHtml(item.paperTitle)} · 第 ${escapeHtml(item.questionNo)} 题</strong>
              <span>${escapeHtml(item.issues.join("、"))}</span>
            </div>
          `
        )
        .join("")}
    </div>
    ${items.length > 5 ? `<p class="muted">还有 ${items.length - 5} 题未显示，可在控制台查看完整 paper-import-quarantine 日志。</p>` : ""}
  `;
}

function renderAbnormalView() {
  if (!elements.abnormalView || state.currentView !== "abnormal") {
    return;
  }
  const allItems = getAbnormalItems();
  const rows = getFilteredAbnormalItems();
  const unrepaired = allItems.filter((item) => !item.repairedAt);
  const paperIds = uniqueValues(allItems.map((item) => item.paperId).filter(Boolean));
  renderSelect(elements.abnormalFilterType, "全部异常类型", ABNORMAL_TYPES, state.abnormalFilters.type, abnormalTypeText);
  renderSelect(elements.abnormalFilterPaper, "全部期次", paperIds, state.abnormalFilters.paperId, (paperId) => {
    const item = allItems.find((row) => row.paperId === paperId);
    return item ? item.paperTitle : paperId;
  });
  elements.abnormalFilterKeyword.value = state.abnormalFilters.keyword;
  elements.abnormalSummary.innerHTML = summaryCardsMarkup([
    { label: "异常隔离总数", value: allItems.length },
    { label: "未修复", value: unrepaired.length },
    { label: "已修复", value: allItems.filter((item) => item.repairedAt).length },
    { label: "水印污染", value: allItems.filter((item) => item.abnormalType === "watermarkNoise").length },
    { label: "轻异常", value: allItems.filter((item) => item.severity === "light").length },
    { label: "当前筛选", value: rows.length },
  ]);
  elements.abnormalList.innerHTML = rows.map(abnormalItemMarkup).join("");
  elements.emptyAbnormal.hidden = rows.length > 0;
  bindAbnormalEvents(rows);
}

function abnormalItemMarkup(item) {
  const key = escapeHtmlAttr(abnormalItemKey(item));
  const optionRows = ["A", "B", "C", "D"].map((label) => {
    const option = (item.options || []).find((row) => row.label === label) || { label, text: "" };
    return `
      <label>
        ${escapeHtml(label)} 选项
        <input data-abnormal-option="${escapeHtmlAttr(label)}" data-abnormal-key="${key}" value="${escapeHtmlAttr(option.text)}" />
      </label>
    `;
  }).join("");
  return `
    <article class="abnormal-card ${item.repairedAt ? "is-repaired" : ""}" data-abnormal-card="${key}">
      <div class="paper-card-header">
        <div>
          <p class="eyebrow">${escapeHtml(item.paperTitle)} · Q${escapeHtml(item.questionNo)}</p>
          <h3>${escapeHtml(abnormalTypeText(item.abnormalType))}</h3>
        </div>
        <span class="status-badge" data-status="${item.repairedAt ? "correct" : item.severity === "light" ? "answered" : "wrong"}">
          ${item.repairedAt ? "已修复" : item.severity === "light" ? "轻异常" : "待修复"}
        </span>
      </div>
      <p class="muted">${escapeHtml((item.issues || []).join("、"))}</p>
      <div class="abnormal-edit-grid">
        <label>
          题干
          <textarea rows="4" data-abnormal-stem="${key}">${escapeHtml(item.stem)}</textarea>
        </label>
        <div class="option-edit-grid">${optionRows}</div>
        <label>
          正确答案
          <input data-abnormal-answer="${key}" value="${escapeHtmlAttr(formatAnswer(item.correctAnswer))}" />
        </label>
        <label>
          解析
          <textarea rows="3" data-abnormal-explanation="${key}">${escapeHtml(item.explanation)}</textarea>
        </label>
      </div>
      <details>
        <summary>查看原始解析片段</summary>
        <pre class="raw-block">${escapeHtml(item.rawBlock || item.stem || "无原始片段")}</pre>
      </details>
      <div class="question-actions">
        <button class="secondary" data-abnormal-clean="${key}">一键清理水印</button>
        <button class="secondary" data-abnormal-reparse="${key}">一键尝试重新解析</button>
        <button class="primary" data-abnormal-save="${key}">保存修复</button>
        <button class="primary" data-abnormal-return="${key}">修复后回流题库</button>
        <button class="ghost" data-abnormal-delete="${key}">删除异常题</button>
      </div>
    </article>
  `;
}

function bindAbnormalEvents(rows) {
  const rowMap = new Map(rows.map((item) => [abnormalItemKey(item), item]));
  elements.abnormalList.querySelectorAll("[data-abnormal-clean]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rowMap.get(button.dataset.abnormalClean);
      if (!item) return;
      readAbnormalEditForm(item);
      cleanAbnormalItemWatermark(item);
      updateAbnormalValidation(item);
      persistStore();
      flashMessage("已清理水印并重新校验。");
      renderApp();
    });
  });
  elements.abnormalList.querySelectorAll("[data-abnormal-reparse]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rowMap.get(button.dataset.abnormalReparse);
      if (!item) return;
      readAbnormalEditForm(item);
      updateAbnormalValidation(item);
      persistStore();
      flashMessage(item.severity === "light" ? "重新校验通过，仅剩轻异常。" : `重新校验仍有异常：${item.issues.join("、")}`, item.severity !== "light");
      renderApp();
    });
  });
  elements.abnormalList.querySelectorAll("[data-abnormal-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rowMap.get(button.dataset.abnormalSave);
      if (!item) return;
      readAbnormalEditForm(item);
      updateAbnormalValidation(item);
      item.repairHistory.push({ action: "save", issues: item.issues, at: new Date().toISOString() });
      item.updatedAt = new Date().toISOString();
      persistStore();
      flashMessage("已保存修复内容。");
      renderApp();
    });
  });
  elements.abnormalList.querySelectorAll("[data-abnormal-return]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = rowMap.get(button.dataset.abnormalReturn);
      if (!item) return;
      readAbnormalEditForm(item);
      const result = repairAndReturnAbnormalItem(item);
      persistStore();
      flashMessage(result.ok ? `已回流题库：第 ${item.questionNo} 题。` : `回流失败：${result.issues.join("、")}`, !result.ok);
      renderApp();
    });
  });
  elements.abnormalList.querySelectorAll("[data-abnormal-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.store.abnormalQuestions = getAbnormalItems().filter((item) => abnormalItemKey(item) !== button.dataset.abnormalDelete);
      persistStore();
      flashMessage("已删除异常题。");
      renderApp();
    });
  });
}

function readAbnormalEditForm(item) {
  const key = abnormalItemKey(item);
  const findByDataset = (selector, attr) =>
    [...elements.abnormalList.querySelectorAll(selector)].find((node) => node.dataset[attr] === key);
  item.stem = findByDataset("[data-abnormal-stem]", "abnormalStem")?.value.trim() || "";
  item.correctAnswer = normalizeAnswerValue(findByDataset("[data-abnormal-answer]", "abnormalAnswer")?.value || "");
  item.explanation = findByDataset("[data-abnormal-explanation]", "abnormalExplanation")?.value.trim() || "";
  item.options = ["A", "B", "C", "D"]
    .map((label) => ({
      label,
      text:
        [...elements.abnormalList.querySelectorAll(`[data-abnormal-option="${label}"]`)].find((node) => node.dataset.abnormalKey === key)?.value.trim() ||
        "",
    }))
    .filter((option) => option.text);
}

function cleanAbnormalItemWatermark(item) {
  const clean = (value) =>
    WATERMARK_NOISE_PATTERNS.reduce((text, pattern) => text.replace(pattern, ""), String(value || ""))
      .replace(/^\s*\d+\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  item.stem = clean(item.stem);
  item.explanation = clean(item.explanation);
  item.rawBlock = clean(item.rawBlock);
  item.options = (item.options || []).map((option) => ({ ...option, text: clean(option.text) }));
}

function updateAbnormalValidation(item) {
  const classified = classifyAbnormalIssues(item);
  item.issues = classified.issues;
  item.abnormalType = classified.abnormalType;
  item.severity = classified.severity;
  item.updatedAt = new Date().toISOString();
}

function repairAndReturnAbnormalItem(item) {
  updateAbnormalValidation(item);
  const hardIssues = item.issues.filter((issue) => issue !== "解析缺失");
  if (hardIssues.length) {
    item.repairHistory.push({ action: "return-failed", issues: item.issues, at: new Date().toISOString() });
    return { ok: false, issues: item.issues };
  }
  const paper = state.store.papers.find((row) => row.paperId === item.paperId);
  const question = normalizePaperQuestion(
    {
      questionNo: item.questionNo,
      type: item.type,
      stem: item.stem,
      options: item.options,
      correctAnswer: item.correctAnswer,
      explanation: item.explanation,
      module: item.module,
    },
    { paperId: item.paperId, paperTitle: item.paperTitle || paper?.paperTitle || item.paperId }
  );
  const parsedIssues = validateParsedQuestion(question);
  if (parsedIssues.length) {
    item.issues = uniqueValues(parsedIssues);
    item.abnormalType = classifyAbnormalIssues(item).abnormalType;
    item.severity = "hard";
    item.updatedAt = new Date().toISOString();
    item.repairHistory.push({ action: "return-failed", issues: item.issues, at: item.updatedAt });
    return { ok: false, issues: item.issues };
  }
  const existing = state.store.questions.find((row) => questionKey(row) === questionKey(question));
  const preserved = getQuestionProgressSnapshot(existing);
  state.store.questions = state.store.questions.filter((row) => questionKey(row) !== questionKey(question));
  state.store.questions.push({ ...question, ...preserved });
  state.store.questions.sort(questionSorter);
  item.repairedAt = new Date().toISOString();
  item.repairHistory.push({ action: "return-ok", issues: item.issues, at: item.repairedAt });
  return { ok: true, issues: [] };
}

function importRepairedAbnormalJson(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
  if (!rows.length) {
    throw new Error("JSON 中没有 items 数组。");
  }
  let repairedCount = 0;
  let failedCount = 0;
  const imported = rows.map((item) => normalizeAbnormalItem(item));
  state.store.abnormalQuestions = mergeAbnormalItems([...getAbnormalItems(), ...imported]);
  imported.forEach((item) => {
    const target = getAbnormalItems().find((row) => abnormalItemKey(row) === abnormalItemKey(item));
    if (!target) return;
    const result = repairAndReturnAbnormalItem(target);
    if (result.ok) repairedCount += 1;
    else failedCount += 1;
  });
  return { repairedCount, failedCount };
}

function abnormalTypeText(type) {
  return {
    missingStem: "题干缺失",
    missingOptions: "选项缺失",
    invalidAnswer: "答案格式错误",
    duplicateQuestionNo: "题号重复",
    mixedContent: "混入其他内容",
    watermarkNoise: "水印广告污染",
    answerConflict: "答案冲突",
    parseFailed: "解析失败",
    missingExplanation: "解析缺失",
    unknown: "未知异常",
  }[type] || "未知异常";
}

function insightGroupMarkup(title, entries) {
  return `
    <section class="insight-group">
      <div class="insight-title">${escapeHtml(title)}</div>
      <div class="insight-tags">
        ${
          entries.length
            ? entries
                .map((entry) => `<span class="metric-pill">${escapeHtml(entry.label)} ${entry.count}</span>`)
                .join("")
            : `<span class="muted">暂无</span>`
        }
      </div>
    </section>
  `;
}

function bindQuestionEvents(container, questions, mode, isWrongBook = false, isGuessBook = false, isRiskBook = false) {
  const questionMap = new Map(questions.map((question) => [questionKey(question), question]));

  container.querySelectorAll("[data-option]").forEach((input) => {
    input.addEventListener("change", () => {
      const question = questionMap.get(input.dataset.questionKey);
      if (!question) {
        return;
      }

      const wasGraded = isGradedQuestion(question);
      if (isWrongBook && state.notebookDrillMode) {
        return;
      }
      if (mode !== "exam" && !wasGraded && !isWrongBook && !isGuessBook && !isRiskBook) {
        return;
      }
      updateUserAnswerFromDom(question, container);
      if (mode === "exam") {
        markAnswered(question);
        persistStore();
        renderApp();
        return;
      }

      if (wasGraded || isWrongBook || isGuessBook || isRiskBook) {
        if (hasUserAnswer(question)) {
          gradeQuestion(question);
        } else {
          clearQuestionProgress(question);
        }
        persistStore();
        renderApp();
      }
    });
  });

  container.querySelectorAll("[data-submit-question]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      if (!question) {
        return;
      }

      const selectedAnswer = collectUserAnswerFromDom(question, container);
      if (!selectedAnswer) {
        flashMessage("请先选择答案。", true);
        return;
      }
      updateConfidenceFromDom(question, container);
      updateHesitationOptionsFromDom(question, container);
      updateScoreTrainingFieldsFromDom(question, container);
      updatePerOptionJudgementFromDom(question, container);
      if (!question.confidenceStatus) {
        flashMessage("请先选择信心状态。", true);
        return;
      }
      if (shouldRequireTangledTrainingBeforeAnswer(mode, isWrongBook, isGuessBook, isRiskBook)) {
        const missingTangledTraining = getMissingTangledTrainingFields(question);
        if (missingTangledTraining.length) {
          flashMessage(`请先补全二选一训练字段：${missingTangledTraining.join("、")}。`, true);
          return;
        }
      }
      question.userAnswer = selectedAnswer;
      markAnswered(question);

      if (mode === "exam") {
        persistStore();
        flashMessage("考试模式下已保存作答，统一交卷后判题。");
        renderApp();
        return;
      }

      gradeQuestion(question);
      updateRecitationCardAfterQuestionGrade(question);
      const autoCardResult = maybeAutoGenerateRecitationCardAfterGrade(question, { trigger: "submit" });
      persistStore();
      const cardSuffix = autoCardResult ? ` 已${autoCardResult.created ? "生成" : "更新"}背诵卡：${autoCardResult.card.title}` : "";
      if (isWrongBook) {
        flashMessage(
          question.status === "correct" ? "回答正确，已从错题本移出。" : `回答错误，继续保留在错题本。${cardSuffix}`,
          question.status !== "correct"
        );
      } else if (isGuessBook) {
        flashMessage(
          question.status === "correct" ? "回答正确，继续保留在猜对题库。" : `回答错误，已转入错题。${cardSuffix}`,
          question.status !== "correct"
        );
      } else if (isRiskBook) {
        flashMessage(
          question.isHighRisk
            ? `已提交，高危状态继续保留。${cardSuffix}`
            : question.status === "correct"
              ? "已连续确定做对，转入已掌握。"
              : `回答错误，已转入错题。${cardSuffix}`,
          question.status !== "correct" || question.isHighRisk
        );
      } else if (autoCardResult) {
        flashMessage(`回答错误，已${autoCardResult.created ? "生成" : "更新"}背诵卡：${autoCardResult.card.title}`, true);
      }
      renderApp();
    });
  });

  container.querySelectorAll("[data-clear-question]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      if (!question) {
        return;
      }

      if (isWrongBook) {
        resetQuestionForWrongDrill(question);
      } else if (isGuessBook) {
        resetQuestionForGuessDrill(question);
      } else if (isRiskBook) {
        resetQuestionForRiskDrill(question);
      } else {
        clearQuestionProgress(question);
      }
      persistStore();
      renderApp();
    });
  });

  container.querySelectorAll("[data-create-recitation-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      if (!question) {
        return;
      }

      const result = generateOrUpdateRecitationCardFromQuestion(question, { trigger: "manual" });
      const { card, created } = result;
      state.recitationFocusCardId = card.cardId;
      persistStore();
      flashMessage(created ? `已生成背诵卡片：${card.title}` : `已存在背诵卡片，已更新复习记录：${card.title}`);
      renderApp();
    });
  });

  container.querySelectorAll("[data-regenerate-recitation-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      if (!question) {
        return;
      }
      const result = generateOrUpdateRecitationCardFromQuestion(question, { trigger: "manual-regenerate", regenerate: true });
      state.recitationFocusCardId = result.card.cardId;
      persistStore();
      flashMessage(`已重新生成背诵卡片：${result.card.title}`);
      renderApp();
    });
  });

  container.querySelectorAll("[data-mark-needs-recitation]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      if (!question) {
        return;
      }
      const result = generateOrUpdateRecitationCardFromQuestion(question, { trigger: "high-risk-need" });
      result.card.isMustMemorize = true;
      result.card.mustMemorize = true;
      result.card.updatedAt = new Date().toISOString();
      state.recitationFocusCardId = result.card.cardId;
      persistStore();
      flashMessage(`已标记需要背，并关联背诵卡：${result.card.title}`);
      renderApp();
    });
  });

  container.querySelectorAll("[data-copy-recitation-card-markdown]").forEach((button) => {
    button.addEventListener("click", async () => {
      const question = questionMap.get(button.dataset.questionKey);
      const card = question ? getRecitationCardForQuestion(question) : null;
      if (!card) {
        flashMessage("这道题还没有生成背诵卡片。", true);
        return;
      }
      await copyText(toRecitationMarkdown([card]));
      flashMessage("已复制背诵卡 Markdown。");
    });
  });

  container.querySelectorAll("[data-view-recitation-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = questionMap.get(button.dataset.questionKey);
      const card = question ? getRecitationCardForQuestion(question) : null;
      if (!card) {
        flashMessage("这道题还没有生成背诵卡片。", true);
        return;
      }
      openRecitationCard(card);
    });
  });

  container.querySelectorAll("[data-wrong-reason]").forEach((select) => {
    select.addEventListener("change", () => {
      const question = questionMap.get(select.dataset.questionKey);
      if (!question) {
        return;
      }

      question.wrongReason = select.value || null;
      question.updatedAt = new Date().toISOString();
      persistStore();
      renderApp();
    });
  });

  container.querySelectorAll("[data-risk-reason]").forEach((input) => {
    input.addEventListener("change", () => {
      const question = questionMap.get(input.dataset.questionKey);
      if (!question) {
        return;
      }

      updateRiskReasonsFromDom(question, container);
      persistReviewMetadata(question);
      if (shouldGenerateCardForHighRiskMeta(question)) {
        generateOrUpdateRecitationCardFromQuestion(question, { trigger: "risk-label" });
      }
      persistStore();
      renderApp();
    });
  });

  container.querySelectorAll("[data-confidence]").forEach((select) => {
    select.addEventListener("change", () => {
      const question = questionMap.get(select.dataset.questionKey);
      if (!question) {
        return;
      }

      question.confidenceStatus = select.value || null;
      if (isGradedQuestion(question) && hasUserAnswer(question)) {
        gradeQuestion(question);
        persistStore();
        renderApp();
      } else {
        persistReviewMetadata(question);
        persistStore();
      }
    });
  });

  container.querySelectorAll("[data-hesitation-option]").forEach((input) => {
    input.addEventListener("change", () => {
      const question = questionMap.get(input.dataset.questionKey);
      if (!question) {
        return;
      }

      updateHesitationOptionsFromDom(question, container);
      if (isGradedQuestion(question) && hasUserAnswer(question)) {
        gradeQuestion(question);
        persistStore();
        renderApp();
      } else {
        persistReviewMetadata(question);
        persistStore();
      }
    });
  });

  container.querySelectorAll("[data-score-training-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const question = questionMap.get(input.dataset.questionKey);
      if (!question) {
        return;
      }

      updateScoreTrainingFieldsFromDom(question, container);
      persistReviewMetadata(question);
      if (isGradedQuestion(question) && hasUserAnswer(question)) {
        gradeQuestion(question);
      }
      persistStore();
      renderApp();
    });
  });

  container.querySelectorAll("[data-per-option-judgement]").forEach((input) => {
    input.addEventListener("change", () => {
      const question = questionMap.get(input.dataset.questionKey);
      if (!question) {
        return;
      }

      updatePerOptionJudgementFromDom(question, container);
      persistReviewMetadata(question);
      if (isGradedQuestion(question) && hasUserAnswer(question)) {
        gradeQuestion(question);
      }
      persistStore();
      renderApp();
    });
  });

  container.querySelectorAll("[data-review-field]").forEach((textarea) => {
    textarea.addEventListener("change", () => {
      const question = questionMap.get(textarea.dataset.questionKey);
      if (!question) {
        return;
      }

      const field = textarea.dataset.reviewField;
      question.reviewNotes = normalizeReviewNotes(question.reviewNotes);
      question.reviewNotes[field] = textarea.value.trim();
      persistReviewMetadata(question);
      persistStore();
    });
  });

  container.querySelectorAll("[data-guess-reason]").forEach((select) => {
    select.addEventListener("change", () => {
      const question = questionMap.get(select.dataset.questionKey);
      if (!question) {
        return;
      }

      question.guessReason = select.value || null;
      question.isGuessed = Boolean(question.guessReason);
      question.confidenceStatus = question.guessReason || question.confidenceStatus;
      if (isGradedQuestion(question) && hasUserAnswer(question)) {
        gradeQuestion(question);
        maybeAutoGenerateRecitationCardAfterGrade(question, { trigger: "guess-reason" });
      }
      question.updatedAt = new Date().toISOString();
      persistStore();
      renderApp();
    });
  });
}

function syncRenderedQuestionTrainingFields(container, questions) {
  if (!container) {
    return;
  }
  const questionMap = new Map(questions.map((question) => [questionKey(question), question]));
  container.querySelectorAll("[data-question-card]").forEach((card) => {
    const question = questionMap.get(card.dataset.questionKey);
    if (!question) {
      return;
    }
    updateConfidenceFromDom(question, container);
    updateHesitationOptionsFromDom(question, container);
    updateScoreTrainingFieldsFromDom(question, container);
    updatePerOptionJudgementFromDom(question, container);
    persistReviewMetadata(question);
  });
}

function importPaper(payload) {
  const paperId = requireString(payload.paperId, "paperId");
  const paperTitle = requireString(payload.paperTitle, "paperTitle");
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    throw new Error("题本数据必须包含 questions 数组。");
  }
  const parserQuarantine = Array.isArray(payload.quarantine) ? payload.quarantine : [];

  const existingPaper = state.store.papers.find((paper) => paper.paperId === paperId);
  const existingQuestionMap = new Map(
    state.store.questions
      .filter((question) => question.paperId === paperId)
      .map((question) => [questionKey(question), question])
  );
  const quarantine = [...parserQuarantine];
  const paperContext = {
    paperId,
    paperTitle,
    description: String(payload.description || ""),
    importedAt: existingPaper?.importedAt || new Date().toISOString(),
    answerImportedAt: existingPaper?.answerImportedAt || null,
  };

  const importedQuestions = payload.questions.flatMap((rawQuestion) => {
    const normalized = normalizePaperQuestion(rawQuestion, paperContext);
    const issues = validateParsedQuestion(normalized);
    if (issues.length > 0) {
      quarantine.push({
        paperId,
        paperTitle,
        questionNo: normalized.questionNo,
        type: normalized.type,
        issues,
        stemPreview: normalized.stem.slice(0, 120),
        rawBlock: "",
        parsedQuestion: normalized,
      });
      return [];
    }
    const previous = existingQuestionMap.get(questionKey(normalized));
    const preservedProgress = getQuestionProgressSnapshot(previous);
    return [{
      ...normalized,
      correctAnswer: previous?.correctAnswer ?? normalized.correctAnswer,
      explanation: previous?.explanation ?? normalized.explanation,
      ...preservedProgress,
    }];
  });

  if (importedQuestions.length === 0) {
    throw new Error(`题本导入失败：${paperTitle} 的题目全部进入异常隔离。`);
  }

  const nextPaper = {
    ...paperContext,
    lastPaperImportReport: {
      importedCount: importedQuestions.length,
      quarantineCount: quarantine.length,
      quarantine,
      importedAt: new Date().toISOString(),
    },
  };

  state.store.papers = state.store.papers.filter((paper) => paper.paperId !== paperId);
  state.store.papers.push(nextPaper);

  const preservedQuestions = state.store.questions.filter((question) => question.paperId !== paperId);

  state.store.questions = [...preservedQuestions, ...importedQuestions].sort(questionSorter);
  syncAbnormalItemsForPaper(paperId, paperTitle, quarantine);
  persistStore();
  if (quarantine.length > 0) {
    console.group(`paper-import-quarantine:${paperTitle}`);
    console.table(
      quarantine.map((item) => ({
        questionNo: item.questionNo,
        type: item.type,
        issues: item.issues.join(" | "),
        stemPreview: item.stemPreview,
      }))
    );
    console.groupEnd();
  }
  return {
    paperTitle,
    importedCount: importedQuestions.length,
    quarantineCount: quarantine.length,
    quarantine,
  };
}

function importAnswers(payload) {
  const paperId = requireString(payload.paperId, "paperId");
  if (!Array.isArray(payload.answers) || payload.answers.length === 0) {
    throw new Error("答案数据必须包含 answers 数组。");
  }

  const paper = state.store.papers.find((item) => item.paperId === paperId) || findCompatiblePaperForAnswerPayload(payload);
  if (!paper) {
    throw new Error("期次不匹配或缺少对应题本");
  }
  const resolvedPaperId = paper.paperId;
  const paperQuestions = getPaperQuestions(resolvedPaperId);

  const answerMap = new Map();
  const duplicateAnswerNos = [];
  payload.answers.forEach((item) => {
    const normalizedNo = normalizeQuestionNo(requireString(item.questionNo, "questionNo"));
    if (answerMap.has(normalizedNo)) {
      duplicateAnswerNos.push(normalizedNo);
    }
    answerMap.set(normalizedNo, {
      rawQuestionNo: item.questionNo,
      correctAnswer: normalizeAnswerValue(item.correctAnswer),
      explanation: String(item.explanation || ""),
      type: item.type ? String(item.type) : "",
    });
  });

  let updatedCount = 0;
  const matchedQuestionNos = new Set();
  const matchedPaperQuestionNos = [];
  state.store.questions = state.store.questions.map((question) => {
    if (question.paperId !== resolvedPaperId) {
      return question;
    }

    const normalizedQuestionNo = normalizeQuestionNo(question.questionNo);
    const answer = answerMap.get(normalizedQuestionNo);
    if (!answer) {
      return question;
    }

    updatedCount += 1;
    matchedQuestionNos.add(normalizedQuestionNo);
    matchedPaperQuestionNos.push(question.questionNo);
    const updatedQuestion = {
      ...question,
      type: answer.type || question.type,
      correctAnswer: answer.correctAnswer,
      explanation: answer.explanation,
    };
    if (hasUserAnswer(updatedQuestion)) {
      gradeQuestion(updatedQuestion);
    }
    return updatedQuestion;
  });

  const extraAnswerCount = payload.answers.length - matchedQuestionNos.size;
  if (updatedCount === 0) {
    throw new Error("期次不匹配或缺少对应题本");
  }

  paper.answerImportedAt = new Date().toISOString();
  const unmatchedPaperQuestionNos = paperQuestions
    .map((question) => normalizeQuestionNo(question.questionNo))
    .filter((questionNo) => !matchedQuestionNos.has(questionNo));
  const unmatchedAnswerQuestionNos = [...answerMap.keys()].filter(
    (questionNo) => !paperQuestions.some((question) => normalizeQuestionNo(question.questionNo) === questionNo)
  );
  const unmatchedReasons = {
    answer_missing_for_question: unmatchedPaperQuestionNos.length,
    answer_without_question: unmatchedAnswerQuestionNos.length,
    duplicate_answer_question_no: duplicateAnswerNos.length,
  };
  paper.lastAnswerImportReport = {
    parsedAnswerCount: payload.answers.length,
    matchedPaperQuestionNos,
    unmatchedPaperQuestionNos,
    unmatchedAnswerQuestionNos,
    unmatchedReasons,
    answerSample: payload.answers.slice(0, 10),
  };
  persistStore();
  const stats = getPaperStats(paperId);
  console.group(`answer-import:${paper.paperTitle}`);
  console.log("题本总题数", paperQuestions.length);
  console.log("答案实际解析条数", payload.answers.length);
  console.log("前10条答案样本", payload.answers.slice(0, 10));
  console.log("已匹配题号", matchedPaperQuestionNos);
  console.log("未匹配题号", unmatchedPaperQuestionNos);
  console.log("答案有但题本无的题号", unmatchedAnswerQuestionNos);
  console.log("未匹配原因统计", unmatchedReasons);
  console.groupEnd();
  return {
    paperTitle: paper.paperTitle,
    updatedCount,
    parsedAnswerCount: payload.answers.length,
    matchedAnswerCount: updatedCount,
    total: paperQuestions.length,
    unmatchedQuestionCount: unmatchedPaperQuestionNos.length,
    extraAnswerCount,
    gradedCount: stats.gradedCount,
    ungradedCount: stats.ungradedCount,
    unmatchedReasonSummary: formatUnmatchedReasonSummary(unmatchedReasons),
  };
}

function findCompatiblePaperForAnswerPayload(payload) {
  const meta = payload?.parserMeta || {};
  const issueNumber = Number(meta.issueNumber);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    return null;
  }

  const answerKind = meta.isMock ? "mock" : "issue";
  const candidates = state.store.papers.filter((paper) => {
    const match = String(paper.paperId || "").match(/^(issue|mock)-(\d+)-(\d+)-(\d+)$/);
    return match && match[1] === answerKind && Number(match[2]) === issueNumber;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function normalizePaperQuestion(rawQuestion, paper) {
  return {
    paperId: paper.paperId,
    paperTitle: paper.paperTitle,
    questionNo: normalizeQuestionNo(requireString(rawQuestion.questionNo, "questionNo")),
    type: requireString(rawQuestion.type, "type"),
    stem: requireString(rawQuestion.stem, "stem"),
    options: normalizeOptions(rawQuestion.options),
    correctAnswer: rawQuestion.correctAnswer ? normalizeAnswerValue(rawQuestion.correctAnswer) : null,
    explanation: String(rawQuestion.explanation || ""),
    module: requireString(rawQuestion.module || "未分类", "module"),
    status: "unanswered",
    userAnswer: null,
    score: null,
    maxScore: null,
    isWrong: false,
    wrongReason: null,
    primaryWrongReason: "",
    secondaryWrongTags: [],
    isGuessed: false,
    guessReason: null,
    isHighRisk: false,
    confidenceStatus: null,
    hesitationOptions: "",
    decisiveKeyword: "",
    wrongThinking: "",
    nextRule: "",
    selectedVsCorrectDiff: "",
    eachOptionReason: "",
    eliminatedOption: "",
    eliminationReason: "",
    perOptionJudgement: {},
    missedOptions: [],
    overSelectedOptions: [],
    multiSelectErrorType: "",
    learningDiagnosis: "",
    retestPriority: "",
    reviewDueAt: "",
    recitationCardId: "",
    riskReasons: [],
    reviewNotes: normalizeReviewNotes(null),
    riskCertainCorrectStreak: 0,
    secondReviewStillUncertain: false,
    lastReviewSnapshot: null,
    updatedAt: null,
  };
}

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("每道题都必须包含 options 数组。");
  }

  return options.map((option, index) => {
    if (typeof option === "string") {
      return { label: String.fromCharCode(65 + index), text: option };
    }
    return {
      label: requireString(option.label || String.fromCharCode(65 + index), "option.label"),
      text: requireString(option.text, "option.text"),
    };
  });
}

function renderSelect(select, defaultLabel, values, currentValue, formatLabel) {
  select.innerHTML = [`<option value="all">${defaultLabel}</option>`]
    .concat(
      values.map((value) => {
        const label = formatLabel ? formatLabel(value) : value;
        return `<option value="${escapeHtmlAttr(value)}">${escapeHtml(label)}</option>`;
      })
    )
    .join("");
  select.value = currentValue;
}

function getPaperQuestions(paperId) {
  return state.store.questions.filter((question) => question.paperId === paperId).sort(questionSorter);
}

function getFilteredPaperQuestions() {
  return getPaperQuestions(state.currentPaperId).filter((question) => {
    if (state.paperFilters.module !== "all" && question.module !== state.paperFilters.module) {
      return false;
    }
    if (state.paperFilters.type !== "all" && question.type !== state.paperFilters.type) {
      return false;
    }
    if (state.paperFilters.status === "unanswered" && question.status !== "unanswered") {
      return false;
    }
    if (state.paperFilters.status === "answered" && question.status === "unanswered") {
      return false;
    }
    if (state.paperFilters.status === "wrong" && !question.isWrong) {
      return false;
    }
    if (state.paperFilters.status === "risk" && !question.isHighRisk) {
      return false;
    }
    if (state.paperFilters.status === "unsure-correct" && !isCorrectButUncertain(question)) {
      return false;
    }
    if (state.paperFilters.status === "guessed-correct" && !isGuessedCorrect(question)) {
      return false;
    }
    if (state.paperFilters.status.startsWith("reason:")) {
      const reason = state.paperFilters.status.slice("reason:".length);
      if (!getQuestionRiskReasons(question).includes(reason)) {
        return false;
      }
    }
    if (state.paperFilters.status === "hesitation" && !normalizeAnswerToArray(question.hesitationOptions).length) {
      return false;
    }
    return true;
  });
}

function getFilteredWrongQuestions() {
  return state.store.questions
    .filter((question) => question.isWrong)
    .filter((question) => {
      if (state.wrongFilters.paperId !== "all" && question.paperId !== state.wrongFilters.paperId) {
        return false;
      }
      if (state.wrongFilters.module !== "all" && question.module !== state.wrongFilters.module) {
        return false;
      }
      if (state.wrongFilters.type !== "all" && question.type !== state.wrongFilters.type) {
        return false;
      }
      if (state.wrongFilters.reason !== "all" && question.wrongReason !== state.wrongFilters.reason) {
        return false;
      }
      return true;
    })
    .sort(questionSorter);
}

function getFilteredGuessQuestions() {
  return state.store.questions
    .filter((question) => question.isGuessed)
    .filter((question) => {
      if (state.wrongFilters.paperId !== "all" && question.paperId !== state.wrongFilters.paperId) {
        return false;
      }
      if (state.wrongFilters.module !== "all" && question.module !== state.wrongFilters.module) {
        return false;
      }
      if (state.wrongFilters.type !== "all" && question.type !== state.wrongFilters.type) {
        return false;
      }
      if (state.wrongFilters.reason !== "all" && question.guessReason !== state.wrongFilters.reason) {
        return false;
      }
      return true;
    })
    .sort(questionSorter);
}

function getFilteredRiskQuestions() {
  return state.store.questions
    .filter((question) => question.isHighRisk)
    .filter((question) => {
      if (state.wrongFilters.paperId !== "all" && question.paperId !== state.wrongFilters.paperId) {
        return false;
      }
      if (state.wrongFilters.module !== "all" && question.module !== state.wrongFilters.module) {
        return false;
      }
      if (state.wrongFilters.type !== "all" && question.type !== state.wrongFilters.type) {
        return false;
      }
      if (state.wrongFilters.reason !== "all" && !matchesRiskReasonFilter(question, state.wrongFilters.reason)) {
        return false;
      }
      return true;
    })
    .sort(questionSorter);
}

function getNotebookQuestions() {
  if (state.notebookMode === "guess") {
    return getFilteredGuessQuestions();
  }
  if (state.notebookMode === "risk") {
    return getFilteredRiskQuestions();
  }
  return getFilteredWrongQuestions();
}

function createDefaultRecitationFilters() {
  return {
    category: "all",
    mastery: "all",
    source: "all",
    tag: "all",
    keyword: "",
    dueOnly: false,
    repeatedWrongOnly: false,
    highReasonOnly: false,
    cramOnly: false,
  };
}

function createEmptyRecitationImportState() {
  return {
    open: false,
    sourceFile: "粘贴文本",
    pendingCards: [],
    duplicatePolicy: "merge",
    summary: null,
  };
}

function getRecitationCards() {
  state.store.recitationCards = Array.isArray(state.store.recitationCards)
    ? state.store.recitationCards.map(normalizeRecitationCard)
    : [];
  return state.store.recitationCards;
}

function getFilteredRecitationCards() {
  const filters = state.recitationFilters;
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return getRecitationCards()
    .filter((card) => {
      if (filters.cramOnly && !isCramRecitationCard(card)) return false;
      if (filters.category !== "all" && card.category !== filters.category) return false;
      if (filters.mastery !== "all" && Number(card.masteryLevel) !== Number(filters.mastery)) return false;
      if (filters.source !== "all" && card.source !== filters.source && card.sourceFile !== filters.source) return false;
      if (filters.tag !== "all" && !(card.tags || []).includes(filters.tag)) return false;
      if (filters.dueOnly && !isRecitationCardDue(card)) return false;
      if (filters.repeatedWrongOnly && !isRepeatedWrongLinkedCard(card)) return false;
      if (filters.highReasonOnly && !hasHighFrequencyReasonLinkedCard(card)) return false;
      if (keyword && !recitationSearchText(card).includes(keyword)) return false;
      return true;
    })
    .sort(recitationCardSorter);
}

function getTodayRecitationCards() {
  const cards = getRecitationCards();
  return uniqueByCardId([
    ...cards.filter((card) => Number(card.masteryLevel) <= 0).slice(0, 10),
    ...cards.filter(isRecitationCardDue).slice(0, 10),
    ...cards.filter(isRepeatedWrongLinkedCard).slice(0, 5),
    ...cards.filter(isGuessedLinkedCard).slice(0, 5),
  ]).sort(recitationCardSorter);
}

function isCramRecitationCard(card) {
  return (
    Number(card.masteryLevel) <= 2 ||
    isRepeatedWrongLinkedCard(card) ||
    isGuessedLinkedCard(card) ||
    hasHighFrequencyReasonLinkedCard(card) ||
    Boolean(card.isMustMemorize)
  );
}

function getActiveRecitationCard() {
  return state.recitationDrill.cardId
    ? getRecitationCards().find((card) => card.cardId === state.recitationDrill.cardId) || null
    : null;
}

function getRecitationCardForQuestion(question) {
  const key = questionKey(question);
  return (
    getRecitationCards().find((card) => card.sourceQuestionId === key || (card.relatedQuestionIds || []).includes(key)) ||
    null
  );
}

function openRecitationCard(card) {
  if (!card) {
    return;
  }
  state.currentView = "recitation";
  state.recitationFilters = createDefaultRecitationFilters();
  state.recitationFocusCardId = card.cardId;
  state.recitationDrill = { cardId: null, questionKeys: [] };
  renderApp();
}

function getActiveRecitationDrillQuestions() {
  const keys = new Set(state.recitationDrill.questionKeys || []);
  return state.store.questions.filter((question) => keys.has(questionKey(question))).sort(questionSorter);
}

function getRelatedQuestionsForCard(card) {
  const directKeys = new Set([...(card.relatedQuestionIds || []), card.sourceQuestionId].filter(Boolean));
  const directQuestions = state.store.questions.filter((question) => directKeys.has(questionKey(question)));
  if (directQuestions.length) {
    return directQuestions.sort(questionSorter);
  }

  const keywordTokens = card.keywords.map((keyword) => String(keyword).trim()).filter((keyword) => keyword.length >= 2);
  if (!keywordTokens.length) {
    return [];
  }

  return state.store.questions
    .filter((question) => {
      const haystack = [question.stem, question.explanation, question.module, ...(question.options || []).map((option) => option.text)]
        .join(" ")
        .toLowerCase();
      return keywordTokens.some((keyword) => haystack.includes(keyword.toLowerCase()));
    })
    .sort(questionSorter)
    .slice(0, 20);
}

function updateRecitationCardAfterQuestionGrade(question) {
  const card = getActiveRecitationCard();
  if (!card || !state.recitationDrill.questionKeys.includes(questionKey(question))) {
    return;
  }

  const certainCorrect = question.status === "correct" && question.confidenceStatus === "确定";
  card.lastReviewDate = new Date().toISOString();
  card.lastReviewedAt = card.lastReviewDate;
  card.nextReviewDate = nextReviewDateForMastery(card.masteryLevel);
  card.nextReviewAt = card.nextReviewDate;
  if (!certainCorrect) {
    card.applicationStreak = 0;
    card.wrongReviewCount = Math.max(0, Number(card.wrongReviewCount) || 0) + 1;
    card.lastApplicationResult = {
      questionId: questionKey(question),
      ok: false,
      status: question.status,
      confidenceStatus: question.confidenceStatus || null,
      checkedAt: new Date().toISOString(),
    };
    return;
  }

  card.applicationStreak = (Number(card.applicationStreak) || 0) + 1;
  card.masteryLevel = Math.max(Number(card.masteryLevel) || 0, card.applicationStreak >= 2 ? 4 : 3);
  card.mastery = card.masteryLevel;
  card.lastApplicationResult = {
    questionId: questionKey(question),
    ok: true,
    status: question.status,
    confidenceStatus: question.confidenceStatus,
    checkedAt: new Date().toISOString(),
  };
  card.nextReviewDate = nextReviewDateForMastery(card.masteryLevel);
  card.nextReviewAt = card.nextReviewDate;
}

function createRecitationCardFromQuestion(question) {
  return buildRecitationCardFromQuestion(question, getRecitationCardForQuestion(question));
}

function maybeAutoGenerateRecitationCardAfterGrade(question, options = {}) {
  if (!question || isQuestionAbnormal(question)) {
    return null;
  }
  if (question.status === "wrong" || shouldGenerateCardForHighRiskMeta(question)) {
    return generateOrUpdateRecitationCardFromQuestion(question, {
      trigger: options.trigger || "auto-wrong",
    });
  }
  return null;
}

function shouldGenerateCardForHighRiskMeta(question) {
  const text = [
    question.confidenceStatus,
    question.guessReason,
    getQuestionRiskReasons(question).join(" "),
    normalizeAnswerToArray(question.hesitationOptions).join(""),
  ].join(" ");
  return (
    /蒙|不确定|纠结|选项边界不清|题干没读懂|固定原话缺失|做对但无法解释/.test(text) ||
    (question.status === "correct" && question.isHighRisk)
  );
}

function generateOrUpdateRecitationCardFromQuestion(question, options = {}) {
  const existing = findDuplicateRecitationCardForQuestion(question);
  const incoming = buildRecitationCardFromQuestion(question, options.regenerate ? null : existing, options);
  if (existing) {
    const historyItem = {
      userAnswer: question.userAnswer ?? null,
      mistakeReason: inferMistakeReason(question),
      trigger: options.trigger || "manual",
      createdAt: new Date().toISOString(),
    };
    const merged = normalizeRecitationCard({
      ...existing,
      ...(options.regenerate ? incoming : mergeRecitationCards(existing, incoming)),
      cardId: existing.cardId,
      id: existing.id || existing.cardId,
      sourceQuestionId: existing.sourceQuestionId || incoming.sourceQuestionId,
      relatedQuestionIds: uniqueValues([...(existing.relatedQuestionIds || []), ...(incoming.relatedQuestionIds || [])]),
      userAnswer: question.userAnswer ?? existing.userAnswer,
      mistakeReason: inferMistakeReason(question),
      wrongReviewCount: Math.max(0, Number(existing.wrongReviewCount) || 0) + 1,
      reviewHistory: [...(existing.reviewHistory || []), historyItem],
      updatedAt: new Date().toISOString(),
    });
    upsertRecitationCard(merged);
    question.recitationCardId = merged.cardId || "";
    return { card: merged, created: false };
  }
  upsertRecitationCard(incoming);
  question.recitationCardId = incoming.cardId || "";
  return { card: incoming, created: true };
}

function findDuplicateRecitationCardForQuestion(question) {
  const key = questionKey(question);
  const paperNo = `${question.paperId}::${normalizeQuestionNo(question.questionNo)}`;
  const incomingTrigger = extractTriggerWordsFromQuestion(question).join("、");
  const incomingDirection = getCorrectOptionText(question);
  return (
    getRecitationCards().find((card) => card.sourceQuestionId === key) ||
    getRecitationCards().find((card) => card.paperId && card.questionNo && `${card.paperId}::${normalizeQuestionNo(card.questionNo)}` === paperNo) ||
    getRecitationCards().find((card) => {
      const trigger = String(card.triggerWords || card.keyword || "").trim();
      const direction = String(card.correctDirection || "").trim();
      return trigger && direction && keywordSimilarity(trigger.split(/[、,，\s]/), incomingTrigger.split(/[、,，\s]/)) >= 0.72 && direction === incomingDirection;
    }) ||
    null
  );
}

function buildRecitationCardFromQuestion(question, existing = null, options = {}) {
  const key = questionKey(question);
  const reviewNotes = normalizeReviewNotes(question.reviewNotes);
  const kind = inferQuestionRecitationKind(question);
  const triggerWords = extractTriggerWordsFromQuestion(question);
  const correctDirection = getCorrectOptionText(question) || formatAnswer(question.correctAnswer);
  const trapDirection = getTrapOptionText(question) || getQuestionRiskReasons(question).join("、") || "易把材料词当成绝对映射";
  const condition = inferRecitationCondition(question, kind);
  const excludeRule = inferExcludeRule(question, trapDirection);
  const nextRule = reviewNotes.nextTime || inferNextRule(question, kind);
  const tags = inferAutoRecitationTags(question, kind);
  const frontBack = buildRecitationFrontBack(question, {
    kind,
    triggerWords: triggerWords.join("、") || inferRecitationTitle(question),
    condition,
    correctDirection,
    trapDirection,
    excludeRule,
    nextRule,
  });
  return normalizeRecitationCard({
    ...(existing || {}),
    cardId: existing?.cardId || `recite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    id: existing?.id || existing?.cardId || undefined,
    sourceQuestionId: key,
    paperId: question.paperId,
    paperTitle: question.paperTitle,
    questionNo: question.questionNo,
    type: question.type,
    stemBrief: compactText(question.stem, 90),
    correctAnswer: question.correctAnswer,
    userAnswer: question.userAnswer,
    front: existing?.front || frontBack.front,
    back: existing?.back || frontBack.back,
    recitePoint: existing?.recitePoint || inferRecitationTitle(question),
    triggerWords: triggerWords.join("、"),
    category: "错题回流库",
    title: existing?.title || inferRecitationTitle(question),
    keywords: existing?.keywords?.length ? existing.keywords : triggerWords,
    keyword: existing?.keyword || triggerWords[0] || inferRecitationTitle(question),
    condition: existing?.condition || condition,
    correctDirection: existing?.correctDirection || correctDirection,
    trapDirection: existing?.trapDirection || trapDirection,
    excludeRule: existing?.excludeRule || excludeRule,
    mistakeReason: inferMistakeReason(question),
    nextRule,
    tags: existing?.tags || tags,
    coreMeaning: existing?.coreMeaning || reviewNotes.materialFocus || question.explanation || question.stem,
    questionSignals: existing?.questionSignals || extractTypicalMaterial(question),
    whenToChoose: existing?.whenToChoose || `出现 ${triggerWords.join("、") || "题干对应语境"} 且符合成立条件时，优先选 ${correctDirection || "正确方向"}。`,
    typicalMaterial: existing?.typicalMaterial || extractTypicalMaterial(question),
    confusingWords: existing?.confusingWords || trapDirection,
    commonMistake: existing?.commonMistake || getQuestionRiskReasons(question).join("、") || "未填写",
    exclusionRule: existing?.exclusionRule || excludeRule,
    mnemonic: existing?.mnemonic || "",
    relatedQuestionIds: uniqueValues([...(existing?.relatedQuestionIds || []), key]),
    masteryLevel: existing?.masteryLevel ?? 0,
    reviewCount: existing?.reviewCount ?? 0,
    wrongReviewCount: existing?.wrongReviewCount ?? (options.trigger?.startsWith("auto") ? 1 : 0),
    reviewHistory: existing?.reviewHistory || [],
    source: options.trigger?.startsWith("auto") || question.status === "wrong" ? "错题自动生成" : "错题回流",
    sourceFile: options.trigger?.startsWith("auto") || question.status === "wrong" ? "错题自动生成" : "错题回流",
  });
}

function inferQuestionRecitationKind(question) {
  const text = `${question.module || ""} ${question.type || ""} ${question.stem || ""} ${question.explanation || ""}`;
  const user = normalizeAnswerToArray(question.userAnswer);
  const correct = normalizeAnswerToArray(question.correctAnswer);
  const hasWrongSelection = user.some((label) => !correct.includes(label));
  if (/法律|刑法|民法|行政法|正当防卫|合同|侵权|劳动关系/.test(text)) return "law";
  if (isMultipleQuestion(question) && user.length < correct.length && !hasWrongSelection) return "multi-missing";
  if (isMultipleQuestion(question) && hasWrongSelection) return "multi-wrong";
  if (/习近平总书记|强调|指出|固定表述|出自|会议|年份|数字|正确答案选|是.{0,8}[：:]/.test(text)) return "fixed";
  if (/主要意在|主要表明|体现了|说明了|主要作用|主要目的|意在|表明|体现|说明/.test(text)) return "material";
  return "material";
}

function buildRecitationFrontBack(question, data) {
  if (data.kind === "fixed") {
    return {
      front: `${data.triggerWords || "本题固定表述"}是什么？`,
      back: `正确答案：${data.correctDirection || formatAnswer(question.correctAnswer)}\n干扰项：${data.trapDirection || "未提取"}\n记忆规则：${data.nextRule}`,
    };
  }
  if (data.kind === "multi-missing") {
    const missing = normalizeAnswerToArray(question.correctAnswer).filter((label) => !normalizeAnswerToArray(question.userAnswer).includes(label));
    return {
      front: `这道多选漏掉了哪个并列项？为什么它也该选？`,
      back: `漏选项：${missing.join("、") || "未提取"}\n并列层级：${data.correctDirection}\n下次规则：${data.nextRule}`,
    };
  }
  if (data.kind === "multi-wrong") {
    return {
      front: `这个选项为什么不能扩张选？`,
      back: `错选项：${data.trapDirection}\n错误原因：${inferMistakeReason(question)}\n排除规则：${data.excludeRule}`,
    };
  }
  if (data.kind === "law") {
    return {
      front: `本题法律争点是什么？`,
      back: `争点：${data.triggerWords}\n判断步骤：先看主体、行为、构成要件，再看例外。\n排除规则：${data.excludeRule}\n下次规则：${data.nextRule}`,
    };
  }
  return {
    front: `【题眼】\n${data.triggerWords}\n\n【问题】\n在什么条件下应对应“${data.correctDirection}”？`,
    back: `【成立条件】\n${data.condition}\n\n【正确方向】\n${data.correctDirection}\n\n【易错方向】\n${data.trapDirection}\n\n【排除规则】\n${data.excludeRule}\n\n【下次规则】\n${data.nextRule}`,
  };
}

function extractTriggerWordsFromQuestion(question) {
  const text = `${question.stem || ""} ${question.explanation || ""}`;
  const phraseMatches = text.match(/[\u4e00-\u9fa5A-Za-z0-9＋+]{2,12}(?:、[\u4e00-\u9fa5A-Za-z0-9＋+]{2,12}){1,5}|[\u4e00-\u9fa5A-Za-z0-9＋+]{2,12}/g) || [];
  const stopWords = new Set(["下列", "正确", "错误", "主要", "体现", "说明", "材料", "的是", "关于", "不是", "可以", "通过", "进行"]);
  return uniqueValues(
    phraseMatches
      .map((item) => item.replace(/[，。；：、]+$/g, "").trim())
      .filter((item) => item.length >= 2 && item.length <= 18 && !stopWords.has(item))
  ).slice(0, 8);
}

function getCorrectOptionText(question) {
  return getOptionTextByLabels(question, normalizeAnswerToArray(question.correctAnswer));
}

function getTrapOptionText(question) {
  const correct = normalizeAnswerToArray(question.correctAnswer);
  const wrongLabels = normalizeAnswerToArray(question.userAnswer).filter((label) => !correct.includes(label));
  const hesitationLabels = normalizeAnswerToArray(question.hesitationOptions).filter((label) => !correct.includes(label));
  return getOptionTextByLabels(question, uniqueValues([...wrongLabels, ...hesitationLabels]));
}

function getOptionTextByLabels(question, labels) {
  const optionMap = new Map((question.options || []).map((option) => [option.label, option.text]));
  return normalizeAnswerToArray(labels)
    .map((label) => optionMap.get(label) ? `${label} ${optionMap.get(label)}` : label)
    .filter(Boolean)
    .join("；");
}

function inferRecitationCondition(question, kind) {
  if (kind === "law") return "法律关系、主体身份、行为构成和例外条件同时匹配时成立。";
  if (kind === "fixed") return "题干考固定表述、出处、会议原话、数字年份或专有概念时成立。";
  if (kind === "multi-missing") return "正确选项属于同一并列层级，且题干没有排除该并列项时成立。";
  if (kind === "multi-wrong") return "只有选项与题干主体、动作、对象、范围完全一致时才可选。";
  return "材料语境与正确选项完全对应时成立，需结合主体、动作、对象判断。";
}

function inferExcludeRule(question, trapDirection) {
  const trap = String(trapDirection || "").replace(/^[A-D]\s*/, "").slice(0, 28);
  if (!trap) return "没有对应成立条件时，不套用该题眼。";
  return `没有出现 ${extractKeywordsFromText(trap).slice(0, 3).join("、") || "易错项所需关键词"}，不优先选 ${trap}。`;
}

function inferNextRule(question, kind) {
  if (kind === "multi-missing") return "多选先找并列层级，逐项核对是否同属一组，不只选最显眼的一个。";
  if (kind === "multi-wrong") return "多选不能扩张，选项只要主体、动作、对象、范围有一处不匹配就排除。";
  if (kind === "fixed") return "遇到固定表述先锁原话，不按常识扩展。";
  if (kind === "law") return "法律题先拆主体、行为、构成要件和例外，再判断选项。";
  return "先看题干任务，再看材料重心，最后排除边界过宽或重心偏移的选项。";
}

function inferMistakeReason(question) {
  return getQuestionRiskReasons(question).join("、") || question.wrongReason || question.confidenceStatus || "未标记";
}

function inferAutoRecitationTags(question, kind) {
  const text = `${question.stem || ""} ${question.explanation || ""} ${inferMistakeReason(question)}`;
  const tags = [];
  if (/意在|表明|体现|说明|主要作用|主要目的/.test(text)) tags.push("材料映射");
  if (getTrapOptionText(question) && getCorrectOptionText(question)) tags.push("二选一误判");
  if (/层级|拔高|宏大|太宽/.test(text)) tags.push("选项层级误判");
  if (/动作/.test(text)) tags.push("动作词漏看");
  if (/主体/.test(text)) tags.push("主体抓错");
  if (/对象/.test(text)) tags.push("对象偷换");
  if (kind === "multi-missing") tags.push("多选漏选");
  if (kind === "multi-wrong") tags.push("多选扩张错选");
  if (kind === "fixed" || /出自|固定表述|习近平.*指出|会议.*指出|\d{4}年|数字/.test(text)) tags.push("固定原话");
  if (kind === "law") tags.push("法律争点");
  return normalizeRuleTags(tags, text);
}

function compactText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isQuestionAbnormal(question) {
  return getAbnormalItems().some((item) => item.paperId === question.paperId && normalizeQuestionNo(item.questionNo) === normalizeQuestionNo(question.questionNo) && !item.repairedAt);
}

function upsertRecitationCard(card) {
  const cards = getRecitationCards();
  const index = cards.findIndex((item) => item.cardId === card.cardId);
  if (index >= 0) {
    cards[index] = normalizeRecitationCard({ ...cards[index], ...card });
  } else {
    cards.unshift(normalizeRecitationCard(card));
  }
}

function normalizeRecitationCard(card) {
  const now = new Date().toISOString();
  const category = inferRecitationCategory(card?.category || card?.title || card?.sourceText || "");
  const sourceQuestionId = String(card?.sourceQuestionId || "").trim();
  const coreMeaning = String(card?.coreMeaning || card?.coreRule || "").trim();
  const commonMistake = String(card?.commonMistake || card?.commonTraps || "").trim();
  const whenToChoose = String(card?.whenToChoose || card?.nextTimeRule || card?.nextRule || "").trim();
  const sourceFile = String(card?.sourceFile || card?.source || "手动导入").trim() || "手动导入";
  const isMustMemorize = Boolean(card?.isMustMemorize ?? card?.mustMemorize);
  const keyword = String(card?.keyword || card?.ruleKeyword || card?.title || normalizeKeywordList(card?.keywords)[0] || "").trim();
  const masteryLevel = clampMasteryLevel(card?.masteryLevel ?? card?.mastery);
  const condition = String(
    card?.condition || card?.成立条件 || card?.questionSignals || "仅在材料语境、题干任务和选项落点同时匹配时成立。"
  ).trim();
  const correctDirection = String(card?.correctDirection || card?.正确方向 || card?.whenToChoose || coreMeaning || "").trim();
  const trapDirection = String(card?.trapDirection || card?.易错方向 || card?.confusingWords || commonMistake || "").trim();
  const excludeRule = String(
    card?.excludeRule || card?.排除规则 || card?.exclusionRule || "没有对应成立条件时，不套用该题眼。"
  ).trim();
  const tags = normalizeRuleTags(card?.tags, `${keyword} ${condition} ${correctDirection} ${trapDirection} ${excludeRule} ${category}`);
  const cardId = String(card?.cardId || card?.id || `recite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    id: String(card?.id || cardId),
    cardId,
    sourceQuestionId,
    paperId: String(card?.paperId || "").trim(),
    paperTitle: String(card?.paperTitle || "").trim(),
    questionNo: String(card?.questionNo || "").trim(),
    type: String(card?.type || "").trim(),
    stemBrief: String(card?.stemBrief || "").trim(),
    correctAnswer: card?.correctAnswer ?? null,
    userAnswer: card?.userAnswer ?? null,
    front: String(card?.front || "").trim(),
    back: String(card?.back || "").trim(),
    recitePoint: String(card?.recitePoint || card?.title || "").trim(),
    triggerWords: String(card?.triggerWords || keyword || "").trim(),
    category: RECITATION_CATEGORIES.includes(card?.category) ? card.category : category,
    title: String(card?.title || "未命名背诵卡").trim() || "未命名背诵卡",
    keywords: normalizeKeywordList(card?.keywords),
    keyword,
    condition,
    correctDirection,
    trapDirection,
    excludeRule,
    tags,
    coreMeaning,
    questionSignals: String(card?.questionSignals || "").trim(),
    whenToChoose,
    confusingWords: String(card?.confusingWords || "").trim(),
    difference: String(card?.difference || "").trim(),
    commonMistake,
    exclusionRule: String(card?.exclusionRule || "").trim(),
    mnemonic: String(card?.mnemonic || "").trim(),
    typicalMaterial: String(card?.typicalMaterial || "").trim(),
    relatedQuestionIds: normalizeStringList(card?.relatedQuestionIds),
    sourceText: String(card?.sourceText || "").trim(),
    sourceFile,
    priority: Math.max(1, Math.min(5, Math.round(Number(card?.priority) || 3))),
    difficulty: Math.max(1, Math.min(5, Math.round(Number(card?.difficulty) || 1))),
    mastery: masteryLevel,
    masteryLevel,
    reviewCount: Math.max(0, Number(card?.reviewCount) || 0),
    wrongReviewCount: Math.max(0, Number(card?.wrongReviewCount) || 0),
    lastReviewDate: card?.lastReviewDate || null,
    lastReviewedAt: card?.lastReviewedAt || card?.lastReviewDate || null,
    nextReviewDate: card?.nextReviewDate || card?.nextReviewAt || new Date().toISOString(),
    nextReviewAt: card?.nextReviewAt || card?.nextReviewDate || new Date().toISOString(),
    source: RECITATION_SOURCES.includes(card?.source) ? card.source : "手动导入",
    isMustMemorize,
    mustMemorize: isMustMemorize,
    applicationStreak: Math.max(0, Number(card?.applicationStreak) || 0),
    lastApplicationResult: card?.lastApplicationResult || null,
    reviewHistory: Array.isArray(card?.reviewHistory) ? card.reviewHistory : [],
    createdAt: card?.createdAt || now,
    updatedAt: card?.updatedAt || now,
    coreRule: coreMeaning,
    commonTraps: commonMistake,
    nextTimeRule: whenToChoose,
  };
}

function normalizeKeywordList(value) {
  return normalizeStringList(Array.isArray(value) ? value : String(value || "").split(/[、,，\n]/));
}

function normalizeRuleTags(value, text = "") {
  const explicit = normalizeStringList(value).filter((tag) => RULE_TAGS.includes(tag));
  const inferred = RULE_TAGS.filter((tag) => String(text || "").includes(tag));
  if (/题眼|材料|方向|映射/.test(text)) inferred.push("材料映射");
  if (/边界|排除|不选|不优先/.test(text)) inferred.push("选项边界");
  if (/层级|现代化|均等化|数智化/.test(text)) inferred.push("选项层级误判");
  if (/二选一|纠结|易错|易混/.test(text)) inferred.push("二选一误判");
  if (/固定|原话|永恒主题|天职|主线/.test(text)) inferred.push("固定原话");
  if (/文化|文创|非遗|考古|遗产/.test(text)) inferred.push("文化");
  if (/消费|退换货|补贴|以旧换新/.test(text)) inferred.push("消费");
  if (/民生|医疗|养老|托育|低保|公共服务/.test(text)) inferred.push("民生");
  if (/治理|监管|执法|协同|网格/.test(text)) inferred.push("治理");
  if (/生态|绿色|环保/.test(text)) inferred.push("生态");
  if (/科技|创新|人工智能|数字|成果转化/.test(text)) inferred.push("科技");
  if (/产业|链|品牌|制造|物流/.test(text)) inferred.push("产业");
  if (/乡村|三农|农业|农民|农村/.test(text)) inferred.push("三农");
  if (/法律|法治|执法权|行政/.test(text)) inferred.push("法律");
  if (/公文|部署|宣传|推广/.test(text)) inferred.push("公文");
  if (/哲学|矛盾|实践|认识/.test(text)) inferred.push("哲学");
  return uniqueValues([...explicit, ...inferred]).filter((tag) => RULE_TAGS.includes(tag));
}

function normalizeStringList(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value])
        .flatMap((item) => String(item || "").split(/[、,，\n]/))
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function clampMasteryLevel(value) {
  return Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
}

function masteryText(level) {
  return RECITATION_MASTERY_LABELS[clampMasteryLevel(level)];
}

function nextReviewDateForMastery(level) {
  const days = [0, 1, 3, 7, 15, 30][clampMasteryLevel(level)];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function nextReviewDateAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, Number(days) || 0));
  return date.toISOString();
}

function applyRecitationReviewAction(card, actionKey) {
  const action = RECITATION_REVIEW_ACTIONS.find((item) => item.key === actionKey) || RECITATION_REVIEW_ACTIONS[0];
  if (action.keepLevel) {
    card.masteryLevel = clampMasteryLevel(card.masteryLevel);
  } else if (typeof action.delta === "number") {
    card.masteryLevel = clampMasteryLevel(card.masteryLevel + action.delta);
  } else {
    card.masteryLevel = clampMasteryLevel(action.level);
  }
  card.mastery = card.masteryLevel;
  card.reviewCount = Math.max(0, Number(card.reviewCount) || 0) + 1;
  if (action.key === "again") {
    card.wrongReviewCount = Math.max(0, Number(card.wrongReviewCount) || 0) + 1;
  }
  card.lastReviewDate = new Date().toISOString();
  card.lastReviewedAt = card.lastReviewDate;
  card.nextReviewDate = typeof action.days === "number" ? nextReviewDateAfterDays(action.days) : nextReviewDateForMastery(card.masteryLevel);
  card.nextReviewAt = card.nextReviewDate;
  card.updatedAt = new Date().toISOString();
}

function isRecitationCardDue(card) {
  return !card.nextReviewDate || new Date(card.nextReviewDate).getTime() <= Date.now();
}

function isRepeatedWrongLinkedCard(card) {
  return getLinkedQuestions(card).some((question) => question.isWrong || question.secondReviewStillUncertain);
}

function isGuessedLinkedCard(card) {
  return getLinkedQuestions(card).some((question) => question.isGuessed || isGuessedCorrect(question));
}

function hasHighFrequencyReasonLinkedCard(card) {
  const topReasons = new Set(
    topCountEntries(
      state.store.questions.flatMap((question) => getQuestionRiskReasons(question).map((reason) => ({ reason }))),
      (item) => item.reason,
      5
    ).map((entry) => entry.label)
  );
  return getLinkedQuestions(card).some((question) => getQuestionRiskReasons(question).some((reason) => topReasons.has(reason)));
}

function getLinkedQuestions(card) {
  const keys = new Set(card.relatedQuestionIds || []);
  return state.store.questions.filter((question) => keys.has(questionKey(question)));
}

function recitationSearchText(card) {
  return [
    card.title,
    card.category,
    card.keywords.join(" "),
    card.keyword,
    card.condition,
    card.correctDirection,
    card.trapDirection,
    card.excludeRule,
    (card.tags || []).join(" "),
    card.coreMeaning,
    card.questionSignals,
    card.whenToChoose,
    card.confusingWords,
    card.difference,
    card.commonMistake,
    card.exclusionRule,
    card.mnemonic,
    card.typicalMaterial,
    card.sourceFile,
  ]
    .join(" ")
    .toLowerCase();
}

function recitationCardSorter(a, b) {
  const dueCompare = Number(isRecitationCardDue(b)) - Number(isRecitationCardDue(a));
  if (dueCompare !== 0) return dueCompare;
  return Number(a.masteryLevel) - Number(b.masteryLevel) || a.title.localeCompare(b.title, "zh-CN");
}

function uniqueByCardId(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    if (seen.has(card.cardId)) return false;
    seen.add(card.cardId);
    return true;
  });
}

function getAverageMasteryText(cards) {
  if (!cards.length) return "--";
  return (cards.reduce((sum, card) => sum + Number(card.masteryLevel || 0), 0) / cards.length).toFixed(1);
}

function formatDateOnly(value) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "";
}

function inferRecitationTitle(question) {
  const reasons = getQuestionRiskReasons(question);
  if (reasons.length) {
    return `${reasons[0]}：第${question.questionNo}题`;
  }
  const text = String(question.stem || "").replace(/\s+/g, "");
  return text.length > 18 ? `${text.slice(0, 18)}...` : text || `第${question.questionNo}题核心考点`;
}

function extractKeywordsFromQuestion(question) {
  const text = [question.stem, question.explanation, question.module].join(" ");
  const tokens = text.match(/[\u4e00-\u9fa5]{2,8}|[A-Za-z][A-Za-z\s-]{2,20}/g) || [];
  return uniqueValues(tokens.map((item) => item.trim()).filter((item) => item.length >= 2)).slice(0, 8);
}

function extractTypicalMaterial(question) {
  const stem = String(question.stem || "");
  const sentence = stem.split(/[。！？；]/).find((part) => part.length >= 12) || stem;
  return sentence.slice(0, 120);
}

function parseRecitationJson(text) {
  return parseRecitationJsonPayload(text).cards;
}

function parseRecitationJsonPayload(text) {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cards) ? parsed.cards : Array.isArray(parsed.recitationCards) ? parsed.recitationCards : [];
  if (!rows.length) {
    throw new Error("JSON 中没有找到 cards 或 recitationCards 数组。");
  }
  const sourceFile = parsed?.source || "JSON 导入";
  if (parsed?.schema === "recitation-card-import-v1") {
    return parseChatGPTRecitationCardImport(rows, sourceFile);
  }
  return {
    cards: rows.map((card) => normalizeRecitationCard({ ...card, sourceFile: card.sourceFile || sourceFile })),
    failedCards: [],
  };
}

function parseChatGPTRecitationCardImport(rows, sourceFile) {
  const cards = [];
  const failedCards = [];
  rows.forEach((rawCard, index) => {
    const validation = validateChatGPTRecitationCard(rawCard);
    if (!validation.ok) {
      failedCards.push({
        index,
        rawCard,
        reason: validation.reason,
      });
      return;
    }
    cards.push(
      normalizeRecitationCard({
        ...rawCard,
        cardId: rawCard.cardId || rawCard.id,
        id: rawCard.id || rawCard.cardId,
        keyword: rawCard.triggerWords || rawCard.recitePoint || rawCard.stemBrief,
        keywords: rawCard.keywords || rawCard.triggerWords,
        coreMeaning: rawCard.recitePoint || rawCard.front,
        whenToChoose: rawCard.nextRule,
        nextTimeRule: rawCard.nextRule,
        masteryLevel: rawCard.mastery,
        nextReviewDate: rawCard.nextReviewAt,
        lastReviewDate: rawCard.lastReviewedAt,
        sourceFile: rawCard.sourceFile || sourceFile || "ChatGPT 背诵卡 JSON",
        source: rawCard.source || "ChatGPT JSON",
      })
    );
  });
  return { cards, failedCards };
}

function validateChatGPTRecitationCard(card) {
  if (!card || typeof card !== "object") {
    return { ok: false, reason: "卡片不是对象" };
  }
  if (!card.id && !card.sourceQuestionId) {
    return { ok: false, reason: "缺少 id 或 sourceQuestionId" };
  }
  const required = ["front", "back", "triggerWords", "condition", "correctDirection", "trapDirection", "excludeRule"];
  const missing = required.filter((field) => !String(card[field] || "").trim());
  if (missing.length) {
    return { ok: false, reason: `缺少核心字段：${missing.join("、")}` };
  }
  return { ok: true, reason: "" };
}

function parseRecitationMarkdown(text) {
  return parseRecitationText(text, "Markdown 导入");
}

function parseRecitationText(text, sourceFile = "粘贴文本") {
  const rawText = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!rawText) {
    throw new Error("没有可解析的背诵资料。");
  }
  const cards = [
    ...parseMarkdownCardBlocks(rawText, sourceFile),
    ...parseMarkdownTables(rawText, sourceFile),
    ...parsePlainTables(rawText, sourceFile),
    ...parseLineBasedRecitationCards(rawText, sourceFile),
  ];
  const uniqueCards = dedupeCardsWithinImport(cards);
  if (!uniqueCards.length) {
    throw new Error("没有识别到结构化背诵卡片。请检查标题、表格或“关键词 = 规则”格式。");
  }
  return uniqueCards;
}

function parseMarkdownCardBlocks(text, sourceFile) {
  return String(text || "")
    .split(/\n(?=#{2,4}\s+)/)
    .map((block) => block.trim())
    .filter((block) => /^#{2,4}\s+/.test(block))
    .map((block) => {
      const title = (block.match(/^#{2,4}\s+(.+)$/m) || [])[1] || "";
      if (!title || isRecitationCategoryHeading(title)) return null;
      return normalizeRecitationCard({
        title,
        category: extractMarkdownField(block, "分类") || inferRecitationCategory(`${title}\n${block}`),
        keywords: extractMarkdownSection(block, "关键词") || extractKeywordsFromText(block).join("、"),
        keyword: extractMarkdownSection(block, "题眼") || extractMarkdownField(block, "题眼") || title,
        condition: extractMarkdownSection(block, "成立条件"),
        correctDirection: extractMarkdownSection(block, "正确方向") || extractMarkdownSection(block, "答案方向"),
        trapDirection: extractMarkdownSection(block, "易错方向"),
        excludeRule: extractMarkdownSection(block, "排除规则"),
        tags: extractMarkdownSection(block, "标签"),
        coreMeaning: extractMarkdownSection(block, "核心判断规则") || extractMarkdownSection(block, "核心含义") || extractMarkdownSection(block, "正确判断"),
        questionSignals: extractMarkdownSection(block, "题干证据词") || extractMarkdownSection(block, "题干信号"),
        whenToChoose: extractMarkdownSection(block, "什么时候选") || extractMarkdownSection(block, "下次判断规则"),
        confusingWords: extractMarkdownSection(block, "易混词") || extractMarkdownSection(block, "常见干扰项"),
        difference: extractMarkdownSection(block, "区别") || extractMarkdownSection(block, "混淆词区别"),
        commonMistake: extractMarkdownSection(block, "常见误选原因") || extractMarkdownSection(block, "典型误判原因"),
        exclusionRule: extractMarkdownSection(block, "排除规则") || extractMarkdownSection(block, "错误选项排除规则"),
        mnemonic: extractMarkdownSection(block, "一句口诀") || extractMarkdownSection(block, "口诀"),
        typicalMaterial: extractMarkdownSection(block, "典型材料") || extractMarkdownSection(block, "典型材料表达"),
        sourceText: block.slice(0, 1200),
        sourceFile,
        source: "手动导入",
        masteryLevel: 0,
      });
    })
    .filter(Boolean);
}

function parseMarkdownTables(text, sourceFile) {
  const lines = String(text || "").split("\n");
  const cards = [];
  let currentCategory = "高频考点库";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const headingCategory = categoryFromHeading(line);
    if (headingCategory) {
      currentCategory = headingCategory;
      continue;
    }
    if (!line.includes("|") || index + 1 >= lines.length || !/^\s*\|?\s*:?-{2,}/.test(lines[index + 1])) continue;
    const headers = splitMarkdownTableRow(line);
    index += 2;
    while (index < lines.length && lines[index].includes("|")) {
      const values = splitMarkdownTableRow(lines[index]);
      const row = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] || ""]));
      const card = cardFromTableRow(row, currentCategory, lines[index], sourceFile);
      if (card) cards.push(card);
      index += 1;
    }
    index -= 1;
  }
  return cards;
}

function parsePlainTables(text, sourceFile) {
  const lines = String(text || "").split("\n");
  const cards = [];
  let currentCategory = "高频考点库";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const headingCategory = categoryFromHeading(line);
    if (headingCategory) {
      currentCategory = headingCategory;
      continue;
    }
    if (!/词\s+核心含义\s+题干信号/.test(line)) continue;
    const headers = line.split(/\s{2,}|\t+/).map((item) => item.trim()).filter(Boolean);
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (categoryFromHeading(lines[index])) break;
      const cells = lines[index].trim().split(/\s{2,}|\t+/).map((item) => item.trim()).filter(Boolean);
      if (cells.length < 2) break;
      const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
      const card = cardFromTableRow(row, currentCategory, lines[index], sourceFile);
      if (card) cards.push(card);
      index += 1;
    }
  }
  return cards;
}

function parseLineBasedRecitationCards(text, sourceFile) {
  const lines = String(text || "").split("\n");
  const cards = [];
  let currentCategory = "高频考点库";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const headingCategory = categoryFromHeading(line);
    if (headingCategory) {
      currentCategory = headingCategory;
      continue;
    }
    if (line.includes("|") || /^#{1,4}\s+/.test(line) || /^\|?\s*:?-{2,}/.test(line) || /词\s+核心含义\s+题干信号/.test(line)) continue;
    const contrastMatch = line.match(/^(.{2,30}?)\s*(?:vs|VS|Vs|和|与|区别)\s*(.{2,30})$/);
    if (contrastMatch) {
      const blockLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].trim() && !categoryFromHeading(lines[cursor]) && !/^\s*#{1,4}\s+/.test(lines[cursor])) {
        blockLines.push(lines[cursor].trim());
        cursor += 1;
      }
      index = cursor - 1;
      cards.push(cardFromContrastBlock(blockLines.join("\n"), currentCategory, sourceFile));
      continue;
    }
    const pairMatch = line.match(/^(.{1,28}?)\s*(?:=|＝|:|：)\s*(.{1,80})$/);
    if (pairMatch && !/^(分类|关键词|核心|题干|什么时候|易混|区别|常见|排除|口诀|典型材料|成立条件|正确方向|易错方向|答案方向|选项方向|标签)/.test(pairMatch[1])) {
      const inferredCategory = /口诀|速背|主动仗|晴雨表|一盘棋/.test(`${currentCategory} ${line}`) ? "考前口诀类" : "固定搭配类";
      const left = pairMatch[1].trim();
      const right = pairMatch[2].trim();
      cards.push(
        normalizeRecitationCard({
          category: inferredCategory,
          title: left,
          keywords: [left, right],
          keyword: left,
          condition: "仅在材料语境指向该固定搭配或固定原话时成立。",
          correctDirection: right,
          trapDirection: "按常识联想出的相近方向",
          excludeRule: "固定原话优先，不能因为相近概念改选。",
          tags: inferredCategory === "考前口诀类" ? ["固定原话"] : ["固定原话", "材料映射"],
          coreMeaning: `${left} = ${right}`,
          whenToChoose: `题干出现“${left}”时，优先对应“${right}”。`,
          mnemonic: inferredCategory === "考前口诀类" ? `${left} = ${right}` : "",
          sourceText: line,
          sourceFile,
          source: "手动导入",
          masteryLevel: 0,
        })
      );
    }
  }
  return cards;
}

function cardFromTableRow(row, fallbackCategory, sourceText, sourceFile) {
  const title = firstField(row, ["题眼", "词", "标题", "考点", "易混词", "固定搭配"]);
  if (!title) return null;
  return normalizeRecitationCard({
    category: inferRecitationCategory(firstField(row, ["分类"]) || fallbackCategory || title),
    title,
    keywords: firstField(row, ["关键词", "词"]) || title,
    keyword: firstField(row, ["题眼", "材料词", "关键词", "词"]) || title,
    condition: firstField(row, ["成立条件", "材料语境", "条件"]) || "仅在材料语境、题干任务和选项落点同时匹配时成立。",
    correctDirection: firstField(row, ["正确方向", "答案方向", "选项方向", "优先对应"]),
    trapDirection: firstField(row, ["易错方向", "误选方向", "易混项", "易混词"]),
    excludeRule: firstField(row, ["排除规则", "错误选项排除规则"]),
    tags: firstField(row, ["标签"]),
    coreMeaning: firstField(row, ["核心含义", "核心判断规则", "正确判断", "含义"]),
    questionSignals: firstField(row, ["题干信号", "题干证据词", "信号"]),
    whenToChoose: firstField(row, ["什么时候选", "优先选", "选择规则"]),
    confusingWords: firstField(row, ["易混项", "易混词", "干扰项"]),
    difference: firstField(row, ["区别", "混淆词区别"]),
    commonMistake: firstField(row, ["常见误选原因", "典型误判原因", "误选"]),
    exclusionRule: firstField(row, ["排除规则", "错误选项排除规则"]),
    mnemonic: firstField(row, ["一句口诀", "口诀"]),
    typicalMaterial: firstField(row, ["典型材料", "典型材料表达"]),
    sourceText,
    sourceFile,
    source: "手动导入",
    masteryLevel: 0,
  });
}

function cardFromContrastBlock(block, fallbackCategory, sourceFile) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines[0];
  return normalizeRecitationCard({
    category: inferRecitationCategory(`${fallbackCategory}\n${block}`) || "易混词库",
    title,
    keywords: extractKeywordsFromText(block).slice(0, 10),
    keyword: title,
    condition: findLineValue(lines, ["成立条件", "语境"]) || "仅在材料语境、题干任务和选项落点同时匹配时成立。",
    correctDirection: findLineValue(lines, ["正确方向", "答案方向"]) || findLineValue(lines, ["什么时候选", "优先选"]),
    trapDirection: findLineValue(lines, ["易错方向", "误选方向"]) || title.replace(/\s*(?:vs|VS|Vs|和|与|区别)\s*/g, "、"),
    excludeRule: findLineValue(lines, ["排除规则", "不能混", "排除"]),
    tags: ["二选一误判", "选项边界"],
    coreMeaning: findLineValue(lines, ["核心", "含义"]) || "易混对照卡，按题干信号区分选择。",
    questionSignals: findLineValue(lines, ["题干", "信号", "证据"]),
    whenToChoose: lines.filter((line) => /什么时候选|优先选|选/.test(line)).join("；"),
    confusingWords: title.replace(/\s*(?:vs|VS|Vs|和|与|区别)\s*/g, "、"),
    difference: findLineValue(lines, ["区别", "区分"]),
    commonMistake: findLineValue(lines, ["误判", "误选", "常见"]),
    exclusionRule: findLineValue(lines, ["不能混", "排除"]),
    mnemonic: findLineValue(lines, ["口诀", "一句"]),
    typicalMaterial: findLineValue(lines, ["典型", "材料"]),
    sourceText: block,
    sourceFile,
    source: "手动导入",
    masteryLevel: 0,
  });
}

function prepareRecitationImport(text, sourceFile) {
  const parsed =
    shouldParseRecitationAsJson(text, sourceFile)
      ? parseRecitationJsonPayload(text)
      : { cards: parseRecitationText(text, sourceFile), failedCards: [] };
  const cards = parsed.cards;
  const failedCards = parsed.failedCards || [];
  const normalizedCards = cards.map((card) => normalizeRecitationCard({ ...card, sourceFile, source: card.source || "手动导入" }));
  state.recitationImport = {
    ...state.recitationImport,
    open: true,
    sourceFile,
    pendingCards: normalizedCards,
    pendingFailedCards: failedCards,
    summary: buildRecitationImportSummary(normalizedCards, failedCards),
  };
  return { parsedCount: normalizedCards.length, failedCount: failedCards.length };
}

function importChatGPTRecitationCardsDirect(text, sourceFile = "ChatGPT 背诵卡 JSON") {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  if (!Array.isArray(parsed?.cards)) {
    throw new Error("JSON 中没有找到 cards 数组。");
  }
  const rows = parsed.cards;
  if (!rows.length) {
    throw new Error("JSON 中没有找到 cards 数组。");
  }

  const { cards, failedCards } = parseChatGPTRecitationCardImport(rows, parsed?.source || sourceFile);
  const normalizedCards = cards.map((card) =>
    normalizeRecitationCard({ ...card, sourceFile: card.sourceFile || sourceFile, source: card.source || "ChatGPT JSON" })
  );
  let importedCount = 0;
  let updatedCount = 0;

  normalizedCards.forEach((card) => {
    const duplicate = findDuplicateChatGPTRecitationCard(card);
    if (!duplicate) {
      upsertRecitationCard(card);
      importedCount += 1;
      return;
    }
    upsertRecitationCard(mergeRecitationCards(duplicate, { ...card, cardId: duplicate.cardId }));
    updatedCount += 1;
  });

  const failedCount = addFailedRecitationCardsToAbnormal(failedCards, sourceFile);
  return { importedCount, updatedCount, failedCount };
}

function applyRecitationImport(policy = "merge") {
  const cards = state.recitationImport.pendingCards || [];
  const failedCards = state.recitationImport.pendingFailedCards || [];
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  cards.forEach((card) => {
    const duplicate = findDuplicateRecitationCard(card);
    if (!duplicate) {
      upsertRecitationCard(card);
      importedCount += 1;
      return;
    }
    if (policy === "skip") {
      skippedCount += 1;
      return;
    }
    if (policy === "overwrite") {
      upsertRecitationCard(normalizeRecitationCard({ ...card, cardId: duplicate.cardId }));
      updatedCount += 1;
      return;
    }
    upsertRecitationCard(mergeRecitationCards(duplicate, card));
    updatedCount += 1;
  });
  const failedCount = addFailedRecitationCardsToAbnormal(failedCards, state.recitationImport.sourceFile);
  return { importedCount, updatedCount, skippedCount, failedCount };
}

function shouldParseRecitationAsJson(text, sourceFile) {
  const name = String(sourceFile || "").toLowerCase();
  if (name.endsWith(".json")) {
    return true;
  }
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function buildRecitationImportSummary(cards, failedCards = []) {
  const byCategory = {};
  cards.forEach((card) => {
    byCategory[card.category] = (byCategory[card.category] || 0) + 1;
  });
  return {
    total: cards.length,
    categoryCount: Object.keys(byCategory).length,
    byCategory,
    fixedCount: cards.filter((card) => card.category === "固定搭配类").length,
    contrastCount: cards.filter((card) => /(?:vs|VS|Vs|和|与|区别)/.test(card.title) || card.category === "易混词库").length,
    cramCount: cards.filter((card) => card.category === "考前口诀类" || card.category === "考前速记库").length,
    duplicateCount: cards.filter(findDuplicateRecitationCard).length,
    failedCount: failedCards.length,
  };
}

function findDuplicateRecitationCard(card) {
  return getRecitationCards().find((existing) => {
    if (card.cardId && existing.cardId === card.cardId) return true;
    if (card.id && (existing.id === card.id || existing.cardId === card.id)) return true;
    if (card.sourceQuestionId && existing.sourceQuestionId === card.sourceQuestionId) return true;
    if (existing.title && existing.title === card.title) return true;
    if (existing.mnemonic && card.mnemonic && existing.mnemonic === card.mnemonic) return true;
    if (existing.sourceText && card.sourceText && existing.sourceText === card.sourceText) return true;
    return keywordSimilarity(existing.keywords, card.keywords) >= 0.72;
  });
}

function findDuplicateChatGPTRecitationCard(card) {
  return getRecitationCards().find((existing) => {
    if (card.cardId && existing.cardId === card.cardId) return true;
    if (card.id && (existing.id === card.id || existing.cardId === card.id)) return true;
    if (card.sourceQuestionId && existing.sourceQuestionId === card.sourceQuestionId) return true;
    return false;
  });
}

function addFailedRecitationCardsToAbnormal(failedCards, sourceFile) {
  if (!failedCards.length) {
    return 0;
  }
  const abnormalItems = failedCards.map((item) => {
    const rawCard = item.rawCard || {};
    const fallbackId = rawCard.id || rawCard.sourceQuestionId || `第${Number(item.index) + 1}张`;
    return normalizeAbnormalItem({
      abnormalId: `recitation-import::${fallbackId}`,
      paperId: rawCard.paperId || "recitation-import",
      paperTitle: rawCard.paperTitle || `背诵卡导入异常：${sourceFile || "JSON"}`,
      questionNo: rawCard.questionNo || fallbackId,
      type: "背诵卡",
      stem: rawCard.front || rawCard.stemBrief || rawCard.recitePoint || `背诵卡 ${fallbackId}`,
      options: [],
      correctAnswer: null,
      explanation: rawCard.back || "",
      rawBlock: JSON.stringify(rawCard, null, 2),
      issues: [`背诵卡导入失败：${item.reason || "未知原因"}`],
      abnormalType: "parseFailed",
      severity: "hard",
      module: "背诵卡导入",
    });
  });
  state.store.abnormalQuestions = mergeAbnormalItems([...(state.store.abnormalQuestions || []), ...abnormalItems]);
  return abnormalItems.length;
}

function mergeRecitationCards(existing, incoming) {
  return normalizeRecitationCard({
    ...existing,
    ...incoming,
    cardId: existing.cardId,
    keywords: uniqueValues([...(existing.keywords || []), ...(incoming.keywords || [])]),
    relatedQuestionIds: uniqueValues([...(existing.relatedQuestionIds || []), ...(incoming.relatedQuestionIds || [])]),
    masteryLevel: existing.masteryLevel,
    reviewCount: existing.reviewCount,
    lastReviewDate: existing.lastReviewDate,
    nextReviewDate: existing.nextReviewDate,
    applicationStreak: existing.applicationStreak,
    lastApplicationResult: existing.lastApplicationResult,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    coreMeaning: mergeText(existing.coreMeaning, incoming.coreMeaning),
    keyword: existing.keyword || incoming.keyword,
    condition: mergeText(existing.condition, incoming.condition),
    correctDirection: mergeText(existing.correctDirection, incoming.correctDirection),
    trapDirection: mergeText(existing.trapDirection, incoming.trapDirection),
    excludeRule: mergeText(existing.excludeRule, incoming.excludeRule),
    tags: uniqueValues([...(existing.tags || []), ...(incoming.tags || [])]),
    questionSignals: mergeText(existing.questionSignals, incoming.questionSignals),
    whenToChoose: mergeText(existing.whenToChoose, incoming.whenToChoose),
    confusingWords: mergeText(existing.confusingWords, incoming.confusingWords),
    difference: mergeText(existing.difference, incoming.difference),
    commonMistake: mergeText(existing.commonMistake, incoming.commonMistake),
    exclusionRule: mergeText(existing.exclusionRule, incoming.exclusionRule),
    mnemonic: existing.mnemonic || incoming.mnemonic,
    typicalMaterial: mergeText(existing.typicalMaterial, incoming.typicalMaterial),
    sourceText: mergeText(existing.sourceText, incoming.sourceText),
  });
}

function extractMarkdownField(block, label) {
  return (block.match(new RegExp(`${label}[:：]\\s*(.+)`)) || [])[1]?.trim() || "";
}

function extractMarkdownSection(block, label) {
  const pattern = new RegExp(`${label}[:：]\\s*\\n([\\s\\S]*?)(?=\\n\\S+[:：]|\\n###|\\n##|$)`);
  return (block.match(pattern) || [])[1]?.trim().replace(/\n+/g, "、") || extractMarkdownField(block, label);
}

function toRecitationMarkdown(cards) {
  return cards
    .map(
      (card) => `# ${card.questionNo ? `第${card.questionNo}题` : card.title}

来源：${card.paperTitle || card.sourceFile || card.source}
正确答案：${formatAnswer(card.correctAnswer) || card.correctDirection}
我的答案：${formatAnswer(card.userAnswer) || "未记录"}

## 题眼
${card.triggerWords || card.keyword || card.title}

## 成立条件
${card.condition}

## 正确方向
${card.correctDirection}

## 易错方向
${card.trapDirection}

## 排除规则
${card.excludeRule}

## 下次规则
${card.nextRule || card.whenToChoose || ""}

## 卡片正面
${card.front || ""}

## 卡片背面
${card.back || ""}

---

### 结构化字段

分类：${card.category}

题眼：
${card.keyword}

成立条件：
${card.condition}

正确方向：
${card.correctDirection}

易错方向：
${card.trapDirection}

排除规则：
${card.excludeRule}

标签：
${(card.tags || []).join("、")}

关键词：
${card.keywords.join("、")}

核心含义：
${card.coreMeaning}

题干证据词：
${card.questionSignals}

什么时候选：
${card.whenToChoose}

易混词：
${card.confusingWords}

区别：
${card.difference}

常见误选原因：
${card.commonMistake}

排除规则：
${card.exclusionRule}

一句口诀：
${card.mnemonic}

典型材料：
${card.typicalMaterial}

掌握度：${card.masteryLevel} · ${masteryText(card.masteryLevel)}
关联题目：${card.relatedQuestionIds.join("、") || "无"}
来源：${card.sourceFile || card.source}`
    )
    .join("\n\n");
}

function toRecitationCsv(cards) {
  const header = [
    "cardId",
    "sourceQuestionId",
    "paperId",
    "paperTitle",
    "questionNo",
    "type",
    "title",
    "triggerWords",
    "condition",
    "correctDirection",
    "trapDirection",
    "excludeRule",
    "mistakeReason",
    "nextRule",
    "tags",
    "mastery",
    "reviewCount",
    "wrongReviewCount",
    "nextReviewAt",
  ];
  const rows = cards.map((card) =>
    header.map((field) => csvCell(Array.isArray(card[field]) ? card[field].join("、") : card[field])).join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function getRecitationExportCards(scope) {
  const cards = getRecitationCards();
  if (scope === "today") return getTodayRecitationCards();
  if (scope === "cram") return cards.filter(isCramRecitationCard).sort(recitationCardSorter);
  if (scope === "repeatedWrong") return cards.filter(isRepeatedWrongLinkedCard).sort(recitationCardSorter);
  if (scope === "fixed") return cards.filter((card) => card.category === "固定搭配类").sort(recitationCardSorter);
  if (scope === "confusing") return cards.filter((card) => card.category === "易混词库" || card.category.includes("易混")).sort(recitationCardSorter);
  return cards.sort(recitationCardSorter);
}

function dedupeCardsWithinImport(cards) {
  const seen = [];
  cards.forEach((card) => {
    const duplicate = seen.find(
      (item) =>
        item.title === card.title ||
        (item.mnemonic && card.mnemonic && item.mnemonic === card.mnemonic) ||
        (item.sourceText && card.sourceText && item.sourceText === card.sourceText) ||
        keywordSimilarity(item.keywords, card.keywords) >= 0.88
    );
    if (duplicate) {
      Object.assign(duplicate, mergeRecitationCards(duplicate, card));
    } else {
      seen.push(normalizeRecitationCard(card));
    }
  });
  return seen;
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function firstField(row, names) {
  for (const name of names) {
    const key = Object.keys(row).find((item) => item.replace(/\s/g, "") === name.replace(/\s/g, ""));
    if (key && row[key]) return String(row[key]).trim();
  }
  return "";
}

function findLineValue(lines, keywords) {
  const line = lines.find((item) => keywords.some((keyword) => item.includes(keyword)));
  if (!line) return "";
  return line.replace(/^[^:：]*[:：]\s*/, "").trim();
}

function mergeText(left, right) {
  const values = normalizeStringList([left, right]);
  return values.join("；");
}

function keywordSimilarity(left, right) {
  const leftSet = new Set(normalizeKeywordList(left));
  const rightSet = new Set(normalizeKeywordList(right));
  if (!leftSet.size || !rightSet.size) return 0;
  const overlap = [...leftSet].filter((item) => rightSet.has(item)).length;
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function categoryFromHeading(line) {
  if (/(?:=|＝|:|：|\bvs\b|\bVS\b|区别)/.test(String(line || ""))) return "";
  const text = String(line || "")
    .replace(/^#{1,4}\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/, "")
    .trim();
  if (!text || text.length > 32) return "";
  return isRecitationCategoryHeading(text) ? inferRecitationCategory(text) : "";
}

function isRecitationCategoryHeading(text) {
  return /问法|治理|生态|绿色|消费|科技|创新|乡村|民生|公共服务|政策|经济|法律|公文|哲学|固定搭配|口诀|速背|题眼|易混|高频/.test(text);
}

function inferRecitationCategory(text) {
  const value = String(text || "");
  if (/问法/.test(value)) return "问法类";
  if (/治理/.test(value)) return "治理类";
  if (/生态|绿色|环保/.test(value)) return "生态绿色类";
  if (/消费/.test(value)) return "消费类";
  if (/科技|创新/.test(value)) return "科技创新类";
  if (/乡村|农业|农村/.test(value)) return "乡村振兴类";
  if (/民生|公共服务/.test(value)) return "民生公共服务类";
  if (/财政|货币|政策|经济|投资|金融/.test(value)) return "政策经济类";
  if (/法律|法治/.test(value)) return "法律类";
  if (/公文/.test(value)) return "公文类";
  if (/哲学|矛盾|实践|认识/.test(value)) return "哲学类";
  if (/固定搭配|永恒主题|基础作用|关键作用/.test(value)) return "固定搭配类";
  if (/口诀|速背|主动仗|晴雨表|一盘棋/.test(value)) return "考前口诀类";
  if (/题眼/.test(value)) return "题眼词库";
  if (/易混|对照|区别|vs|VS/.test(value)) return "易混词库";
  if (/错题/.test(value)) return "错题回流库";
  return "高频考点库";
}

function extractKeywordsFromText(text) {
  const tokens = String(text || "").match(/[\u4e00-\u9fa5]{2,10}|[A-Za-z][A-Za-z\s-]{2,20}/g) || [];
  return uniqueValues(tokens.map((item) => item.trim()).filter((item) => item.length >= 2)).slice(0, 10);
}

function buildNotebookInsights(rows, isGuessBook = false, isRiskBook = false) {
  return {
    total: rows.length,
    byReason: topCountEntries(rows, (question) =>
      (isGuessBook
        ? question.guessReason
        : isRiskBook
          ? getQuestionRiskReasons(question).join("、")
          : question.wrongReason) || "未标记"
    ),
    byPaper: topCountEntries(rows, (question) => question.paperTitle || question.paperId || "未分类"),
    byModule: topCountEntries(rows, (question) => question.module || "未分类"),
  };
}

function topCountEntries(rows, getLabel, limit = 5) {
  const counts = new Map();
  rows.forEach((item) => {
    const label = String(getLabel(item) || "未分类").trim() || "未分类";
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, limit);
}

function getRiskFilterValues(questions) {
  return [
    "没有背诵卡",
    ...WRONG_REASONS,
    ...uniqueValues(
      questions
        .map((question) => getHesitationCombo(question))
        .filter(Boolean)
        .map((combo) => `犹豫项:${combo}`)
    ),
  ];
}

function matchesRiskReasonFilter(question, value) {
  if (value === "没有背诵卡") {
    return !getRecitationCardForQuestion(question);
  }
  if (String(value).startsWith("犹豫项:")) {
    return getHesitationCombo(question) === String(value).slice("犹豫项:".length);
  }
  return getQuestionRiskReasons(question).includes(value);
}

function getQuestionRiskReasons(question) {
  const reasons = Array.isArray(question.riskReasons) ? question.riskReasons : [];
  if (reasons.length) {
    return reasons;
  }
  return question.wrongReason ? [question.wrongReason] : [];
}

function countQuestionsByRiskReason(questions, reason) {
  return questions.filter((question) => getQuestionRiskReasons(question).includes(reason)).length;
}

function topRiskReasonText(questions) {
  const entries = topCountEntries(
    questions.filter((question) => question.isWrong || question.isHighRisk),
    (question) => getQuestionRiskReasons(question).join("、") || "未标记",
    5
  ).filter((entry) => entry.label !== "未标记");
  return entries.length ? entries.map((entry) => `${entry.label}${entry.count}`).join(" / ") : "--";
}

function getScoreDiagnosisStats(questions) {
  const answered = questions.filter(hasUserAnswer);
  const graded = answered.filter(isGradedQuestion);
  const surfaceCorrect = graded.filter((question) => question.status === "correct");
  const sureCorrect = surfaceCorrect.filter((question) => question.confidenceStatus === "确定" && !question.isGuessed);
  const tangled = graded.filter(isTangledQuestion);
  const tangledWrong = tangled.filter((question) => question.status === "wrong");
  const multi = graded.filter(isMultipleQuestion);
  const multiMissedCount = multi.reduce((sum, question) => sum + normalizeAnswerToArray(question.missedOptions).length, 0);
  const multiOverSelectedCount = multi.reduce((sum, question) => sum + normalizeAnswerToArray(question.overSelectedOptions).length, 0);
  const primaryReasons = topCountEntries(
    questions.filter((question) => question.isWrong || question.isHighRisk),
    (question) => question.primaryWrongReason || question.wrongReason || "未标记",
    5
  ).filter((entry) => entry.label !== "未标记");
  const secondaryTags = topCountEntries(
    questions.flatMap((question) => normalizeStringArray(question.secondaryWrongTags).map((tag) => ({ tag }))),
    (item) => item.tag,
    10
  );

  return {
    realAccuracyText: answered.length ? `${Math.round((sureCorrect.length / answered.length) * 100)}%` : "--",
    surfaceAccuracyText: answered.length ? `${Math.round((surfaceCorrect.length / answered.length) * 100)}%` : "--",
    tangledErrorRateText: tangled.length ? `${Math.round((tangledWrong.length / tangled.length) * 100)}%` : "--",
    multiMissedCount,
    multiOverSelectedCount,
    topPrimaryWrongReasonsText: primaryReasons.length ? primaryReasons.map((entry) => `${entry.label}${entry.count}`).join(" / ") : "--",
    topSecondaryWrongTagsText: secondaryTags.length ? secondaryTags.map((entry) => `${entry.label}${entry.count}`).join(" / ") : "--",
  };
}

function getTopHesitationCombo(questions) {
  const entries = topCountEntries(
    questions.filter((question) => getHesitationCombo(question)),
    (question) => getHesitationCombo(question),
    1
  );
  return entries.length ? `${entries[0].label} ${entries[0].count}` : "--";
}

function getHesitationCombo(question) {
  const options = normalizeAnswerToArray(question.hesitationOptions);
  return options.length ? options.join("/") : "";
}

function isTangledQuestion(question) {
  return TANGLED_CONFIDENCE_VALUES.includes(question.confidenceStatus);
}

function getMissingTangledTrainingFields(question) {
  if (!isTangledQuestion(question)) {
    return [];
  }
  return [
    ["hesitationOptions", "纠结选项", normalizeAnswerToArray(question.hesitationOptions).length],
    ["eachOptionReason", "各选项理由", String(question.eachOptionReason || "").trim()],
    ["decisiveKeyword", "定胜关键词", String(question.decisiveKeyword || "").trim()],
    ["eliminatedOption", "淘汰项", normalizeAnswerToArray(question.eliminatedOption).length],
    ["eliminationReason", "淘汰理由", String(question.eliminationReason || "").trim()],
  ]
    .filter(([, , value]) => !value)
    .map(([, label]) => label);
}

function shouldRequireTangledTrainingBeforeAnswer(mode, isWrongBook, isGuessBook, isRiskBook) {
  return mode !== "exam" && !isGuessBook && (isWrongBook || isRiskBook || state.currentView === "paper");
}

function isCorrectButUncertain(question) {
  return question.status === "correct" && question.confidenceStatus === "不确定";
}

function isGuessedCorrect(question) {
  return question.status === "correct" && (question.confidenceStatus === "蒙的" || question.guessReason === "蒙的");
}

function getQuarantineItems() {
  return getAbnormalItems().filter((item) => !item.repairedAt);
}

function getAbnormalItems() {
  const stored = Array.isArray(state.store.abnormalQuestions) ? state.store.abnormalQuestions : [];
  const paperQuarantine = state.store.papers.flatMap((paper) => {
    const quarantine = Array.isArray(paper.lastPaperImportReport?.quarantine)
      ? paper.lastPaperImportReport.quarantine
      : [];
    return quarantine.map((item) => normalizeAbnormalItem(item, paper));
  });
  const merged = mergeAbnormalItems([...stored.map((item) => normalizeAbnormalItem(item)), ...paperQuarantine]);
  state.store.abnormalQuestions = merged;
  return merged;
}

function getFilteredAbnormalItems() {
  const keyword = String(state.abnormalFilters.keyword || "").trim().toLowerCase();
  return getAbnormalItems()
    .filter((item) => state.abnormalFilters.type === "all" || item.abnormalType === state.abnormalFilters.type)
    .filter((item) => state.abnormalFilters.paperId === "all" || item.paperId === state.abnormalFilters.paperId)
    .filter((item) => {
      if (!keyword) return true;
      const haystack = [
        item.questionNo,
        item.paperTitle,
        item.stem,
        item.explanation,
        ...(item.options || []).map((option) => `${option.label}${option.text}`),
        item.rawBlock,
        item.issues.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
}

function normalizeAbnormalItem(item, paper = {}) {
  const parsedQuestion = item?.parsedQuestion || item?.question || item || {};
  const paperId = String(item?.paperId || parsedQuestion.paperId || paper.paperId || "").trim();
  const paperTitle = String(item?.paperTitle || parsedQuestion.paperTitle || paper.paperTitle || paperId || "未知期次").trim();
  const questionNo = String(item?.questionNo || parsedQuestion.questionNo || "?").trim() || "?";
  const options = Array.isArray(item?.options)
    ? item.options
    : Array.isArray(parsedQuestion.options)
      ? parsedQuestion.options
      : [];
  const normalized = {
    abnormalId: String(item?.abnormalId || `${paperId || "unknown"}::${normalizeQuestionNo(questionNo)}::${Date.now()}`),
    paperId,
    paperTitle,
    questionNo,
    type: String(item?.type || parsedQuestion.type || "单选题").trim(),
    stem: String(item?.stem || parsedQuestion.stem || item?.stemPreview || "").trim(),
    options: options.map((option, index) => ({
      label: String(option.label || String.fromCharCode(65 + index)).trim(),
      text: String(option.text || option || "").trim(),
    })),
    correctAnswer: item?.correctAnswer ?? parsedQuestion.correctAnswer ?? null,
    explanation: String(item?.explanation || parsedQuestion.explanation || "").trim(),
    module: String(item?.module || parsedQuestion.module || "未分类").trim(),
    rawBlock: String(item?.rawBlock || item?.sourceText || "").trim(),
    issues: Array.isArray(item?.issues) ? item.issues : [],
    abnormalType: item?.abnormalType || "unknown",
    severity: item?.severity || "hard",
    repairedAt: item?.repairedAt || null,
    repairHistory: Array.isArray(item?.repairHistory) ? item.repairHistory : [],
    createdAt: item?.createdAt || new Date().toISOString(),
    updatedAt: item?.updatedAt || new Date().toISOString(),
  };
  const classified = classifyAbnormalIssues(normalized);
  normalized.issues = uniqueValues([...normalized.issues, ...classified.issues]);
  normalized.abnormalType = item?.abnormalType && item.abnormalType !== "unknown" ? item.abnormalType : classified.abnormalType;
  normalized.severity = classified.severity;
  return normalized;
}

function classifyAbnormalIssues(item) {
  const issues = [];
  const typeSet = [];
  const stem = String(item.stem || "");
  const explanation = String(item.explanation || "");
  const options = Array.isArray(item.options) ? item.options : [];
  const labels = options.map((option) => option.label).filter(Boolean);
  const allowed = ["A", "B", "C", "D"];
  const answer = normalizeAnswerToArray(item.correctAnswer);
  const haystack = [stem, explanation, ...options.map((option) => option.text), item.rawBlock].join(" ");
  if (!stem.trim()) {
    issues.push("题干为空");
    typeSet.push("missingStem");
  }
  if (options.length < 2) {
    issues.push("选项少于 2 个");
    typeSet.push("missingOptions");
  }
  if (!answer.length) {
    issues.push("correctAnswer 为空");
    typeSet.push("invalidAnswer");
  } else if (answer.some((label) => !allowed.includes(label))) {
    issues.push("答案格式不合法");
    typeSet.push("invalidAnswer");
  }
  if (new Set(labels).size !== labels.length) {
    issues.push("options 出现重复 label");
    typeSet.push("mixedContent");
  }
  if (!String(item.questionNo || "").trim() || item.questionNo === "?") {
    issues.push("题号为空");
    typeSet.push("parseFailed");
  }
  if (!String(item.paperId || "").trim()) {
    issues.push("paperId 为空");
    typeSet.push("parseFailed");
  }
  if (!explanation.trim() && answer.length) {
    issues.push("解析缺失");
    typeSet.push("missingExplanation");
  }
  if (WATERMARK_NOISE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(haystack);
  })) {
    issues.push("水印广告污染");
    typeSet.push("watermarkNoise");
  }
  if (/(?:^|\s)(?:[1-9]\d?|Q\d+)[.、．]\s*[\u4e00-\u9fa5]|[ABCD][.、．]\s*.+[ABCD][.、．]\s*/.test(stem) || options.some((option) => option.text.length > 180 && /(?:[1-9]\d?|Q\d+)[.、．]/.test(option.text))) {
    issues.push("疑似混入其他题内容");
    typeSet.push("mixedContent");
  }
  const hardTypes = typeSet.filter((type) => type !== "missingExplanation");
  return {
    issues,
    abnormalType: hardTypes[0] || typeSet[0] || "unknown",
    severity: hardTypes.length ? "hard" : issues.length ? "light" : "valid",
  };
}

function mergeAbnormalItems(items) {
  const map = new Map();
  items.forEach((item) => {
    const normalized = normalizeAbnormalItem(item);
    const key = abnormalItemKey(normalized);
    const existing = map.get(key);
    map.set(
      key,
      existing
        ? {
            ...existing,
            ...normalized,
            issues: uniqueValues([...(existing.issues || []), ...(normalized.issues || [])]),
            repairHistory: [...(existing.repairHistory || []), ...(normalized.repairHistory || [])],
            repairedAt: normalized.repairedAt || existing.repairedAt || null,
          }
        : normalized
    );
  });
  return [...map.values()].sort(questionSorter);
}

function abnormalItemKey(item) {
  return `${item.paperId || "unknown"}::${normalizeQuestionNo(item.questionNo || "?")}`;
}

function syncAbnormalItemsForPaper(paperId, paperTitle, quarantine) {
  const retained = getAbnormalItems().filter((item) => item.paperId !== paperId || item.repairedAt);
  const nextItems = quarantine.map((item) => normalizeAbnormalItem(item, { paperId, paperTitle }));
  state.store.abnormalQuestions = mergeAbnormalItems([...retained, ...nextItems]);
}

function getPaperStats(paperId) {
  const questions = getPaperQuestions(paperId);
  const total = questions.length;
  const answered = questions.filter((question) => question.status !== "unanswered").length;
  const matchedAnswerCount = questions.filter((question) => hasCorrectAnswer(question)).length;
  const wrongCount = questions.filter((question) => question.isWrong).length;
  const guessCount = questions.filter((question) => question.isGuessed).length;
  const riskCount = questions.filter((question) => question.isHighRisk).length;
  const uncertainCorrectCount = questions.filter((question) => isCorrectButUncertain(question)).length;
  const guessedCorrectCount = questions.filter((question) => isGuessedCorrect(question)).length;
  const graded = questions.filter((question) => isGradedQuestion(question));
  const correct = questions.filter((question) => question.status === "correct").length;
  const ungradedCount = Math.max(0, answered - graded.length);
  const completion = total ? (answered / total) * 100 : 0;
  const accuracy = graded.length ? (correct / graded.length) * 100 : null;
  const scoreStats = getQuestionScoreStats(questions);

  return {
    total,
    answered,
    matchedAnswerCount,
    gradedCount: graded.length,
    correctCount: correct,
    wrongCount,
    guessCount,
    riskCount,
    uncertainCorrectCount,
    guessedCorrectCount,
    ungradedCount,
    ...scoreStats,
    completionText: `${completion.toFixed(0)}%`,
    accuracyText: accuracy === null ? "--" : `${accuracy.toFixed(0)}% (${graded.length}题)`,
  };
}

function getStoreScoreStats() {
  return getQuestionScoreStats(state.store.questions);
}

function getQuestionScoreStats(questions) {
  const maxScore = questions.reduce((sum, question) => sum + getQuestionMaxScore(question), 0);
  const answeredMaxScore = questions
    .filter((question) => hasUserAnswer(question))
    .reduce((sum, question) => sum + getQuestionMaxScore(question), 0);
  const score = questions.reduce((sum, question) => {
    if (!isGradedQuestion(question)) {
      return sum;
    }
    return sum + Math.max(0, Number(question.score) || 0);
  }, 0);
  const scoreRate = answeredMaxScore ? (score / answeredMaxScore) * 100 : null;

  return {
    score,
    maxScore,
    answeredMaxScore,
    scoreText: `${formatScore(score)}/${formatScore(maxScore)}`,
    scoreRateText: scoreRate === null ? "--" : `${scoreRate.toFixed(0)}%`,
  };
}

function getPaperTimingStats(paperId) {
  const timing = getPaperTiming(paperId);
  const questionByKey = new Map(getPaperQuestions(paperId).map((question) => [questionKey(question), question]));
  const slowestEntries = Object.entries(timing.questionSeconds || {})
    .map(([key, seconds]) => ({
      key,
      seconds: Math.max(0, Math.round(Number(seconds) || 0)),
      question: questionByKey.get(key),
    }))
    .filter((entry) => entry.seconds > 0 && entry.question)
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 5);

  return {
    totalSeconds: Math.max(0, Math.round(Number(timing.totalSeconds) || 0)),
    slowestEntries,
    slowestQuestionLabel: slowestEntries.length
      ? `Q${slowestEntries[0].question.questionNo} · ${formatDuration(slowestEntries[0].seconds)}`
      : "--",
  };
}

function getGlobalTimingStats(papers) {
  const entries = papers
    .map((paper) => {
      const timing = getPaperTiming(paper.paperId);
      return {
        paper,
        seconds: Math.max(0, Math.round(Number(timing.totalSeconds) || 0)),
      };
    })
    .filter((entry) => entry.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds || left.paper.paperTitle.localeCompare(right.paper.paperTitle, "zh-CN"))
    .slice(0, 8);

  return {
    totalSeconds: entries.reduce((sum, entry) => sum + entry.seconds, 0),
    entries,
  };
}

function renderGlobalTimingPanel(timingStats) {
  if (!elements.globalTimingPanel) {
    return;
  }

  elements.globalTimingPanel.hidden = false;
  elements.globalTimingPanel.innerHTML = `
    <div>
      <div class="timing-title">总计时</div>
      <div class="timing-value" data-global-total-time="true">${escapeHtml(formatDuration(timingStats.totalSeconds))}</div>
      <p class="muted">汇总所有期次练习页的自动计时。</p>
    </div>
    <div>
      <div class="timing-title">耗时最多期次</div>
      <div class="timing-list" data-global-slowest-list="true">
        ${globalTimingListMarkup(timingStats.entries)}
      </div>
    </div>
  `;
}

function globalTimingListMarkup(entries) {
  if (!entries.length) {
    return `<span class="muted">暂无计时数据</span>`;
  }

  return entries
    .map(
      (entry) => `
        <span class="metric-pill">
          ${escapeHtml(entry.paper.paperTitle)} · ${escapeHtml(formatDuration(entry.seconds))}
        </span>
      `
    )
    .join("");
}

function renderPaperTimingPanel(timingStats) {
  if (!elements.paperTimingPanel) {
    return;
  }

  elements.paperTimingPanel.hidden = false;
  elements.paperTimingPanel.innerHTML = `
    <div>
      <div class="timing-title">本期计时</div>
      <div class="timing-value" data-paper-total-time="true">${escapeHtml(formatDuration(timingStats.totalSeconds))}</div>
      <p class="muted">进入本期练习页后自动累计；滚动到哪道题，就主要记到哪道题。</p>
    </div>
    <div>
      <div class="timing-title">耗时最多</div>
      <div class="timing-list" data-paper-slowest-list="true">
        ${timingSlowestListMarkup(timingStats.slowestEntries)}
      </div>
    </div>
  `;
}

function timingSlowestListMarkup(entries) {
  if (!entries.length) {
    return `<span class="muted">暂无计时数据</span>`;
  }

  return entries
    .map(
      (entry) => `
        <span class="metric-pill">
          Q${escapeHtml(entry.question.questionNo)} · ${escapeHtml(formatDuration(entry.seconds))}
        </span>
      `
    )
    .join("");
}

function questionCardMarkup(question, mode, isWrongBook, isGuessBook = false, isRiskBook = false) {
  const multiple = isMultipleQuestion(question);
  const key = questionKey(question);
  const recitationCard = getRecitationCardForQuestion(question);
  const recitationCardFocused = recitationCard && state.recitationFocusCardId === recitationCard.cardId;
  const userAnswer = normalizeAnswerToArray(question.userAnswer);
  const correctAnswer = normalizeAnswerToArray(question.correctAnswer);
  const showFeedback = hasUserAnswer(question) && (question.status === "correct" || question.status === "wrong");
  const showCorrectAnswer = showFeedback;
  const feedbackKind =
    question.status === "correct" ? "correct" : question.status === "wrong" ? "wrong" : "neutral";

  return `
    <article class="question-card" data-question-card="true" data-question-key="${escapeHtmlAttr(key)}">
      <div class="question-header">
        <div>
          <p class="eyebrow">Q ${escapeHtml(question.questionNo)}</p>
          <h3 class="question-stem">${escapeHtml(question.stem)}</h3>
        </div>
        <div class="question-meta">
          <span class="tag">${escapeHtml(question.paperTitle)}</span>
          <span class="tag">${escapeHtml(question.module)}</span>
          <span class="tag">${escapeHtml(question.type)}</span>
          <span class="status-badge" data-status="${escapeHtmlAttr(question.status)}">${statusText(question.status)}</span>
        </div>
      </div>
      <div class="option-grid">
        ${question.options
          .map((option) => {
            const selected = userAnswer.includes(option.label);
            const isCorrect = correctAnswer.includes(option.label);
            const optionState = [
              selected ? "selected" : "",
              showCorrectAnswer && isCorrect ? "correct" : "",
              showCorrectAnswer && selected && !isCorrect ? "wrong" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return `
              <label class="option-item ${optionState}">
                <input
                  type="${multiple ? "checkbox" : "radio"}"
                  name="question-${escapeHtmlAttr(key)}"
                  value="${escapeHtmlAttr(option.label)}"
                  data-option="true"
                  data-question-key="${escapeHtmlAttr(key)}"
                  ${selected ? "checked" : ""}
                />
                <span><span class="option-badge">${escapeHtml(option.label)}</span>${escapeHtml(option.text)}</span>
              </label>
            `;
          })
          .join("")}
      </div>
      ${confidencePanelMarkup(question)}
      ${multiple ? perOptionJudgementMarkup(question) : ""}
      <div class="question-actions">
        <button class="secondary" data-submit-question="true" data-question-key="${escapeHtmlAttr(key)}">
          ${mode === "exam" ? "保存作答" : isWrongBook || isGuessBook || isRiskBook ? "提交重刷" : "提交判题"}
        </button>
        <button class="ghost" data-clear-question="true" data-question-key="${escapeHtmlAttr(key)}">
          ${isWrongBook || isGuessBook || isRiskBook ? "重做本题" : "清空"}
        </button>
        ${
          question.isWrong || question.isHighRisk || isWrongBook || isRiskBook
            ? `<button class="ghost" data-create-recitation-card="true" data-question-key="${escapeHtmlAttr(key)}">${
                recitationCard ? "已生成背诵卡片" : "生成背诵卡片"
              }</button>`
            : ""
        }
        ${
          isRiskBook || question.isHighRisk
            ? `<button class="ghost" data-mark-needs-recitation="true" data-question-key="${escapeHtmlAttr(key)}">需要背</button>`
            : ""
        }
        ${
          recitationCard
            ? `
              <button class="ghost" data-view-recitation-card="true" data-question-key="${escapeHtmlAttr(key)}">查看关联背诵卡</button>
              <button class="ghost" data-regenerate-recitation-card="true" data-question-key="${escapeHtmlAttr(key)}">重新生成背诵卡</button>
              <button class="ghost" data-copy-recitation-card-markdown="true" data-question-key="${escapeHtmlAttr(key)}">复制背诵卡 Markdown</button>
            `
            : ""
        }
      </div>
      ${
        recitationCard
          ? `
            <div class="recitation-inline-result ${recitationCardFocused ? "is-fresh" : ""}">
              <span>${recitationCardFocused ? "已生成" : "已存在"}：${escapeHtml(recitationCard.category)}：${escapeHtml(recitationCard.title)} · 下次 ${escapeHtml(formatDateOnly(recitationCard.nextReviewDate) || "今天")}</span>
              <button class="ghost" data-view-recitation-card="true" data-question-key="${escapeHtmlAttr(key)}">查看背诵库</button>
            </div>
          `
          : ""
      }
      ${
        showFeedback
          ? `
            <div class="question-feedback" data-kind="${feedbackKind}">
              ${question.status === "correct" ? "回答正确" : "回答错误"} · 你的答案：${escapeHtml(
                formatAnswer(question.userAnswer) || "未作答"
              )}${question.correctAnswer ? ` · 正确答案：${escapeHtml(formatAnswer(question.correctAnswer))}` : " · 当前尚未导入答案"}${
                question.maxScore ? ` · 得分：${escapeHtml(formatScore(question.score))}/${escapeHtml(formatScore(question.maxScore))}` : ""
              }${question.confidenceStatus ? ` · 信心：${escapeHtml(question.confidenceStatus)}` : ""}${
                getHesitationCombo(question) ? ` · 犹豫项：${escapeHtml(getHesitationCombo(question))}` : ""
              }${question.selectedVsCorrectDiff ? ` · 选择差异：${escapeHtml(question.selectedVsCorrectDiff)}` : ""}${
                question.multiSelectErrorType ? ` · 多选诊断：${escapeHtml(question.multiSelectErrorType)}` : ""
              }
            </div>
          `
          : ""
      }
      ${showCorrectAnswer && question.explanation ? `<div class="question-explanation">解析：${escapeHtml(question.explanation)}</div>` : ""}
      ${isRiskBook && showFeedback && question.lastReviewSnapshot ? previousReviewMarkup(question.lastReviewSnapshot) : ""}
      ${
        question.status === "correct" || question.isGuessed
          ? `
            <div class="wrong-reason-panel">
              <label>
                掌握情况
                <select data-guess-reason="true" data-question-key="${escapeHtmlAttr(key)}">
                  <option value="">正常做对</option>
                  ${GUESS_REASONS.map(
                    (reason) => `<option value="${escapeHtmlAttr(reason)}" ${question.guessReason === reason ? "selected" : ""}>${escapeHtml(reason)}</option>`
                  ).join("")}
                </select>
              </label>
              <p class="muted">选择“蒙的/猜的/不确定”后，这道题会进入猜对题库。</p>
            </div>
          `
          : ""
      }
      ${question.isWrong || question.isHighRisk || isWrongBook || isRiskBook ? riskReviewPanelMarkup(question) : ""}
    </article>
  `;
}

function confidencePanelMarkup(question) {
  const key = questionKey(question);
  const hesitationOptions = normalizeAnswerToArray(question.hesitationOptions);
  const missingTangledTraining = getMissingTangledTrainingFields(question);
  return `
    <div class="wrong-reason-panel">
      <label>
        信心状态（提交前必选）
        <select data-confidence="true" data-question-key="${escapeHtmlAttr(key)}">
          <option value="">请选择</option>
          ${CONFIDENCE_OPTIONS.map(
            (option) => `<option value="${escapeHtmlAttr(option)}" ${question.confidenceStatus === option ? "selected" : ""}>${escapeHtml(option)}</option>`
          ).join("")}
        </select>
      </label>
      <div class="insight-tags">
        <span class="muted">犹豫项：</span>
        ${["A", "B", "C", "D"].map(
          (label) => `
            <label class="metric-pill">
              <input
                type="checkbox"
                value="${escapeHtmlAttr(label)}"
                data-hesitation-option="true"
                data-question-key="${escapeHtmlAttr(key)}"
                ${hesitationOptions.includes(label) ? "checked" : ""}
              />
              ${escapeHtml(label)}
            </label>
          `
        ).join("")}
      </div>
      ${isTangledQuestion(question) && missingTangledTraining.length ? `<p class="muted">纠结题复盘待补全：${escapeHtml(missingTangledTraining.join("、"))}</p>` : ""}
      <div class="review-grid">
        <label>
          各选项理由
          <textarea rows="2" data-score-training-field="eachOptionReason" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(question.eachOptionReason || "")}</textarea>
        </label>
        <label>
          定胜关键词
          <textarea rows="2" data-score-training-field="decisiveKeyword" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(question.decisiveKeyword || "")}</textarea>
        </label>
        <label>
          淘汰项
          <input data-score-training-field="eliminatedOption" data-question-key="${escapeHtmlAttr(key)}" value="${escapeHtmlAttr(formatAnswer(question.eliminatedOption) || "")}" />
        </label>
        <label>
          淘汰理由
          <textarea rows="2" data-score-training-field="eliminationReason" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(question.eliminationReason || "")}</textarea>
        </label>
      </div>
    </div>
  `;
}

function perOptionJudgementMarkup(question) {
  const key = questionKey(question);
  const judgement = normalizePerOptionJudgement(question.perOptionJudgement);
  return `
    <div class="wrong-reason-panel per-option-panel">
      <div class="insight-title">多选逐项判断</div>
      <div class="per-option-grid">
        ${question.options
          .map((option) => {
            const optionValue = judgement[option.label] || "";
            return `
              <div class="per-option-row">
                <span class="option-badge">${escapeHtml(option.label)}</span>
                ${PER_OPTION_JUDGEMENT_VALUES.map(
                  (value) => `
                    <label class="metric-pill">
                      <input
                        type="radio"
                        name="per-option-${escapeHtmlAttr(key)}-${escapeHtmlAttr(option.label)}"
                        value="${escapeHtmlAttr(value)}"
                        data-per-option-judgement="true"
                        data-option-label="${escapeHtmlAttr(option.label)}"
                        data-question-key="${escapeHtmlAttr(key)}"
                        ${optionValue === value ? "checked" : ""}
                      />
                      ${escapeHtml(value)}
                    </label>
                  `
                ).join("")}
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="muted">逐项判断只用于训练诊断，不参与最终判题。</p>
    </div>
  `;
}

function riskReviewPanelMarkup(question) {
  const key = questionKey(question);
  const selectedReasons = getQuestionRiskReasons(question);
  const reviewNotes = normalizeReviewNotes(question.reviewNotes);
  return `
    <div class="wrong-reason-panel">
      <div class="insight-title">${question.isHighRisk ? "高危复盘" : "错题复盘"}</div>
      <div class="insight-tags">
        ${WRONG_REASONS.map(
          (reason) => `
            <label class="metric-pill">
              <input
                type="checkbox"
                value="${escapeHtmlAttr(reason)}"
                data-risk-reason="true"
                data-question-key="${escapeHtmlAttr(key)}"
                ${selectedReasons.includes(reason) ? "checked" : ""}
              />
              ${escapeHtml(reason)}
            </label>
          `
        ).join("")}
      </div>
      <div class="review-grid">
        <label>
          易混标签
          <input data-score-training-field="secondaryWrongTags" data-question-key="${escapeHtmlAttr(key)}" value="${escapeHtmlAttr(normalizeStringArray(question.secondaryWrongTags).join("，"))}" />
        </label>
        ${REVIEW_PROMPTS.map(
          ([field, label]) => `
            <label>
              ${escapeHtml(label)}
              <textarea rows="2" data-review-field="${escapeHtmlAttr(field)}" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(reviewNotes[field] || "")}</textarea>
            </label>
          `
        ).join("")}
        <label>
          错误思路
          <textarea rows="2" data-score-training-field="wrongThinking" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(question.wrongThinking || "")}</textarea>
        </label>
        <label>
          下次规则
          <textarea rows="2" data-score-training-field="nextRule" data-question-key="${escapeHtmlAttr(key)}">${escapeHtml(question.nextRule || "")}</textarea>
        </label>
      </div>
      ${scoreDiagnosisPanelMarkup(question)}
    </div>
  `;
}

function scoreDiagnosisPanelMarkup(question) {
  const rows = [
    ["选择差异", question.selectedVsCorrectDiff],
    ["多选诊断", question.multiSelectErrorType],
    ["漏选", formatAnswer(question.missedOptions)],
    ["错选", formatAnswer(question.overSelectedOptions)],
    ["学习诊断", question.learningDiagnosis],
    ["复测优先级", question.retestPriority],
    ["复盘日期", question.reviewDueAt],
    ["规则卡", question.recitationCardId],
  ].filter(([, value]) => String(value || "").trim());
  if (!rows.length) {
    return "";
  }
  return `
    <div class="diagnosis-chip-grid">
      ${rows.map(([label, value]) => `<span class="metric-pill">${escapeHtml(label)}：${escapeHtml(value)}</span>`).join("")}
    </div>
  `;
}

function previousReviewMarkup(snapshot) {
  const reviewNotes = normalizeReviewNotes(snapshot.reviewNotes);
  return `
    <div class="question-feedback" data-kind="neutral">
      上次选择：${escapeHtml(formatAnswer(snapshot.userAnswer) || "未作答")} ·
      上次犹豫项：${escapeHtml(formatAnswer(snapshot.hesitationOptions) || "无")} ·
      上次信心：${escapeHtml(snapshot.confidenceStatus || "未标记")} ·
      上次错因：${escapeHtml((snapshot.riskReasons || []).join("、") || snapshot.wrongReason || "未标记")}
    </div>
    <div class="question-explanation">
      ${REVIEW_PROMPTS.map(([field, label]) => `${escapeHtml(label)}${escapeHtml(reviewNotes[field] || "未填写")}`).join("<br/>")}
    </div>
  `;
}

function updateUserAnswerFromDom(question, container) {
  question.userAnswer = collectUserAnswerFromDom(question, container);
  updateConfidenceFromDom(question, container);
  updateHesitationOptionsFromDom(question, container);
  updateScoreTrainingFieldsFromDom(question, container);
  updatePerOptionJudgementFromDom(question, container);
  markAnswered(question);
}

function collectUserAnswerFromDom(question, container) {
  const inputs = container.querySelectorAll(
    `[data-option][data-question-key="${cssEscape(questionKey(question))}"]`
  );
  const selected = [...inputs].filter((input) => input.checked).map((input) => input.value).sort();
  return selected.length ? (isMultipleQuestion(question) ? selected : selected[0]) : null;
}

function updateConfidenceFromDom(question, container) {
  const select = container.querySelector(`[data-confidence][data-question-key="${cssEscape(questionKey(question))}"]`);
  if (select) {
    question.confidenceStatus = select.value || null;
  }
}

function updateHesitationOptionsFromDom(question, container) {
  const inputs = container.querySelectorAll(
    `[data-hesitation-option][data-question-key="${cssEscape(questionKey(question))}"]`
  );
  question.hesitationOptions = [...inputs].filter((input) => input.checked).map((input) => input.value).sort();
}

function updateScoreTrainingFieldsFromDom(question, container) {
  const fields = [
    "secondaryWrongTags",
    "eachOptionReason",
    "decisiveKeyword",
    "eliminatedOption",
    "eliminationReason",
    "wrongThinking",
    "nextRule",
  ];
  fields.forEach((field) => {
    const input = container.querySelector(
      `[data-score-training-field="${cssEscape(field)}"][data-question-key="${cssEscape(questionKey(question))}"]`
    );
    if (!input) {
      return;
    }
    if (field === "eliminatedOption") {
      question[field] = normalizeAnswerToArray(input.value);
    } else if (field === "secondaryWrongTags") {
      question[field] = normalizeStringArray(input.value);
    } else {
      question[field] = input.value.trim();
    }
  });
}

function updatePerOptionJudgementFromDom(question, container) {
  if (!isMultipleQuestion(question)) {
    question.perOptionJudgement = {};
    return;
  }
  const inputs = container.querySelectorAll(
    `[data-per-option-judgement][data-question-key="${cssEscape(questionKey(question))}"]`
  );
  const next = {};
  [...inputs].forEach((input) => {
    if (input.checked && input.dataset.optionLabel) {
      next[input.dataset.optionLabel] = input.value;
    }
  });
  question.perOptionJudgement = normalizePerOptionJudgement(next);
}

function updateRiskReasonsFromDom(question, container) {
  const inputs = container.querySelectorAll(
    `[data-risk-reason][data-question-key="${cssEscape(questionKey(question))}"]`
  );
  question.riskReasons = [...inputs].filter((input) => input.checked).map((input) => input.value);
  question.wrongReason = question.riskReasons[0] || null;
  question.primaryWrongReason = question.wrongReason || "";
}

function markAnswered(question) {
  question.status = hasUserAnswer(question) ? "answered" : "unanswered";
  question.isWrong = false;
  question.score = null;
  question.maxScore = null;
  if (!hasUserAnswer(question)) {
    question.wrongReason = null;
    question.primaryWrongReason = "";
    question.secondaryWrongTags = [];
    question.isGuessed = false;
    question.guessReason = null;
    question.isHighRisk = false;
    question.confidenceStatus = null;
    question.hesitationOptions = "";
    question.decisiveKeyword = "";
    question.wrongThinking = "";
    question.nextRule = "";
    question.selectedVsCorrectDiff = "";
    question.eachOptionReason = "";
    question.eliminatedOption = "";
    question.eliminationReason = "";
    question.perOptionJudgement = {};
    question.missedOptions = [];
    question.overSelectedOptions = [];
    question.multiSelectErrorType = "";
    question.learningDiagnosis = "";
    question.retestPriority = "";
    question.reviewDueAt = "";
    question.riskCertainCorrectStreak = 0;
    question.secondReviewStillUncertain = false;
  }
  question.updatedAt = new Date().toISOString();
}

function clearQuestionProgress(question) {
  question.userAnswer = null;
  question.status = "unanswered";
  question.isWrong = false;
  question.score = null;
  question.maxScore = null;
  question.wrongReason = null;
  question.primaryWrongReason = "";
  question.secondaryWrongTags = [];
  question.isGuessed = false;
  question.guessReason = null;
  question.isHighRisk = false;
  question.confidenceStatus = null;
  question.hesitationOptions = "";
  question.decisiveKeyword = "";
  question.wrongThinking = "";
  question.nextRule = "";
  question.selectedVsCorrectDiff = "";
  question.eachOptionReason = "";
  question.eliminatedOption = "";
  question.eliminationReason = "";
  question.perOptionJudgement = {};
  question.missedOptions = [];
  question.overSelectedOptions = [];
  question.multiSelectErrorType = "";
  question.learningDiagnosis = "";
  question.retestPriority = "";
  question.reviewDueAt = "";
  question.riskReasons = [];
  question.reviewNotes = normalizeReviewNotes(null);
  question.riskCertainCorrectStreak = 0;
  question.secondReviewStillUncertain = false;
  question.lastReviewSnapshot = null;
  question.updatedAt = new Date().toISOString();
}

function resetQuestionForWrongDrill(question) {
  question.userAnswer = null;
  question.status = "unanswered";
  question.score = null;
  question.maxScore = null;
  question.isWrong = true;
  question.isGuessed = false;
  question.guessReason = null;
  question.confidenceStatus = null;
  question.hesitationOptions = "";
  question.riskCertainCorrectStreak = 0;
  question.updatedAt = new Date().toISOString();
}

function resetQuestionForGuessDrill(question) {
  question.userAnswer = null;
  question.status = "unanswered";
  question.score = null;
  question.maxScore = null;
  question.isWrong = false;
  question.isGuessed = true;
  question.confidenceStatus = question.guessReason || null;
  question.hesitationOptions = "";
  question.riskCertainCorrectStreak = 0;
  question.updatedAt = new Date().toISOString();
}

function resetQuestionForRiskDrill(question) {
  question.lastReviewSnapshot = buildReviewSnapshot(question);
  question.userAnswer = null;
  question.status = "unanswered";
  question.score = null;
  question.maxScore = null;
  question.isWrong = false;
  question.isHighRisk = true;
  question.confidenceStatus = null;
  question.hesitationOptions = "";
  question.updatedAt = new Date().toISOString();
}

function gradeQuestion(question) {
  if (!hasUserAnswer(question)) {
    question.status = "unanswered";
    question.isWrong = false;
    question.isGuessed = false;
    question.guessReason = null;
    question.isHighRisk = false;
    question.score = null;
    question.maxScore = null;
    updateScoreDiagnosisFields(question);
    question.updatedAt = new Date().toISOString();
    return;
  }

  if (!question.correctAnswer) {
    question.status = "answered";
    question.isWrong = false;
    question.isGuessed = false;
    question.guessReason = null;
    question.isHighRisk = false;
    question.score = null;
    question.maxScore = null;
    updateScoreDiagnosisFields(question);
    question.updatedAt = new Date().toISOString();
    return;
  }

  const result = gradeAnswer(question);
  question.score = result.score;
  question.maxScore = result.maxScore;
  question.status = result.isFullScore ? "correct" : "wrong";
  question.isWrong = !result.isFullScore;
  if (result.isFullScore) {
    question.wrongReason = null;
    updateHighRiskAfterCorrectGrade(question);
  } else {
    question.isGuessed = false;
    question.guessReason = null;
    question.isHighRisk = false;
    question.riskCertainCorrectStreak = 0;
  }
  updateScoreDiagnosisFields(question);
  question.updatedAt = new Date().toISOString();
}

function updateHighRiskAfterCorrectGrade(question) {
  const riskyConfidence = RISK_CONFIDENCE_VALUES.includes(question.confidenceStatus);
  const hasHesitation = normalizeAnswerToArray(question.hesitationOptions).length > 0;
  const cannotExplain = getQuestionRiskReasons(question).includes("做对但无法解释");
  const wasHighRisk = Boolean(question.isHighRisk);
  const isRiskyCorrect = riskyConfidence || hasHesitation || cannotExplain;

  question.isGuessed = isRiskyCorrect || Boolean(question.guessReason);
  question.guessReason = riskyConfidence ? question.confidenceStatus : question.guessReason;

  if (isRiskyCorrect) {
    question.isHighRisk = true;
    question.riskCertainCorrectStreak = 0;
    question.secondReviewStillUncertain = wasHighRisk;
    return;
  }

  if (wasHighRisk) {
    question.riskCertainCorrectStreak = (Number(question.riskCertainCorrectStreak) || 0) + 1;
    question.highRiskLevel = question.riskCertainCorrectStreak >= 2 ? "lowered" : "active";
    question.isHighRisk = question.riskCertainCorrectStreak < 3;
    question.secondReviewStillUncertain = false;
    if (!question.isHighRisk) {
      question.isGuessed = false;
      question.guessReason = null;
    }
    return;
  }

  question.isHighRisk = false;
  question.riskCertainCorrectStreak = 0;
  question.secondReviewStillUncertain = false;
}

function gradeAnswer(question) {
  const user = normalizeAnswerToArray(question.userAnswer);
  const correct = normalizeAnswerToArray(question.correctAnswer);
  const maxScore = getQuestionMaxScore(question);
  const hasWrongSelection = user.some((value) => !correct.includes(value));
  const isFullScore = user.length === correct.length && user.every((value, index) => value === correct[index]);

  if (!isMultipleQuestion(question)) {
    return {
      score: isFullScore ? maxScore : 0,
      maxScore,
      isFullScore,
    };
  }

  return {
    score: hasWrongSelection ? 0 : isFullScore ? maxScore : Math.min(user.length * 0.5, maxScore),
    maxScore,
    isFullScore,
  };
}

function updateScoreDiagnosisFields(question) {
  const user = normalizeAnswerToArray(question.userAnswer);
  const correct = normalizeAnswerToArray(question.correctAnswer);
  const missedOptions = correct.filter((value) => !user.includes(value));
  const overSelectedOptions = user.filter((value) => !correct.includes(value));
  const multiSelectErrorType = isMultipleQuestion(question)
    ? getMultiSelectErrorType(missedOptions, overSelectedOptions, user, correct)
    : "";
  const primaryWrongReason = question.primaryWrongReason || question.wrongReason || "";

  question.primaryWrongReason = primaryWrongReason;
  question.secondaryWrongTags = normalizeStringArray(question.secondaryWrongTags);
  question.perOptionJudgement = isMultipleQuestion(question) ? normalizePerOptionJudgement(question.perOptionJudgement) : {};
  question.missedOptions = isMultipleQuestion(question) ? missedOptions : [];
  question.overSelectedOptions = isMultipleQuestion(question) ? overSelectedOptions : [];
  question.multiSelectErrorType = multiSelectErrorType;
  question.selectedVsCorrectDiff = correct.length ? `已选 ${formatAnswer(user) || "未选"} / 正确 ${formatAnswer(correct)}` : "";
  question.learningDiagnosis = buildLearningDiagnosis(question);
  question.retestPriority = question.retestPriority || inferRetestPriority(question);
  question.reviewDueAt = question.reviewDueAt || inferReviewDueAt(question);
  question.recitationCardId = question.recitationCardId || getRecitationCardForQuestion(question)?.cardId || "";
}

function getMultiSelectErrorType(missedOptions, overSelectedOptions, user, correct) {
  if (!missedOptions.length && !overSelectedOptions.length) {
    return "";
  }
  if (!user.length || (missedOptions.length === correct.length && overSelectedOptions.length === user.length)) {
    return "全错";
  }
  if (missedOptions.length && overSelectedOptions.length) {
    return "漏选+错选";
  }
  return missedOptions.length ? "漏选" : "错选";
}

function buildLearningDiagnosis(question) {
  const parts = [
    question.primaryWrongReason || question.wrongReason || "",
    ...(normalizeStringArray(question.secondaryWrongTags)),
    question.multiSelectErrorType ? `多选${question.multiSelectErrorType}` : "",
    perOptionJudgementSummary(question),
  ].filter(Boolean);
  return parts.join(" / ");
}

function perOptionJudgementSummary(question) {
  const judgement = normalizePerOptionJudgement(question.perOptionJudgement);
  const entries = Object.entries(judgement);
  if (!entries.length) {
    return "";
  }
  return entries.map(([label, value]) => `${label}${value}`).join("、");
}

function inferRetestPriority(question) {
  if (question.status === "wrong" && isTangledQuestion(question)) {
    return "高";
  }
  if (question.status === "wrong" || question.isHighRisk || question.isGuessed || question.multiSelectErrorType) {
    return "中";
  }
  return "";
}

function inferReviewDueAt(question) {
  if (question.status !== "wrong" && !question.isHighRisk && !question.isGuessed) {
    return "";
  }
  const date = new Date();
  date.setDate(date.getDate() + (question.status === "wrong" ? 1 : 3));
  return date.toISOString().slice(0, 10);
}

function getQuestionMaxScore(question) {
  return isMultipleQuestion(question) ? 2 : 1;
}

function persistReviewMetadata(question) {
  question.riskReasons = Array.isArray(question.riskReasons) ? question.riskReasons : [];
  question.primaryWrongReason = question.primaryWrongReason || question.wrongReason || "";
  question.secondaryWrongTags = normalizeStringArray(question.secondaryWrongTags);
  question.hesitationOptions = normalizeAnswerToArray(question.hesitationOptions);
  question.eliminatedOption = normalizeAnswerToArray(question.eliminatedOption);
  question.perOptionJudgement = isMultipleQuestion(question) ? normalizePerOptionJudgement(question.perOptionJudgement) : {};
  question.reviewNotes = normalizeReviewNotes(question.reviewNotes);
  question.wrongReason = question.riskReasons[0] || question.wrongReason || null;
  question.primaryWrongReason = question.primaryWrongReason || question.wrongReason || "";
  question.learningDiagnosis = buildLearningDiagnosis(question);
  question.updatedAt = new Date().toISOString();
}

function normalizeReviewNotes(notes) {
  const source = notes && typeof notes === "object" ? notes : {};
  return Object.fromEntries(REVIEW_PROMPTS.map(([field]) => [field, String(source[field] || "")]));
}

function buildReviewSnapshot(question) {
  return {
    userAnswer: question.userAnswer ?? null,
    confidenceStatus: question.confidenceStatus ?? null,
    hesitationOptions: normalizeAnswerToArray(question.hesitationOptions),
    riskReasons: getQuestionRiskReasons(question),
    wrongReason: question.wrongReason ?? null,
    primaryWrongReason: question.primaryWrongReason || question.wrongReason || "",
    secondaryWrongTags: normalizeStringArray(question.secondaryWrongTags),
    selectedVsCorrectDiff: question.selectedVsCorrectDiff || "",
    multiSelectErrorType: question.multiSelectErrorType || "",
    learningDiagnosis: question.learningDiagnosis || "",
    reviewNotes: normalizeReviewNotes(question.reviewNotes),
    createdAt: new Date().toISOString(),
  };
}

function migrateReviewFields() {
  let changed = false;
  state.store.questions.forEach((question) => {
    const before = JSON.stringify({
      isHighRisk: question.isHighRisk,
      confidenceStatus: question.confidenceStatus,
      hesitationOptions: question.hesitationOptions,
      primaryWrongReason: question.primaryWrongReason,
      secondaryWrongTags: question.secondaryWrongTags,
      decisiveKeyword: question.decisiveKeyword,
      wrongThinking: question.wrongThinking,
      nextRule: question.nextRule,
      selectedVsCorrectDiff: question.selectedVsCorrectDiff,
      eachOptionReason: question.eachOptionReason,
      eliminatedOption: question.eliminatedOption,
      eliminationReason: question.eliminationReason,
      perOptionJudgement: question.perOptionJudgement,
      missedOptions: question.missedOptions,
      overSelectedOptions: question.overSelectedOptions,
      multiSelectErrorType: question.multiSelectErrorType,
      learningDiagnosis: question.learningDiagnosis,
      retestPriority: question.retestPriority,
      reviewDueAt: question.reviewDueAt,
      recitationCardId: question.recitationCardId,
      riskReasons: question.riskReasons,
      reviewNotes: question.reviewNotes,
      riskCertainCorrectStreak: question.riskCertainCorrectStreak,
      secondReviewStillUncertain: question.secondReviewStillUncertain,
      lastReviewSnapshot: question.lastReviewSnapshot,
    });
    question.isHighRisk = Boolean(question.isHighRisk);
    question.confidenceStatus = question.confidenceStatus || null;
    question.primaryWrongReason = question.primaryWrongReason || question.wrongReason || "";
    question.secondaryWrongTags = normalizeStringArray(question.secondaryWrongTags);
    question.hesitationOptions = question.hesitationOptions ?? "";
    question.decisiveKeyword = question.decisiveKeyword || "";
    question.wrongThinking = question.wrongThinking || "";
    question.nextRule = question.nextRule || "";
    question.selectedVsCorrectDiff = question.selectedVsCorrectDiff || "";
    question.eachOptionReason = question.eachOptionReason || "";
    question.eliminatedOption = question.eliminatedOption ?? "";
    question.eliminationReason = question.eliminationReason || "";
    question.perOptionJudgement = isMultipleQuestion(question) ? normalizePerOptionJudgement(question.perOptionJudgement) : {};
    question.missedOptions = normalizeAnswerToArray(question.missedOptions);
    question.overSelectedOptions = normalizeAnswerToArray(question.overSelectedOptions);
    question.multiSelectErrorType = question.multiSelectErrorType || "";
    question.learningDiagnosis = question.learningDiagnosis || "";
    question.retestPriority = question.retestPriority || "";
    question.reviewDueAt = question.reviewDueAt || "";
    question.recitationCardId = question.recitationCardId || getRecitationCardForQuestion(question)?.cardId || "";
    question.riskReasons = Array.isArray(question.riskReasons)
      ? question.riskReasons.filter(Boolean)
      : question.wrongReason
        ? [question.wrongReason]
        : [];
    question.reviewNotes = normalizeReviewNotes(question.reviewNotes);
    question.riskCertainCorrectStreak = Number(question.riskCertainCorrectStreak) || 0;
    question.secondReviewStillUncertain = Boolean(question.secondReviewStillUncertain);
    question.lastReviewSnapshot = question.lastReviewSnapshot || null;
    const after = JSON.stringify({
      isHighRisk: question.isHighRisk,
      confidenceStatus: question.confidenceStatus,
      hesitationOptions: question.hesitationOptions,
      primaryWrongReason: question.primaryWrongReason,
      secondaryWrongTags: question.secondaryWrongTags,
      decisiveKeyword: question.decisiveKeyword,
      wrongThinking: question.wrongThinking,
      nextRule: question.nextRule,
      selectedVsCorrectDiff: question.selectedVsCorrectDiff,
      eachOptionReason: question.eachOptionReason,
      eliminatedOption: question.eliminatedOption,
      eliminationReason: question.eliminationReason,
      perOptionJudgement: question.perOptionJudgement,
      missedOptions: question.missedOptions,
      overSelectedOptions: question.overSelectedOptions,
      multiSelectErrorType: question.multiSelectErrorType,
      learningDiagnosis: question.learningDiagnosis,
      retestPriority: question.retestPriority,
      reviewDueAt: question.reviewDueAt,
      recitationCardId: question.recitationCardId,
      riskReasons: question.riskReasons,
      reviewNotes: question.reviewNotes,
      riskCertainCorrectStreak: question.riskCertainCorrectStreak,
      secondReviewStillUncertain: question.secondReviewStillUncertain,
      lastReviewSnapshot: question.lastReviewSnapshot,
    });
    if (before !== after) {
      changed = true;
    }
  });
  if (changed) {
    persistTimingOnly();
  }
}

function refreshAnsweredQuestionScores() {
  let changed = false;
  state.store.questions.forEach((question) => {
    if (!hasUserAnswer(question) || !hasCorrectAnswer(question)) {
      return;
    }
    const before = JSON.stringify({
      status: question.status,
      isWrong: question.isWrong,
      score: question.score,
      maxScore: question.maxScore,
      wrongReason: question.wrongReason,
      isGuessed: question.isGuessed,
      guessReason: question.guessReason,
      isHighRisk: question.isHighRisk,
      confidenceStatus: question.confidenceStatus,
      hesitationOptions: question.hesitationOptions,
      primaryWrongReason: question.primaryWrongReason,
      secondaryWrongTags: question.secondaryWrongTags,
      selectedVsCorrectDiff: question.selectedVsCorrectDiff,
      missedOptions: question.missedOptions,
      overSelectedOptions: question.overSelectedOptions,
      multiSelectErrorType: question.multiSelectErrorType,
      learningDiagnosis: question.learningDiagnosis,
      retestPriority: question.retestPriority,
      reviewDueAt: question.reviewDueAt,
      recitationCardId: question.recitationCardId,
      riskReasons: question.riskReasons,
      riskCertainCorrectStreak: question.riskCertainCorrectStreak,
      secondReviewStillUncertain: question.secondReviewStillUncertain,
    });
    gradeQuestion(question);
    const after = JSON.stringify({
      status: question.status,
      isWrong: question.isWrong,
      score: question.score,
      maxScore: question.maxScore,
      wrongReason: question.wrongReason,
      isGuessed: question.isGuessed,
      guessReason: question.guessReason,
      isHighRisk: question.isHighRisk,
      confidenceStatus: question.confidenceStatus,
      hesitationOptions: question.hesitationOptions,
      primaryWrongReason: question.primaryWrongReason,
      secondaryWrongTags: question.secondaryWrongTags,
      selectedVsCorrectDiff: question.selectedVsCorrectDiff,
      missedOptions: question.missedOptions,
      overSelectedOptions: question.overSelectedOptions,
      multiSelectErrorType: question.multiSelectErrorType,
      learningDiagnosis: question.learningDiagnosis,
      retestPriority: question.retestPriority,
      reviewDueAt: question.reviewDueAt,
      recitationCardId: question.recitationCardId,
      riskReasons: question.riskReasons,
      riskCertainCorrectStreak: question.riskCertainCorrectStreak,
      secondReviewStillUncertain: question.secondReviewStillUncertain,
    });
    if (before !== after) {
      changed = true;
    }
  });

  if (changed) {
    persistStore();
  }
}

function updatePracticeTimerState() {
  if (state.currentView !== "paper" || !state.currentPaperId) {
    stopPracticeTimer();
    return;
  }

  startPracticeTimer(state.currentPaperId);
  updateTimingDisplay();
}

function startPracticeTimer(paperId) {
  const runtime = state.timingRuntime;
  if (runtime.activePaperId !== paperId) {
    runtime.activePaperId = paperId;
    runtime.activeQuestionKey = getActiveQuestionKey();
    runtime.lastTickAt = Date.now();
    runtime.lastPersistAt = runtime.lastTickAt;
  }

  getPaperTiming(paperId);
  if (runtime.timerId) {
    return;
  }

  runtime.timerId = window.setInterval(() => {
    tickPracticeTimer();
    updateTimingDisplay();
  }, 1000);
}

function stopPracticeTimer() {
  tickPracticeTimer();
  if (state.timingRuntime.timerId) {
    window.clearInterval(state.timingRuntime.timerId);
  }
  state.timingRuntime.timerId = null;
  state.timingRuntime.activePaperId = null;
  state.timingRuntime.activeQuestionKey = null;
  state.timingRuntime.lastTickAt = null;
  state.timingRuntime.lastPersistAt = null;
  persistTimingOnly();
}

function tickPracticeTimer() {
  const runtime = state.timingRuntime;
  if (!runtime.activePaperId || !runtime.lastTickAt) {
    return;
  }

  const now = Date.now();
  const elapsedSeconds = Math.max(0, Math.min(5, Math.floor((now - runtime.lastTickAt) / 1000)));
  if (elapsedSeconds <= 0) {
    return;
  }

  runtime.lastTickAt = now;
  if (document.visibilityState !== "visible") {
    return;
  }

  const timing = getPaperTiming(runtime.activePaperId);
  const activeQuestionKey = getActiveQuestionKey() || runtime.activeQuestionKey;
  timing.totalSeconds = Math.max(0, Math.round(Number(timing.totalSeconds) || 0)) + elapsedSeconds;
  if (activeQuestionKey) {
    timing.questionSeconds[activeQuestionKey] =
      Math.max(0, Math.round(Number(timing.questionSeconds[activeQuestionKey]) || 0)) + elapsedSeconds;
  }
  runtime.activeQuestionKey = activeQuestionKey;

  if (!runtime.lastPersistAt || now - runtime.lastPersistAt >= 10000) {
    runtime.lastPersistAt = now;
    persistTimingOnly();
  }
}

function getActiveQuestionKey() {
  const cards = [...document.querySelectorAll("#paper-question-list [data-question-card='true']")];
  if (!cards.length) {
    return null;
  }

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const ranked = cards
    .map((card) => {
      const rect = card.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(viewportHeight, rect.bottom);
      return {
        key: card.dataset.questionKey || null,
        visibleHeight: Math.max(0, visibleBottom - visibleTop),
        distanceFromFocus: Math.abs(rect.top - viewportHeight * 0.28),
      };
    })
    .filter((item) => item.key && item.visibleHeight > 0)
    .sort((left, right) => right.visibleHeight - left.visibleHeight || left.distanceFromFocus - right.distanceFromFocus);

  return ranked[0]?.key || null;
}

function getTimingStore() {
  if (!state.store.timing || typeof state.store.timing !== "object") {
    state.store.timing = { papers: {} };
  }
  if (!state.store.timing.papers || typeof state.store.timing.papers !== "object") {
    state.store.timing.papers = {};
  }
  return state.store.timing;
}

function getPaperTiming(paperId) {
  const timing = getTimingStore();
  if (!timing.papers[paperId] || typeof timing.papers[paperId] !== "object") {
    timing.papers[paperId] = {
      totalSeconds: 0,
      questionSeconds: {},
      startedAt: new Date().toISOString(),
    };
  }
  if (!timing.papers[paperId].questionSeconds || typeof timing.papers[paperId].questionSeconds !== "object") {
    timing.papers[paperId].questionSeconds = {};
  }
  timing.papers[paperId].updatedAt = new Date().toISOString();
  return timing.papers[paperId];
}

function updateTimingDisplay() {
  if (elements.globalTimingPanel && !elements.globalTimingPanel.hidden) {
    const papers = [...state.store.papers].sort((a, b) => {
      return String(b.paperId).localeCompare(String(a.paperId), "zh-CN", { numeric: true });
    });
    const globalTimingStats = getGlobalTimingStats(papers);
    const globalTotalNode = elements.globalTimingPanel.querySelector("[data-global-total-time]");
    const globalSlowestNode = elements.globalTimingPanel.querySelector("[data-global-slowest-list]");
    if (globalTotalNode) {
      globalTotalNode.textContent = formatDuration(globalTimingStats.totalSeconds);
    }
    if (globalSlowestNode) {
      globalSlowestNode.innerHTML = globalTimingListMarkup(globalTimingStats.entries);
    }
  }

  if (state.currentView !== "paper" || !state.currentPaperId || !elements.paperTimingPanel) {
    return;
  }

  const timingStats = getPaperTimingStats(state.currentPaperId);
  const totalNode = elements.paperTimingPanel.querySelector("[data-paper-total-time]");
  const slowestNode = elements.paperTimingPanel.querySelector("[data-paper-slowest-list]");
  if (totalNode) {
    totalNode.textContent = formatDuration(timingStats.totalSeconds);
  }
  if (slowestNode) {
    slowestNode.innerHTML = timingSlowestListMarkup(timingStats.slowestEntries);
  }
}

function persistTimingOnly() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}时${String(minutes).padStart(2, "0")}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${String(restSeconds).padStart(2, "0")}秒`;
  }
  return `${restSeconds}秒`;
}

function loadStore() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { papers: [], questions: [], timing: { papers: {} }, recitationCards: [], abnormalQuestions: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      papers: Array.isArray(parsed.papers) ? parsed.papers : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      timing: parsed.timing && typeof parsed.timing === "object" ? parsed.timing : { papers: {} },
      recitationCards: Array.isArray(parsed.recitationCards) ? parsed.recitationCards.map(normalizeRecitationCard) : [],
      abnormalQuestions: Array.isArray(parsed.abnormalQuestions) ? parsed.abnormalQuestions.map((item) => normalizeAbnormalItem(item)) : [],
    };
  } catch {
    return { papers: [], questions: [], timing: { papers: {} }, recitationCards: [], abnormalQuestions: [] };
  }
}

function persistStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
  void scheduleWrongExport();
}

function backupStoreBeforeAutoImport(reason) {
  if (!state.store || (!state.store.papers?.length && !state.store.questions?.length)) {
    return;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY) || JSON.stringify(state.store);
    const backups = JSON.parse(localStorage.getItem(STORE_BACKUP_KEY) || "[]");
    const nextBackups = Array.isArray(backups) ? backups : [];
    nextBackups.unshift({
      createdAt: new Date().toISOString(),
      reason,
      paperCount: Array.isArray(state.store.papers) ? state.store.papers.length : 0,
      questionCount: Array.isArray(state.store.questions) ? state.store.questions.length : 0,
      answeredCount: Array.isArray(state.store.questions)
        ? state.store.questions.filter((question) => question.status !== "unanswered").length
        : 0,
      data: raw,
    });
    localStorage.setItem(STORE_BACKUP_KEY, JSON.stringify(nextBackups.slice(0, MAX_STORE_BACKUPS)));
  } catch (error) {
    console.warn("自动导入前备份失败", error);
  }
}

function getQuestionProgressSnapshot(question) {
  if (!question) {
    return {
      status: "unanswered",
      userAnswer: null,
      score: null,
      maxScore: null,
      isWrong: false,
      wrongReason: null,
      primaryWrongReason: "",
      secondaryWrongTags: [],
      isGuessed: false,
      guessReason: null,
      isHighRisk: false,
      confidenceStatus: null,
      hesitationOptions: "",
      decisiveKeyword: "",
      wrongThinking: "",
      nextRule: "",
      selectedVsCorrectDiff: "",
      eachOptionReason: "",
      eliminatedOption: "",
      eliminationReason: "",
      perOptionJudgement: {},
      missedOptions: [],
      overSelectedOptions: [],
      multiSelectErrorType: "",
      learningDiagnosis: "",
      retestPriority: "",
      reviewDueAt: "",
      recitationCardId: "",
      riskReasons: [],
      reviewNotes: normalizeReviewNotes(null),
      riskCertainCorrectStreak: 0,
      secondReviewStillUncertain: false,
      lastReviewSnapshot: null,
      updatedAt: null,
    };
  }

  return {
    status: question.status ?? "unanswered",
    userAnswer: question.userAnswer ?? null,
    score: question.score ?? null,
    maxScore: question.maxScore ?? null,
    isWrong: question.isWrong ?? false,
    wrongReason: question.wrongReason ?? null,
    primaryWrongReason: question.primaryWrongReason || question.wrongReason || "",
    secondaryWrongTags: normalizeStringArray(question.secondaryWrongTags),
    isGuessed: question.isGuessed ?? false,
    guessReason: question.guessReason ?? null,
    isHighRisk: question.isHighRisk ?? false,
    confidenceStatus: question.confidenceStatus ?? null,
    hesitationOptions: question.hesitationOptions ?? "",
    decisiveKeyword: question.decisiveKeyword || "",
    wrongThinking: question.wrongThinking || "",
    nextRule: question.nextRule || "",
    selectedVsCorrectDiff: question.selectedVsCorrectDiff || "",
    eachOptionReason: question.eachOptionReason || "",
    eliminatedOption: question.eliminatedOption || "",
    eliminationReason: question.eliminationReason || "",
    perOptionJudgement: normalizePerOptionJudgement(question.perOptionJudgement),
    missedOptions: normalizeAnswerToArray(question.missedOptions),
    overSelectedOptions: normalizeAnswerToArray(question.overSelectedOptions),
    multiSelectErrorType: question.multiSelectErrorType || "",
    learningDiagnosis: question.learningDiagnosis || "",
    retestPriority: question.retestPriority || "",
    reviewDueAt: question.reviewDueAt || "",
    recitationCardId: question.recitationCardId || "",
    riskReasons: Array.isArray(question.riskReasons) ? question.riskReasons : [],
    reviewNotes: normalizeReviewNotes(question.reviewNotes),
    riskCertainCorrectStreak: question.riskCertainCorrectStreak ?? 0,
    secondReviewStillUncertain: question.secondReviewStillUncertain ?? false,
    lastReviewSnapshot: question.lastReviewSnapshot ?? null,
    updatedAt: question.updatedAt ?? null,
  };
}

function getFixedAutoImportBundle() {
  if (typeof window === "undefined" || !window.__AUTO_IMPORT_BUNDLE__) {
    return null;
  }
  return window.__AUTO_IMPORT_BUNDLE__;
}

function applyFixedAutoImportBundle() {
  const bundle = getFixedAutoImportBundle();
  if (!bundle) {
    return;
  }

  const version = String(bundle.version || "").trim();
  if (version && localStorage.getItem(AUTOLOAD_BUNDLE_VERSION_KEY) === version) {
    if (shouldReapplyFixedAutoImportBundle(bundle)) {
      backupStoreBeforeAutoImport(`reapply-fixed-bundle:${version}`);
      localStorage.removeItem(AUTOLOAD_BUNDLE_VERSION_KEY);
      applyFixedAutoImportBundle();
      return;
    }

    state.autoImport.enabled = true;
    state.autoImport.paperFolderName ||= "Downloads";
    state.autoImport.answerFolderName ||= "答案解";
    state.autoImport.lastScanAt ||= bundle.generatedAt || "";
    state.autoImport.lastResult ||= formatFixedAutoImportResult(bundle.report);
    return;
  }

  backupStoreBeforeAutoImport(`apply-fixed-bundle:${version || "unknown"}`);

  let importedCount = 0;
  let errorCount = 0;

  for (const payload of Array.isArray(bundle.papers) ? bundle.papers : []) {
    try {
      importPaper(payload);
      importedCount += 1;
    } catch {
      errorCount += 1;
    }
  }

  for (const payload of Array.isArray(bundle.answers) ? bundle.answers : []) {
    try {
      importAnswers(payload);
      importedCount += 1;
    } catch {
      errorCount += 1;
    }
  }

  state.autoImport.enabled = true;
  state.autoImport.paperFolderName = "Downloads";
  state.autoImport.answerFolderName = "答案解";
  state.autoImport.lastScanAt = bundle.generatedAt || new Date().toISOString();
  state.autoImport.lastResult =
    formatFixedAutoImportResult(bundle.report) +
    `，当前已导入 ${importedCount} 个文件，错误 ${errorCount} 个`;
  state.autoImport.lastError = bundle.report?.errors?.length
    ? bundle.report.errors.map((item) => `${item.file}: ${item.error}`).join(" | ")
    : "";
  persistAutoImportSettings();
  if (version) {
    localStorage.setItem(AUTOLOAD_BUNDLE_VERSION_KEY, version);
  }
}

function formatFixedAutoImportResult(report) {
  if (!report) {
    return "";
  }

  return `题本 ${report.importedPaperCount ?? report.paperFileCount ?? 0}，解析 ${
    report.importedAnswerCount ?? report.answerFileCount ?? 0
  }，构建错误 ${report.errors?.length || 0}`;
}

function shouldReapplyFixedAutoImportBundle(bundle) {
  const bundledQuestions = (Array.isArray(bundle.papers) ? bundle.papers : []).flatMap((paper) =>
    Array.isArray(paper.questions) ? paper.questions : []
  );

  const currentQuestionMap = new Map(state.store.questions.map((question) => [questionKey(question), question]));
  const questionNeedsReapply = bundledQuestions.some((bundledQuestion) => {
    const currentQuestion = currentQuestionMap.get(questionKey(bundledQuestion));
    if (!currentQuestion) {
      return true;
    }
    if (validateParsedQuestion(currentQuestion).length > 0) {
      return true;
    }
    return !hasSameQuestionContent(currentQuestion, bundledQuestion);
  });
  if (questionNeedsReapply) {
    return true;
  }

  return fixedAnswerBundleNeedsReapply(bundle);
}

function fixedAnswerBundleNeedsReapply(bundle) {
  const bundledAnswers = Array.isArray(bundle.answers) ? bundle.answers : [];
  if (!bundledAnswers.length) {
    return false;
  }

  const currentQuestionMap = new Map(
    state.store.questions.map((question) => [
      `${question.paperId}::${normalizeQuestionNo(question.questionNo)}`,
      question,
    ])
  );

  return bundledAnswers.some((answerPayload) => {
    const paperId = String(answerPayload.paperId || "").trim();
    if (!paperId || !Array.isArray(answerPayload.answers) || answerPayload.answers.length === 0) {
      return false;
    }

    return answerPayload.answers.some((answer) => {
      const currentQuestion = currentQuestionMap.get(
        `${paperId}::${normalizeQuestionNo(answer.questionNo)}`
      );
      if (!currentQuestion) {
        return false;
      }
      return normalizeAnswerValue(currentQuestion.correctAnswer) !== normalizeAnswerValue(answer.correctAnswer);
    });
  });
}

function hasSameQuestionContent(currentQuestion, bundledQuestion) {
  if (normalizeComparableText(currentQuestion.stem) !== normalizeComparableText(bundledQuestion.stem)) {
    return false;
  }

  const currentOptions = Array.isArray(currentQuestion.options) ? currentQuestion.options : [];
  const bundledOptions = Array.isArray(bundledQuestion.options) ? bundledQuestion.options : [];
  if (currentOptions.length !== bundledOptions.length) {
    return false;
  }

  return bundledOptions.every((option, index) => {
    const currentOption = currentOptions[index] || {};
    return (
      String(currentOption.label || "") === String(option.label || "") &&
      normalizeComparableText(currentOption.text) === normalizeComparableText(option.text)
    );
  });
}

function normalizeComparableText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function loadAutoImportSettings() {
  const raw = localStorage.getItem(AUTO_IMPORT_SETTINGS_KEY);
  const defaults = {
    enabled: false,
    folderName: "",
    paperFolderName: "",
    answerFolderName: "",
    importedFiles: {},
    lastScanAt: "",
    lastResult: "",
    lastError: "",
    directoryHandle: null,
    paperDirectoryHandle: null,
    answerDirectoryHandle: null,
    handleReady: false,
    paperHandleReady: false,
    answerHandleReady: false,
    scanInFlight: false,
  };

  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      directoryHandle: null,
      paperDirectoryHandle: null,
      answerDirectoryHandle: null,
      handleReady: false,
      paperHandleReady: false,
      answerHandleReady: false,
      scanInFlight: false,
    };
  } catch {
    return defaults;
  }
}

function persistAutoImportSettings() {
  localStorage.setItem(
    AUTO_IMPORT_SETTINGS_KEY,
    JSON.stringify({
      enabled: state.autoImport.enabled,
      folderName: state.autoImport.folderName,
      paperFolderName: state.autoImport.paperFolderName,
      answerFolderName: state.autoImport.answerFolderName,
      importedFiles: state.autoImport.importedFiles,
      lastScanAt: state.autoImport.lastScanAt,
      lastResult: state.autoImport.lastResult,
      lastError: state.autoImport.lastError,
    })
  );
}

function renderAutoImportStatus() {
  const fixedBundle = getFixedAutoImportBundle();
  const supportText = fixedBundle
    ? "已内置一批题本/答案；后续新增 PDF 需要绑定 Finder 里的 Downloads 或“答案解”"
    : isDirectoryAccessSupported()
      ? "支持自动导入（选择 Downloads、答案解或错题解）"
      : "当前浏览器不支持目录读取，请使用 Chromium 浏览器并通过 localhost 访问";

  const detail = state.autoImport.enabled
    ? `题本目录：${state.autoImport.paperFolderName || "未绑定"}` +
      ` · 解析目录：${state.autoImport.answerFolderName || "未绑定"}` +
      `${state.autoImport.lastScanAt ? ` · 最近扫描：${formatDateTime(state.autoImport.lastScanAt)}` : ""}` +
      `${state.autoImport.lastResult ? ` · 最近结果：${state.autoImport.lastResult}` : ""}` +
      `${state.autoImport.lastError ? ` · 最近错误：${state.autoImport.lastError}` : ""}`
    : "未开启自动导入";

  elements.importFolderStatus.textContent = `${supportText} · ${detail}`;
}

function isDirectoryAccessSupported() {
  return window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

function hasAnyConfiguredImportDirectory() {
  return Boolean(
    state.autoImport.paperDirectoryHandle ||
      state.autoImport.answerDirectoryHandle ||
      state.autoImport.paperHandleReady ||
      state.autoImport.answerHandleReady ||
      state.autoImport.paperFolderName ||
      state.autoImport.answerFolderName
  );
}

async function configureAutoImportFolder() {
  if (!isDirectoryAccessSupported()) {
    throw new Error("当前浏览器不支持目录读取。请使用 Chromium 浏览器并通过 localhost 访问。");
  }

  return withDirectoryPickerLock(async () => {
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await ensureDirectoryPermission(directoryHandle);
    state.autoImport.enabled = true;
    state.autoImport.folderName = directoryHandle.name || "导入目录";
    if (isAnswerImportFolder(directoryHandle.name)) {
      await saveHandle("autoImportAnswerDir", directoryHandle);
      state.autoImport.answerDirectoryHandle = directoryHandle;
      state.autoImport.answerHandleReady = true;
      state.autoImport.answerFolderName = directoryHandle.name || "解析目录";
    } else {
      await saveHandle("autoImportPaperDir", directoryHandle);
      state.autoImport.paperDirectoryHandle = directoryHandle;
      state.autoImport.paperHandleReady = true;
      state.autoImport.paperFolderName = directoryHandle.name || "题本目录";
    }
    state.autoImport.lastError = "";
    persistAutoImportSettings();
    await scanConfiguredImportFolder("manual");
    return true;
  });
}

async function disableAutoImportFolder() {
  state.autoImport.enabled = false;
  state.autoImport.directoryHandle = null;
  state.autoImport.paperDirectoryHandle = null;
  state.autoImport.answerDirectoryHandle = null;
  state.autoImport.handleReady = false;
  state.autoImport.paperHandleReady = false;
  state.autoImport.answerHandleReady = false;
  state.autoImport.folderName = "";
  state.autoImport.paperFolderName = "";
  state.autoImport.answerFolderName = "";
  state.autoImport.lastError = "";
  persistAutoImportSettings();
  await clearHandle("autoImportDir");
  await clearHandle("autoImportPaperDir");
  await clearHandle("autoImportAnswerDir");
}

async function hydrateAutoImportHandle() {
  const legacyHandle = await loadHandle("autoImportDir");
  const paperHandle = (await loadHandle("autoImportPaperDir")) || (!state.autoImport.paperFolderName ? legacyHandle : null);
  const answerHandle = await loadHandle("autoImportAnswerDir");

  if (paperHandle) {
    state.autoImport.paperDirectoryHandle = paperHandle;
    state.autoImport.paperHandleReady = true;
    if (!state.autoImport.paperFolderName) {
      state.autoImport.paperFolderName = paperHandle.name || "";
    }
  }
  if (answerHandle) {
    state.autoImport.answerDirectoryHandle = answerHandle;
    state.autoImport.answerHandleReady = true;
    if (!state.autoImport.answerFolderName) {
      state.autoImport.answerFolderName = answerHandle.name || "";
    }
  }
  state.autoImport.handleReady = state.autoImport.paperHandleReady || state.autoImport.answerHandleReady;
  if (!state.autoImport.folderName) {
    state.autoImport.folderName = state.autoImport.paperFolderName || state.autoImport.answerFolderName || "";
  }
  if (paperHandle || answerHandle) {
    persistAutoImportSettings();
  }
  if (state.autoImport.enabled && (paperHandle || answerHandle)) {
    void scanConfiguredImportFolder("auto");
  }
  renderApp();
}

async function scanConfiguredImportFolder(mode = "auto") {
  if (!state.autoImport.enabled) {
    throw new Error("尚未开启自动导入。");
  }
  if (state.autoImport.scanInFlight) {
    return { importedCount: 0, skippedCount: 0, details: [] };
  }

  const legacyHandle = await loadHandle("autoImportDir");
  const paperDirectoryHandle =
    state.autoImport.paperDirectoryHandle || (await loadHandle("autoImportPaperDir")) || legacyHandle;
  const answerDirectoryHandle =
    state.autoImport.answerDirectoryHandle || (await loadHandle("autoImportAnswerDir"));
  if (!paperDirectoryHandle && !answerDirectoryHandle) {
    throw new Error("还没有绑定导入目录。");
  }
  if (paperDirectoryHandle) {
    await ensureDirectoryPermission(paperDirectoryHandle);
    state.autoImport.paperDirectoryHandle = paperDirectoryHandle;
    state.autoImport.paperHandleReady = true;
    state.autoImport.paperFolderName ||= paperDirectoryHandle.name || "";
  }
  if (answerDirectoryHandle) {
    await ensureDirectoryPermission(answerDirectoryHandle);
    state.autoImport.answerDirectoryHandle = answerDirectoryHandle;
    state.autoImport.answerHandleReady = true;
    state.autoImport.answerFolderName ||= answerDirectoryHandle.name || "";
  }
  state.autoImport.handleReady = state.autoImport.paperHandleReady || state.autoImport.answerHandleReady;
  state.autoImport.scanInFlight = true;

  try {
    const entries = [];
    if (paperDirectoryHandle) {
      entries.push(...(await collectImportableEntries(paperDirectoryHandle, state.autoImport.paperFolderName || "Downloads")));
    }
    if (answerDirectoryHandle) {
      entries.push(...(await collectImportableEntries(answerDirectoryHandle, state.autoImport.answerFolderName || "答案解")));
    }
    const classified = await classifyImportEntries(entries);
    const queue = [...classified.papers, ...classified.answers];
    let importedCount = 0;
    let skippedCount = 0;
    const details = [];

    for (const item of queue) {
      const signature = await buildImportSignature(item.fileHandle, item.relativePath, item.kind);
      if (state.autoImport.importedFiles[item.relativePath] === signature) {
        skippedCount += 1;
        details.push({ path: item.relativePath, kind: item.kind, result: "skipped" });
        continue;
      }

      try {
        const file = await item.fileHandle.getFile();
        const result = item.kind === "paper" ? await importPaperFile(file) : await importAnswerFile(file);
        state.autoImport.importedFiles[item.relativePath] = signature;
        importedCount += 1;
        details.push({
          path: item.relativePath,
          kind: item.kind,
          result: "imported",
          paperTitle: result.paperTitle,
        });
      } catch (error) {
        details.push({
          path: item.relativePath,
          kind: item.kind,
          result: "error",
          error: error.message,
        });
      }
    }

    state.autoImport.lastScanAt = new Date().toISOString();
    state.autoImport.lastError = "";
    state.autoImport.lastResult =
      `题本 ${classified.papers.length}，解析 ${classified.answers.length}，导入 ${importedCount}，` +
      `跳过 ${skippedCount}，错误 ${details.filter((item) => item.result === "error").length}`;
    persistAutoImportSettings();
    persistStore();
    renderApp();
    if (mode === "manual") {
      console.group("auto-import-scan");
      console.log(details);
      console.groupEnd();
    }
    return { importedCount, skippedCount, details };
  } catch (error) {
    state.autoImport.lastError = error.message;
    persistAutoImportSettings();
    throw error;
  } finally {
    state.autoImport.scanInFlight = false;
  }
}

async function collectImportableEntries(directoryHandle, parentPath = "") {
  const entries = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "directory") {
      entries.push(...(await collectImportableEntries(handle, relativePath)));
      continue;
    }
    if (!/\.(pdf|json)$/i.test(name)) {
      continue;
    }
    entries.push({ relativePath, fileHandle: handle });
  }

  return entries;
}

async function classifyImportEntries(entries) {
  const papers = [];
  const answers = [];

  for (const entry of entries) {
    const sourceHint = inferAutoImportSource(entry.relativePath);
    if (!sourceHint) {
      continue;
    }
    if (!shouldIncludeAutoImportEntry(entry.relativePath, sourceHint)) {
      continue;
    }

    const kind = await inferImportKind(entry.fileHandle, entry.relativePath);
    if (!kind) {
      continue;
    }
    const target = { ...entry, kind };
    if (kind === "paper") {
      papers.push(target);
    } else {
      answers.push(target);
    }
  }

  return {
    papers: papers.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN")),
    answers: answers.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN")),
  };
}

async function inferImportKind(fileHandle, relativePath) {
  const sourceHint = inferAutoImportSource(relativePath);
  if (sourceHint && shouldIncludeAutoImportEntry(relativePath, sourceHint)) {
    return sourceHint;
  }

  const file = await fileHandle.getFile();
  const lowerPath = relativePath.toLowerCase();
  if (lowerPath.endsWith(".json")) {
    try {
      const payload = JSON.parse(await file.text());
      if (Array.isArray(payload.questions)) {
        return "paper";
      }
      if (Array.isArray(payload.answers)) {
        return "answer";
      }
    } catch {
      return null;
    }
  }

  if (/答案|解析/.test(relativePath)) {
    return "answer";
  }
  if (/题本/.test(relativePath)) {
    return "paper";
  }
  if (/刷题/.test(relativePath)) {
    return "paper";
  }
  return null;
}

function inferAutoImportSource(relativePath) {
  const segments = String(relativePath || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const folderSegments = segments.slice(0, -1);
  const fileName = segments[segments.length - 1] || "";

  if (
    folderSegments.some((segment) => segment.includes("答案解")) ||
    folderSegments.some((segment) => segment.includes("错题解")) ||
    folderSegments.some((segment) => segment.includes("答案解析"))
  ) {
    return "answer";
  }

  if (
    folderSegments.some((segment) => /^downloads?$/i.test(segment)) ||
    folderSegments.some((segment) => segment.includes("下载"))
  ) {
    return "paper";
  }

  if (folderSegments.length === 0) {
    if (/答案|解析/.test(fileName)) {
      return "answer";
    }
    if (/题本|刷题/.test(fileName)) {
      return "paper";
    }
  }

  return null;
}

function isAnswerImportFolder(name) {
  return /答案解|错题解|答案解析/.test(String(name || ""));
}

function shouldIncludeAutoImportEntry(relativePath, sourceHint) {
  const segments = String(relativePath || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fileName = segments[segments.length - 1] || "";
  const isCurrentAffairs = /时政刷题|公基时政刷题|模考/.test(fileName);

  if (sourceHint === "paper") {
    return isCurrentAffairs && /题本/.test(fileName);
  }

  if (sourceHint === "answer") {
    return /答案|解析/.test(fileName) && (isCurrentAffairs || isAnswerImportFolder(segments[0] || ""));
  }

  return false;
}

async function buildImportSignature(fileHandle, relativePath, kind) {
  const file = await fileHandle.getFile();
  return JSON.stringify({
    relativePath,
    kind,
    size: file.size,
    lastModified: file.lastModified,
  });
}

function loadWrongExportSettings() {
  const raw = localStorage.getItem(WRONG_EXPORT_SETTINGS_KEY);
  const defaults = {
    enabled: false,
    fileName: "wrong-questions-latest.json",
    folderName: "",
    lastExportAt: "",
    lastError: "",
    handleReady: false,
    directoryHandle: null,
    exportInFlight: false,
  };

  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      directoryHandle: null,
      exportInFlight: false,
      handleReady: false,
    };
  } catch {
    return defaults;
  }
}

function persistWrongExportSettings() {
  localStorage.setItem(
    WRONG_EXPORT_SETTINGS_KEY,
    JSON.stringify({
      enabled: state.wrongExport.enabled,
      fileName: state.wrongExport.fileName,
      folderName: state.wrongExport.folderName,
      lastExportAt: state.wrongExport.lastExportAt,
      lastError: state.wrongExport.lastError,
    })
  );
}

function renderWrongExportStatus() {
  elements.icloudExportStatus.hidden = false;
  const supportText = isWrongExportSupported()
    ? "支持自动导出"
    : "当前浏览器不支持自动写入目录，请改用 Chromium 浏览器访问 localhost";

  const status = state.wrongExport.enabled
    ? `已绑定目录：${state.wrongExport.folderName || "未命名目录"} · 文件名：${state.wrongExport.fileName}` +
      `${state.wrongExport.lastExportAt ? ` · 最近同步：${formatDateTime(state.wrongExport.lastExportAt)}` : ""}` +
      `${state.wrongExport.lastError ? ` · 最近错误：${state.wrongExport.lastError}` : ""}`
    : "未开启 iCloud 自动导出";

  elements.icloudExportStatus.textContent = `${supportText} · ${status}`;
}

function isWrongExportSupported() {
  return window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

async function configureIcloudWrongExport() {
  if (!isWrongExportSupported()) {
    throw new Error("当前浏览器不支持目录写入。请使用 Chromium 浏览器并通过 localhost 访问。");
  }

  return withDirectoryPickerLock(async () => {
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await ensureDirectoryPermission(directoryHandle);
    await saveWrongExportHandle(directoryHandle);
    state.wrongExport.directoryHandle = directoryHandle;
    state.wrongExport.handleReady = true;
    state.wrongExport.enabled = true;
    state.wrongExport.folderName = directoryHandle.name || "iCloud";
    state.wrongExport.lastError = "";
    persistWrongExportSettings();
    await exportWrongQuestionsToConfiguredDirectory("manual");
    return true;
  });
}

async function disableWrongExport() {
  state.wrongExport.enabled = false;
  state.wrongExport.directoryHandle = null;
  state.wrongExport.handleReady = false;
  state.wrongExport.folderName = "";
  state.wrongExport.lastError = "";
  persistWrongExportSettings();
  await clearWrongExportHandle();
}

async function hydrateWrongExportHandle() {
  const handle = await loadWrongExportHandle();
  if (!handle) {
    return;
  }

  state.wrongExport.directoryHandle = handle;
  state.wrongExport.handleReady = true;
  if (!state.wrongExport.folderName) {
    state.wrongExport.folderName = handle.name || "";
    persistWrongExportSettings();
  }
  renderApp();
}

async function scheduleWrongExport() {
  if (!state.wrongExport.enabled || state.wrongExport.exportInFlight) {
    return;
  }

  try {
    await exportWrongQuestionsToConfiguredDirectory("auto");
  } catch (error) {
    state.wrongExport.lastError = error.message;
    persistWrongExportSettings();
    renderApp();
  }
}

async function exportWrongQuestionsToConfiguredDirectory(mode = "auto") {
  if (!state.wrongExport.enabled) {
    throw new Error("尚未开启自动导出。");
  }

  const directoryHandle = state.wrongExport.directoryHandle || (await loadWrongExportHandle());
  if (!directoryHandle) {
    throw new Error("还没有绑定 iCloud 目录。");
  }

  await ensureDirectoryPermission(directoryHandle);
  state.wrongExport.directoryHandle = directoryHandle;
  state.wrongExport.handleReady = true;
  state.wrongExport.exportInFlight = true;

  try {
    const fileHandle = await directoryHandle.getFileHandle(state.wrongExport.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(buildWrongExportPayload(), null, 2));
    await writable.close();
    state.wrongExport.lastExportAt = new Date().toISOString();
    state.wrongExport.lastError = "";
    persistWrongExportSettings();
    if (mode === "manual") {
      renderApp();
    }
  } finally {
    state.wrongExport.exportInFlight = false;
  }
}

function buildWrongExportPayload() {
  return {
    exportedAt: new Date().toISOString(),
    totalWrongQuestions: state.store.questions.filter((question) => question.isWrong).length,
    questions: state.store.questions
      .filter((question) => question.isWrong)
      .sort(questionSorter)
      .map((question) => ({
        paperId: question.paperId,
        paperTitle: question.paperTitle,
        questionNo: question.questionNo,
        type: question.type,
        module: question.module,
        stem: question.stem,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        status: question.status,
        userAnswer: question.userAnswer,
        isWrong: question.isWrong,
        wrongReason: question.wrongReason,
        updatedAt: question.updatedAt,
      })),
  };
}

function exposeWrongExportDebug() {
  window.__wrongExportDebug = {
    setDirectoryHandle: async (directoryHandle) => {
      state.wrongExport.directoryHandle = directoryHandle;
      state.wrongExport.enabled = true;
      state.wrongExport.handleReady = true;
      state.wrongExport.folderName = directoryHandle?.name || "debug";
      return exportWrongQuestionsToConfiguredDirectory("manual");
    },
    buildPayload: () => buildWrongExportPayload(),
  };
}

function exposeAutoImportDebug() {
  window.__autoImportDebug = {
    setDirectoryHandle: async (directoryHandle) => {
      state.autoImport.directoryHandle = directoryHandle;
      state.autoImport.enabled = true;
      state.autoImport.handleReady = true;
      state.autoImport.folderName = directoryHandle?.name || "debug-import";
      state.autoImport.lastError = "";
      persistAutoImportSettings();
      return scanConfiguredImportFolder("manual");
    },
  };
}

async function ensureDirectoryPermission(directoryHandle) {
  if (typeof directoryHandle.queryPermission === "function") {
    const current = await directoryHandle.queryPermission({ mode: "readwrite" });
    if (current === "granted") {
      return;
    }
  }

  if (typeof directoryHandle.requestPermission === "function") {
    const next = await directoryHandle.requestPermission({ mode: "readwrite" });
    if (next === "granted") {
      return;
    }
  }

  throw new Error("目录写入权限未授予。");
}

function openWrongExportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("question-bank-fs", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("handles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveWrongExportHandle(directoryHandle) {
  await saveHandle("icloudWrongExportDir", directoryHandle);
}

async function loadWrongExportHandle() {
  return loadHandle("icloudWrongExportDir");
}

async function clearWrongExportHandle() {
  await clearHandle("icloudWrongExportDir");
}

async function saveHandle(key, handle) {
  const db = await openWrongExportDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandle(key) {
  const db = await openWrongExportDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const request = tx.objectStore("handles").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function clearHandle(key) {
  const db = await openWrongExportDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function questionKey(question) {
  return `${question.paperId}::${normalizeQuestionNo(question.questionNo)}`;
}

function questionSorter(a, b) {
  const paperCompare = String(a.paperId).localeCompare(String(b.paperId), "zh-CN", { numeric: true });
  if (paperCompare !== 0) {
    return paperCompare;
  }
  return String(a.questionNo).localeCompare(String(b.questionNo), "zh-CN", { numeric: true });
}

function requireString(value, fieldName) {
  const nextValue = String(value || "").trim();
  if (!nextValue) {
    throw new Error(`缺少字段：${fieldName}`);
  }
  return nextValue;
}

function normalizeAnswerValue(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
  }
  const text = String(value || "").trim();
  return text.includes(",") ? [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))].sort() : text;
}

function normalizeAnswerToArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
  }
  if (value === null || value === undefined || value === "") {
    return [];
  }
  const text = String(value).trim().replace(/\s+/g, "");
  if (!text) {
    return [];
  }
  if (text.includes(",")) {
    return [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))].sort();
  }
  if (/^[A-D]+$/i.test(text)) {
    return [...new Set(text.toUpperCase().split(""))].sort();
  }
  return [text];
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePerOptionJudgement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([label, judgement]) => [String(label || "").trim().toUpperCase(), String(judgement || "").trim()])
      .filter(([label, judgement]) => label && PER_OPTION_JUDGEMENT_VALUES.includes(judgement))
  );
}

function isMultipleQuestion(question) {
  const value = String(question.type).toLowerCase();
  return value.includes("multi") || value.includes("多选");
}

function hasUserAnswer(question) {
  return normalizeAnswerToArray(question.userAnswer).length > 0;
}

function hasCorrectAnswer(question) {
  return normalizeAnswerToArray(question.correctAnswer).length > 0;
}

function isGradedQuestion(question) {
  return question.status === "correct" || question.status === "wrong";
}

function formatUnmatchedReasonSummary(reasons) {
  const labels = [];
  if (reasons.answer_missing_for_question) {
    labels.push(`答案未解析到对应题号 ${reasons.answer_missing_for_question} 题`);
  }
  if (reasons.answer_without_question) {
    labels.push(`答案题号在题本中不存在 ${reasons.answer_without_question} 题`);
  }
  if (reasons.duplicate_answer_question_no) {
    labels.push(`答案题号重复 ${reasons.duplicate_answer_question_no} 题`);
  }
  return labels.join("；") || "无";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "zh-CN", { numeric: true })
  );
}

function summaryCardsMarkup(items) {
  return items
    .map(
      (item) => `
        <article class="summary-card">
          <strong>${escapeHtml(String(item.value))}</strong>
          <span>${escapeHtml(item.label)}</span>
        </article>
      `
    )
    .join("");
}

function statusText(status) {
  if (status === "correct") {
    return "已对";
  }
  if (status === "wrong") {
    return "已错";
  }
  if (status === "answered") {
    return "已做";
  }
  return "未做";
}

function formatAnswer(value) {
  return Array.isArray(value) ? value.join(", ") : value ? String(value) : "";
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(Number(value).toFixed(1));
}

function toMarkdown(rows) {
  if (!rows.length) {
    return "# 当前筛选下没有错题\n";
  }

  return rows
    .map((question) => {
      const classification = getObsidianClassification(question);
      const options = question.options.map((option) => `- ${option.label}. ${option.text}`).join("\n");
      return `## ${question.paperTitle} · 第 ${question.questionNo} 题

- paperId: ${question.paperId}
- 模块: ${question.module}
- 题型: ${question.type}
- 错因: ${question.wrongReason || "未标记"}
- manual_classification: ${classification.manual_classification}
- training_group: ${classification.training_group}
- error_type: ${classification.error_type}
- wrong_reason: ${classification.wrong_reason}
- next_rule: ${classification.next_rule}
- 用户答案: ${formatAnswer(question.userAnswer) || "未作答"}
- 正确答案: ${formatAnswer(question.correctAnswer) || "未导入"}
- 更新时间: ${question.updatedAt || ""}

### 题干
${question.stem}

### 选项
${options}

### 解析
${question.explanation || "暂无解析"}
`;
    })
    .join("\n");
}

function toGuessMarkdown(rows) {
  if (!rows.length) {
    return "# 当前筛选下没有猜对题\n";
  }

  return rows
    .map((question) => {
      const options = question.options.map((option) => `- ${option.label}. ${option.text}`).join("\n");
      return `## ${question.paperTitle} · 第 ${question.questionNo} 题

- paperId: ${question.paperId}
- 模块: ${question.module}
- 题型: ${question.type}
- 标记: ${question.guessReason || "未标记"}
- 用户答案: ${formatAnswer(question.userAnswer) || "未作答"}
- 正确答案: ${formatAnswer(question.correctAnswer) || "未导入"}
- 更新时间: ${question.updatedAt || ""}

### 题干
${question.stem}

### 选项
${options}

### 解析
${question.explanation || "暂无解析"}
`;
    })
    .join("\n");
}

function toWrongQuestionClipboardText(rows) {
  if (!rows.length) {
    return "当前筛选下没有错题。";
  }

  return rows
    .map((question, index) => {
      const options = question.options.map((option) => `${option.label}. ${option.text}`).join("\n");
      return [
        `${index + 1}. ${question.paperTitle} 第 ${question.questionNo} 题`,
        `模块：${question.module}`,
        `题型：${question.type}`,
        `错因：${question.wrongReason || "未标记"}`,
        `我的答案：${formatAnswer(question.userAnswer) || "未作答"}`,
        `正确答案：${formatAnswer(question.correctAnswer) || "未导入"}`,
        "",
        question.stem,
        options,
        question.explanation ? `解析：${question.explanation}` : "解析：暂无",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function toNotebookQuestionClipboardText(rows, mode = "wrong") {
  if (mode !== "guess") {
    return toWrongQuestionClipboardText(rows);
  }
  if (!rows.length) {
    return "当前筛选下没有猜对题。";
  }

  return rows
    .map((question, index) => {
      const options = question.options.map((option) => `${option.label}. ${option.text}`).join("\n");
      return [
        `${index + 1}. ${question.paperTitle} 第 ${question.questionNo} 题`,
        `模块：${question.module}`,
        `题型：${question.type}`,
        `标记：${question.guessReason || "未标记"}`,
        `我的答案：${formatAnswer(question.userAnswer) || "未作答"}`,
        `正确答案：${formatAnswer(question.correctAnswer) || "未导入"}`,
        "",
        question.stem,
        options,
        question.explanation ? `解析：${question.explanation}` : "解析：暂无",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function toCsv(rows) {
  const header = [
    "paperId",
    "paperTitle",
    "questionNo",
    "type",
    "module",
    "stem",
    "options",
    "correctAnswer",
    "userAnswer",
    "isWrong",
    "wrongReason",
    "explanation",
    "updatedAt",
  ];

  const body = rows.map((question) =>
    [
      question.paperId,
      question.paperTitle,
      question.questionNo,
      question.type,
      question.module,
      question.stem,
      question.options.map((option) => `${option.label}. ${option.text}`).join(" / "),
      formatAnswer(question.correctAnswer),
      formatAnswer(question.userAnswer),
      question.isWrong ? "true" : "false",
      question.wrongReason || "",
      question.explanation || "",
      question.updatedAt || "",
    ]
      .map(csvCell)
      .join(",")
  );

  return [header.join(","), ...body].join("\n");
}

function toGuessCsv(rows) {
  const header = [
    "paperId",
    "paperTitle",
    "questionNo",
    "type",
    "module",
    "stem",
    "options",
    "correctAnswer",
    "userAnswer",
    "isGuessed",
    "guessReason",
    "explanation",
    "updatedAt",
  ];

  const body = rows.map((question) =>
    [
      question.paperId,
      question.paperTitle,
      question.questionNo,
      question.type,
      question.module,
      question.stem,
      question.options.map((option) => `${option.label}. ${option.text}`).join(" / "),
      formatAnswer(question.correctAnswer),
      formatAnswer(question.userAnswer),
      question.isGuessed ? "true" : "false",
      question.guessReason || "",
      question.explanation || "",
      question.updatedAt || "",
    ]
      .map(csvCell)
      .join(",")
  );

  return [header.join(","), ...body].join("\n");
}

function exportCurrentPaperWrongQuestionsPdf() {
  const paper = state.store.papers.find((item) => item.paperId === state.currentPaperId);
  if (!paper) {
    throw new Error("当前没有打开具体期次。");
  }

  const rows = getPaperQuestions(paper.paperId).filter((question) => question.isWrong);
  if (!rows.length) {
    throw new Error("本期当前没有错题可导出。");
  }

  printHtmlDocument(buildWrongQuestionsPrintHtml(rows, paper), `${paper.paperTitle} 本期错题`);

  return {
    paperTitle: paper.paperTitle,
    count: rows.length,
  };
}

function buildWrongQuestionsPrintHtml(rows, paper) {
  const generatedAt = formatDateTime(new Date().toISOString());
  const fileTitle = `${safeFilename(paper.paperTitle)}-错题-${compactDateTime()}`;
  const items = rows
    .map((question, index) => {
      const options = question.options
        .map(
          (option) => `
            <li>
              <span class="option-label">${escapeHtml(option.label)}.</span>
              <span>${escapeHtml(option.text)}</span>
            </li>
          `
        )
        .join("");

      return `
        <article class="question">
          <div class="question-top">
            <span class="question-index">${index + 1}</span>
            <div>
              <p class="meta">第 ${escapeHtml(question.questionNo)} 题 · ${escapeHtml(question.module)} · ${escapeHtml(question.type)}</p>
              <h2>${escapeHtml(question.stem)}</h2>
            </div>
          </div>
          <ol class="options">${options}</ol>
          <div class="answer-grid">
            <p><strong>我的答案：</strong>${escapeHtml(formatAnswer(question.userAnswer) || "未作答")}</p>
            <p><strong>正确答案：</strong>${escapeHtml(formatAnswer(question.correctAnswer) || "未导入")}</p>
            <p><strong>错因：</strong>${escapeHtml(question.wrongReason || "未标记")}</p>
          </div>
          ${question.explanation ? `<div class="explanation"><strong>解析：</strong>${escapeHtml(question.explanation)}</div>` : ""}
        </article>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(fileTitle)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 28px;
        color: #241a14;
        background: #f8f3ea;
        font-family: "Songti SC", "Noto Serif CJK SC", serif;
        line-height: 1.7;
      }
      .sheet {
        max-width: 920px;
        margin: 0 auto;
        padding: 34px;
        background: #fffdf8;
        border: 1px solid #e2d7c8;
      }
      header {
        border-bottom: 2px solid #9d5633;
        margin-bottom: 24px;
        padding-bottom: 16px;
      }
      .eyebrow {
        margin: 0 0 6px;
        color: #9d5633;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.3;
      }
      .summary {
        margin: 8px 0 0;
        color: #65564a;
        font-size: 14px;
      }
      .question {
        break-inside: avoid;
        padding: 20px 0;
        border-bottom: 1px solid #e8ded0;
      }
      .question-top {
        display: grid;
        grid-template-columns: 34px 1fr;
        gap: 12px;
        align-items: start;
      }
      .question-index {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: #9d5633;
        color: #fff;
        font-weight: 700;
      }
      .meta {
        margin: 0 0 4px;
        color: #76685d;
        font-size: 13px;
      }
      h2 {
        margin: 0;
        font-size: 18px;
        line-height: 1.65;
      }
      .options {
        list-style: none;
        margin: 14px 0;
        padding: 0 0 0 46px;
      }
      .options li {
        margin: 6px 0;
      }
      .option-label {
        display: inline-block;
        min-width: 24px;
        font-weight: 700;
        color: #9d5633;
      }
      .answer-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-left: 46px;
      }
      .answer-grid p,
      .explanation {
        margin: 0;
        padding: 8px 10px;
        border-radius: 8px;
        background: #f5eee3;
      }
      .explanation {
        margin: 10px 0 0 46px;
      }
      @media print {
        body { padding: 0; background: #fff; }
        .sheet { max-width: none; border: 0; padding: 0; }
        .question { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header>
        <p class="eyebrow">Wrong Questions PDF</p>
        <h1>${escapeHtml(paper.paperTitle)} · 本期错题</h1>
        <p class="summary">paperId：${escapeHtml(paper.paperId)} · 错题数：${rows.length} · 生成时间：${escapeHtml(generatedAt)}</p>
      </header>
      ${items}
    </main>
  </body>
</html>`;
}

function printHtmlDocument(html, title) {
  const previousFrame = document.getElementById("wrong-question-pdf-print-frame");
  if (previousFrame) {
    previousFrame.remove();
  }

  const frame = document.createElement("iframe");
  frame.id = "wrong-question-pdf-print-frame";
  frame.title = title;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.visibility = "hidden";

  frame.addEventListener("load", () => {
    const targetWindow = frame.contentWindow;
    if (!targetWindow) {
      return;
    }

    const cleanup = () => {
      setTimeout(() => frame.remove(), 1000);
    };

    targetWindow.addEventListener("afterprint", cleanup, { once: true });
    targetWindow.focus();
    setTimeout(() => {
      targetWindow.print();
      setTimeout(cleanup, 15000);
    }, 150);
  });

  document.body.appendChild(frame);
  frame.srcdoc = html;
}

function csvCell(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}

function exportBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || "wrong-questions")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function compactDateTime() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
}

function buildWrongQuestionsJsonExport(rows) {
  const partition = partitionWrongQuestionsForJsonExport(rows);
  return {
    exportedAt: new Date().toISOString(),
    source: "wrong-notebook",
    count: rows.length,
    validCount: partition.validItems.length,
    invalidCount: partition.invalidItems.length,
    items: partition.validItems,
    validItems: partition.validItems,
    invalidItems: partition.invalidItems,
    issueReport: partition.issueReport,
    recitationCards: getRecitationCards().map(toRecitationCardExportItem),
    questionRecitationLinks: buildQuestionRecitationLinks(),
  };
}

function buildGuessQuestionsJsonExport(rows) {
  return {
    exportedAt: new Date().toISOString(),
    source: "guess-notebook",
    count: rows.length,
    items: rows.map(toGuessQuestionExportItem),
    recitationCards: getRecitationCards().map(toRecitationCardExportItem),
    questionRecitationLinks: buildQuestionRecitationLinks(),
  };
}

function buildRiskQuestionsJsonExport(rows) {
  return {
    exportedAt: new Date().toISOString(),
    source: "risk-notebook",
    count: rows.length,
    items: rows.map(toRiskQuestionExportItem),
    recitationCards: getRecitationCards().map(toRecitationCardExportItem),
    questionRecitationLinks: buildQuestionRecitationLinks(),
  };
}

function validateWrongQuestionsForJsonExport(rows) {
  if (!rows.length) {
    return {
      ok: false,
      issues: [{ questionNo: "-", problems: ["当前筛选下没有错题可导出"] }],
      summary: "当前筛选下没有错题可导出。",
    };
  }

  const issues = rows.map(inspectWrongQuestionForJsonExport).filter((result) => result.problems.length);

  return {
    ok: issues.length === 0,
    issues,
    summary: issues.length
      ? issues
          .slice(0, 3)
          .map((issue) => `${issue.paperTitle} 第${issue.questionNo}题：${issue.problems.join("、")}`)
          .join("；")
      : "",
  };
}

function partitionWrongQuestionsForJsonExport(rows) {
  const validItems = [];
  const invalidItems = [];
  const issues = [];

  rows.forEach((question) => {
    const inspection = inspectWrongQuestionForJsonExport(question);
    const exportItem = toWrongQuestionExportItem(question);

    if (inspection.problems.length) {
      issues.push(inspection);
      invalidItems.push({
        ...exportItem,
        problems: inspection.problems,
      });
      return;
    }

    validItems.push(exportItem);
  });

  return {
    validItems,
    invalidItems,
    issueReport: {
      ok: issues.length === 0,
      issueCount: issues.length,
      summary: issues.length
        ? issues
            .slice(0, 3)
            .map((issue) => `${issue.paperTitle} 第${issue.questionNo}题：${issue.problems.join("、")}`)
            .join("；")
        : "",
      issues,
    },
  };
}

function inspectWrongQuestionForJsonExport(question) {
  const problems = [];
  const stem = String(question.stem || "").trim();
  const questionNo = String(question.questionNo || "").trim();
  const correctAnswer = normalizeAnswerToArray(question.correctAnswer);
  const options = Array.isArray(question.options) ? question.options : [];
  const labels = options.map((option) => String(option?.label || "").trim()).filter(Boolean);
  const validOptionCount = options.filter(
    (option) =>
      option &&
      typeof option === "object" &&
      String(option.label || "").trim() &&
      String(option.text || "").trim()
  ).length;
  const uniqueLabels = new Set(labels);
  const mergedNextQuestionPattern =
    /(解析：|故本题答案选|下一题|^\s*\d+[.、]|[A-D][\s\u3000].*[A-D][\s\u3000])/m;

  if (!stem) {
    problems.push("stem 为空");
  }
  if (!/^\d+$/.test(questionNo)) {
    problems.push("questionNo 异常");
  }
  if (!correctAnswer.length) {
    problems.push("correctAnswer 缺失");
  }
  if (validOptionCount < 2) {
    problems.push("options 数量异常");
  }
  if (validOptionCount !== options.length) {
    problems.push("options 结构异常");
  }
  if (uniqueLabels.size !== labels.length) {
    problems.push("options 出现重复标签，疑似串题");
  }
  if (labels.length > 6) {
    problems.push("options 数量过多，疑似混入下一题");
  }
  if (options.some((option) => mergedNextQuestionPattern.test(String(option?.text || "")))) {
    problems.push("options 文本疑似混入下一题内容");
  }
  if (mergedNextQuestionPattern.test(stem.replace(/\s+/g, " ")) && labels.length > 4) {
    problems.push("stem 内容疑似混入下一题");
  }

  return {
    paperId: question.paperId || "",
    paperTitle: question.paperTitle || "",
    questionNo: questionNo || "?",
    problems,
  };
}

function toWrongQuestionExportItem(question) {
  const obsidianClassification = getObsidianClassification(question);
  return {
    paperId: question.paperId,
    paperTitle: question.paperTitle,
    questionNo: question.questionNo,
    type: question.type,
    stem: question.stem,
    options: question.options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    module: question.module,
    status: question.status,
    userAnswer: question.userAnswer,
    isWrong: question.isWrong,
    wrongReason: question.wrongReason,
    manual_classification: obsidianClassification.manual_classification,
    training_group: obsidianClassification.training_group,
    error_type: obsidianClassification.error_type,
    wrong_reason: obsidianClassification.wrong_reason,
    next_rule: obsidianClassification.next_rule,
    riskReasons: getQuestionRiskReasons(question),
    confidenceStatus: question.confidenceStatus,
    hesitationOptions: normalizeAnswerToArray(question.hesitationOptions),
    reviewNotes: normalizeReviewNotes(question.reviewNotes),
    ...scoreDiagnosisExportFields(question),
    updatedAt: question.updatedAt,
  };
}

function toGuessQuestionExportItem(question) {
  return {
    paperId: question.paperId,
    paperTitle: question.paperTitle,
    questionNo: question.questionNo,
    type: question.type,
    stem: question.stem,
    options: question.options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    module: question.module,
    status: question.status,
    userAnswer: question.userAnswer,
    isGuessed: question.isGuessed,
    guessReason: question.guessReason,
    confidenceStatus: question.confidenceStatus,
    hesitationOptions: normalizeAnswerToArray(question.hesitationOptions),
    riskReasons: getQuestionRiskReasons(question),
    reviewNotes: normalizeReviewNotes(question.reviewNotes),
    ...scoreDiagnosisExportFields(question),
    updatedAt: question.updatedAt,
  };
}

function toRiskQuestionExportItem(question) {
  return {
    paperId: question.paperId,
    paperTitle: question.paperTitle,
    questionNo: question.questionNo,
    type: question.type,
    stem: question.stem,
    options: question.options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    module: question.module,
    status: question.status,
    userAnswer: question.userAnswer,
    isHighRisk: question.isHighRisk,
    confidenceStatus: question.confidenceStatus,
    hesitationOptions: normalizeAnswerToArray(question.hesitationOptions),
    riskReasons: getQuestionRiskReasons(question),
    reviewNotes: normalizeReviewNotes(question.reviewNotes),
    riskCertainCorrectStreak: question.riskCertainCorrectStreak || 0,
    secondReviewStillUncertain: Boolean(question.secondReviewStillUncertain),
    ...scoreDiagnosisExportFields(question),
    updatedAt: question.updatedAt,
  };
}

function scoreDiagnosisExportFields(question) {
  return {
    primaryWrongReason: question.primaryWrongReason || question.wrongReason || "",
    secondaryWrongTags: normalizeStringArray(question.secondaryWrongTags),
    decisiveKeyword: question.decisiveKeyword || "",
    wrongThinking: question.wrongThinking || "",
    nextRule: question.nextRule || "",
    selectedVsCorrectDiff: question.selectedVsCorrectDiff || "",
    eachOptionReason: question.eachOptionReason || "",
    eliminatedOption: normalizeAnswerToArray(question.eliminatedOption),
    eliminationReason: question.eliminationReason || "",
    perOptionJudgement: normalizePerOptionJudgement(question.perOptionJudgement),
    missedOptions: normalizeAnswerToArray(question.missedOptions),
    overSelectedOptions: normalizeAnswerToArray(question.overSelectedOptions),
    multiSelectErrorType: question.multiSelectErrorType || "",
    learningDiagnosis: question.learningDiagnosis || "",
    retestPriority: question.retestPriority || "",
    reviewDueAt: question.reviewDueAt || "",
    recitationCardId: question.recitationCardId || "",
  };
}

function toRecitationCardExportItem(card) {
  return {
    id: card.id || card.cardId,
    cardId: card.cardId,
    sourceQuestionId: card.sourceQuestionId,
    paperId: card.paperId,
    paperTitle: card.paperTitle,
    questionNo: card.questionNo,
    type: card.type,
    stemBrief: card.stemBrief,
    correctAnswer: card.correctAnswer,
    userAnswer: card.userAnswer,
    front: card.front,
    back: card.back,
    recitePoint: card.recitePoint,
    triggerWords: card.triggerWords,
    category: card.category,
    title: card.title,
    keywords: card.keywords,
    keyword: card.keyword,
    condition: card.condition,
    correctDirection: card.correctDirection,
    trapDirection: card.trapDirection,
    excludeRule: card.excludeRule,
    mistakeReason: card.mistakeReason,
    nextRule: card.nextRule,
    tags: card.tags,
    coreMeaning: card.coreMeaning,
    questionSignals: card.questionSignals,
    whenToChoose: card.whenToChoose,
    confusingWords: card.confusingWords,
    difference: card.difference,
    commonMistake: card.commonMistake,
    exclusionRule: card.exclusionRule,
    mnemonic: card.mnemonic,
    typicalMaterial: card.typicalMaterial,
    relatedQuestionIds: card.relatedQuestionIds,
    sourceText: card.sourceText,
    sourceFile: card.sourceFile,
    priority: card.priority,
    difficulty: card.difficulty,
    mastery: card.mastery,
    masteryLevel: card.masteryLevel,
    reviewCount: card.reviewCount,
    wrongReviewCount: card.wrongReviewCount,
    lastReviewDate: card.lastReviewDate,
    lastReviewedAt: card.lastReviewedAt,
    nextReviewDate: card.nextReviewDate,
    nextReviewAt: card.nextReviewAt,
    source: card.source,
    isMustMemorize: card.isMustMemorize,
    applicationStreak: card.applicationStreak,
    lastApplicationResult: card.lastApplicationResult,
    reviewHistory: card.reviewHistory,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

function buildQuestionRecitationLinks() {
  return getRecitationCards().flatMap((card) =>
    card.relatedQuestionIds.map((questionId) => ({
      questionId,
      cardId: card.cardId,
      title: card.title,
      category: card.category,
    }))
  );
}

async function exportWrongQuestionsToGptGongji(popup = null) {
  const rows = getFilteredWrongQuestions();
  if (!rows.length) {
    throw new Error("当前筛选下没有错题可导出。");
  }

  const targetUrl = getStoredGptGongjiUrl() || configureGptGongjiUrl();
  if (!targetUrl) {
    throw new Error("未设置 GPT 公基链接。");
  }

  const promptText = toGptGongjiPrompt(rows);
  await copyText(promptText);

  if (popup && !popup.closed) {
    popup.location.replace(targetUrl);
  } else {
    window.open(targetUrl, "_blank", "noopener");
  }

  return {
    targetUrl,
    questionCount: rows.length,
  };
}

function toGptGongjiPrompt(rows) {
  return [
    `以下是我当前筛选下的 ${rows.length} 道公基错题，请直接开始复盘。`,
    "输出要求：",
    "1. 每题先给出正确答案。",
    "2. 用最容易记住的话解释考点。",
    "3. 点出我最可能的错误原因。",
    "4. 每题最后补一句速记提醒。",
    "5. 全部题目讲完后，再给一份本批错题总复盘。",
    "",
    toMarkdown(rows),
  ].join("\n");
}

function getStoredGptGongjiUrl() {
  return normalizeWebUrl(localStorage.getItem(GPT_GONGJI_URL_KEY) || "", false);
}

function configureGptGongjiUrl() {
  const current = getStoredGptGongjiUrl();
  const input = window.prompt(
    "请输入 GPT“公基”页面链接。可粘贴 chatgpt.com/g/...；留空可清除当前设置。",
    current
  );

  if (input === null) {
    return null;
  }

  const nextValue = String(input).trim();
  if (!nextValue) {
    localStorage.removeItem(GPT_GONGJI_URL_KEY);
    return "";
  }

  const normalized = normalizeWebUrl(nextValue, true);
  localStorage.setItem(GPT_GONGJI_URL_KEY, normalized);
  return normalized;
}

function normalizeWebUrl(value, shouldThrow) {
  const nextValue = String(value || "").trim();
  if (!nextValue) {
    if (shouldThrow) {
      throw new Error("链接不能为空。");
    }
    return "";
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(nextValue) ? nextValue : `https://${nextValue}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("只支持 http 或 https 链接。");
    }
    return url.toString();
  } catch (error) {
    if (shouldThrow) {
      throw new Error(error.message || "链接格式不正确。");
    }
    return "";
  }
}

async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function flashMessage(message, isError = false) {
  elements.messageBar.textContent = message;
  elements.messageBar.style.color = isError ? "var(--warn)" : "var(--accent-strong)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replaceAll('"', '\\"');
}
