# 导入字段说明

## 1. 题本导入

文件结构：

```json
{
  "paperId": "2025-Q1",
  "paperTitle": "2025 年第 1 期题本",
  "description": "可选说明",
  "questions": [
    {
      "questionNo": "1",
      "type": "单选题",
      "module": "基础知识",
      "stem": "题干",
      "options": [
        { "label": "A", "text": "选项内容" },
        { "label": "B", "text": "选项内容" }
      ]
    }
  ]
}
```

最少字段：

- `paperId`
- `paperTitle`
- `questions`
- `questionNo`
- `type`
- `module`
- `stem`
- `options`

说明：

- `paperId + questionNo` 共同定位一道题。
- `options` 支持字符串数组，也支持 `{ "label": "A", "text": "..." }` 结构。
- 题本导入时可以不带 `correctAnswer` 和 `explanation`。

## 2. 答案导入

文件结构：

```json
{
  "paperId": "2025-Q1",
  "answers": [
    {
      "questionNo": "1",
      "correctAnswer": "A",
      "explanation": "解析"
    }
  ]
}
```

说明：

- 单选题 `correctAnswer` 用字符串，例如 `"A"`。
- 多选题 `correctAnswer` 推荐用数组，例如 `["A", "C"]`。
- 导入时按 `paperId + questionNo` 回填 `correctAnswer` 和 `explanation`。

## 3. 题目持久化字段

应用内部每道题至少保留以下字段：

- `paperId`
- `paperTitle`
- `questionNo`
- `type`
- `stem`
- `options`
- `correctAnswer`
- `explanation`
- `module`
- `status`
- `userAnswer`
- `isWrong`
- `wrongReason`
- `updatedAt`
