import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAINING_GROUPS,
  countBy,
  getObsidianClassification,
  manual_classification,
} from "../src/obsidian-error-classification.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUT_DIR = path.join(PROJECT_DIR, "obsidian-error-classification");
const TRAINING_PRIORITY_ORDER = [
  "01-材料核心效果判断",
  "03-多选逐项定罪",
  "02-选项边界二选一",
  "04-时政原话固定搭配",
  "08-反向否定题",
  "06-法律公文管理硬规则",
  "07-文史科技常识",
  "05-哲学关键词识别",
];
const PRIORITY_BY_GROUP = {
  "01-材料核心效果判断": "high",
  "03-多选逐项定罪": "high",
  "02-选项边界二选一": "medium",
  "04-时政原话固定搭配": "medium",
  "08-反向否定题": "medium",
};

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readWrongQuestions(inputPath) {
  if (!inputPath) {
    fail("缺少 --input=/path/to/wrong-questions-latest.json");
  }
  if (!fs.existsSync(inputPath)) {
    fail(`找不到输入文件：${inputPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(payload.validItems)
    ? payload.validItems
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.questions)
        ? payload.questions
        : Array.isArray(payload)
          ? payload
          : [];
  return rows.filter((item) => item && typeof item === "object");
}

function safeName(value) {
  return String(value || "未命名")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "未命名";
}

function yamlScalar(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatAnswer(value) {
  return Array.isArray(value) ? value.join("") : String(value || "");
}

function priorityForGroup(group) {
  return PRIORITY_BY_GROUP[group] || "low";
}

function questionLink(question) {
  const name = questionFileName(question).replace(/\.md$/, "");
  return `[[题目/${name}|${questionTitle(question)}]]`;
}

function enrichRows(rows) {
  return rows.map((question) => {
    const classification = getObsidianClassification(question);
    const inferred = Boolean(classification.inferred_classification);
    const priority = priorityForGroup(classification.training_group);
    return { question, classification, inferred, priority };
  });
}

function groupItems(enriched) {
  const byGroup = new Map();
  enriched.forEach((item) => {
    const group = item.classification.training_group;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
    }
    byGroup.get(group).push(item);
  });
  return byGroup;
}

function questionTitle(question) {
  return `${safeName(question.paperTitle || question.paperId)}第${safeName(question.questionNo)}题`;
}

function questionFileName(question) {
  return `${safeName(question.paperTitle || question.paperId)}-第${safeName(question.questionNo)}题.md`;
}

function optionBlock(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (!options.length) {
    return "暂无选项。";
  }
  return options.map((option) => `${option.label}. ${normalizeText(option.text)}  `).join("\n");
}

function questionMarkdown(question) {
  const classification = getObsidianClassification(question);
  const title = questionTitle(question);
  const tags = ["公基", "三支一扶", "错题", question.type || "未分类"].filter(Boolean);
  const inferred = Boolean(classification.inferred_classification);
  const priority = priorityForGroup(classification.training_group);
  return `---
title: ${yamlScalar(title)}
paper: ${yamlScalar(question.paperTitle)}
paper_id: ${yamlScalar(question.paperId)}
question_no: ${yamlScalar(question.questionNo)}
type: ${yamlScalar(question.type)}
module: ${yamlScalar(question.module)}
source: ${yamlScalar("河南事业单位联考")}
correct_answer: ${yamlScalar(formatAnswer(question.correctAnswer))}
user_answer: ${yamlScalar(formatAnswer(question.userAnswer))}
result: wrong
status: need_review
manual_classification: ${classification.manual_classification}
inferred_classification: ${inferred}
training_group: ${yamlScalar(classification.training_group)}
error_type: ${yamlScalar(classification.error_type)}
wrong_reason: ${yamlScalar(classification.wrong_reason)}
next_rule: ${yamlScalar(classification.next_rule)}
review_count: 0
last_review: 
next_review: 
priority: ${priority}
tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}
---

# ${title}

## 一、先盲拆，不看选项前先填

主要动作：
直接变化：
落点领域：
核心效果：
我预测答案方向：

## 二、题目

${normalizeText(question.stem)}

## 三、选项

${optionBlock(question)}

## 四、我的作答

我的答案：${formatAnswer(question.userAnswer)}
排除理由：
我为什么排除 A：
我为什么排除 B：
我为什么排除 C：
我为什么排除 D：

## 五、错因复盘

training_group：${classification.training_group}
error_type：${classification.error_type}
wrong_reason：${classification.wrong_reason}
next_rule：${classification.next_rule}

## 六、正确答案与解析

> [!success]- 点击展开答案
> 正确答案：${formatAnswer(question.correctAnswer)}
> 解析：${normalizeText(question.explanation) || "暂无解析。"}
`;
}

function writeQuestionFiles(rows, outDir) {
  const questionDir = path.join(outDir, "题目");
  fs.mkdirSync(questionDir, { recursive: true });
  rows.forEach((question) => {
    fs.writeFileSync(path.join(questionDir, questionFileName(question)), questionMarkdown(question));
  });
}

function writeTodayDashboard(enriched, outDir) {
  const byGroup = groupItems(enriched);
  const body = TRAINING_PRIORITY_ORDER.map((group, index) => {
    const items = (byGroup.get(group) || []).slice(0, 20);
    const links = items.length
      ? items.map(({ question }) => `- [ ] ${questionLink(question)}`).join("\n")
      : "- [ ] 暂无";
    return `## 第${index + 1}组：${group}\n\n${links}`;
  }).join("\n\n");

  fs.writeFileSync(
    path.join(outDir, "00-今日训练看板.md"),
    `# 00-今日训练看板\n\n${body}\n`
  );
}

function writeTrainingOverview(enriched, outDir) {
  const byGroup = groupItems(enriched);
  const rows = TRAINING_PRIORITY_ORDER.map((group, index) => {
    const count = (byGroup.get(group) || []).length;
    return `| 第${index + 1}组 | ${group} | ${count} |`;
  }).join("\n");
  fs.writeFileSync(
    path.join(outDir, "01-七组轮换总览.md"),
    `# 01-七组轮换总览\n\n` +
      `| 轮换顺序 | 训练组 | 题数 |\n| --- | --- | ---: |\n${rows}\n\n` +
      `## 训练入口\n\n` +
      `- [[00-今日训练看板]]\n` +
      `- [[03-材料盲拆训练]]\n` +
      `- [[04-多选逐项定罪训练]]\n` +
      `- [[05-二选一边界训练]]\n` +
      `- [[06-时政原话快问快答]]\n` +
      `- [[07-考前只看规则卡]]\n`
  );
}

function writeClassificationIndex(enriched, outDir) {
  const byGroup = groupItems(enriched);

  const sections = [...TRAINING_GROUPS, "待人工判断"]
    .filter((group, index, groups) => groups.indexOf(group) === index)
    .map((group) => {
      const items = byGroup.get(group) || [];
      const links = items.length
        ? items.map(({ question }) => `- ${questionLink(question)}`).join("\n")
        : "- 暂无";
      return `## ${group}\n\n${links}`;
    })
    .join("\n\n");

  fs.writeFileSync(
    path.join(outDir, "02-错因分类索引.md"),
    `# 02-错因分类索引\n\n${sections}\n`
  );
}

function writeMaterialBlindTraining(enriched, outDir) {
  const items = enriched.filter((item) => item.classification.training_group === "01-材料核心效果判断");
  const body = items.map(({ question, classification }) =>
    `- ${questionLink(question)}\n` +
    `  - 题眼：\n` +
    `  - 主体：\n` +
    `  - 动作：\n` +
    `  - 对象：\n` +
    `  - 直接效果：\n` +
    `  - 下次规则：${classification.next_rule || ""}`
  ).join("\n");
  fs.writeFileSync(path.join(outDir, "03-材料盲拆训练.md"), `# 03-材料盲拆训练\n\n${body || "- 暂无"}\n`);
}

function writeMultiSelectTraining(enriched, outDir) {
  const items = enriched.filter((item) => item.classification.training_group === "03-多选逐项定罪");
  const body = items.map(({ question, classification }) =>
    `- ${questionLink(question)}\n` +
    `  - A：\n` +
    `  - B：\n` +
    `  - C：\n` +
    `  - D：\n` +
    `  - 最终答案：\n` +
    `  - 漏选原因：\n` +
    `  - 下次规则：${classification.next_rule || ""}`
  ).join("\n");
  fs.writeFileSync(path.join(outDir, "04-多选逐项定罪训练.md"), `# 04-多选逐项定罪训练\n\n${body || "- 暂无"}\n`);
}

function writeBoundaryTraining(enriched, outDir) {
  const items = enriched.filter((item) => item.classification.training_group === "02-选项边界二选一");
  const body = items.map(({ question, classification }) =>
    `- ${questionLink(question)}\n` +
    `  - 易混选项：\n` +
    `  - 正确项强在哪里：\n` +
    `  - 错误项偷换了什么：\n` +
    `  - 下次规则：${classification.next_rule || ""}`
  ).join("\n");
  fs.writeFileSync(path.join(outDir, "05-二选一边界训练.md"), `# 05-二选一边界训练\n\n${body || "- 暂无"}\n`);
}

function writeOriginalWordingQuiz(enriched, outDir) {
  const items = enriched.filter((item) => item.classification.training_group === "04-时政原话固定搭配");
  const body = items.map(({ question }) =>
    `- 问：这题考的固定搭配是什么？\n` +
    `  > [!success]- 答\n` +
    `  > 答：\n` +
    `  > 来源题：${questionLink(question)}`
  ).join("\n");
  fs.writeFileSync(path.join(outDir, "06-时政原话快问快答.md"), `# 06-时政原话快问快答\n\n${body || "- 暂无"}\n`);
}

function writeRuleCards(enriched, outDir) {
  const byGroup = new Map();
  enriched.forEach(({ classification }) => {
    const rule = String(classification.next_rule || "").trim();
    if (!rule || rule === "待人工补充") {
      return;
    }
    const group = classification.training_group;
    if (!byGroup.has(group)) {
      byGroup.set(group, new Set());
    }
    byGroup.get(group).add(rule);
  });
  const groups = TRAINING_PRIORITY_ORDER.filter((group) => byGroup.has(group));
  const body = groups.map((group) => {
    const rules = [...byGroup.get(group)].map((rule) => `- ${rule}`).join("\n");
    return `## ${group}\n\n${rules}`;
  }).join("\n\n");
  fs.writeFileSync(path.join(outDir, "07-考前只看规则卡.md"), `# 07-考前只看规则卡\n\n${body || "- 暂无"}\n`);
}

function writeSummary(enriched, outDir) {
  const matchedCount = enriched.filter((item) => item.classification.manual_classification).length;
  const manualCount = matchedCount;
  const inferredCount = enriched.filter((item) => item.inferred).length;
  const pendingCount = enriched.filter((item) =>
    item.classification.training_group === "待人工判断" ||
    item.classification.error_type === "待人工判断"
  ).length;
  const highPriorityCount = enriched.filter((item) => item.priority === "high").length;
  const mediumPriorityCount = enriched.filter((item) => item.priority === "medium").length;
  const lowPriorityCount = enriched.filter((item) => item.priority === "low").length;
  const flat = enriched.map((item) => ({
    ...item.classification,
    priority: item.priority,
  }));
  const trainingGroupCounts = countBy(flat, "training_group");
  const errorTypeCounts = countBy(flat, "error_type");

  const countList = (counts) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");

  fs.writeFileSync(
    path.join(outDir, "导出统计.md"),
    `# Obsidian 错题错因分类导出统计\n\n` +
      `- 总题数：${enriched.length}\n` +
      `- 手工分类数量：${manualCount}\n` +
      `- 规则分类数量：${inferredCount}\n` +
      `- 待人工判断数量：${pendingCount}\n` +
      `- 高优先级题数：${highPriorityCount}\n` +
      `- 中优先级题数：${mediumPriorityCount}\n` +
      `- 低优先级题数：${lowPriorityCount}\n\n` +
      `## training_group 数量\n\n${countList(trainingGroupCounts)}\n\n` +
      `## error_type 数量\n\n${countList(errorTypeCounts)}\n`
  );

  const stats = {
    total: enriched.length,
    matchedCount,
    manualCount,
    inferredCount,
    pendingCount,
    highPriorityCount,
    mediumPriorityCount,
    lowPriorityCount,
    trainingGroupCounts,
    errorTypeCounts,
  };
  fs.writeFileSync(
    path.join(outDir, "export-stats.json"),
    `${JSON.stringify(stats, null, 2)}\n`
  );
}

function main() {
  const input = readArg("input", "");
  const outDir = path.resolve(readArg("out", DEFAULT_OUT_DIR));
  const rows = readWrongQuestions(path.resolve(input));
  const enriched = enrichRows(rows);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  writeQuestionFiles(rows, outDir);
  writeTodayDashboard(enriched, outDir);
  writeTrainingOverview(enriched, outDir);
  writeClassificationIndex(enriched, outDir);
  writeMaterialBlindTraining(enriched, outDir);
  writeMultiSelectTraining(enriched, outDir);
  writeBoundaryTraining(enriched, outDir);
  writeOriginalWordingQuiz(enriched, outDir);
  writeRuleCards(enriched, outDir);
  writeSummary(enriched, outDir);
  console.log(`EXPORTED_OBSIDIAN_ERROR_CLASSIFICATION ${rows.length} ${outDir}`);
}

main();
