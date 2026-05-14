export const PENDING_CLASSIFICATION = {
  training_group: "待人工判断",
  error_type: "待人工判断",
  wrong_reason: "待人工判断",
  next_rule: "待人工补充",
};

export const TRAINING_GROUPS = [
  "材料映射训练",
  "题眼识别训练",
  "选项边界训练",
  "概念辨析训练",
  "材料主旨训练",
  "审题稳定训练",
  "复盘巩固训练",
];

export const manual_classification = {
  "issue-3-11-28::23": {
    training_group: "材料映射训练",
    error_type: "材料映射",
    wrong_reason: "看到“主题展览、公益宣讲、科普活动”容易想成“形式创新”，但题干重点不是创新形式，而是扩大教育覆盖面。",
    next_rule: "看到“依托阵地、面向社会、普及教育”，优先找“延伸链条、扩大覆盖、夯实基础”。",
  },
};

export function questionClassificationKey(question) {
  return `${String(question?.paperId || "").trim()}::${String(question?.questionNo || "").trim()}`;
}

export function getManualClassification(question) {
  return manual_classification[questionClassificationKey(question)] || null;
}

export function getObsidianClassification(question) {
  const manual = getManualClassification(question);
  return {
    ...PENDING_CLASSIFICATION,
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
