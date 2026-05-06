# 公基题库工具

一个可部署为静态网页的公基刷题题库工具。公开网页默认不携带真实题库、答案、错题或背诵数据；用户自行导入 PDF / JSON 后，数据只保存在自己的浏览器本地。

## 功能概览

- 静态网页：可直接部署到 GitHub Pages、Netlify 或 Vercel。
- 题本导入：支持浏览器内导入 JSON 和可复制文本的 PDF。
- 答案导入：先导入题本，再把答案 PDF 匹配到对应题本。
- 题库练习：支持选择答案、查看答案、标记错题和背诵。
- 本地保存：题库和练习记录保存在用户自己的浏览器 `localStorage`。
- 数据导出：支持导出当前浏览器里的 JSON 数据。

## 项目结构

```text
.
├── index.html
├── styles.css
├── src/
│   └── main.js
├── scripts/
│   ├── build-fixed-import-bundle.mjs
│   └── verify-import.mjs
├── config/
│   ├── local-paths.example.json
│   └── local-paths.json
```

## 本地配置

本地批量导入脚本读取 `config/local-paths.json`。第一次运行前，需要复制 `config/local-paths.example.json` 为 `config/local-paths.json`，再把里面的路径改成本机真实路径。

`config/local-paths.json` 是本机私有配置，已加入 `.gitignore`，不应该提交到 GitHub。公开部署也不会使用它。

字段说明：

- `rootDir`：iCloud 或本地资料根目录。
- `paperDir`：题本 PDF 所在目录。
- `answerDir`：答案解析 PDF 所在目录。
- `historicalTruthFile`：历年真题 PDF 文件。
- `outputBundle`：生成的 `autoload-data.js` 路径。
- `outputReport`：生成的导入报告 JSON 路径。
- `verifyFiles`：`npm run verify-import` 使用的抽样验证文件。

## 常用命令

打开 `index.html` 即可本地试用静态版。部署到 GitHub Pages 时，发布仓库根目录即可。

## 固定导入包

`scripts/build-fixed-import-bundle.mjs` 会根据 `config/local-paths.json` 扫描本机资料并生成：

- `autoload-data.js`
- `data/autoload-report.json`

如果路径不存在、配置缺失或 PDF 解析失败，脚本会输出带有路径和处理建议的错误信息。

这些文件属于本机私有产物，已加入 `.gitignore`，不要部署到公开网页。

## 公开部署边界

会部署：

- `index.html`
- `styles.css`
- `src/main.js`
- `README.md`
- `config/local-paths.example.json`
- `scripts/` 中的本地辅助脚本

不会部署：

- `config/local-paths.json`
- `autoload-data.js`
- `data/autoload-report.json`
- 题本 PDF、答案 PDF
- 错题数据、背诵卡数据、浏览器导出的个人 JSON

## 当前维护边界

当前优先保持工具稳定可用，主要维护范围是导入配置、解析提示、导出和数据质量。`src/main.js` 暂时不拆分，首页 UI 暂时不做大改。
