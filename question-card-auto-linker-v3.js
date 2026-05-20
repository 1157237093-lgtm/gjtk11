(() => {
  "use strict";

  const STORAGE_KEY = "staged-question-bank-v1";
  const PANEL_CLASS = "gpt-auto-selected-card-panel";
  const TOOLBAR_ID = "gpt-auto-selected-card-toolbar";
  const STYLE_ID = "gpt-auto-selected-card-style";
  const EXPORT_NAME = "questionCardLinks-wrong-only.json";

  const RULES = [
    ["multi", "多选同组判断", /多选题|正确的有|下列.*有|包括|属于|内容包括/, "把相关项当同组项", "多选先判断题干问的是哪一组；相关但不同组不选。", ["多选", "同组", "错选漏选"]],
    ["educationPublicity", "宣传教育题：阵地活动/意识培育", /生态文明教育|文明实践中心|科普场馆|主题展览|公益宣讲|科普活动|节约意识|环保意识|法治意识|责任意识|良好风气|普及.*教育|培育公众|教育链条|教育基础|协同育人|课程体系/, "把背景词当答案", "下次看到文明实践中心、科普场馆、主题展览、公益宣讲、科普活动，先判宣传教育/延伸教育链条；不要因为有“生态”二字就选生态治理、绿色转型。", ["宣传教育", "生态文明教育", "教育链条", "意识培育", "文明实践"]],
    ["agriQuality", "农业质量题：标准化/追溯/闭环监管", /标准化|追溯|闭环监管|农产品质量|质量安全|全链条监管|从产地到市场|网格化管理/, "把工具当主体", "下次看到标准化、追溯、闭环监管，先判质量农业；智慧平台只是工具，不直接选科技农业。", ["农业", "质量农业", "标准化", "追溯"]],
    ["consume", "消费题：场景/供给/潜力/机制", /消费券|首发经济|票根|消费场景|服务消费|商旅文体健|展会|新地标|消费潜力|扩大内需|离境退税|以旧换新/, "把背景词当答案", "下次看到消费，先分需求端、供给端、场景端、机制端；首发经济、展会、新地标优先判消费场景。", ["消费", "首发经济", "消费场景"]],
    ["livelihood", "民生题：资源配置/服务可及性", /养老|老年人|15\s*分钟|家门口|社区服务|助餐|适老化|无障碍|医疗|教育公共服务|普惠性|可及性|社会救助|保障网|就业/, "把手段当目的", "下次看到家门口、15分钟、社区服务，优先判服务可及性或民生资源配置；低保救助兜底才判保障网。", ["民生", "养老", "服务可及性", "资源配置"]],
    ["tech", "科技创新题：技术供给/成果转化/协同机制", /高校|企业|产学研|创新链|产业链|资金链|人才链|成果转化|技术供给|前沿技术|科研攻关|委托研发|校企|科技小院/, "把受益者当主体", "下次看到高校为企业提供前沿技术，主卡判技术供给；企业多半是受益对象，不直接选企业竞争力。", ["科技创新", "技术供给", "成果转化", "产学研"]],
    ["governance", "社会治理题：基层/源头/全链条治理", /枫桥|信访|扫黑除恶|电信诈骗|非法集资|矛盾纠纷|基层治理|社会治理|共建共治共享|源头治理|萌芽状态/, "选项偷换对象", "下次看到枫桥、信访、矛盾化解、扫黑除恶，优先判社会治理；不要拔高成国家安全体系。", ["社会治理", "枫桥", "信访", "基层治理"]],
    ["digital", "数字赋能题：技术服务场景", /AI|人工智能|数字技术|数字化|智慧监管|智能监管|互联网\+|平台|数据共享|非现场执法|电子证照|扫码|自动预警|智能监控/, "把工具当主体", "下次看到AI、平台、数据，先问它服务哪个场景；技术是工具，场景定答案。", ["数字赋能", "AI", "平台", "智慧监管"]],
    ["ecology", "生态题：绿色转型/生态监管/系统治理", /生态|绿色|山水林田湖草沙|排污|环保|碳|非化石能源|美丽中国|污染防控|环境监管|气候治理/, "把背景词当答案", "下次看到生态，先分绿色转型、生态监管、系统治理、辩证统一；不要只看绿色大词。", ["生态", "绿色", "排污", "美丽中国"]],
    ["city", "城市题：生活空间/发展活力/安全韧性/治理水平", /城市更新|好房子|危旧房|老旧街区|旧厂区|商业街|烟火气|韧性城市|吹哨报到|城市治理|宜居|安居/, "把背景词当答案", "城市题按四分法：住得好=生活空间，街区活=发展活力，防风险=安全韧性，管得顺=治理水平。", ["城市", "城市更新", "韧性", "好房子"]],
    ["culture", "文化文旅题：参与/体验/传播/转化", /文旅|博物馆|文创|IP|盲盒|沉浸式|AR|VR|演艺|文化遗产|非遗|游客|传播|文博/, "把手段当目的", "文化题不要只看载体新不新；先看它是让群众参与、体验、传播，还是做文创转化。", ["文化", "文旅", "文创", "IP", "沉浸式"]],
    ["philosophy", "哲学题：矛盾同一性/转化", /转危为机|化险为夷|危中有机|相互转化|同一性|辩证统一|矛盾/, "关键词没抓住", "哲学题看到转危为机、化险为夷，先判矛盾同一性；看到山水林田湖草沙才优先系统思维。", ["哲学", "矛盾同一性", "转危为机"]],
    ["fixedQuote", "固定原话/事实清单题", /锐利武器|传家宝|第一需求|辞书之祖|四渎|四汛|全球治理倡议|普惠包容|两个结合|平安|社会救助|尔雅|淮南子/, "固定原话没记住", "固定原话题不要材料推理，只背触发词、整组搭配、易混替身。", ["固定原话", "固定搭配", "事实清单"]],
    ["material", "材料题总法", /主要意在|主要表明|这说明|体现了|主要作用|以上做法|主要目的|目的在于|启示|这表明/, "关键词没抓住", "下次先拆主体、动作、对象、直接目的；不要先看哪个选项顺眼。", ["材料题总法", "主要意在", "材料映射"]],
  ].map(([key, label, pattern, mistakeType, nextTimeRule, cardNeedles]) => ({ key, label, pattern, mistakeType, nextTimeRule, cardNeedles }));

  injectStyle();
  installToolbar();
  new MutationObserver(scheduleRender).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("storage", scheduleRender);
  scheduleRender();

  function scheduleRender() {
    clearTimeout(scheduleRender.timer);
    scheduleRender.timer = setTimeout(render, 160);
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch { return {}; }
  }
  function saveStore(store) { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  function questions(store) { return Array.isArray(store.questions) ? store.questions : []; }
  function cards(store) { return Array.isArray(store.recitationCards) ? store.recitationCards : []; }
  function links(store) { if (!Array.isArray(store.questionCardLinks)) store.questionCardLinks = []; return store.questionCardLinks; }
  function qKey(q) { return `${q.paperId || "unknown"}-${q.questionNo || "unknown"}`; }
  function isWrong(q) { return q?.isWrong === true || q?.status === "wrong"; }
  function normalize(s) { return String(s || "").replace(/\s+/g, "").replace(/[\u200b\ufeff]/g, "").toLowerCase(); }
  function qText(q) {
    const opts = Array.isArray(q.options) ? q.options.map(o => `${o.label || ""}${o.text || o}`).join(" ") : "";
    return [q.type, q.stem, opts, q.correctAnswer, q.explanation, q.analysis].join(" ");
  }
  function cardId(card) { return card?.cardId || card?.id || card?.title || ""; }
  function cardText(card) { return [card.title, card.category, card.recitePoint, card.keyword, card.keywords, card.tags, card.front, card.back, card.coreRule, card.rule].flat().join(" "); }
  function findCard(rule, allCards) {
    const needles = rule.cardNeedles.map(normalize);
    return allCards.find(card => {
      const text = normalize(cardText(card));
      return needles.some(needle => needle && text.includes(needle));
    });
  }
  function resolveCard(rule, allCards) { const found = findCard(rule, allCards); return found ? cardId(found) : `auto:${rule.key}`; }
  function labelOf(id, allCards) {
    const found = allCards.find(card => cardId(card) === id);
    if (found) return found.title || found.recitePoint || found.category || id;
    return RULES.find(rule => `auto:${rule.key}` === id)?.label || id;
  }

  function matchedRules(q) {
    const text = qText(q);
    return RULES.filter(rule => (rule.key === "multi" && /多选/.test(String(q.type || ""))) || rule.pattern.test(text));
  }
  function choosePrimary(hits, q) {
    const has = key => hits.some(rule => rule.key === key);
    const text = qText(q);
    if (/多选/.test(String(q.type || "")) && has("multi")) return hits.find(rule => rule.key === "multi");
    if (has("educationPublicity") && /生态文明教育|文明实践中心|科普场馆|主题展览|公益宣讲|科普活动|普及.*教育|培育公众|教育链条|教育基础/.test(text)) return hits.find(rule => rule.key === "educationPublicity");
    if (has("agriQuality") && /标准化|追溯|闭环监管|农产品质量|质量安全|全链条监管/.test(text)) return hits.find(rule => rule.key === "agriQuality");
    if (has("consume") && /首发经济|票根|展会|新地标|消费场景|服务消费/.test(text)) return hits.find(rule => rule.key === "consume");
    if (has("tech") && /高校|企业|产学研|技术供给|前沿技术|成果转化|校企/.test(text)) return hits.find(rule => rule.key === "tech");
    if (has("governance") && /枫桥|信访|扫黑除恶|矛盾纠纷|基层治理/.test(text)) return hits.find(rule => rule.key === "governance");
    if (has("livelihood") && /养老|老年人|15\s*分钟|家门口|社区服务|适老化|社会救助/.test(text)) return hits.find(rule => rule.key === "livelihood");
    if (has("digital") && /监管|执法|排污|非现场|智慧监管|智能监控/.test(text)) return hits.find(rule => rule.key === "digital");
    const priority = ["educationPublicity", "culture", "city", "ecology", "philosophy", "fixedQuote", "digital", "material"];
    return hits.find(rule => priority.includes(rule.key)) || hits[0] || RULES.find(rule => rule.key === "material");
  }
  function reasons(q, primary) {
    const text = qText(q);
    const words = ["文明实践中心", "科普场馆", "主题展览", "公益宣讲", "科普活动", "节约意识", "环保意识", "生态文明教育", "AI", "人工智能", "智慧监管", "平台", "标准化", "追溯", "首发经济", "15分钟", "养老", "高校", "企业", "枫桥", "信访", "扫黑除恶", "文创", "盲盒", "山水林田湖草沙", "转危为机", "化险为夷"].filter(w => text.includes(w));
    const out = [`已自动选主卡：${primary.label}`];
    if (words.length) out.push(`命中词：${words.slice(0, 8).join("、")}`);
    if (/主要意在|主要表明|体现了|以上做法|目的/.test(text)) out.push("问法是材料映射题，材料题总法作为辅助规则。");
    return out;
  }
  function autoLink(q, allCards) {
    const hits = matchedRules(q);
    const primary = choosePrimary(hits, q);
    const primaryCardId = resolveCard(primary, allCards);
    const helperIds = hits
      .filter(rule => rule.key !== primary.key)
      .filter(rule => ["material", "multi", "digital", "fixedQuote"].includes(rule.key) || hits.length <= 3)
      .slice(0, 3)
      .map(rule => resolveCard(rule, allCards));
    const cardIds = Array.from(new Set([primaryCardId, ...helperIds].filter(Boolean)));
    return {
      questionKey: qKey(q), paperId: q.paperId || "", paperTitle: q.paperTitle || "", questionNo: q.questionNo || "",
      cardIds, primaryCardId, autoMatched: true, autoSelected: true, autoVersion: "v3",
      matchConfidence: hits.length >= 2 ? "high" : "medium",
      matchReasons: reasons(q, primary), mistakeType: primary.mistakeType, nextTimeRule: primary.nextTimeRule,
      source: "wrong-question-bank", updatedAt: new Date().toISOString(),
    };
  }
  function upsert(store, link) {
    const list = links(store);
    const idx = list.findIndex(x => x.questionKey === link.questionKey);
    if (idx >= 0) list[idx] = { ...list[idx], ...link, updatedAt: new Date().toISOString() };
    else list.push(link);
    saveStore(store);
    return idx >= 0 ? list[idx] : link;
  }
  function existing(store, q) { return links(store).find(link => link.questionKey === qKey(q)); }

  function isQuestionBox(el) {
    const text = el.innerText || el.textContent || "";
    return /Q\s*\d+|第\s*\d+\s*题/.test(text) && /A|B|C|D/.test(text) && /提交|做本题|正确答案|我的答案|错因|解析|选项/.test(text);
  }
  function visibleBoxes() {
    const roots = [document.getElementById("wrong-list"), document.getElementById("paper-question-list")].filter(Boolean);
    const out = [];
    roots.forEach(root => Array.from(root.children).forEach(child => { if (isQuestionBox(child)) out.push(child); }));
    return out;
  }
  function toHalf(v) { return String(v || "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)); }
  function findQuestion(box, allQuestions) {
    const text = normalize(box.innerText || box.textContent || "");
    const no = (text.match(/q\s*([0-9０-９]+)/i) || text.match(/第\s*([0-9０-９]+)\s*题/))?.[1];
    const list = no ? allQuestions.filter(q => String(q.questionNo) === toHalf(no)) : allQuestions;
    return list.find(q => {
      const stem = normalize(q.stem).slice(0, 24);
      return stem && text.includes(stem.slice(0, Math.min(18, stem.length)));
    });
  }
  function shouldShow(q, box) {
    if (!q) return false;
    if (isWrong(q)) return true;
    return /回答错误|继续保留在错题|已转入错题/.test(box.innerText || box.textContent || "");
  }
  function hideLegacyManualPanels(box) {
    Array.from(box.querySelectorAll("section, div, article, fieldset")).forEach(el => {
      if (el.classList.contains(PANEL_CLASS)) return;
      const text = el.innerText || el.textContent || "";
      if (/能力卡关联|手动选择能力卡|识别类型|下次规则/.test(text) && /保存.*卡|取消卡|推荐能力卡/.test(text)) {
        el.style.display = "none";
        el.dataset.hiddenByAutoCard = "true";
      }
    });
  }

  function render() {
    installToolbar();
    const store = loadStore();
    const allQuestions = questions(store);
    const allCards = cards(store);
    visibleBoxes().forEach(box => {
      const q = findQuestion(box, allQuestions);
      const old = box.querySelector(`.${PANEL_CLASS}`);
      if (!shouldShow(q, box)) { old?.remove(); return; }
      hideLegacyManualPanels(box);
      const oldLink = existing(store, q);
      const link = oldLink && oldLink.autoMatched === false ? oldLink : upsert(store, autoLink(q, allCards));
      if (old) { updatePanel(old, link, allCards); return; }
      box.appendChild(panel(link, allCards));
    });
    updateToolbar();
  }
  function panel(link, allCards) {
    const el = document.createElement("section");
    el.className = PANEL_CLASS;
    el.dataset.questionKey = link.questionKey;
    updatePanel(el, link, allCards);
    el.addEventListener("click", e => {
      const action = e.target?.dataset?.action;
      if (action === "reauto") {
        const store = loadStore();
        const q = questions(store).find(item => qKey(item) === link.questionKey);
        if (!q) return;
        const next = upsert(store, autoLink(q, cards(store)));
        updatePanel(el, next, cards(store));
        updateToolbar();
      }
      if (action === "export") exportLinks();
    });
    return el;
  }
  function updatePanel(el, link, allCards) {
    const helpers = link.cardIds.filter(id => id !== link.primaryCardId).map(id => labelOf(id, allCards)).join("、") || "无";
    el.innerHTML = `
      <div class="gpt-v2-head"><strong>已自动选好主卡</strong><span>${link.matchConfidence === "high" ? "高置信" : "需快速看一眼"}</span></div>
      <div class="gpt-v2-grid">
        <div><em>主卡</em><b>${esc(labelOf(link.primaryCardId, allCards))}</b></div>
        <div><em>辅助卡</em><b>${esc(helpers)}</b></div>
        <div><em>误识别类型</em><b>${esc(link.mistakeType)}</b></div>
      </div>
      <div class="gpt-v2-rule"><em>下次规则</em><p>${esc(link.nextTimeRule)}</p></div>
      <div class="gpt-v2-reasons">${(link.matchReasons || []).map(r => `<span>${esc(r)}</span>`).join("")}</div>
      <div class="gpt-v2-actions"><button data-action="reauto">重新自动判断</button><button data-action="export">导出归卡JSON</button></div>
    `;
  }
  function installToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    const el = document.createElement("div");
    el.id = TOOLBAR_ID;
    el.innerHTML = `<strong>错题自动归卡</strong><span data-role="stats">-</span><button data-action="batch">一键归完未归卡错题</button><button data-action="export">导出JSON</button>`;
    el.addEventListener("click", e => { if (e.target?.dataset?.action === "batch") batch(); if (e.target?.dataset?.action === "export") exportLinks(); });
    document.body.appendChild(el);
  }
  function updateToolbar() {
    const el = document.getElementById(TOOLBAR_ID); if (!el) return;
    const store = loadStore();
    const wrong = questions(store).filter(isWrong);
    const linked = new Set(links(store).map(l => l.questionKey));
    el.querySelector('[data-role="stats"]').textContent = `错题${wrong.length}｜已选主卡${wrong.filter(q => linked.has(qKey(q))).length}｜未归卡${wrong.filter(q => !linked.has(qKey(q))).length}`;
  }
  function batch() {
    const store = loadStore();
    const allCards = cards(store);
    const linked = new Set(links(store).map(l => l.questionKey));
    const todo = questions(store).filter(isWrong).filter(q => !linked.has(qKey(q)));
    todo.forEach(q => upsert(store, autoLink(q, allCards)));
    alert(`已帮你自动选好 ${todo.length} 道错题的主卡。`);
    scheduleRender();
  }
  function exportLinks() {
    const store = loadStore();
    const wrongKeys = new Set(questions(store).filter(isWrong).map(qKey));
    const data = links(store).filter(l => wrongKeys.has(l.questionKey));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: data.length, questionCardLinks: data }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = EXPORT_NAME; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style"); style.id = STYLE_ID; style.textContent = `
      #${TOOLBAR_ID}{position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:min(780px,calc(100vw - 32px));padding:10px 12px;border:1px solid #bcd2c7;border-radius:14px;background:rgba(244,255,249,.97);box-shadow:0 12px 28px rgba(0,0,0,.14);font-size:13px}
      #${TOOLBAR_ID} button,.${PANEL_CLASS} button{border:1px solid #9bc5b2;border-radius:999px;padding:6px 10px;background:#fff;cursor:pointer}
      .${PANEL_CLASS}{margin-top:14px;padding:14px;border:2px solid #64a984;border-radius:16px;background:#f6fff9;box-shadow:inset 0 0 0 1px rgba(255,255,255,.7)}
      .gpt-v2-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.gpt-v2-head strong{font-size:16px}.gpt-v2-head span{border-radius:999px;background:#dff4e8;color:#185b3b;padding:4px 8px;font-weight:700}
      .gpt-v2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.gpt-v2-grid div,.gpt-v2-rule{padding:8px;border:1px solid #bfe3cf;border-radius:12px;background:#fff}.gpt-v2-grid em,.gpt-v2-rule em{display:block;color:#4e765d;font-style:normal;font-size:12px;margin-bottom:4px}.gpt-v2-grid b{color:#102f1f}.gpt-v2-rule{margin-top:8px}.gpt-v2-rule p{margin:0;color:#163a28;font-weight:700}
      .gpt-v2-reasons{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.gpt-v2-reasons span{border-radius:999px;background:#e8f7ee;color:#315d43;padding:4px 8px;font-size:12px}.gpt-v2-actions{display:flex;gap:8px;flex-wrap:wrap}
    `; document.head.appendChild(style);
  }
  function esc(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
})();
