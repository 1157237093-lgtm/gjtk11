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

项目内置 `manual_classification` 人工错因映射和既定规则分类入口，位置在 `src/obsidian-error-classification.js`。导出脚本只读取该文件返回的分类结果，不在导出阶段重新设计错因规则。未匹配到分类结果的题目统一写入：

- `training_group: 待人工判断`
- `error_type: 待人工判断`
- `wrong_reason: 待人工判断`
- `next_rule: 待人工补充`

运行 `npm run export:obsidian-errors -- --input="/path/to/wrong-questions-latest.json" --out=obsidian-error-classification` 会生成：

- `obsidian-error-classification/题目/`：每道错题一个独立 Markdown 文件。
- `obsidian-error-classification/00-今日训练看板.md`：按提分优先级展示每日训练入口。
- `obsidian-error-classification/01-七组轮换总览.md`：七组轮换训练总览。
- `obsidian-error-classification/02-错因分类索引.md`：按错因训练组归档。
- `obsidian-error-classification/03-材料盲拆训练.md`、`04-多选逐项定罪训练.md`、`05-二选一边界训练.md`、`06-时政原话快问快答.md`：专项训练入口。
- `obsidian-error-classification/07-考前只看规则卡.md`：去重后的 `next_rule` 考前规则卡。
- `obsidian-error-classification/导出统计.md` 和 `export-stats.json`：匹配与待人工判断统计。

导出脚本只追加 Obsidian frontmatter 和复盘字段，不删除原题、选项、答案、解析，也不改写题干原文。

## Obsidian 七组轮换错题训练用法

1. 打开 `00-今日训练看板.md`。
2. 先练 `01-材料核心效果判断`。
3. 再练 `03-多选逐项定罪`。
4. 每题先盲拆，不要展开答案。
5. 做完再展开答案。
6. 只补一句 `next_rule`。
7. 当天结束看 `07-考前只看规则卡.md`。

## 固定导入包

`npm run build` 会先复制 PDF worker，再根据 `config/local-paths.json` 扫描题本、答案解析和历年真题，生成：

- `autoload-data.js`
- `data/autoload-report.json`

如果路径不存在、配置缺失或 PDF 解析失败，脚本会输出带有路径和处理建议的错误信息。

## 当前维护边界

当前优先保持工具稳定可用，主要维护范围是导入配置、解析提示、导出和数据质量。`src/main.js` 暂时不拆分，首页 UI 暂时不做大改。
