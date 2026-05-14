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
training_group: ${yamlScalar(classification.training_group)}
error_type: ${yamlScalar(classification.error_type)}
wrong_reason: ${yamlScalar(classification.wrong_reason)}
next_rule: ${yamlScalar(classification.next_rule)}
tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}
---

## 题目

${normalizeText(question.stem)}

## 选项

${optionBlock(question)}

## 我的作答

我的答案：${formatAnswer(question.userAnswer)}  
排除理由：

## 正确答案与解析

> [!success]- 答案
> 正确答案：${formatAnswer(question.correctAnswer)}  
> 解析：${normalizeText(question.explanation) || "暂无解析。"}

## 错因复盘

### 1. training_group
${classification.training_group}

### 2. error_type
${classification.error_type}

### 3. wrong_reason
${classification.wrong_reason}

### 4. next_rule
${classification.next_rule}
`;
}

function writeQuestionFiles(rows, outDir) {
  const questionDir = path.join(outDir, "题目");
  fs.mkdirSync(questionDir, { recursive: true });
  rows.forEach((question) => {
    fs.writeFileSync(path.join(questionDir, questionFileName(question)), questionMarkdown(question));
  });
}

function writeClassificationIndex(rows, outDir) {
  const enriched = rows.map((question) => ({
    question,
    classification: getObsidianClassification(question),
  }));
  const byGroup = new Map();
  enriched.forEach((item) => {
    const group = item.classification.training_group;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
    }
    byGroup.get(group).push(item.question);
  });

  const sections = [...TRAINING_GROUPS, "待人工判断"]
    .filter((group, index, groups) => groups.indexOf(group) === index)
    .map((group) => {
      const questions = byGroup.get(group) || [];
      const links = questions.length
        ? questions.map((question) => `- [[题目/${questionFileName(question).replace(/\.md$/, "")}|${questionTitle(question)}]]`).join("\n")
        : "- 暂无";
      return `## ${group}\n\n${links}`;
    })
    .join("\n\n");

  fs.writeFileSync(
    path.join(outDir, "02-错因分类索引.md"),
    `# 02-错因分类索引\n\n${sections}\n`
  );
}

function writeTrainingDashboard(rows, outDir) {
  const enriched = rows.map((question) => ({
    question,
    classification: getObsidianClassification(question),
  }));
  const body = TRAINING_GROUPS.map((group, index) => {
    const items = enriched.filter((item) => item.classification.training_group === group);
    const links = items.length
      ? items.map(({ question }) => `- [ ] [[题目/${questionFileName(question).replace(/\.md$/, "")}|${questionTitle(question)}]]`).join("\n")
      : "- [ ] 暂无匹配题，等待 manual_classification 补充";
    return `## 第 ${index + 1} 组：${group}\n\n${links}`;
  }).join("\n\n");

  const pending = enriched.filter((item) => item.classification.training_group === "待人工判断");
  const pendingLinks = pending.length
    ? pending.map(({ question }) => `- [ ] [[题目/${questionFileName(question).replace(/\.md$/, "")}|${questionTitle(question)}]]`).join("\n")
    : "- [ ] 暂无";

  fs.writeFileSync(
    path.join(outDir, "七组轮换训练看板.md"),
    `# 七组轮换训练看板\n\n${body}\n\n## 待人工判断\n\n${pendingLinks}\n`
  );
}

function writeSummary(rows, outDir) {
  const enriched = rows.map((question) => ({
    ...getObsidianClassification(question),
    question,
  }));
  const matchedCount = enriched.filter((item) => item.manual_classification).length;
  const pendingCount = enriched.length - matchedCount;
  const trainingGroupCounts = countBy(enriched, "training_group");
  const errorTypeCounts = countBy(enriched, "error_type");

  const countList = (counts) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");

  fs.writeFileSync(
    path.join(outDir, "导出统计.md"),
    `# Obsidian 错题错因分类导出统计\n\n` +
      `- 题目总数：${rows.length}\n` +
      `- manual_classification 条目数：${Object.keys(manual_classification).length}\n` +
      `- 匹配成功：${matchedCount}\n` +
      `- 待人工判断：${pendingCount}\n\n` +
      `## training_group 数量\n\n${countList(trainingGroupCounts)}\n\n` +
      `## error_type 数量\n\n${countList(errorTypeCounts)}\n`
  );

  fs.writeFileSync(
    path.join(outDir, "export-stats.json"),
    `${JSON.stringify({ total: rows.length, matchedCount, pendingCount, trainingGroupCounts, errorTypeCounts }, null, 2)}\n`
  );
}

function main() {
  const input = readArg("input", "");
  const outDir = path.resolve(readArg("out", DEFAULT_OUT_DIR));
  const rows = readWrongQuestions(path.resolve(input));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  writeQuestionFiles(rows, outDir);
  writeClassificationIndex(rows, outDir);
  writeTrainingDashboard(rows, outDir);
  writeSummary(rows, outDir);
  console.log(`EXPORTED_OBSIDIAN_ERROR_CLASSIFICATION ${rows.length} ${outDir}`);
}

main();
