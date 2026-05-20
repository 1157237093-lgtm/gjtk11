(() => {
  "use strict";

  const STORAGE_KEY = "staged-question-bank-v1";
  const PANEL_CLASS = "gpt-auto-question-card-link-panel";
  const TOOLBAR_ID = "gpt-auto-card-link-toolbar";
  const STYLE_ID = "gpt-auto-card-link-style";
  const EXPORT_NAME = "questionCardLinks-wrong-only.json";

  const MISTAKE_TYPES = [
    "把工具当主体",
    "把受益者当主体",
    "把背景词当答案",
    "把手段当目的",
    "把直接目的看成远期意义",
    "把选项大词拔高",
    "把相关项当同组项",
    "固定原话没记住",
    "事实清单漏背",
    "二选一边界混淆",
    "多选过度扩张",
    "多选漏选",
    "关键词没抓住",
    "选项偷换对象",
    "其他",
  ];

  const RULES = [
    {
      key: "material",
      label: "材料题总法",
      cardNeedles: ["材料题总法", "主要意在", "主要表明", "体现了什么", "材料映射", "问法"],
      pattern: /主要意在|主要表明|这说明|体现了|主要作用|以上做法|以上措施|主要目的|目的在于|启示|这表明/,
      mistakeType: "关键词没抓住",
      nextTimeRule: "下次先拆主体、动作、对象、直接目的；不要先看哪个选项顺眼。",
    },
    {
      key: "multi",
      label: "多选同组判断",
      cardNeedles: ["多选", "同组", "错选漏选", "多选同组"],
      pattern: /多选题|下列.*有|包括|属于|正确的有|内容包括|措施.*有|体现.*有/,
      mistakeType: "把相关项当同组项",
      nextTimeRule: "多选先判断题干问的是哪一组；相关但不同组，不选。",
    },
    {
      key: "consume",
      label: "消费题：场景/供给/潜力/机制",
      cardNeedles: ["消费", "首发经济", "票根", "消费场景", "释放消费潜力"],
      pattern: /消费券|首发经济|票根|消费场景|服务消费|商旅文体健|展会|新地标|消费潜力|扩大内需|国际消费中心|离境退税|入境消费|以旧换新|消费供给/,
      mistakeType: "把背景词当答案",
      nextTimeRule: "下次看到消费，先分需求端、供给端、场景端、机制端；首发经济、展会、新地标优先判消费场景。",
    },
    {
      key: "livelihood",
      label: "民生题：资源配置/服务可及性",
      cardNeedles: ["民生", "养老", "服务可及性", "资源配置", "15分钟"],
      pattern: /养老|老年人|15\s*分钟|家门口|社区服务|助餐|适老化|无障碍|医疗|教育公共服务|普惠性|可及性|便捷性|社会救助|保障网|社保|就业/,
      mistakeType: "把手段当目的",
      nextTimeRule: "下次看到家门口、15分钟、社区服务，优先判服务可及性或民生资源配置；低保救助兜底才判保障网。",
    },
    {
      key: "digital",
      label: "数字赋能题：技术服务场景",
      cardNeedles: ["数字赋能", "AI", "人工智能", "平台", "智慧监管", "互联网+"],
      pattern: /AI|人工智能|数字技术|数字化|智慧监管|智能监管|互联网\+|平台|数据共享|非现场执法|全时段化|一证式|电子证照|扫码|自动预警|智能监控/,
      mistakeType: "把工具当主体",
      nextTimeRule: "下次看到AI、平台、数据，先问它服务哪个场景；技术是工具，场景定答案。",
    },
    {
      key: "tech",
      label: "科技创新题：技术供给/成果转化/协同机制",
      cardNeedles: ["科技创新", "技术供给", "成果转化", "产学研", "创新链"],
      pattern: /高校|企业|产学研|创新链|产业链|资金链|人才链|成果转化|技术供给|前沿技术|科研攻关|委托研发|校企|人才双向流动|科技小院|科技创新/,
      mistakeType: "把受益者当主体",
      nextTimeRule: "下次看到高校为企业提供前沿技术，主卡判技术供给；企业多半是受益对象，不直接选企业竞争力。",
    },
    {
      key: "governance",
      label: "社会治理题：基层/源头/全链条治理",
      cardNeedles: ["社会治理", "枫桥", "信访", "基层治理", "全链条治理"],
      pattern: /枫桥|信访|扫黑除恶|电信诈骗|非法集资|黄赌毒|矛盾纠纷|基层治理|社会治理|共建共治共享|网格|源头治理|萌芽状态|四下基层|社会治安/,
      mistakeType: "选项偷换对象",
      nextTimeRule: "下次看到枫桥、信访、矛盾化解、扫黑除恶，优先判社会治理；不要拔高成国家安全体系。",
    },
    {
      key: "agriQuality",
      label: "农业质量题：标准化/追溯/闭环监管",
      cardNeedles: ["农业", "质量农业", "标准化", "追溯", "闭环监管"],
      pattern: /标准化|追溯|闭环监管|农产品质量|质量安全|生产基地|网格化管理|全链条监管|从产地到市场|合作社|联农带农|乡村特色产业|农民增收/,
      mistakeType: "把工具当主体",
      nextTimeRule: "下次看到标准化、追溯、闭环监管，先判质量农业；智慧平台只是工具，不直接选科技农业。",
    },
    {
      key: "ecology",
      label: "生态题：绿色转型/生态监管/系统治理",
      cardNeedles: ["生态", "绿色", "山水林田湖草沙", "排污", "美丽中国"],
      pattern: /生态|绿色|山水林田湖草沙|排污|环保|碳|非化石能源|美丽中国|污染防控|环境监管|绿色转型|生态文明|气候治理/,
      mistakeType: "把背景词当答案",
      nextTimeRule: "下次看到生态，先分绿色转型、生态监管、系统治理、辩证统一；不要只看绿色大词。",
    },
    {
      key: "city",
      label: "城市题：生活空间/发展活力/安全韧性/治理水平",
      cardNeedles: ["城市", "城市更新", "韧性", "老旧街区", "好房子"],
      pattern: /城市更新|好房子|危旧房|老旧街区|旧厂区|商业街|烟火气|韧性城市|吹哨报到|城市治理|生活圈|宜居|安居/,
      mistakeType: "把背景词当答案",
      nextTimeRule: "城市题按四分法：住得好=生活空间，街区活=发展活力，防风险=安全韧性，管得顺=治理水平。",
    },
    {
      key: "culture",
      label: "文化文旅题：参与/体验/传播/转化",
      cardNeedles: ["文化", "文旅", "文创", "IP", "沉浸式", "盲盒"],
      pattern: /文旅|博物馆|文创|IP|盲盒|沉浸式|AR|VR|演艺|文化遗产|传统村落|非遗|数字展厅|游客|寻根|传播|文博/,
      mistakeType: "把手段当目的",
      nextTimeRule: "文化题不要只看载体新不新；先看它是让群众参与、体验、传播，还是做文创转化。",
    },
    {
      key: "philosophyTransform",
      label: "哲学题：矛盾同一性/转化",
      cardNeedles: ["哲学", "矛盾同一性", "转危为机", "化险为夷"],
      pattern: /转危为机|化险为夷|危中有机|相互转化|同一性|否定理解|居安思危|辩证统一|矛盾/,
      mistakeType: "关键词没抓住",
      nextTimeRule: "哲学题看到转危为机、化险为夷，先判矛盾同一性；看到山水林田湖草沙才优先系统思维。",
    },
    {
      key: "fixedQuote",
      label: "固定原话/事实清单题",
      cardNeedles: ["固定原话", "固定搭配", "清单", "原话", "事实清单"],
      pattern: /（\s*）|锐利武器|传家宝|第一需求|辞书之祖|四渎|四汛|全球治理倡议|普惠包容|两个结合|历史唯物主义|平安|社会救助|尔雅|淮南子/,
      mistakeType: "固定原话没记住",
      nextTimeRule: "固定原话题不要材料推理，只背触发词、整组搭配、易混替身。",
    },
  ];

  injectStyle();
  installToolbar();
  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("storage", scheduleRender);
  scheduleRender();

  function scheduleRender() {
    clearTimeout(scheduleRender.timer);
    scheduleRender.timer = setTimeout(renderAutoCardLinkUI, 180);
  }

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function getQuestions(store) {
    return Array.isArray(store.questions) ? store.questions : [];
  }

  function getCards(store) {
    return Array.isArray(store.recitationCards) ? store.recitationCards : [];
  }

  function getLinks(store) {
    if (!Array.isArray(store.questionCardLinks)) {
      store.questionCardLinks = [];
    }
    return store.questionCardLinks;
  }

  function questionKey(question) {
    return `${question.paperId || "unknown"}-${question.questionNo || "unknown"}`;
  }

  function isWrongQuestion(question) {
    return question?.isWrong === true || question?.status === "wrong";
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[\u200b\ufeff]/g, "")
      .toLowerCase();
  }

  function questionText(question) {
    const options = Array.isArray(question.options)
      ? question.options.map((option) => `${option.label || ""}${option.text || option}`).join(" ")
      : "";
    return [question.type, question.stem, options, question.correctAnswer, question.explanation].join(" ");
  }

  function cardText(card) {
    return [
      card.id,
      card.cardId,
      card.title,
      card.category,
      card.recitePoint,
      card.keyword,
      Array.isArray(card.keywords) ? card.keywords.join(" ") : card.keywords,
      Array.isArray(card.tags) ? card.tags.join(" ") : card.tags,
      card.front,
      card.back,
      card.coreRule,
      card.rule,
    ].join(" ");
  }

  function getCardId(card) {
    return card?.cardId || card?.id || card?.title || "";
  }

  function findCardByRule(rule, cards) {
    const needles = rule.cardNeedles || [rule.label];
    const normalizedNeedles = needles.map(normalizeText);
    return cards.find((card) => {
      const text = normalizeText(cardText(card));
      return normalizedNeedles.some((needle) => needle && text.includes(needle));
    });
  }

  function resolveCardId(rule, cards) {
    const card = findCardByRule(rule, cards);
    return card ? getCardId(card) : `auto:${rule.key}`;
  }

  function cardLabel(cardId, cards) {
    const card = cards.find((item) => getCardId(item) === cardId);
    if (card) {
      return card.title || card.recitePoint || card.category || cardId;
    }
    const rule = RULES.find((item) => `auto:${item.key}` === cardId);
    return rule?.label || cardId;
  }

  function matchRules(question) {
    const text = questionText(question);
    const hits = RULES.filter((rule) => {
      if (rule.key === "multi" && /多选/.test(String(question.type || ""))) return true;
      return rule.pattern.test(text);
    });
    return hits;
  }

  function choosePrimaryRule(hits, question) {
    const has = (key) => hits.some((rule) => rule.key === key);
    const text = questionText(question);
    if (/多选/.test(String(question.type || "")) && has("multi")) return hits.find((rule) => rule.key === "multi");
    if (has("agriQuality") && /标准化|追溯|闭环监管|农产品质量|质量安全/.test(text)) return hits.find((rule) => rule.key === "agriQuality");
    if (has("consume") && /首发经济|票根|展会|新地标|消费场景|商旅文体健|离境退税|入境消费/.test(text)) return hits.find((rule) => rule.key === "consume");
    if (has("tech") && /高校|企业|产学研|技术供给|前沿技术|成果转化|校企/.test(text)) return hits.find((rule) => rule.key === "tech");
    if (has("governance") && /枫桥|信访|扫黑除恶|电信诈骗|非法集资|矛盾纠纷/.test(text)) return hits.find((rule) => rule.key === "governance");
    if (has("livelihood") && /养老|老年人|15\s*分钟|家门口|社区服务|适老化|无障碍|社会救助/.test(text)) return hits.find((rule) => rule.key === "livelihood");
    if (has("digital") && /监管|执法|排污|非现场|全时段|智慧监管|智能监控/.test(text)) return hits.find((rule) => rule.key === "digital");
    const priority = ["culture", "city", "ecology", "philosophyTransform", "fixedQuote", "digital", "material"];
    return hits.find((rule) => priority.includes(rule.key)) || hits[0] || RULES.find((rule) => rule.key === "material");
  }

  function confidenceFor(hits, primary) {
    if (!primary) return "low";
    if (hits.length >= 2) return "high";
    return primary.key === "material" || primary.key === "fixedQuote" ? "medium" : "high";
  }

  function buildMatchReasons(question, hits, primary) {
    const text = questionText(question);
    const reasons = [];
    if (primary) reasons.push(`主卡命中：${primary.label}`);
    const keywords = [];
    [
      "AI", "人工智能", "智慧监管", "平台", "标准化", "追溯", "首发经济", "15分钟", "养老", "高校", "企业",
      "枫桥", "信访", "扫黑除恶", "文创", "盲盒", "山水林田湖草沙", "转危为机", "化险为夷",
    ].forEach((word) => {
      if (text.includes(word)) keywords.push(word);
    });
    if (keywords.length) reasons.push(`题干/解析包含：${keywords.slice(0, 8).join("、")}`);
    if (/主要意在|主要表明|体现了|这表明|以上做法/.test(text)) reasons.push("问法属于材料映射题，需要归到材料题总法作辅助。");
    if (/多选/.test(String(question.type || ""))) reasons.push("题型为多选，需按同组判断。");
    if (!reasons.length) reasons.push("未命中强关键词，按材料题通用规则兜底。建议人工检查一次。");
    return reasons;
  }

  function autoMatchQuestionToCards(question, cards) {
    const hits = matchRules(question);
    const primaryRule = choosePrimaryRule(hits, question);
    const primaryCardId = resolveCardId(primaryRule, cards);
    const helperRules = hits
      .filter((rule) => rule.key !== primaryRule.key)
      .filter((rule) => ["material", "multi", "digital", "fixedQuote"].includes(rule.key) || hits.length <= 3)
      .slice(0, 3);
    const helperCardIds = helperRules.map((rule) => resolveCardId(rule, cards));
    const cardIds = Array.from(new Set([primaryCardId, ...helperCardIds].filter(Boolean)));
    return {
      questionKey: questionKey(question),
      paperId: question.paperId || "",
      paperTitle: question.paperTitle || "",
      questionNo: question.questionNo || "",
      cardIds,
      primaryCardId,
      autoMatched: true,
      matchConfidence: confidenceFor(hits, primaryRule),
      matchReasons: buildMatchReasons(question, hits, primaryRule),
      mistakeType: primaryRule?.mistakeType || "关键词没抓住",
      nextTimeRule: primaryRule?.nextTimeRule || "下次先找核心动词，再给名词贴角色。",
      source: "wrong-question-bank",
      updatedAt: new Date().toISOString(),
    };
  }

  function findQuestionForElement(element, questions) {
    const text = normalizeText(element.innerText || element.textContent || "");
    const noMatch = text.match(/q\s*([0-9０-９]+)/i) || text.match(/第\s*([0-9０-９]+)\s*题/);
    const questionNo = noMatch ? toHalfWidth(noMatch[1]) : "";
    const candidates = questionNo ? questions.filter((question) => String(question.questionNo) === questionNo) : questions;
    return candidates.find((question) => {
      const stem = normalizeText(question.stem).slice(0, 24);
      return stem && text.includes(stem.slice(0, Math.min(18, stem.length)));
    });
  }

  function toHalfWidth(value) {
    return String(value || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
  }

  function isQuestionContainer(element) {
    const text = element.innerText || element.textContent || "";
    if (!/Q\s*\d+|第\s*\d+\s*题/.test(text)) return false;
    if (!/A|B|C|D/.test(text)) return false;
    return /提交|做本题|正确答案|我的答案|错因|解析|选项/.test(text);
  }

  function visibleQuestionContainers() {
    const roots = [document.getElementById("wrong-list"), document.getElementById("paper-question-list")].filter(Boolean);
    const containers = [];
    roots.forEach((root) => {
      Array.from(root.children).forEach((child) => {
        if (isQuestionContainer(child)) containers.push(child);
      });
    });
    return containers;
  }

  function shouldShowPanelFor(question, container) {
    if (!question) return false;
    if (isWrongQuestion(question)) return true;
    const text = container.innerText || container.textContent || "";
    return /回答错误|继续保留在错题|已转入错题/.test(text);
  }

  function renderAutoCardLinkUI() {
    installToolbar();
    const store = loadStore();
    const questions = getQuestions(store);
    const cards = getCards(store);
    visibleQuestionContainers().forEach((container) => {
      const question = findQuestionForElement(container, questions);
      const oldPanel = container.querySelector(`.${PANEL_CLASS}`);
      if (!shouldShowPanelFor(question, container)) {
        oldPanel?.remove();
        return;
      }
      const suggestion = getExistingLink(store, question) || autoMatchQuestionToCards(question, cards);
      if (oldPanel) {
        oldPanel.dataset.questionKey = questionKey(question);
        return;
      }
      container.appendChild(createPanel(question, suggestion, cards));
    });
    updateToolbarStats();
  }

  function getExistingLink(store, question) {
    return getLinks(store).find((link) => link.questionKey === questionKey(question));
  }

  function upsertLink(link) {
    const store = loadStore();
    const links = getLinks(store);
    const index = links.findIndex((item) => item.questionKey === link.questionKey);
    const next = { ...link, updatedAt: new Date().toISOString(), source: "wrong-question-bank" };
    if (index >= 0) links[index] = next;
    else links.push(next);
    saveStore(store);
    return next;
  }

  function createPanel(question, suggestion, cards) {
    const panel = document.createElement("section");
    panel.className = PANEL_CLASS;
    panel.dataset.questionKey = questionKey(question);
    panel.innerHTML = `
      <div class="gpt-card-link-head">
        <div>
          <strong>错题归卡｜系统已自动推荐</strong>
          <p>不用手动从全部卡片里找，先确认；不准再点“修改”。</p>
        </div>
        <span class="gpt-confidence">${escapeHtml(confidenceText(suggestion.matchConfidence))}</span>
      </div>
      <div class="gpt-card-link-grid">
        <div><span>主卡</span><b data-role="primary-label">${escapeHtml(cardLabel(suggestion.primaryCardId, cards))}</b></div>
        <div><span>辅助卡</span><b data-role="helper-label">${escapeHtml(suggestion.cardIds.filter((id) => id !== suggestion.primaryCardId).map((id) => cardLabel(id, cards)).join("、") || "无")}</b></div>
        <div><span>误识别类型</span><b data-role="mistake-label">${escapeHtml(suggestion.mistakeType)}</b></div>
      </div>
      <label class="gpt-next-rule">下次规则<textarea data-role="next-rule" rows="2">${escapeHtml(suggestion.nextTimeRule)}</textarea></label>
      <div class="gpt-match-reasons">${suggestion.matchReasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
      <div class="gpt-card-link-actions">
        <button type="button" data-action="confirm" class="primary">确认归卡</button>
        <button type="button" data-action="modify" class="secondary">修改</button>
        <button type="button" data-action="expand" class="ghost">展开全部卡片</button>
      </div>
      <div class="gpt-manual-editor" hidden></div>
    `;
    panel.__suggestion = suggestion;
    panel.addEventListener("click", (event) => handlePanelClick(event, panel, question));
    return panel;
  }

  function handlePanelClick(event, panel, question) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    const store = loadStore();
    const cards = getCards(store);
    const suggestion = panel.__suggestion || autoMatchQuestionToCards(question, cards);
    if (action === "confirm") {
      const nextRule = panel.querySelector('[data-role="next-rule"]')?.value || suggestion.nextTimeRule;
      upsertLink({ ...suggestion, nextTimeRule: nextRule });
      flashLocal(panel, "已确认归卡");
      updateToolbarStats();
      return;
    }
    if (action === "modify" || action === "expand") {
      const editor = panel.querySelector(".gpt-manual-editor");
      if (!editor) return;
      if (editor.hidden) {
        editor.innerHTML = buildManualEditorHtml(suggestion, cards);
        editor.hidden = false;
      } else if (action === "modify") {
        editor.hidden = true;
      }
      return;
    }
    if (action === "save-manual") {
      const editor = panel.querySelector(".gpt-manual-editor");
      const primaryCardId = editor?.querySelector('[data-role="primary-card"]')?.value || suggestion.primaryCardId;
      const helperCardIds = Array.from(editor?.querySelectorAll('[data-role="helper-card"]:checked') || []).map((input) => input.value);
      const mistakeType = editor?.querySelector('[data-role="mistake-type"]')?.value || suggestion.mistakeType;
      const nextRule = panel.querySelector('[data-role="next-rule"]')?.value || suggestion.nextTimeRule;
      const cardIds = Array.from(new Set([primaryCardId, ...helperCardIds].filter(Boolean)));
      const link = upsertLink({
        ...suggestion,
        primaryCardId,
        cardIds,
        mistakeType,
        nextTimeRule: nextRule,
        autoMatched: false,
        matchConfidence: "manual",
        matchReasons: ["用户手动修改归卡。"],
      });
      panel.__suggestion = link;
      panel.querySelector('[data-role="primary-label"]').textContent = cardLabel(primaryCardId, cards);
      panel.querySelector('[data-role="helper-label"]').textContent = cardIds.filter((id) => id !== primaryCardId).map((id) => cardLabel(id, cards)).join("、") || "无";
      panel.querySelector('[data-role="mistake-label"]').textContent = mistakeType;
      flashLocal(panel, "已保存修改");
      updateToolbarStats();
    }
  }

  function buildManualEditorHtml(suggestion, cards) {
    const availableCards = cards.length
      ? cards.map((card) => ({ id: getCardId(card), label: cardLabel(getCardId(card), cards) }))
      : RULES.map((rule) => ({ id: `auto:${rule.key}`, label: rule.label }));
    const options = availableCards
      .map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === suggestion.primaryCardId ? "selected" : ""}>${escapeHtml(card.label)}</option>`)
      .join("");
    const helpers = availableCards
      .map((card) => `<label><input type="checkbox" data-role="helper-card" value="${escapeHtml(card.id)}" ${suggestion.cardIds.includes(card.id) && card.id !== suggestion.primaryCardId ? "checked" : ""}> ${escapeHtml(card.label)}</label>`)
      .join("");
    const mistakeOptions = MISTAKE_TYPES.map((type) => `<option value="${escapeHtml(type)}" ${type === suggestion.mistakeType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("");
    return `
      <div class="gpt-manual-row"><label>主卡<select data-role="primary-card">${options}</select></label></div>
      <div class="gpt-manual-row"><label>误识别类型<select data-role="mistake-type">${mistakeOptions}</select></label></div>
      <div class="gpt-helper-list">${helpers}</div>
      <button type="button" data-action="save-manual" class="primary">保存修改</button>
    `;
  }

  function installToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = `
      <strong>错题自动归卡</strong>
      <span data-role="stats">未归卡：-</span>
      <button type="button" data-action="batch">批量自动归卡全部未归卡错题</button>
      <button type="button" data-action="export">导出归卡 JSON</button>
    `;
    toolbar.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (action === "batch") batchAutoLinkWrongQuestions();
      if (action === "export") exportLinksJson();
    });
    document.body.appendChild(toolbar);
    updateToolbarStats();
  }

  function updateToolbarStats() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;
    const store = loadStore();
    const wrongQuestions = getQuestions(store).filter(isWrongQuestion);
    const linkedKeys = new Set(getLinks(store).map((link) => link.questionKey));
    const linked = wrongQuestions.filter((question) => linkedKeys.has(questionKey(question))).length;
    const unlinked = Math.max(0, wrongQuestions.length - linked);
    toolbar.querySelector('[data-role="stats"]').textContent = `错题：${wrongQuestions.length}｜已归卡：${linked}｜未归卡：${unlinked}`;
  }

  function batchAutoLinkWrongQuestions() {
    const store = loadStore();
    const cards = getCards(store);
    const links = getLinks(store);
    const linkedKeys = new Set(links.map((link) => link.questionKey));
    const todo = getQuestions(store).filter(isWrongQuestion).filter((question) => !linkedKeys.has(questionKey(question)));
    todo.forEach((question) => links.push(autoMatchQuestionToCards(question, cards)));
    saveStore(store);
    updateToolbarStats();
    alert(`已批量自动归卡 ${todo.length} 道未归卡错题。`);
    scheduleRender();
  }

  function exportLinksJson() {
    const store = loadStore();
    const wrongKeys = new Set(getQuestions(store).filter(isWrongQuestion).map(questionKey));
    const rows = getLinks(store).filter((link) => wrongKeys.has(link.questionKey));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), source: "wrong-question-bank", count: rows.length, questionCardLinks: rows }, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = EXPORT_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function confidenceText(value) {
    if (value === "high") return "高置信";
    if (value === "medium") return "中置信";
    if (value === "low") return "低置信";
    if (value === "manual") return "手动修改";
    return "自动推荐";
  }

  function flashLocal(panel, text) {
    let tip = panel.querySelector(".gpt-local-tip");
    if (!tip) {
      tip = document.createElement("span");
      tip.className = "gpt-local-tip";
      panel.querySelector(".gpt-card-link-actions")?.appendChild(tip);
    }
    tip.textContent = text;
    clearTimeout(tip.timer);
    tip.timer = setTimeout(() => (tip.textContent = ""), 1800);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TOOLBAR_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: min(760px, calc(100vw - 32px)); padding: 10px 12px; border: 1px solid #d7c7a4; border-radius: 14px; background: rgba(255, 252, 244, .96); box-shadow: 0 12px 28px rgba(0,0,0,.14); font-size: 13px; }
      #${TOOLBAR_ID} button, .${PANEL_CLASS} button { border: 1px solid #d8caaa; border-radius: 999px; padding: 6px 10px; background: #fffaf0; cursor: pointer; }
      #${TOOLBAR_ID} button:hover, .${PANEL_CLASS} button:hover { filter: brightness(.98); }
      .${PANEL_CLASS} { margin-top: 14px; padding: 14px; border: 1px solid #d9c6a3; border-radius: 16px; background: #fffaf0; box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
      .gpt-card-link-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
      .gpt-card-link-head p { margin: 4px 0 0; color: #80683e; font-size: 13px; }
      .gpt-confidence { border-radius: 999px; padding: 4px 8px; background: #f1e3c4; color: #5f431b; white-space: nowrap; }
      .gpt-card-link-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 10px 0; }
      .gpt-card-link-grid div { padding: 8px; border: 1px solid #eadcbd; border-radius: 12px; background: #fffdf8; }
      .gpt-card-link-grid span { display: block; color: #8c7653; font-size: 12px; margin-bottom: 4px; }
      .gpt-card-link-grid b { font-weight: 700; color: #2f2416; }
      .gpt-next-rule { display: block; font-size: 13px; color: #6c593a; }
      .gpt-next-rule textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; border: 1px solid #d7c7a4; border-radius: 10px; padding: 8px; background: #fff; resize: vertical; }
      .gpt-match-reasons { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
      .gpt-match-reasons span { border-radius: 999px; background: #f3ead7; padding: 4px 8px; color: #66502d; font-size: 12px; }
      .gpt-card-link-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .gpt-card-link-actions .primary, .gpt-manual-editor .primary { background: #1e6f5c; color: #fff; border-color: #1e6f5c; }
      .gpt-card-link-actions .secondary { background: #fff; }
      .gpt-card-link-actions .ghost { background: transparent; }
      .gpt-local-tip { color: #1e6f5c; font-weight: 700; }
      .gpt-manual-editor { margin-top: 12px; border-top: 1px dashed #d7c7a4; padding-top: 12px; }
      .gpt-manual-row { margin-bottom: 10px; }
      .gpt-manual-row select { margin-left: 8px; max-width: 100%; }
      .gpt-helper-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; max-height: 240px; overflow: auto; padding: 8px; border: 1px solid #eadcbd; border-radius: 12px; background: #fffdf8; margin-bottom: 10px; }
      .gpt-helper-list label { font-size: 13px; }
    `;
    document.head.appendChild(style);
  }
})();
