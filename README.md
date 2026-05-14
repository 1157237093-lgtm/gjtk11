# 公基题库工具

一个本地运行的公基刷题题库工具，支持从 PDF 题本和答案解析中导入题目，维护错题本、高危题库、猜对题库、背诵库，并导出 JSON、Markdown、CSV 数据。

## 功能概览

- 题本 PDF 导入：解析题干、选项、题型和期次信息。
- 答案 PDF 导入：匹配对应题本，写入正确答案和解析。
- 异常隔离：解析异常题目进入隔离记录，避免污染正常题库。
- 题库练习：支持做题状态、错题、高危题、猜对题和背诵库管理。
- 数据导出：支持 JSON、Markdown、CSV。
- 固定导入包：可从本地 PDF 目录生成 `autoload-data.js` 和导入报告。

## 项目结构

```text
.
├── index.html
├── styles.css
├── src/
│   ├── main.js
│   └── parser-core.js
├── scripts/
│   ├── build-fixed-import-bundle.mjs
│   └── verify-import.mjs
├── config/
│   ├── local-paths.example.json
│   └── local-paths.json
└── package.json
```

## 本地配置

脚本读取 `config/local-paths.json`。第一次运行前，需要复制 `config/local-paths.example.json` 为 `config/local-paths.json`，再把里面的路径改成本机真实路径。

`config/local-paths.json` 是本机私有配置，已加入 `.gitignore`，不应该提交到 GitHub。

字段说明：

- `rootDir`：iCloud 或本地资料根目录。
- `paperDir`：题本 PDF 所在目录。
- `answerDir`：答案解析 PDF 所在目录。
- `historicalTruthFile`：历年真题 PDF 文件。
- `outputBundle`：生成的 `autoload-data.js` 路径。
- `outputReport`：生成的导入报告 JSON 路径。
- `verifyFiles`：`npm run verify-import` 使用的抽样验证文件。

## 常用命令

```bash
npm install
npm run build
npm run verify-import
npm run export:obsidian-errors -- --input="/path/to/wrong-questions-latest.json" --out=obsidian-error-classification
npm run electron:start
```

## Obsidian 错题错因分类系统

项目内置 `manual_classification` 人工错因映射，位置在 `src/obsidian-error-classification.js`。所有错因分类只从该映射读取，不做自动推断。未匹配到人工映射的题目统一写入：

- `training_group: 待人工判断`
- `error_type: 待人工判断`
- `wrong_reason: 待人工判断`
- `next_rule: 待人工补充`

运行 `npm run export:obsidian-errors -- --input="/path/to/wrong-questions-latest.json" --out=obsidian-error-classification` 会生成：

- `obsidian-error-classification/题目/`：每道错题一个独立 Markdown 文件。
- `obsidian-error-classification/02-错因分类索引.md`：按错因训练组归档。
- `obsidian-error-classification/七组轮换训练看板.md`：七组轮换训练入口。
- `obsidian-error-classification/导出统计.md` 和 `export-stats.json`：匹配与待人工判断统计。

导出脚本只追加 Obsidian frontmatter 和复盘字段，不删除原题、选项、答案、解析，也不改写题干原文。

## 固定导入包

`npm run build` 会先复制 PDF worker，再根据 `config/local-paths.json` 扫描题本、答案解析和历年真题，生成：

- `autoload-data.js`
- `data/autoload-report.json`

如果路径不存在、配置缺失或 PDF 解析失败，脚本会输出带有路径和处理建议的错误信息。

## 当前维护边界

当前优先保持工具稳定可用，主要维护范围是导入配置、解析提示、导出和数据质量。`src/main.js` 暂时不拆分，首页 UI 暂时不做大改。
