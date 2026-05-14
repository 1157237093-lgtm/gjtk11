export const PENDING_CLASSIFICATION = {
  training_group: "待人工判断",
  error_type: "待人工判断",
  wrong_reason: "待人工判断",
  next_rule: "待人工补充",
};

export const TRAINING_GROUPS = [
  "01-材料核心效果判断",
  "02-选项边界二选一",
  "03-多选逐项定罪",
  "04-时政原话固定搭配",
  "05-哲学关键词识别",
  "06-法律公文管理硬规则",
  "07-文史科技常识",
  "08-反向否定题",
  "待人工判断",
];

export const ERROR_TYPES = [
  "材料核心效果判断不稳",
  "选项边界二选一误判",
  "多选漏选",
  "多选错选",
  "时政原话记忆不准",
  "哲学关键词混淆",
  "法律公文规则薄弱",
  "概念定义边界模糊",
  "时期时序数字记忆不牢",
  "文史科技常识缺口",
  "反向否定极性检查缺失",
  "审题粗心",
  "待人工判断",
];

export const manual_classification = {
  "issue-3-11-28::23": {
    training_group: "01-材料核心效果判断",
    error_type: "材料核心效果判断不稳",
    wrong_reason: "看到“主题展览、公益宣讲、科普活动”容易想成“形式创新”，但题干重点不是创新形式，而是扩大教育覆盖面。",
    next_rule: "看到“依托阵地、面向社会、普及教育”，优先找“延伸链条、扩大覆盖、夯实基础”。",
  },
};

const PAPER_TITLE_ALIASES = {
  "专项三": "专项三（11月28日）",
  "专项四": "专项四（12月15日）",
  "专项五": "专项五（12月29日）",
  "专项六": "专项六（1月15日）",
  "专项七": "专项七（1月28日）",
  "专项十": "专项十（3月16日）",
  "专项十一": "专项十一（3月30日）",
  "专项十二": "专项十二（4月17日）",
  "专项十三": "专项十三（4月28日）",
};

function compact(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizePaperTitle(value) {
  const raw = String(value || "").trim();
  return PAPER_TITLE_ALIASES[raw] || raw;
}

function questionText(question) {
  const options = Array.isArray(question?.options)
    ? question.options.map((option) => `${option?.label || ""}${option?.text || ""}`).join("\n")
    : "";
  return [
    question?.paperTitle,
    question?.paperId,
    question?.questionNo,
    question?.type,
    question?.module,
    question?.stem,
    options,
    question?.explanation,
    Array.isArray(question?.correctAnswer) ? question.correctAnswer.join("") : question?.correctAnswer,
    Array.isArray(question?.userAnswer) ? question.userAnswer.join("") : question?.userAnswer,
  ].filter(Boolean).join("\n");
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isMultiSelect(question, text) {
  return /多选/.test(String(question?.type || "")) || hasAny(text, ["下列说法正确的有", "下列选项正确的有", "多选题"]);
}

function isReverseQuestion(text) {
  return hasAny(text, [
    "不正确的是",
    "错误的是",
    "不属于",
    "不包括",
    "不能体现",
    "没有体现",
    "无关的是",
    "表述错误",
    "说法错误",
    "下列哪项不",
  ]);
}

function inferredClassification(question) {
  const rawText = questionText(question);
  const text = compact(rawText);

  if (isMultiSelect(question, text)) {
    return {
      training_group: "03-多选逐项定罪",
      error_type: "多选漏选",
      wrong_reason: "多选题不能找到两个确定项后停止，必须逐项核验每个选项的正误边界。",
      next_rule: "多选题按 A、B、C、D 逐项定罪，每项都写出保留或排除理由，最后再组合答案。",
      inferred_classification: true,
    };
  }

  if (isReverseQuestion(text)) {
    return {
      training_group: "08-反向否定题",
      error_type: "反向否定极性检查缺失",
      wrong_reason: "题干含否定或反向限定，容易按正向题处理。",
      next_rule: "先圈出“不正确、错误、不属于、不包括、不能体现”，再判断选项和题干方向是否一致。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["矛盾", "同一性", "斗争性", "量变", "质变", "否定之否定", "实践", "认识", "真理", "价值", "规律", "联系", "发展", "意识", "物质", "辩证法", "历史唯物主义", "唯物辩证法", "转危为机", "化险为夷", "危中有机"])) {
    return {
      training_group: "05-哲学关键词识别",
      error_type: "哲学关键词混淆",
      wrong_reason: "哲学题容易只看材料表面词，忽略关键词对应的固定原理。",
      next_rule: "先定位哲学关键词，再匹配原理，最后检查选项有没有偷换成其他哲学范畴。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["宪法", "民法典", "刑法", "行政法", "行政许可", "行政处罚", "行政复议", "行政诉讼", "监察法", "公务员法", "劳动合同", "法定", "法律责任", "管辖", "公文", "请示", "报告", "函", "通知", "决定", "纪要", "主送机关", "发文字号", "成文日期", "版记", "印发", "管理幅度", "管理层次", "组织结构", "公共管理"] )) {
    return {
      training_group: "06-法律公文管理硬规则",
      error_type: "法律公文规则薄弱",
      wrong_reason: "此类题主要考固定规则，不能靠材料语感猜。",
      next_rule: "先回忆法条、公文或管理学固定规则，再判断选项是否越权、错主体、错程序、错格式。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["朝代", "秦", "汉", "唐", "宋", "元", "明", "清", "春秋", "战国", "古代", "诗经", "论语", "史记", "资治通鉴", "杜甫", "李白", "苏轼", "物理", "化学", "生物", "地理", "天文", "节气", "太阳", "月球", "地震", "火山", "细胞", "基因", "疫苗", "芯片", "量子", "航天", "北斗"] )) {
    return {
      training_group: "07-文史科技常识",
      error_type: "文史科技常识缺口",
      wrong_reason: "题目依赖稳定常识或固定事实，无法通过材料推理完全推出。",
      next_rule: "把错误事实做成一问一答卡，优先记时间、主体、作品、概念和适用场景。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["党的二十届", "中央经济工作会议", "中央农村工作会议", "政府工作报告", "习近平", "总书记", "重要讲话", "重要指示", "中国式现代化", "新质生产力", "高质量发展", "全过程人民民主", "共同富裕", "两个维护", "四个意识", "四个自信", "五位一体", "四个全面", "人民至上", "自我革命", "两个确立", "三农", "乡村全面振兴"] )) {
    return {
      training_group: "04-时政原话固定搭配",
      error_type: "时政原话记忆不准",
      wrong_reason: "时政题常考原话搭配和政策表述，凭近义词替换容易选偏。",
      next_rule: "优先核对主语、谓语、对象、限定词和固定搭配，看到原文出处题要按原话判。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["主要意在", "主要表明", "主要体现", "体现了", "说明", "这说明", "表明", "旨在", "有利于", "作用", "目的", "意义", "反映出", "材料中", "以上做法", "上述做法", "上述材料", "这表明", "这体现"])) {
    return {
      training_group: "01-材料核心效果判断",
      error_type: "材料核心效果判断不稳",
      wrong_reason: "材料题的核心不是选择最顺眼的大词，而是找材料中主体、动作、对象和直接效果。",
      next_rule: "先圈主体、动作、对象、限定词，再把材料直接效果压缩成一句话，选项必须和这句话同层级。",
      inferred_classification: true,
    };
  }

  if (hasAny(text, ["最符合", "最佳", "应当", "更", "准确", "根本", "关键", "核心", "基础", "前提", "保障", "动力", "路径"])) {
    return {
      training_group: "02-选项边界二选一",
      error_type: "选项边界二选一误判",
      wrong_reason: "选项之间常只差层级、范围或限定词，容易选更大、更抽象、更顺口的一项。",
      next_rule: "二选一时比较主语、对象、范围、强度和领域，优先选和题干限定最贴的一项。",
      inferred_classification: true,
    };
  }

  return {
    training_group: "02-选项边界二选一",
    error_type: "概念定义边界模糊",
    wrong_reason: "当前题目没有命中更明确的固定规则，优先按概念边界和选项层级复盘。",
    next_rule: "把题干限定词逐个对应到选项，发现扩大范围、偷换主体、错换领域就排除。",
    inferred_classification: true,
  };
}

export function questionClassificationKey(question) {
  return `${String(question?.paperId || "").trim()}::${String(question?.questionNo || "").trim()}`;
}

export function questionTitleKey(question) {
  return `${normalizePaperTitle(question?.paperTitle)}::${String(question?.questionNo || "").trim()}`;
}

export function getManualClassification(question) {
  const keys = [
    questionClassificationKey(question),
    questionTitleKey(question),
    `${String(question?.paperTitle || "").trim()}::${String(question?.questionNo || "").trim()}`,
  ];
  return keys.map((key) => manual_classification[key]).find(Boolean) || null;
}

export function getObsidianClassification(question) {
  const manual = getManualClassification(question);
  const inferred = manual ? null : inferredClassification(question);
  return {
    ...PENDING_CLASSIFICATION,
    ...(inferred || {}),
    ...(manual || {}),
    manual_classification: Boolean(manual),
  };
}

export function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = String(item?.[field] || "未标记");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
