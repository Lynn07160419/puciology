const PROJECT_ID = "shexi-graduation";
const FINAL_ID = "Final";
const PARTICIPANT_KEY = "orientation.participantId";
const STUDENT_ID_KEY = "orientation.studentId";
const PHONE_KEY = "orientation.phone";
const PARTICIPANT_KIND_KEY = "orientation.participantKind";
const ADMIN_TOKEN_KEY = "orientation.adminToken";
const ADMIN_NICKNAME_KEY = "orientation.adminNickname";
const SHOW_TEST_ENTRY = false;

let participant = null;
let state = null;
let cooldownRemaining = 0;
let cooldownTimer = null;
let echoAnimation = null;
let adminRedeemNotice = null;
let lotterySpinning = false;
let lotteryWheelAnimating = false;
let lotteryWheelSettled = false;
let lotteryWheelRotation = 0;
let lotteryTargetPrize = null;
let lotteryNotice = null;
let pendingLotteryResult = null;
let loginNotice = null;
let imageModal = null;
let imageGallery = null;
let imageGalleryIndex = 0;
let imageZoom = { scale: 1, x: 0, y: 0 };
let imagePointers = new Map();
let imageGesture = null;
let imageMouseStage = null;
let confirmModal = null;
let cyberGiftModal = null;
let eventTimer = null;
let animateReveals = false;
let lastRevealKey = null;
let revealObserver = null;
let ticketShown = false;
let ticketBurstPending = false;
const echoArchiveOpen = { main: false, bonus: false, score: false };
const messages = new Map();
const draftAnswers = new Map();
const LOTTERY_BASE_SEGMENTS = [
  "三等奖", "三等奖", "二等奖",
  "三等奖", "三等奖", "一等奖",
  "三等奖", "三等奖", "二等奖",
  "三等奖", "三等奖", "二等奖",
  "三等奖", "三等奖", "一等奖",
  "三等奖", "三等奖", "二等奖",
  "三等奖", "三等奖", "二等奖",
  "三等奖", "三等奖", "一等奖",
  "三等奖", "三等奖", "二等奖",
];
const LOTTERY_SEGMENT_COLORS = {
  一等奖: "var(--brass)",
  二等奖: "var(--teal)",
  三等奖: "var(--mute)",
  额外奖候补: "#7d8290",
};
const SVG_TAGS = new Set(["svg", "path", "circle"]);

function $(selector, root = document) {
  return root.querySelector(selector);
}

function el(tag, attrs = {}, children = []) {
  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") {
      if (isSvg) node.setAttribute("class", value);
      else node.className = value;
    }
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, options = {}) {
  const { admin = false, headers = {}, ...fetchOptions } = options;
  const requestHeaders = { "Content-Type": "application/json", ...headers };
  if (admin) {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, {
    headers: requestHeaders,
    ...fetchOptions,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setScreen(children) {
  const app = $("#app");
  const nodes = (Array.isArray(children) ? children : [children]).filter((child) => child !== null && child !== undefined);
  app.replaceChildren(...nodes);
  const heading = app.querySelector(".section-head h1") || app.querySelector("h1");
  transitionTo(heading ? heading.textContent : "");
  observeReveals();
}

function observeReveals() {
  const nodes = document.querySelectorAll("#app .reveal:not(.is-visible)");
  if (!nodes.length) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  }
  nodes.forEach((node) => revealObserver.observe(node));
}

let lastPageKey = null;

// 仅在「页面大标题」改变时播放浓雾聚散过渡；同一页面内的局部刷新不触发。
function transitionTo(key) {
  const isFirst = lastPageKey === null;
  const changed = !isFirst && lastPageKey !== key;
  lastPageKey = key;
  if (changed) {
    playPageTransition(true);
  } else if (isFirst) {
    playPageTransition(false);
  }
}

function playPageTransition(withFog) {
  const app = $("#app");
  if (app) {
    app.classList.remove("page-enter");
    void app.offsetWidth;
    app.classList.add("page-enter");
  }
  if (!withFog) return;
  let fog = document.querySelector(".page-fog");
  if (!fog) {
    fog = document.createElement("div");
    fog.className = "page-fog";
    fog.setAttribute("aria-hidden", "true");
    document.body.appendChild(fog);
  }
  fog.classList.remove("run");
  void fog.offsetWidth;
  fog.classList.add("run");
}

function sectionHead(eyebrow, title, lede) {
  return el("section", { class: "section-head" }, [
    el("p", { class: "eyebrow" }, eyebrow),
    el("h1", {}, title),
    lede ? el("p", { class: "lede" }, lede) : null,
  ]);
}

function pageFooter() {
  return el("footer", { class: "page-footer", "aria-hidden": "true" }, [
    el("img", { src: "/static/assets/mascot-qunyang.webp", alt: "" }),
    el("span", {}, "社会学系毕业晚会 · 群学"),
  ]);
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayQuestionId(id) {
  return id === FINAL_ID ? "终章" : id;
}

async function ensureParticipant() {
  const saved = localStorage.getItem(PARTICIPANT_KEY) || "";
  if (!saved) return null;
    const data = await api("/api/participants", {
      method: "POST",
      body: JSON.stringify({ participant_id: saved, participant_kind: "individual" }),
    });
    participant = data.participant;
  if (participant.participant_kind !== "tester" && !participant.student_id) {
    localStorage.removeItem(PARTICIPANT_KEY);
    localStorage.removeItem(PARTICIPANT_KIND_KEY);
    localStorage.removeItem(STUDENT_ID_KEY);
    localStorage.removeItem(PHONE_KEY);
    participant = null;
    loginNotice = "请先输入学号和手机号后再进入活动。";
    return null;
  }
  localStorage.setItem(PARTICIPANT_KEY, participant.id);
  localStorage.setItem(PARTICIPANT_KIND_KEY, participant.participant_kind);
  if (participant.student_id) localStorage.setItem(STUDENT_ID_KEY, participant.student_id);
  if (participant.phone) localStorage.setItem(PHONE_KEY, participant.phone);
  return participant;
}

async function loadState() {
  const restored = await ensureParticipant();
  if (!restored) return null;
  state = await api(`/api/projects/${PROJECT_ID}/state?participant_id=${encodeURIComponent(participant.id)}`);
  cooldownRemaining = state.cooldown_remaining || 0;
  return state;
}

function renderHome() {
  setScreen([
    sectionHead(
      "项目列表",
      "选择一场定向解密",
      "每个项目会保存自己的进度。当前先开放社系毕业晚会解密，后续可以继续加入新的楼宇、校园或展览项目。"
    ),
    el("section", { class: "project-grid" }, [
      el("article", { class: "project-card" }, [
        el("p", { class: "badge main" }, "当前项目"),
        el("h2", {}, "社系毕业晚会解密"),
        el("p", {}, "通过理科五号楼一二层、中庭、门牌号、导视牌和固定文字信息，收集毕业回声并解开终章。26届毕业生可以获得礼物，但游戏对所有人开放。每个学号只能参与一次，刷新或重新打开时会回到当前进度。"),
        el("p", { class: "meta" }, "地点：理科五号楼一二层、中庭"),
        el("div", { class: "cta-row" }, [
          el("button", { class: "btn", type: "button", onclick: enterProjectFromHome }, "进入项目"),
          SHOW_TEST_ENTRY
            ? el("button", { class: "btn secondary", type: "button", onclick: startTesterFromHome }, "测试人员入口")
            : null,
        ]),
      ]),
    ]),
    pageFooter(),
  ]);
}

async function enterProjectFromHome() {
  const saved = localStorage.getItem(PARTICIPANT_KEY) || "";
  const savedKind = localStorage.getItem(PARTICIPANT_KIND_KEY) || "";
  if (saved && savedKind === "tester") {
    localStorage.removeItem(PARTICIPANT_KEY);
    localStorage.removeItem(PARTICIPANT_KIND_KEY);
    localStorage.removeItem(STUDENT_ID_KEY);
    localStorage.removeItem(PHONE_KEY);
  } else if (saved && !savedKind) {
    try {
      const data = await api("/api/participants", {
        method: "POST",
        body: JSON.stringify({ participant_id: saved, participant_kind: "individual" }),
      });
      if (data.participant.participant_kind === "tester") {
        localStorage.removeItem(PARTICIPANT_KEY);
        localStorage.removeItem(PARTICIPANT_KIND_KEY);
        localStorage.removeItem(STUDENT_ID_KEY);
        localStorage.removeItem(PHONE_KEY);
      } else {
        localStorage.setItem(PARTICIPANT_KIND_KEY, data.participant.participant_kind);
      }
    } catch (_) {
      localStorage.removeItem(PARTICIPANT_KEY);
      localStorage.removeItem(PARTICIPANT_KIND_KEY);
      localStorage.removeItem(STUDENT_ID_KEY);
      localStorage.removeItem(PHONE_KEY);
    }
  }
  location.href = "/project/shexi-graduation";
}

function startTesterFromHome() {
  history.pushState(null, "", "/project/shexi-graduation");
  startTesterSession();
}

async function renderProject(options = {}) {
  const shouldReload = options.reload !== false;
  const restoreScrollY = options.preserveScroll ? window.scrollY : null;
  const shouldScrollTop = options.scrollTop === true;
  if (!localStorage.getItem(PARTICIPANT_KEY)) {
    setScreen(renderParticipantLogin());
    return;
  }
  try {
    if (shouldReload || !state) {
      const loaded = await loadState();
      if (!loaded) {
        setScreen(renderParticipantLogin());
        return;
      }
    }
  } catch (error) {
    localStorage.removeItem(PARTICIPANT_KEY);
    localStorage.removeItem(PARTICIPANT_KIND_KEY);
    participant = null;
    setScreen(renderParticipantLogin(error.message));
    return;
  }

  const completedMain = state.questions.filter((q) => q.kind === "main" && q.completed).length;
  const collectedMain = state.completed_main_questions?.length || completedMain;
  const progressPct = Math.round((collectedMain / state.main_ids.length) * 100);
  const activeQuestions = visibleActiveQuestions();

  const revealKey = state.phase;
  animateReveals = shouldReload && revealKey !== lastRevealKey;
  lastRevealKey = revealKey;
  if (state.phase !== "completed") ticketShown = false;
  const appEl = $("#app");
  if (appEl) {
    appEl.dataset.stage = state.phase === "final" ? "final" : state.phase === "completed" ? "reward" : "";
  }

  const page = [
    state.phase === "final"
      ? renderFinalBand()
      : sectionHead("社系毕业晚会解密", phaseTitle(state.phase), phaseLede(state.phase)),
    renderProgressPanel(progressPct, collectedMain),
    ...renderPhaseBody(activeQuestions),
    renderEchoAnimation(),
    renderCyberGiftModal(),
    renderImageModal(),
    renderConfirmModal(),
  ];

  setScreen(page);
  if (shouldScrollTop) {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  } else if (restoreScrollY !== null) {
    requestAnimationFrame(() => window.scrollTo(0, restoreScrollY));
  }
  if (cyberGiftModal) {
    requestAnimationFrame(() => initCyberGiftScene());
  }
  if (ticketBurstPending) {
    ticketBurstPending = false;
    requestAnimationFrame(() => burstTicketSparks());
  }
  startCooldownTimer();
  startEventPolling();
}

function renderParticipantLogin(errorMessage = "") {
  const notice = errorMessage || loginNotice || "";
  return [
    el("section", { class: "entry-hero" }, [
      el("img", { class: "entry-wm", src: "/static/assets/mascot-qunyang.webp", alt: "", "aria-hidden": "true" }),
      el("img", { class: "entry-greeter", src: "/static/assets/mascot-sheep.png", alt: "社会学系吉祥物·群羊" }),
      el("div", { class: "entry-copy" }, [
        el("p", { class: "eyebrow" }, "社系毕业晚会解密"),
        el("h1", {}, ["理科五号楼里", el("br"), "六段毕业回声"]),
      ]),
    ]),
    el("form", { class: "login-panel entry-frost", onsubmit: onParticipantLogin }, [
      el("h2", {}, "用学号和手机号开启这一程"),
      el("div", { class: "admin-actions" }, [
        el("input", {
          class: "admin-input",
          name: "student_id",
          placeholder: "请输入学号",
          inputmode: "numeric",
          autocomplete: "off",
          value: localStorage.getItem(STUDENT_ID_KEY) || "",
        }),
        el("input", {
          class: "admin-input",
          name: "phone",
          placeholder: "请输入手机号",
          inputmode: "numeric",
          autocomplete: "tel",
          value: localStorage.getItem(PHONE_KEY) || "",
        }),
        el("button", { class: "btn", type: "submit" }, "进入活动"),
      ]),
      el("p", { class: `message ${notice ? "error" : ""}`, id: "participantLoginMessage" }, notice),
      el("p", { class: "entry-note" }, "26 届毕业生可获得礼物，游戏对所有人开放 · 每个学号绑定一个手机号，进度自动保存"),
      SHOW_TEST_ENTRY
        ? el("div", { class: "test-entry" }, [
            el("p", { class: "small" }, "测试阶段入口：不绑定学号，可无限次生成新进度。正式使用时删除这个入口。"),
            el("button", { class: "btn secondary", type: "button", onclick: startTesterSession }, "测试人员入口"),
          ])
        : null,
    ]),
    pageFooter(),
  ];
}

async function onParticipantLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const output = $("#participantLoginMessage", form);
  const studentId = form.elements.student_id.value.trim();
  const phone = form.elements.phone.value.trim();
  if (!studentId || !phone) {
    output.className = "message error";
    output.textContent = "请先输入学号和手机号。";
    return;
  }
  try {
    const data = await api("/api/participants", {
      method: "POST",
      body: JSON.stringify({ student_id: studentId, phone, participant_kind: "individual" }),
    });
    participant = data.participant;
    localStorage.setItem(PARTICIPANT_KEY, participant.id);
    localStorage.setItem(PARTICIPANT_KIND_KEY, participant.participant_kind);
    localStorage.setItem(STUDENT_ID_KEY, participant.student_id || studentId);
    localStorage.setItem(PHONE_KEY, participant.phone || phone);
    loginNotice = null;
    renderProject();
  } catch (error) {
    output.className = "message error";
    output.textContent = error.message;
  }
}

async function startTesterSession() {
  try {
    const data = await api("/api/participants", {
      method: "POST",
      body: JSON.stringify({ participant_kind: "tester", nickname: "测试人员", force_new: true }),
    });
    participant = data.participant;
    localStorage.setItem(PARTICIPANT_KEY, participant.id);
    localStorage.setItem(PARTICIPANT_KIND_KEY, participant.participant_kind);
    localStorage.removeItem(STUDENT_ID_KEY);
    localStorage.removeItem(PHONE_KEY);
    loginNotice = null;
    renderProject();
  } catch (error) {
    loginNotice = error.message;
    setScreen(renderParticipantLogin(error.message));
  }
}

function phaseTitle(phase) {
  const titles = {
    main: "沿着楼的线索前进",
    post_main_choice: "六段回声已经集齐",
    bonus: "旁枝仍有回声",
    final: "终章已经开启",
    completed: "且行且歌共少年",
  };
  return titles[phase] || "收集六段毕业回声";
}

function phaseLede(phase) {
  const ledes = {
    main: "",
    post_main_choice: "你可以在完成终章后领取纪念奖。\n现在可以直接开启终章，也可以先探索三条旁枝路线。每完成一道旁枝题多一次抽奖机会。开启终章后，旁枝将无法再体验。",
    bonus: "每完成一道旁枝题，就多一次抽奖机会。若歌声已经在心里响起，也可以随时收束旁枝，开启终章。",
    final: "",
    completed: "终章完成，游戏已经结束。请领取你的兑奖凭证，毕业快乐。",
  };
  return ledes[phase] || "";
}

function visibleActiveQuestions() {
  if (state.phase === "main") return state.questions.filter((q) => !q.completed);
  if (state.phase === "bonus") return state.questions.filter((q) => !q.completed);
  if (state.phase === "completed" || state.phase === "post_main_choice") return [];
  return state.questions;
}

function renderProgressPanel(progressPct, collectedMain) {
  const isTester = state.participant.participant_kind === "tester";
  const identityText = isTester
    ? `测试编号：${state.participant.id}`
    : `学号：${state.participant.student_id || "未记录"}`;
  const toolbarActions = [];
  if (state.phase !== "completed") {
    toolbarActions.push(el("button", { class: "btn secondary", type: "button", onclick: logoutParticipant }, isTester ? "退出测试" : "更换学号"));
  }
  const statusItems = [
    el("span", {}, `主线 ${collectedMain}/${state.main_ids.length}`),
  ];
  if (state.phase !== "completed" || (state.bonus_completed || 0) > 0) {
    statusItems.push(el("span", {}, `旁枝 ${state.bonus_completed || 0}/${state.bonus_ids.length}`));
  }
  if (state.phase === "completed") {
    statusItems.push(el("span", { id: "gameStatus", class: "cooldown-status" }, "游戏已结束"));
  }

  return el("section", { class: "summary-panel" }, [
    el("div", { class: "toolbar" }, [
      el("div", {}, [
        el("h2", {}, "当前进度"),
        el("p", { class: "small" }, identityText),
      ]),
      toolbarActions.length ? el("div", { class: "cta-row toolbar-actions" }, toolbarActions) : null,
    ]),
    el("div", { class: "progress-bar", "aria-label": "主线进度" }, [
      el("span", { style: `width: ${progressPct}%` }),
    ]),
    el("div", { class: "status-row" }, statusItems),
    messages.get("phase") ? el("p", { class: `message ${messages.get("phase").type}` }, messages.get("phase").text) : null,
    state.phase === "completed"
      ? null
      : el("p", { class: `small cooldown-policy${cooldownRemaining > 0 ? " active" : ""}`, id: "cooldownStatus" }, cooldownStatusText()),
    state.phase === "completed" ? null : renderRedeem(state.redeem_code),
    state.phase === "bonus" ? renderBonusFinalNotice() : null,
  ]);
}

function cooldownStatusText() {
  const policy = state?.cooldown_policy || "任一题答错后，终止答题 15s。";
  return cooldownRemaining > 0
    ? `${policy.replace(/。$/, "")}，还剩 ${cooldownRemaining} 秒。`
    : policy;
}

function renderFinalBand() {
  return el("section", { class: "final-band" }, [
    el("p", { class: "final-band-eyebrow" }, "终 章 · 压 轴"),
    el("h1", {}, "行行重行行"),
    el("p", { class: "final-band-by" }, "一路收集的六段回声，在此汇成终章。"),
  ]);
}

function renderPhaseBody(activeQuestions) {
  const blocks = [];
  // 终章＝节目单：题面 → 六段回声（主线百宝箱·可折叠）→ 简谱曲目条
  if (state.phase === "final") {
    if (activeQuestions.length) {
      blocks.push(renderQuestionSection("终章题", "终章已开启，未完成的旁枝题已经关闭。", activeQuestions));
    }
    blocks.push(...renderEchoGroups());
    const score = renderScorePanel();
    if (score) blocks.push(score);
    return blocks;
  }

  blocks.push(...renderEchoGroups());
  if (state.phase === "post_main_choice") {
    blocks.push(renderChoicePanel());
  } else if (state.phase === "completed") {
    blocks.push(renderCompletedPanel());
  } else {
    if (state.phase === "bonus" && (state.bonus_completed || 0) >= state.bonus_ids.length) {
      blocks.push(renderAllBonusCompletePanel());
    }
    if (activeQuestions.length) {
      const title = state.phase === "bonus" ? "旁枝路线" : "当前开放题";
      const description = state.phase === "bonus"
        ? "旁枝题一次开放，可任选完成。"
        : "完成当前两题后，下一组线索会自动出现。";
      blocks.push(renderQuestionSection(title, description, activeQuestions));
    }
  }
  return blocks;
}

function renderEchoGroups() {
  const blocks = [];
  const mainEchoes = orderedMainEchoQuestions();
  const bonusEchoes = state.completed_bonus_questions || [];
  if (mainEchoes.length) {
    blocks.push(renderEchoArchive("main", "主线百宝箱", mainEchoes, false));
  }
  if (bonusEchoes.length) {
    blocks.push(renderEchoArchive("bonus", "旁枝百宝箱", bonusEchoes, false));
  }
  return blocks;
}

function orderedMainEchoQuestions() {
  return state.completed_main_questions || [];
}

function renderScorePanel() {
  const images = state.score_images || [];
  if (!images.length) return null;
  return el("section", { class: "score-panel" }, [
    el("p", { class: "score-panel-label" }, `《行行重行行》简谱 · ${images.length} 页（左右滑动，点开可翻页）`),
    el("div", { class: "score-strip" }, images.map((image, index) => el("figure", { class: "score-page" }, [
      el("button", { class: "question-image-button score-image-button", type: "button", onclick: () => openImageModal(image, images, index) }, [
        el("img", { src: image.src, alt: image.alt || "简谱图片" }),
      ]),
      el("figcaption", {}, image.caption || `${index + 1} / ${images.length}`),
    ]))),
  ]);
}

function renderChoicePanel() {
  return el("section", { class: "choice-panel" }, [
    el("span", { class: "seal seal-lg" }, "毕"),
    el("p", { class: "badge done" }, "主线完成"),
    el("h2", {}, "恭喜你集齐六段毕业回声"),
    el("div", { class: "cta-row" }, [
      el("button", { class: "btn", type: "button", onclick: confirmStartFinal }, "现在开启终章"),
      el("button", { class: "btn secondary", type: "button", onclick: () => makeDecision("continue_bonus") }, "先探索旁枝"),
    ]),
  ]);
}

function renderMiniFinalEntry() {
  return el("div", { class: "mini-final" }, [
    el("div", {}, [
      el("strong", {}, "终章入口"),
      el("p", { class: "small" }, "开启终章后，旁枝将无法再体验；终章完成后游戏即刻结束。"),
    ]),
    el("button", { class: "btn secondary", type: "button", onclick: confirmStartFinal }, "展开终章"),
  ]);
}

function renderBonusFinalNotice() {
  return renderMiniFinalEntry();
}

function renderAllBonusCompletePanel() {
  return el("section", { class: "choice-panel bonus-complete" }, [
    el("p", { class: "badge done" }, "旁枝集齐"),
    el("h2", {}, "三枚旁枝的光都已收入掌心"),
    el("p", {}, "你已经把楼里额外留给你的回声都听完了。若想走向句点，请使用上方的终章入口。"),
  ]);
}

function renderCompletedPanel() {
  const bonusCount = state.bonus_completed || 0;
  const bonusText = bonusCount > 0 ? `你完成了 ${bonusCount} 道旁枝题，获得 ${state.extra_lottery_chances || 0} 次额外抽奖机会。` : "";
  const waitingForDraw = (state.lottery?.draws_remaining || 0) > 0;
  const rewardLine = bonusText
    ? `${bonusText}抽奖后，请带着完成凭证前往兑奖处领取礼物，也把这一晚的回声带向下一段旅程。`
    : "请带着完成凭证前往兑奖处领取礼物，也把这一晚的回声带向下一段旅程。";
  const endingText = `念百年，筚路蓝缕志弥坚；愿今生，且行且歌共少年🎵\n一路且行且歌，不觉已行至一程终点。恭喜你顺利通关！\n与社会学系结缘这些年，你的身后是百年学养，身边是同群相伴，而眼前，也必定是光辉灿烂、且行且歌的广阔世界。\n${rewardLine}\n游戏已至终章，新篇方才起步。谢谢你走到这里，愿此去一路有光。`;
  const isTester = state.participant.participant_kind === "tester";
  return el("section", { class: "choice-panel complete-ending" }, [
    el("p", { class: "badge done" }, "完成"),
    el("h2", {}, "且行且歌共少年"),
    el("p", { class: "prompt" }, endingText),
    renderLotteryPanel(state.lottery),
    waitingForDraw ? null : renderFinalTicket(state.redeem_code),
    el("div", { class: "cta-row" }, [
      isTester
        ? el("button", { class: "btn secondary", type: "button", onclick: restartAsNewParticipant }, "测试人员重新开始一次")
        : el("button", { class: "btn secondary", type: "button", onclick: logoutParticipant }, "退出登录"),
    ]),
    el("p", { class: "site-credit" }, "网站设计 · Lynn WishingCat"),
  ]);
}

function renderFinalTicket(redeem) {
  if (!redeem) return null;
  const firstReveal = !ticketShown;
  if (firstReveal) {
    ticketShown = true;
    ticketBurstPending = true;
  }
  return el("div", { class: `ticket-peek-wrap${firstReveal ? " enter" : ""}` }, [
    el("div", { class: "fw-layer", "aria-hidden": "true" }),
    el("img", { class: "ticket-peek-sheep", src: "/static/assets/mascot-sheep.png", alt: "", "aria-hidden": "true" }),
    renderRedeem(redeem),
  ]);
}

function renderLotteryPanel(lottery) {
  if (!lottery || !lottery.chances_total) return null;
  const remaining = lottery.draws_remaining || 0;
  const used = lottery.draws_used || 0;
  const resultText = lottery.prize_summary ? `已抽中：${lottery.prize_summary}` : "还没有抽奖结果。";
  const wheelClass = [
    "lottery-wheel",
    lotteryWheelAnimating ? "spinning" : "",
    lotteryWheelSettled ? "settled" : "",
  ].filter(Boolean).join(" ");
  const wheelStyle = lotteryWheelAnimating || lotteryWheelSettled
    ? `--wheel-rotation: ${lotteryWheelRotation}deg;`
    : "";
  return el("section", { class: "lottery-panel" }, [
    el("div", { class: "lottery-head" }, [
      el("div", {}, [
        el("h2", {}, "抽奖转盘"),
        el("p", { class: "small" }, `抽奖进度：${used}/${lottery.chances_total}，剩余 ${remaining} 次`),
      ]),
      el("div", { class: "lottery-count" }, remaining),
    ]),
    el("div", { class: "wheel-wrap" }, [
      el("div", { class: "wheel-pointer" }),
      renderLotteryWheel(wheelClass, wheelStyle, lotteryTargetPrize),
    ]),
    renderLotteryLegend(lotteryTargetPrize),
    el("p", { class: "lottery-result" }, lotterySpinning ? "转盘正在转动，今晚的回声正在落定。" : resultText),
    remaining > 0
      ? el("p", { class: "small lottery-reminder" }, "请先抽完全部机会；抽奖完成后才会显示兑奖凭证，并进入工作人员后台的已预定清单。")
      : null,
    lottery.draws?.length
      ? el("div", { class: "lottery-draws" }, lottery.draws.map((draw) => el("span", {}, `第 ${draw.draw_index} 次：${draw.prize_label}`)))
      : null,
    lotteryNotice ? el("p", { class: `message ${lotteryNotice.type}` }, lotteryNotice.text) : null,
    el("button", { class: "btn", type: "button", disabled: remaining <= 0 || lotterySpinning, onclick: onDrawLottery }, remaining > 0 ? "开始抽奖" : "抽奖已完成"),
  ]);
}

function renderLotteryLegend(targetPrize) {
  const labels = ["一等奖", "二等奖", "三等奖"];
  if (targetPrize === "额外奖候补") labels.push("额外奖候补");
  return el("div", { class: "wheel-legend" }, labels.map((label) => el("span", {}, [
    el("i", { style: `background: ${LOTTERY_SEGMENT_COLORS[label]};` }),
    label,
  ])));
}

function renderEchoArchive(key, title, questions, defaultOpen = false) {
  const open = echoArchiveOpen[key] ?? defaultOpen;
  const directoryClass = key === "bonus" ? "echo-directory bonus-directory" : "echo-directory";
  return el("details", {
    class: directoryClass,
    open,
    ontoggle: (event) => {
      echoArchiveOpen[key] = event.currentTarget.open;
    },
  }, [
    el("summary", {}, `${title}（${questions.length}）`),
    el("div", { class: "echo-grid" }, questions.map((q) => el("article", { class: "echo-tile" }, [
      el("span", { class: "seal mini" }, echoSealChar(q, key)),
      el("div", { class: "echo-tile-body" }, [
        el("p", { class: "eh" }, `${displayQuestionId(q.id)} · ${q.title}`),
        q.echo ? renderEcho(q.echo) : el("p", { class: "message" }, "已完成"),
      ]),
    ]))),
  ]);
}

function echoSealChar(q, key) {
  if (q.echo?.highlight) return q.echo.highlight;
  return key === "bonus" ? "枝" : "声";
}

function showEchoAnimation(echo, qid) {
  echoAnimation = { echo, qid };
  renderProject({ preserveScroll: true });
}

function renderEchoAnimation() {
  if (!echoAnimation) return null;
  const highlight = echoAnimation.echo.highlight;
  return el("div", { class: "paper-echo-overlay" }, [
    el("div", { class: "paper-sheet" }, [
      el("div", { class: "wrinkle", "aria-hidden": "true" }),
      el("div", { class: "echo-stamp-feedback" }, [
        el("p", { class: "cap" }, "收 到 一 条 回 声"),
        highlight ? el("span", { class: "seal seal-lg" }, highlight) : null,
        renderEcho(echoAnimation.echo),
      ]),
      el("p", { class: "paper-note" }, "纸团慢慢展开，楼里的声音浮了出来。"),
      el("button", { class: "btn", type: "button", onclick: collectEchoAnimation }, "收入百宝箱"),
    ]),
  ]);
}

function collectEchoAnimation() {
  const sheet = $(".paper-echo-overlay .paper-sheet");
  if (sheet && !sheet.classList.contains("crumple")) {
    sheet.classList.add("crumple");
    setTimeout(() => {
      echoAnimation = null;
      renderProject();
    }, 680);
    return;
  }
  echoAnimation = null;
  renderProject();
}

function startEventPolling() {
  if (eventTimer || !participant?.id) return;
  eventTimer = setInterval(checkParticipantEvents, 2500);
  checkParticipantEvents();
}

function stopEventPolling() {
  if (eventTimer) clearInterval(eventTimer);
  eventTimer = null;
}

async function checkParticipantEvents() {
  if (!participant?.id || cyberGiftModal) return;
  try {
    const result = await api(`/api/projects/${PROJECT_ID}/events?participant_id=${encodeURIComponent(participant.id)}`);
    const event = (result.events || [])[0];
    if (event?.type === "cyber_gift") {
      cyberGiftModal = event;
      renderProject({ reload: false, preserveScroll: true });
    }
  } catch (_) {
    // Event polling should stay quiet during transient network hiccups.
  }
}

async function collectCyberGift() {
  const eventId = cyberGiftModal?.id;
  stopCyberGiftScene();
  cyberGiftModal = null;
  if (eventId && participant?.id) {
    try {
      await api(`/api/projects/${PROJECT_ID}/events/consume`, {
        method: "POST",
        body: JSON.stringify({ participant_id: participant.id, event_id: eventId }),
      });
    } catch (_) {
      // If acknowledgement fails, the server will offer the event again later.
    }
  }
  renderProject({ reload: false, preserveScroll: true });
}

function renderCyberGiftModal() {
  if (!cyberGiftModal) return null;
  const payload = cyberGiftModal.payload || {};
  const title = payload.title || "赛博礼物已送达";
  // Blessing shown on the ticket — three readable lines.
  const lines = ["谢谢你一起完成这趟楼里的旅程", "愿今晚的歌声，", "也能带给你前程似锦的祝福"];
  const overlay = el("div", { class: "modal-overlay cyber-gift-overlay" });
  overlay.innerHTML = `
    <canvas class="cg-canvas" aria-hidden="true"></canvas>
    <div class="cg-shell">
      <div class="cg-stage" data-cg-stage>
        <div class="cg-floor"></div>

        <div class="cg-box layer-back">
          <svg viewBox="0 0 230 210" aria-hidden="true">
            <defs>
              <linearGradient id="cgInterior" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#063b35"/><stop offset="1" stop-color="#0a4f47"/>
              </linearGradient>
              <linearGradient id="cgBoxTop" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#1aa697"/><stop offset="1" stop-color="#0e6f63"/>
              </linearGradient>
            </defs>
            <path d="M18,78 L115,52 L212,78 L115,104 Z" fill="url(#cgBoxTop)"/>
            <path d="M30,80 L115,60 L200,80 L115,100 Z" fill="url(#cgInterior)"/>
          </svg>
        </div>

        <img class="cg-sheep" data-cg-sheep src="/static/assets/mascot-sheep.png" alt="社会学系吉祥物·小羊"/>

        <svg class="cg-ticket" data-cg-ticket viewBox="0 0 300 176" role="img" aria-label="${title}：${lines.join("")}">
          <defs>
            <linearGradient id="cgPaper" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fdfaf2"/><stop offset="1" stop-color="#f1e7cf"/>
            </linearGradient>
            <filter id="cgPaperTex" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .05 0"/>
              <feComposite operator="over" in2="SourceGraphic"/>
            </filter>
            <filter id="cgTicketShadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity="0.30"/>
            </filter>
            <path id="cgTicketShape" d="M14,8 H286 a6,6 0 0 1 6,6 V74 a11,11 0 0 0 0,30 V162 a6,6 0 0 1 -6,6 H14 a6,6 0 0 1 -6,-6 V104 a11,11 0 0 0 0,-30 V14 a6,6 0 0 1 6,-6 Z"/>
          </defs>
          <g filter="url(#cgTicketShadow)">
            <use href="#cgTicketShape" fill="url(#cgPaper)"/>
            <use href="#cgTicketShape" fill="url(#cgPaper)" filter="url(#cgPaperTex)"/>
            <use href="#cgTicketShape" fill="none" stroke="#d8c79b" stroke-width="1.4"/>
          </g>
          <use href="#cgTicketShape" fill="none" stroke="#fff" stroke-width="1" opacity="0.45" transform="scale(.99)" transform-origin="150 88"/>
          <line x1="64" y1="14" x2="64" y2="162" stroke="#c79a52" stroke-width="1.6" stroke-dasharray="3 4"/>
          <circle cx="64" cy="14" r="3.2" fill="#07221f"/>
          <circle cx="64" cy="162" r="3.2" fill="#07221f"/>
          <text x="38" y="88" fill="#b88a3e" font-size="15" font-weight="700" text-anchor="middle" transform="rotate(-90 38 88)" letter-spacing="4" font-family="var(--serif)">社系晚会</text>
          <text x="51" y="138" fill="#caa45c" font-size="10" text-anchor="middle" transform="rotate(-90 51 136)" letter-spacing="1">ADMIT ONE</text>
          <text x="38" y="36" fill="#c79a52" font-size="13" text-anchor="middle">✦</text>
          <text x="180" y="40" fill="#138a7d" font-size="11" text-anchor="middle" letter-spacing="5" font-family="var(--serif)">赛 博 礼 物</text>
          <text x="180" y="71" fill="#163029" font-size="14.5" text-anchor="middle" font-family="var(--serif)">${lines[0]}</text>
          <text x="180" y="96" fill="#163029" font-size="14.5" text-anchor="middle" font-family="var(--serif)">${lines[1]}</text>
          <text x="180" y="120" fill="#163029" font-size="14.5" text-anchor="middle" font-family="var(--serif)">${lines[2]}</text>
          <text x="180" y="152" fill="#9c8049" font-size="10.5" text-anchor="middle" letter-spacing="2" font-family="var(--serif)">— 社会学系毕业晚会 —</text>
        </svg>

        <div class="cg-box layer-front">
          <svg viewBox="0 0 230 210" aria-hidden="true">
            <defs>
              <linearGradient id="cgBoxFront" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#159384"/><stop offset="1" stop-color="#0c5f55"/>
              </linearGradient>
              <linearGradient id="cgBoxSide" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#0b524a"/><stop offset="1" stop-color="#0a4942"/>
              </linearGradient>
              <linearGradient id="cgRibbonV" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#d8aa5e"/><stop offset=".5" stop-color="#f0d089"/><stop offset="1" stop-color="#c2913f"/>
              </linearGradient>
            </defs>
            <g class="cg-box-body">
              <path d="M30,80 L115,100 L115,196 L30,176 Z" fill="url(#cgBoxSide)"/>
              <path d="M115,100 L200,80 L200,176 L115,196 Z" fill="url(#cgBoxFront)"/>
              <path d="M122,104 L150,98 L150,188 L122,192 Z" fill="#ffffff" opacity="0.06"/>
              <path d="M150,95 L168,91 L168,187 L150,191 Z" fill="url(#cgRibbonV)"/>
              <path d="M150,95 L150,191 L141,193 L141,97 Z" fill="#b9852f"/>
            </g>
          </svg>
        </div>

        <div class="cg-box layer-lid">
          <svg viewBox="0 0 230 210" aria-hidden="true">
            <defs>
              <linearGradient id="cgLidTop" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#1cab9b"/><stop offset="1" stop-color="#127a6d"/>
              </linearGradient>
              <linearGradient id="cgLidSide" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#10796c"/><stop offset="1" stop-color="#0c5f55"/>
              </linearGradient>
              <radialGradient id="cgBow" cx="0.4" cy="0.35" r="0.8">
                <stop offset="0" stop-color="#f5d791"/><stop offset="1" stop-color="#c4933f"/>
              </radialGradient>
            </defs>
            <g class="cg-lid">
              <path d="M18,70 L115,44 L212,70 L115,96 Z" fill="url(#cgLidTop)"/>
              <path d="M18,70 L115,96 L115,118 L18,92 Z" fill="url(#cgLidSide)"/>
              <path d="M115,96 L212,70 L212,92 L115,118 Z" fill="#0e6f63"/>
              <path d="M150,55 L168,59 L130,113 L113,109 Z" fill="#d8aa5e" opacity="0.9"/>
              <path d="M100,57 L118,53 L150,107 L132,111 Z" fill="#e7c373" opacity="0.85"/>
              <g class="cg-bow">
                <path d="M115,52 C92,30 60,40 74,62 C84,76 108,66 115,58 Z" fill="url(#cgBow)"/>
                <path d="M115,52 C138,30 170,40 156,62 C146,76 122,66 115,58 Z" fill="url(#cgBow)"/>
                <path d="M115,52 C100,40 96,44 100,58 M115,52 C130,40 134,44 130,58" stroke="#a9782e" stroke-width="1.4" fill="none" opacity="0.6"/>
                <ellipse cx="115" cy="56" rx="10" ry="9" fill="#caa24f"/>
                <ellipse cx="115" cy="54" rx="6" ry="5" fill="#f0d089"/>
              </g>
            </g>
          </svg>
        </div>
      </div>

      <p class="cg-badge-line"><span class="badge cg-badge">赛博礼物</span></p>
      <div class="cg-actions">
        <button class="btn cg-collect" type="button" data-cg-collect>收下这份祝福</button>
        <button class="btn secondary cg-replay" type="button" data-cg-replay>重新播放</button>
      </div>
    </div>`;
  overlay.querySelector("[data-cg-collect]").addEventListener("click", collectCyberGift);
  overlay.querySelector("[data-cg-replay]").addEventListener("click", () => cgScene && cgScene.replay());
  return overlay;
}

/* ---- cyber-gift scene: Canvas firework/confetti engine + open-box choreography ---- */
let cgScene = null;

function initCyberGiftScene() {
  stopCyberGiftScene();
  const overlay = $(".cyber-gift-overlay");
  if (!overlay) return;
  const canvas = overlay.querySelector(".cg-canvas");
  const stage = overlay.querySelector("[data-cg-stage]");
  const sheep = overlay.querySelector("[data-cg-sheep]");
  const ticket = overlay.querySelector("[data-cg-ticket]");
  if (!canvas || !stage) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fx = createCyberFX(canvas, reduce);
  let timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const reflow = (node) => { if (!node) return; const a = node.style.animation; node.style.animation = "none"; void node.offsetWidth; node.style.animation = a || ""; };

  function play() {
    clearTimers();
    stage.classList.remove("cg-opened");
    if (sheep) sheep.classList.remove("settled");
    if (ticket) ticket.classList.remove("settled");
    stage.querySelectorAll(".cg-box-body, .cg-lid, .cg-bow, .cg-floor").forEach(reflow);
    reflow(sheep); reflow(ticket);
    fx.start();
    if (!reduce) {
      at(880, () => { fx.confetti(); fx.burstAt(window.innerWidth / 2, window.innerHeight / 2 - 30); });
      at(1180, () => fx.confetti());
    }
    at(1450, () => stage.classList.add("cg-opened"));
    at(2900, () => { if (sheep) sheep.classList.add("settled"); if (ticket) ticket.classList.add("settled"); });
  }
  cgScene = { play, replay: play, stop() { clearTimers(); fx.stop(); } };
  requestAnimationFrame(play);
}

function stopCyberGiftScene() {
  if (cgScene) { cgScene.stop(); cgScene = null; }
}

function createCyberFX(canvas, reduce) {
  const ctx = canvas.getContext("2d");
  const PALETTE = ["#ffffff", "#ffe9b0", "#f4c45e", "#c79a52", "#37cdbb", "#5fe0cf", "#7ff0dd"];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  // Mobile GPUs are fill-rate bound: smaller backbuffer + fewer additive draws + a finite show.
  const lite = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
    || (window.matchMedia && window.matchMedia("(max-width: 760px)").matches)
    || (navigator.hardwareConcurrency || 8) <= 6;
  const CFG = lite
    ? { dpr: 1.3, burst: [150, 270], extra: 200, conf: 80, maxSparks: 850, spawnGap: [46, 78], spawnMs: 3200 }
    : { dpr: 2.0, burst: [300, 600], extra: 420, conf: 130, maxSparks: 2400, spawnGap: [34, 64], spawnMs: 4200 };
  let W = 0, H = 0, DPR = 1, sparks = [], rockets = [], confetti = [], running = false, raf = 0, rocketTimer = 0, spawnDeadline = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, CFG.dpr);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function Spark(x, y, color, opt) {
    opt = opt || {};
    const a = rnd(0, Math.PI * 2);
    const sp = opt.speed != null ? opt.speed : (2.2 + Math.pow(Math.random(), 0.5) * 7.0);
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.rgb = toRgb(color); this.life = 1;
    this.decay = rnd(0.012, 0.022) * (opt.fast ? 1.8 : 1);
    this.grav = 0.026; this.drag = 0.986;
    this.canSecondary = opt.secondary !== false && Math.random() < 0.08;
    this.size = rnd(0.8, 1.6);
  }
  Spark.prototype.step = function () {
    this.px = this.x; this.py = this.y;
    this.vx *= this.drag; this.vy = this.vy * this.drag + this.grav;
    this.x += this.vx; this.y += this.vy; this.life -= this.decay;
    if (this.life <= 0 && this.canSecondary) {
      this.canSecondary = false;
      for (let i = 0; i < (rnd(5, 9) | 0); i += 1) sparks.push(new Spark(this.x, this.y, pick(PALETTE), { speed: rnd(0.6, 2.2), fast: true, secondary: false }));
    }
  };
  Spark.prototype.draw = function () {
    if (this.life <= 0) return;
    const l = this.life, rgb = this.rgb;
    const heat = l > 0.65 ? (l - 0.65) / 0.35 : 0;
    const cr = Math.min(255, rgb[0] + heat * 160) | 0, cg = Math.min(255, rgb[1] + heat * 160) | 0, cb = Math.min(255, rgb[2] + heat * 160) | 0;
    const al = Math.min(1, l * 1.25);
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${al})`;
    // One round-capped stroke draws both the trail and a glowing head — half the fill cost of stroke+arc.
    ctx.lineWidth = Math.max(1, l * 2.7 * this.size); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(this.px, this.py); ctx.lineTo(this.x, this.y); ctx.stroke();
  };

  function Rocket() {
    this.x = rnd(W * 0.18, W * 0.82); this.y = H + 10; this.px = this.x; this.py = this.y;
    this.tx = this.x + rnd(-30, 30); this.ty = rnd(H * 0.12, H * 0.40);
    this.vy = -rnd(9, 12); this.vx = (this.tx - this.x) / ((this.y - this.ty) / -this.vy);
    this.color = pick(PALETTE); this.dead = false;
  }
  Rocket.prototype.step = function () {
    this.px = this.x; this.py = this.y;
    this.x += this.vx; this.y += this.vy; this.vy += 0.12;
    if (this.vy >= -1.4 || this.y <= this.ty) { this.explode(); this.dead = true; }
  };
  Rocket.prototype.explode = function () {
    const n = CFG.burst[0] + (Math.random() * (CFG.burst[1] - CFG.burst[0]) | 0), b1 = pick(PALETTE), b2 = pick(PALETTE);
    for (let i = 0; i < n; i += 1) sparks.push(new Spark(this.x, this.y, Math.random() < 0.5 ? b1 : b2));
  };
  Rocket.prototype.draw = function () {
    ctx.strokeStyle = this.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(this.px, this.py); ctx.lineTo(this.x, this.y); ctx.stroke();
  };

  const CONF = ["#37cdbb", "#c79a52", "#ecd9ad", "#19a394", "#f4c45e", "#7ff0dd", "#ffffff"];
  function Confetto(x, y) {
    this.x = x; this.y = y;
    const a = rnd(-Math.PI * 0.85, -Math.PI * 0.15), sp = rnd(6, 15);
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.w = rnd(5, 10); this.h = rnd(7, 13);
    this.rot = rnd(0, Math.PI * 2); this.vr = rnd(-0.3, 0.3);
    this.color = pick(CONF); this.life = 1; this.decay = rnd(0.004, 0.008);
    this.grav = 0.28; this.drag = 0.985; this.tilt = rnd(0, Math.PI * 2); this.vt = rnd(0.1, 0.25);
  }
  Confetto.prototype.step = function () {
    this.vx *= this.drag; this.vy = this.vy * this.drag + this.grav;
    this.x += this.vx; this.y += this.vy; this.rot += this.vr; this.tilt += this.vt; this.life -= this.decay;
  };
  Confetto.prototype.draw = function () {
    if (this.life <= 0) return;
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    ctx.scale(1, Math.max(0.25, Math.abs(Math.cos(this.tilt))));
    ctx.globalAlpha = Math.min(1, this.life * 1.4); ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h); ctx.restore();
  };

  function loop() {
    if (!running) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(7,34,31,0.30)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const r of rockets) { r.step(); r.draw(); }
    rockets = rockets.filter((r) => !r.dead);
    for (const s of sparks) { s.step(); s.draw(); }
    sparks = sparks.filter((s) => s.life > 0);
    if (sparks.length > CFG.maxSparks) sparks.splice(0, sparks.length - CFG.maxSparks);
    ctx.globalCompositeOperation = "source-over";
    for (const c of confetti) { c.step(); c.draw(); }
    confetti = confetti.filter((c) => c.life > 0 && c.y < H + 40);
    ctx.globalAlpha = 1;
    const spawning = !reduce && performance.now() < spawnDeadline;
    if (spawning) {
      rocketTimer -= 1;
      if (rocketTimer <= 0) { rockets.push(new Rocket()); if (Math.random() < 0.4) rockets.push(new Rocket()); rocketTimer = rnd(CFG.spawnGap[0], CFG.spawnGap[1]); }
    }
    // Once the show is over and nothing is left on screen, stop the loop so the GPU goes idle.
    if (!spawning && !rockets.length && !sparks.length && !confetti.length) {
      running = false; ctx.clearRect(0, 0, W, H); return;
    }
    raf = requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);
  return {
    start() { if (running) return; resize(); running = true; ctx.clearRect(0, 0, W, H); rocketTimer = 10; spawnDeadline = performance.now() + CFG.spawnMs; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); },
    confetti() { const ox = W / 2, oy = H / 2 - 6; for (let i = 0; i < CFG.conf; i += 1) confetti.push(new Confetto(ox + rnd(-26, 26), oy + rnd(-10, 10))); },
    burstAt(px, py) { const c = pick(PALETTE); for (let i = 0; i < CFG.extra; i += 1) sparks.push(new Spark(px, py, Math.random() < 0.5 ? c : pick(PALETTE))); },
  };
}


function fireworkBurst(layer, cx, cy, color) {
  const total = 26;
  for (let i = 0; i < total; i += 1) {
    const angle = (i / total) * Math.PI * 2 + Math.random() * 0.2;
    const distance = 46 + Math.random() * 64;
    const dot = el("span", { class: "fw-dot" });
    dot.style.left = `${cx}px`;
    dot.style.top = `${cy}px`;
    dot.style.color = color;
    dot.style.setProperty("--tx", `${(Math.cos(angle) * distance).toFixed(1)}px`);
    dot.style.setProperty("--ty", `${(Math.sin(angle) * distance + 38).toFixed(1)}px`);
    dot.style.animationDelay = `${Math.round(Math.random() * 70)}ms`;
    layer.appendChild(dot);
    setTimeout(() => dot.remove(), 1400);
  }
}

function burstTicketSparks() {
  const layer = $(".ticket-peek-wrap .fw-layer");
  if (!layer) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const w = layer.clientWidth || 280;
  const h = layer.clientHeight || 160;
  fireworkBurst(layer, w * 0.5, h * 0.4, "#c79a52");
  setTimeout(() => fireworkBurst(layer, w * 0.3, h * 0.52, "#37cdbb"), 200);
  setTimeout(() => fireworkBurst(layer, w * 0.72, h * 0.52, "#ecd9ad"), 360);
}

async function makeDecision(action) {
  try {
    const result = await api(`/api/projects/${PROJECT_ID}/decision`, {
      method: "POST",
      body: JSON.stringify({ participant_id: participant.id, action }),
    });
    messages.clear();
    state = result.state;
    cooldownRemaining = state.cooldown_remaining || 0;
    renderProject({ scrollTop: true });
  } catch (error) {
    messages.set("phase", { type: "error", text: error.message });
    renderProject();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetLotteryAnimation() {
  lotterySpinning = false;
  lotteryWheelAnimating = false;
  lotteryWheelSettled = false;
  lotteryWheelRotation = 0;
  lotteryTargetPrize = null;
  pendingLotteryResult = null;
}

function lotteryVisualSegments(targetPrize = null) {
  if (targetPrize === "额外奖候补") {
    return ["额外奖候补", ...LOTTERY_BASE_SEGMENTS.slice(1)];
  }
  return LOTTERY_BASE_SEGMENTS;
}

function renderLotteryWheel(wheelClass, wheelStyle, targetPrize = null) {
  const segments = lotteryVisualSegments(targetPrize);
  return el("div", { class: wheelClass, style: wheelStyle }, [
    el("svg", { class: "wheel-svg", viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" }, [
      ...segments.map((label, index) => el("path", {
        class: "wheel-slice",
        d: lotterySlicePath(index, segments.length),
        fill: LOTTERY_SEGMENT_COLORS[label] || LOTTERY_SEGMENT_COLORS["三等奖"],
      })),
      el("circle", { class: "wheel-inner-ring", cx: "50", cy: "50", r: "16" }),
    ]),
    el("span", { class: "wheel-center" }, "抽"),
  ]);
}

function lotterySlicePath(index, total) {
  const step = 360 / total;
  const start = -90 + index * step;
  const end = -90 + (index + 1) * step;
  const center = { x: 50, y: 50 };
  const radius = 48;
  const startPoint = lotteryPolarPoint(center, radius, start);
  const endPoint = lotteryPolarPoint(center, radius, end);
  const largeArc = step > 180 ? 1 : 0;
  return [
    `M ${center.x} ${center.y}`,
    `L ${startPoint.x.toFixed(3)} ${startPoint.y.toFixed(3)}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x.toFixed(3)} ${endPoint.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

function lotteryPolarPoint(center, radius, angleDeg) {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: center.x + radius * Math.cos(radians),
    y: center.y + radius * Math.sin(radians),
  };
}

function lotteryRotationForPrize(prizeLabel, drawIndex = 1) {
  const segments = lotteryVisualSegments(prizeLabel);
  const candidates = segments
    .map((label, index) => (label === prizeLabel ? index : -1))
    .filter((index) => index >= 0);
  const targetIndex = candidates.length
    ? candidates[(Math.max(1, drawIndex) - 1) % candidates.length]
    : 0;
  const step = 360 / segments.length;
  const targetCenter = (targetIndex + 0.5) * step;
  const stopRotation = (360 - targetCenter) % 360;
  const fullSpins = 5 + (drawIndex % 2);
  return fullSpins * 360 + stopRotation;
}

async function onDrawLottery() {
  if (lotterySpinning) return;
  lotterySpinning = true;
  lotteryWheelAnimating = false;
  lotteryWheelSettled = false;
  lotteryWheelRotation = 0;
  lotteryNotice = null;
  pendingLotteryResult = null;
  renderProject({ reload: false, preserveScroll: true });
  try {
    const drawPromise = api(`/api/projects/${PROJECT_ID}/lottery/draw`, {
      method: "POST",
      body: JSON.stringify({ participant_id: participant.id }),
    });
    pendingLotteryResult = await drawPromise;
    lotteryTargetPrize = pendingLotteryResult.draw.prize_label;
    lotteryWheelRotation = lotteryRotationForPrize(
      pendingLotteryResult.draw.prize_label,
      pendingLotteryResult.draw.draw_index
    );
    lotteryWheelAnimating = true;
    renderProject({ reload: false, preserveScroll: true });
    await wait(5000);
    const result = pendingLotteryResult;
    const resultText = `抽中了${result.draw.prize_label}。`;
    state = result.state;
    lotteryNotice = { type: "ok", text: resultText };
    lotterySpinning = false;
    lotteryWheelAnimating = false;
    lotteryWheelSettled = true;
    renderProject({ reload: false, preserveScroll: true });
    await wait(3000);
    if (lotteryNotice?.text === resultText) {
      lotteryNotice = null;
      resetLotteryAnimation();
      renderProject({ reload: false, preserveScroll: true });
    }
  } catch (error) {
    lotteryNotice = { type: "error", text: error.message };
    resetLotteryAnimation();
    renderProject({ reload: false, preserveScroll: true });
  }
}

function confirmStartFinal() {
  confirmModal = { type: "start_final" };
  renderProject();
}

function closeConfirmModal() {
  confirmModal = null;
  renderProject();
}

function confirmStartFinalDecision() {
  confirmModal = null;
  makeDecision("start_final");
}

function renderConfirmModal() {
  if (!confirmModal) return null;
  if (confirmModal.type === "logout_tester") {
    return renderDecisionModal({
      badge: "退出测试",
      title: "确定退出当前测试进度吗？",
      body: "测试进度会留在后台记录中，重新打开时会回到当前进度。",
      primary: "确认退出",
      secondary: "继续游玩",
      onPrimary: confirmLogoutParticipant,
    });
  }
  if (confirmModal.type === "logout_individual") {
    return renderDecisionModal({
      badge: "更换学号",
      title: "确定退出当前学号吗？",
      body: "当前进度会保留；再次输入同一学号时，会回到这一次的完成记录。",
      primary: "确认退出",
      secondary: "继续游玩",
      onPrimary: confirmLogoutParticipant,
    });
  }
  if (confirmModal.type === "restart_tester") {
    return renderDecisionModal({
      badge: "重新开始",
      title: "确定以测试人员身份重新开始一次吗？",
      body: "当前完成记录和兑奖码会留在后台，本机会生成一个新的测试编号。",
      primary: "重新开始一次",
      secondary: "继续查看结果",
      onPrimary: confirmRestartAsNewParticipant,
    });
  }
  if (confirmModal.type !== "start_final") return null;
  return renderDecisionModal({
    badge: "终章确认",
    title: "开启终章并关闭未完成旁枝",
    body: "一旦开启终章，未完成的旁枝题将无法再体验；终章完成后游戏即刻结束。",
    primary: "开启终章并关闭未完成旁枝",
    secondary: "继续探索",
    onPrimary: confirmStartFinalDecision,
  });
}

function renderDecisionModal({ badge, title, body, primary, secondary, onPrimary }) {
  return el("div", { class: "modal-overlay confirm-modal" }, [
    el("div", { class: "modal-panel confirm-panel" }, [
      el("p", { class: "badge main" }, badge),
      el("h2", {}, title),
      el("p", {}, body),
      el("div", { class: "cta-row" }, [
        el("button", { class: "btn", type: "button", onclick: onPrimary }, primary),
        el("button", { class: "btn secondary", type: "button", onclick: closeConfirmModal }, secondary),
      ]),
    ]),
  ]);
}

function restartAsNewParticipant() {
  confirmModal = { type: "restart_tester" };
  renderProject();
}

function confirmRestartAsNewParticipant() {
  confirmModal = null;
  localStorage.removeItem(PARTICIPANT_KEY);
  localStorage.removeItem(PARTICIPANT_KIND_KEY);
  localStorage.removeItem(STUDENT_ID_KEY);
  localStorage.removeItem(PHONE_KEY);
  participant = null;
  state = null;
  cooldownRemaining = 0;
  stopEventPolling();
  messages.clear();
  lotteryNotice = null;
  resetLotteryAnimation();
  startTesterSession();
}

function logoutParticipant() {
  const isTester = participant?.participant_kind === "tester" || state?.participant?.participant_kind === "tester";
  confirmModal = { type: isTester ? "logout_tester" : "logout_individual" };
  renderProject();
}

function confirmLogoutParticipant() {
  const isTester = participant?.participant_kind === "tester" || state?.participant?.participant_kind === "tester";
  confirmModal = null;
  if (!isTester) {
    localStorage.removeItem(PARTICIPANT_KEY);
    localStorage.removeItem(PARTICIPANT_KIND_KEY);
    localStorage.removeItem(STUDENT_ID_KEY);
    localStorage.removeItem(PHONE_KEY);
  }
  participant = null;
  state = null;
  cooldownRemaining = 0;
  stopEventPolling();
  messages.clear();
  lotteryNotice = null;
  resetLotteryAnimation();
  if (isTester) {
    location.href = "/";
  } else {
    renderProject();
  }
}

function renderQuestionSection(title, description, questions) {
  return el("section", { class: "question-section" }, [
    el("h2", {}, title),
    el("p", { class: "lede" }, description),
    el("div", { class: "question-list" }, questions.map(renderQuestionCard)),
  ]);
}

function renderQuestionCard(q) {
  const message = messages.get(q.id);
  const hasError = message?.type === "error";
  const cardClass = [
    "question-card",
    q.kind === "bonus" ? "branch-card" : "",
    q.kind === "final" ? "final-card" : "",
    q.completed ? "complete" : "",
    q.locked ? "locked" : "",
    hasError ? "err" : "",
    animateReveals ? "reveal" : "",
  ].filter(Boolean).join(" ");
  const badgeClass = q.completed ? "badge done" : q.kind === "bonus" ? "badge bonus" : "badge main";
  const body = [
    el("div", { class: "question-title-row" }, [
      el("div", {}, [
        el("h3", {}, `${displayQuestionId(q.id)} · ${q.title}`),
      ]),
      q.kind === "bonus"
        ? null
        : el("span", { class: badgeClass }, q.completed ? "已完成" : q.kind === "final" ? "终章" : "主线"),
    ]),
    q.kind === "bonus" && q.bonus_meta ? renderBranchMeta(q) : null,
    el("p", { class: "prompt" }, q.locked ? q.locked_reason : q.prompt),
  ];
  if (!q.locked && q.image) {
    body.push(renderQuestionImage(q.image));
  }
  if (!q.completed && !q.locked) {
    body.push(
      el("form", { class: "form-row", dataset: { qid: q.id }, onsubmit: onSubmitAnswer }, [
        el("input", {
          class: `answer-input${hasError ? " err" : ""}`,
          name: "answer",
          autocomplete: "off",
          placeholder: `答案格式：${q.answer_format}`,
          "aria-label": `${displayQuestionId(q.id)} 答案`,
          value: draftAnswers.get(q.id) || "",
          oninput: (event) => draftAnswers.set(q.id, event.currentTarget.value),
        }),
        el("button", { class: `btn submit-btn${q.kind === "final" ? " gold" : ""}`, type: "submit", dataset: { qid: q.id } }, submitButtonText()),
      ])
    );
  }

  if (message) {
    body.push(el("p", { class: `message ${message.type}` }, message.text));
  }
  if (!q.completed && !q.locked && q.rescue_hints_unlocked?.length) {
    body.push(renderRescueHints(q.rescue_hints_unlocked));
  }

  return el("article", { class: cardClass }, body);
}

function renderBranchMeta(q) {
  return el("div", { class: "branch-meta" }, [
    el("span", {}, q.location),
    el("span", {}, `难度 ${q.bonus_meta.difficulty}`),
  ]);
}

function renderRescueHints(hints) {
  return el("section", { class: "rescue-card" }, [
    el("h4", {}, "救援提示"),
    ...hints.map((hint) => el("div", { class: "rescue-item" }, [
      el("strong", {}, hint.title),
      el("p", {}, hint.text),
    ])),
  ]);
}

function renderQuestionImage(image) {
  return el("figure", { class: "question-image" }, [
    el("button", { class: "question-image-button", type: "button", onclick: () => openImageModal(image) }, [
      el("img", {
        class: "blurup",
        loading: "lazy",
        alt: image.alt || "题目附图",
        onload: (event) => event.currentTarget.classList.add("loaded"),
        src: image.src,
      }),
    ]),
    image.caption ? el("figcaption", {}, image.caption) : null,
  ]);
}

function openImageModal(image, gallery = null, index = 0) {
  imageModal = image;
  imageGallery = gallery && gallery.length > 1 ? gallery : null;
  imageGalleryIndex = index;
  imageZoom = { scale: 1, x: 0, y: 0 };
  imagePointers = new Map();
  imageGesture = null;
  imageMouseStage = null;
  renderProject({ reload: false, preserveScroll: true });
}

function showGalleryImage(delta) {
  if (!imageGallery) return;
  const count = imageGallery.length;
  imageGalleryIndex = (imageGalleryIndex + delta + count) % count;
  imageModal = imageGallery[imageGalleryIndex];
  imageZoom = { scale: 1, x: 0, y: 0 };
  imageGesture = null;
  imageMouseStage = null;
  renderProject({ reload: false, preserveScroll: true });
}

function closeImageModal(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  imageModal = null;
  imageGallery = null;
  imageGalleryIndex = 0;
  imagePointers = new Map();
  imageGesture = null;
  imageMouseStage = null;
  $(".image-modal")?.remove();
}

function renderImageModal() {
  if (!imageModal) return null;
  return el("div", { class: "modal-overlay image-modal", onclick: (event) => {
    if (event.target.classList.contains("modal-overlay")) closeImageModal();
  } }, [
    el("div", { class: "modal-panel image-modal-panel" }, [
      el("div", { class: "image-modal-toolbar" }, [
        el("button", { class: "btn secondary", type: "button", onclick: () => changeImageZoom(0.2) }, "放大"),
        el("button", { class: "btn secondary", type: "button", onclick: () => changeImageZoom(-0.2) }, "缩小"),
        el("button", { class: "btn secondary", type: "button", onclick: resetImageZoom }, "复位"),
        el("button", {
          class: "modal-close",
          type: "button",
          onclick: closeImageModal,
          onpointerdown: closeImageModal,
          ontouchstart: closeImageModal,
          "aria-label": "关闭大图",
        }, "×"),
      ]),
      el("div", {
        class: "image-zoom-stage",
        onwheel: onImageWheel,
        ondragstart: preventImageDrag,
        onmousedown: onImageMouseDown,
        ontouchstart: onImageTouchStart,
        ontouchmove: onImageTouchMove,
        ontouchend: onImageTouchEnd,
        ontouchcancel: onImageTouchEnd,
      }, [
        el("img", {
          class: "zoomable-image",
          src: imageModal.src,
          alt: imageModal.alt || "题目附图",
          draggable: "false",
          ondragstart: preventImageDrag,
          style: imageZoomStyle(),
        }),
      ]),
      imageGallery
        ? el("div", { class: "image-gallery-bar" }, [
            el("button", { class: "btn secondary", type: "button", onclick: () => showGalleryImage(-1) }, "‹ 上一页"),
            el("span", { class: "image-page-indicator" }, `${imageGalleryIndex + 1} / ${imageGallery.length}`),
            el("button", { class: "btn secondary", type: "button", onclick: () => showGalleryImage(1) }, "下一页 ›"),
          ])
        : null,
      imageModal.caption ? el("p", { class: "small" }, imageModal.caption) : null,
    ]),
  ]);
}

function imageZoomStyle() {
  return `--image-x: ${imageZoom.x}px; --image-y: ${imageZoom.y}px; --image-scale: ${imageZoom.scale};`;
}

function clampZoom(value) {
  return Math.min(4, Math.max(1, value));
}

function applyImageZoom() {
  const image = $(".zoomable-image");
  if (image) {
    image.style.setProperty("--image-x", `${imageZoom.x}px`);
    image.style.setProperty("--image-y", `${imageZoom.y}px`);
    image.style.setProperty("--image-scale", imageZoom.scale);
  }
}

function changeImageZoom(delta) {
  imageZoom.scale = clampZoom(imageZoom.scale + delta);
  if (imageZoom.scale === 1) {
    imageZoom.x = 0;
    imageZoom.y = 0;
  }
  applyImageZoom();
}

function resetImageZoom() {
  imageZoom = { scale: 1, x: 0, y: 0 };
  applyImageZoom();
}

function onImageWheel(event) {
  event.preventDefault();
  changeImageZoom(event.deltaY < 0 ? 0.18 : -0.18);
}

function preventImageDrag(event) {
  event.preventDefault();
}

function beginImageDrag(clientX, clientY) {
  imageGesture = {
    type: "drag",
    startX: clientX,
    startY: clientY,
    originX: imageZoom.x,
    originY: imageZoom.y,
  };
}

function updateImageDrag(clientX, clientY) {
  if (imageGesture?.type !== "drag" || imageZoom.scale <= 1) return;
  imageZoom.x = imageGesture.originX + clientX - imageGesture.startX;
  imageZoom.y = imageGesture.originY + clientY - imageGesture.startY;
  applyImageZoom();
}

function pointerDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function pointerMidpoint(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function beginImagePinch(touches) {
  const [a, b] = touches;
  const midpoint = pointerMidpoint(a, b);
  imageGesture = {
    type: "pinch",
    startDistance: Math.max(1, pointerDistance(a, b)),
    startScale: imageZoom.scale,
    originX: imageZoom.x,
    originY: imageZoom.y,
    midpointX: midpoint.x,
    midpointY: midpoint.y,
  };
}

function updateImagePinch(touches) {
  if (imageGesture?.type !== "pinch") return;
  const [a, b] = touches;
  const midpoint = pointerMidpoint(a, b);
  const distance = Math.max(1, pointerDistance(a, b));
  const nextScale = clampZoom(imageGesture.startScale * (distance / imageGesture.startDistance));
  const scaleRatio = nextScale / imageGesture.startScale;
  imageZoom.scale = nextScale;
  imageZoom.x = midpoint.x - imageGesture.midpointX + imageGesture.originX * scaleRatio;
  imageZoom.y = midpoint.y - imageGesture.midpointY + imageGesture.originY * scaleRatio;
  if (imageZoom.scale === 1) {
    imageZoom.x = 0;
    imageZoom.y = 0;
  }
  applyImageZoom();
}

function onImageMouseDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  imageMouseStage = event.currentTarget;
  imageMouseStage.classList.add("dragging");
  beginImageDrag(event.clientX, event.clientY);
  window.addEventListener("mousemove", onImageMouseMove);
  window.addEventListener("mouseup", onImageMouseUp, { once: true });
}

function onImageMouseMove(event) {
  if (!imageMouseStage) return;
  event.preventDefault();
  updateImageDrag(event.clientX, event.clientY);
}

function onImageMouseUp(event) {
  event.preventDefault();
  window.removeEventListener("mousemove", onImageMouseMove);
  imageMouseStage?.classList.remove("dragging");
  imageMouseStage = null;
  imageGesture = null;
}

function onImageTouchStart(event) {
  if (![1, 2].includes(event.touches.length)) return;
  event.preventDefault();
  imageMouseStage = event.currentTarget;
  imageMouseStage.classList.add("dragging");
  if (event.touches.length === 2) {
    beginImagePinch(Array.from(event.touches));
  } else {
    const touch = event.touches[0];
    beginImageDrag(touch.clientX, touch.clientY);
  }
}

function onImageTouchMove(event) {
  if (!imageMouseStage || ![1, 2].includes(event.touches.length)) return;
  event.preventDefault();
  if (event.touches.length === 2) {
    updateImagePinch(Array.from(event.touches));
  } else {
    const touch = event.touches[0];
    updateImageDrag(touch.clientX, touch.clientY);
  }
}

function onImageTouchEnd(event) {
  event.preventDefault();
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    beginImageDrag(touch.clientX, touch.clientY);
    return;
  }
  imageMouseStage?.classList.remove("dragging");
  imageMouseStage = null;
  imageGesture = null;
}

function renderEcho(echo) {
  const p = el("p");
  p.append(echo.before || "");
  if (echo.highlight) p.append(el("strong", {}, echo.highlight));
  p.append(echo.after || "");
  return el("div", { class: "echo" }, p);
}

function renderRedeem(redeem) {
  if (!redeem) return null;
  const lottery = redeem.lottery || {};
  const waitingForDraw = (lottery.draws_remaining || 0) > 0;
  return el("div", { class: "redeem" }, [
    el("p", { class: "small" }, redeem.redeemed ? "兑奖凭证已核销" : "完成凭证"),
    el("div", { class: "redeem-code" }, redeem.code),
    redeem.award_summary ? el("p", { class: "redeem-award" }, redeem.award_summary) : null,
    el(
      "p",
      { class: "small" },
      redeem.redeemed
        ? `核销时间：${formatTime(redeem.redeemed_at)}`
        : waitingForDraw
          ? "请先完成抽奖，再到兑奖处出示此码。"
          : "请到兑奖处出示此码。"
    ),
  ]);
}

function submitButtonText() {
  return cooldownRemaining > 0 ? `终止答题 ${cooldownRemaining} 秒` : "提交";
}

async function onSubmitAnswer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const qid = form.dataset.qid;
  const input = $("input[name='answer']", form);
  const answer = input.value.trim();
  if (!answer) {
    messages.set(qid, { type: "error", text: "请先输入答案。" });
    renderProject();
    return;
  }
  draftAnswers.set(qid, answer);
  if (cooldownRemaining > 0) {
    messages.set(qid, { type: "error", text: `任一题答错后，终止答题 15s，还剩 ${cooldownRemaining} 秒。` });
    renderProject({ reload: false, preserveScroll: true });
    return;
  }

  const button = $(".submit-btn", form);
  button.disabled = true;
  button.textContent = "提交中";

  try {
    const result = await api(`/api/projects/${PROJECT_ID}/submit`, {
      method: "POST",
      body: JSON.stringify({ participant_id: participant.id, question_id: qid, answer }),
    });
    state = result.state;
    cooldownRemaining = state.cooldown_remaining || result.cooldown_remaining || 0;
    if (result.ok) {
      messages.delete(qid);
      draftAnswers.delete(qid);
      if (qid !== FINAL_ID && result.echo) {
        showEchoAnimation(result.echo, qid);
        return;
      }
      if (qid === FINAL_ID) {
        renderProject({ scrollTop: true });
        return;
      }
    } else if (result.rate_limited) {
      messages.set(qid, { type: "error", text: result.message });
    } else {
      draftAnswers.delete(qid);
      input.value = "";
      messages.set(qid, { type: "error", text: result.message });
    }
  } catch (error) {
    messages.set(qid, { type: "error", text: error.message });
  }

  renderProject();
}

function startCooldownTimer() {
  if (cooldownTimer) clearInterval(cooldownTimer);
  updateCooldownUi();
  if (cooldownRemaining <= 0) return;
  cooldownTimer = setInterval(() => {
    cooldownRemaining = Math.max(0, cooldownRemaining - 1);
    updateCooldownUi();
    if (cooldownRemaining <= 0) clearInterval(cooldownTimer);
  }, 1000);
}

function updateCooldownUi() {
  const status = $("#cooldownStatus");
  if (status) {
    status.textContent = cooldownStatusText();
    status.classList.toggle("active", cooldownRemaining > 0);
  }
  document.querySelectorAll(".submit-btn").forEach((button) => {
    button.disabled = cooldownRemaining > 0;
    button.textContent = submitButtonText();
  });
}

async function renderAdmin() {
  if (!localStorage.getItem(ADMIN_TOKEN_KEY)) {
    setScreen(renderAdminLogin());
    return;
  }
  let overview;
  try {
    overview = await api("/api/admin/overview", { admin: true });
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setScreen(renderAdminLogin(error.message));
      return;
    }
    setScreen(renderError(error.message));
    return;
  }

  const panels = el("section", { class: "admin-grid" }, [
    metricPanel("参与者", overview.participants),
    metricPanel("有效提交", overview.submissions),
    metricPanel("完成终章", overview.final_done),
    metricPanel("已抽奖", overview.lottery_drawn || 0),
    metricPanel("额外奖剩余", overview.lottery_remaining || 0),
  ]);

  setScreen([
    sectionHead("工作人员后台", "运行与核销", `当前操作者：${overview.admin.nickname || localStorage.getItem(ADMIN_NICKNAME_KEY) || "未命名"}`),
    el("div", { class: "cta-row admin-session-row" }, [
      el("button", { class: "btn secondary", type: "button", onclick: logoutAdmin }, "退出后台"),
    ]),
    panels,
    renderRedeemForm(),
    adminTable(
      "奖品剩余情况",
      ["奖品", "奖池总数", "已预定", "已核销", "剩余"],
      (overview.prize_fulfillment || []).map((row) => [
        row.label,
        row.stock,
        row.reserved,
        row.redeemed,
        row.remaining,
      ])
    ),
    adminTable(
      "已预定奖品清单",
      ["学号", "手机号", "参与者", "兑奖码", "奖项结果", "状态", "生成时间"],
      (overview.reserved_awards || []).map((row) => [
        row.student_id || "-",
        row.phone || "-",
        row.participant_id,
        row.code,
        row.award_summary || "-",
        row.lottery_draws_remaining ? "待抽奖/待兑奖" : "待兑奖",
        formatTime(row.created_at),
      ])
    ),
    collapsibleAdminTable(
      "题目统计",
      "展开查看各题完成与错误情况",
      ["题号", "题目", "完成", "正确提交", "错误提交"],
      overview.question_stats.map((row) => [displayQuestionId(row.id), row.title, row.completed, row.correct_submissions, row.wrong_submissions])
    ),
    adminTable(
      "兑奖码",
      ["学号", "手机号", "参与者", "兑奖码", "奖项结果", "状态", "核销人", "创建时间"],
      overview.redeem_codes.map((row) => [
        row.student_id || "-",
        row.phone || "-",
        row.participant_id,
        row.code,
        row.award_summary || "-",
        row.redeemed ? `已核销 ${formatTime(row.redeemed_at)}` : row.cyber_gift_sent ? `已发赛博礼物 ${formatTime(row.cyber_gift_at)}` : "未核销",
        row.redeemed_by || row.cyber_gift_by || "-",
        formatTime(row.created_at),
      ])
    ),
    adminTable(
      "最近提交",
      ["时间", "学号", "参与者", "题号", "答案", "结果"],
      overview.recent_submissions.map((row) => [
        formatTime(row.submitted_at),
        row.student_id || "-",
        row.participant_id,
        displayQuestionId(row.question_id),
        row.answer,
        row.is_rate_limited ? "冷却拦截" : row.is_correct ? "正确" : "错误",
      ]),
      el("a", { class: "btn secondary", href: "/admin/submissions" }, "查看全部提交记录")
    ),
  ]);
}

async function renderAdminSubmissions() {
  if (!localStorage.getItem(ADMIN_TOKEN_KEY)) {
    setScreen(renderAdminLogin());
    return;
  }
  let data;
  try {
    data = await api("/api/admin/submissions", { admin: true });
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setScreen(renderAdminLogin(error.message));
      return;
    }
    setScreen(renderError(error.message));
    return;
  }

  setScreen([
    sectionHead("工作人员后台", "全部提交记录", `当前操作者：${data.admin.nickname || localStorage.getItem(ADMIN_NICKNAME_KEY) || "未命名"}`),
    el("div", { class: "cta-row admin-session-row" }, [
      el("a", { class: "btn secondary", href: "/admin" }, "返回后台"),
    ]),
    adminTable(
      "全部提交",
      ["时间", "学号", "参与者", "题号", "答案", "结果", "回传"],
      data.submissions.map((row) => [
        formatTime(row.submitted_at),
        row.student_id || "-",
        row.participant_id,
        displayQuestionId(row.question_id),
        row.answer,
        row.is_rate_limited ? "冷却拦截" : row.is_correct ? "正确" : "错误",
        row.message || "-",
      ])
    ),
  ]);
}

function renderAdminLogin(errorMessage = "") {
  return [
    sectionHead("工作人员后台", "请先进入后台", "请输入工作人员昵称和后台密码。"),
    el("form", { class: "admin-panel", onsubmit: onAdminLogin }, [
      el("h2", {}, "后台入口"),
      el("div", { class: "admin-actions" }, [
        el("input", { class: "admin-input", name: "nickname", placeholder: "工作人员昵称", autocomplete: "name" }),
        el("input", { class: "admin-input", name: "password", placeholder: "工作人员密码", type: "password", autocomplete: "current-password" }),
        el("button", { class: "btn", type: "submit" }, "进入后台"),
      ]),
      el("p", { class: `message ${errorMessage ? "error" : ""}`, id: "adminLoginMessage" }, errorMessage),
    ]),
  ];
}

async function onAdminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const output = $("#adminLoginMessage", form);
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        nickname: form.elements.nickname.value,
        password: form.elements.password.value,
      }),
    });
    localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
    localStorage.setItem(ADMIN_NICKNAME_KEY, result.nickname);
    adminRedeemNotice = null;
    renderAdmin();
  } catch (error) {
    output.className = "message error";
    output.textContent = error.message;
  }
}

async function logoutAdmin() {
  try {
    await api("/api/admin/logout", { method: "POST", admin: true, body: JSON.stringify({}) });
  } catch (_) {
    // Local logout should still work if the server is unreachable.
  }
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_NICKNAME_KEY);
  adminRedeemNotice = null;
  renderAdmin();
}

function metricPanel(label, value) {
  return el("div", { class: "admin-panel" }, [
    el("p", { class: "small" }, label),
    el("p", { class: "metric" }, value),
  ]);
}

function renderRedeemForm() {
  const notice = adminRedeemNotice;
  const message = el(
    "p",
    { class: `message ${notice ? (notice.ok ? "ok" : "error") : ""}`, id: "redeemMessage" },
    notice?.message || ""
  );
  const details = el("div", { id: "redeemDetails" }, notice?.award ? renderAwardDetails(notice.award, notice.redeem) : null);
  const form = el("form", { class: "admin-panel", onsubmit: onRedeem }, [
    el("h2", {}, "核销兑奖码"),
    el("div", { class: "admin-actions" }, [
      el("input", { class: "admin-input", name: "code", placeholder: "例如 SX-ABCD-EF12", autocomplete: "off" }),
      el("button", { class: "btn", type: "submit" }, "查询兑奖码"),
    ]),
    message,
    details,
  ]);
  return form;
}

async function onRedeem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const output = $("#redeemMessage", form);
  const details = $("#redeemDetails", form);
  const body = {
    code: form.elements.code.value,
  };
  try {
    const result = await api("/api/admin/redeem/preview", {
      method: "POST",
      admin: true,
      body: JSON.stringify(body),
    });
    adminRedeemNotice = {
      ok: result.ok,
      message: result.message,
      award: result.award,
      redeem: result.redeem,
      needsEligibilityCheck: result.needs_eligibility_check,
    };
    renderAdmin();
  } catch (error) {
    output.className = "message error";
    output.textContent = error.message;
    details.replaceChildren();
  }
}

function renderAwardDetails(award, redeem) {
  if (!award) return el("div");
  const done = !!(redeem && (redeem.redeemed || redeem.cyber_gift_sent));
  const needsEligibilityCheck = adminRedeemNotice?.needsEligibilityCheck && redeem && !done;
  const children = [
    award.student_id ? el("p", {}, `学号：${award.student_id}`) : null,
    award.phone ? el("p", {}, `手机号：${award.phone}`) : null,
    el("p", {}, `参与者：${award.participant_id}`),
    el("p", {}, `完成题目：${award.completed_count} 题（主线 ${award.main_completed}/6，旁枝 ${award.bonus_completed}/3，终章${award.final_complete ? "已完成" : "未完成"}）`),
    el("p", {}, `奖项等级：${award.award_level}`),
    award.lottery_draws_remaining ? el("p", { class: "message error" }, `还有 ${award.lottery_draws_remaining} 次抽奖机会未使用。`) : null,
  ];
  if (done) {
    children.push(el("p", { class: "redeem-alert lead" }, "已核销 · 礼物已发送"));
    if (redeem.redeemed) {
      children.push(el("p", { class: "redeem-alert" }, `实体礼物已核销：${formatTime(redeem.redeemed_at)}${redeem.redeemed_by ? `，${redeem.redeemed_by}` : ""}`));
    }
    if (redeem.cyber_gift_sent) {
      children.push(el("p", { class: "redeem-alert" }, `赛博礼物已发送：${formatTime(redeem.cyber_gift_at)}${redeem.cyber_gift_by ? `，${redeem.cyber_gift_by}` : ""}`));
    }
    children.push(el("div", { class: "cta-row eligibility-actions" }, [
      el("button", { class: "btn secondary", type: "button", onclick: () => onUnredeem(redeem.code) }, "撤销核销"),
    ]));
  } else if (needsEligibilityCheck) {
    children.push(el("p", { class: "redeem-confirm-q" }, "请确认该参与者是否为 26 届毕业生："));
    children.push(el("div", { class: "cta-row eligibility-actions" }, [
      el("button", { class: "btn", type: "button", onclick: () => onConfirmGraduateRedeem(redeem.code) }, "是 · 核销并发实体礼物"),
      el("button", { class: "btn secondary", type: "button", onclick: () => onSendCyberGift(redeem.code) }, "不是 · 核销并发赛博礼物"),
    ]));
  }
  return el("div", { class: "award-details" }, children.filter(Boolean));
}

async function onConfirmGraduateRedeem(code) {
  try {
    const result = await api("/api/admin/redeem", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ code, graduate_confirmed: true }),
    });
    adminRedeemNotice = {
      ok: result.ok,
      message: result.message,
      award: result.award,
      redeem: result.redeem,
    };
    renderAdmin();
  } catch (error) {
    adminRedeemNotice = { ok: false, message: error.message };
    renderAdmin();
  }
}

async function onSendCyberGift(code) {
  try {
    const result = await api("/api/admin/cyber-gift", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ code }),
    });
    adminRedeemNotice = {
      ok: result.ok,
      message: result.message,
      award: result.award,
      redeem: result.redeem,
    };
    renderAdmin();
  } catch (error) {
    adminRedeemNotice = { ok: false, message: error.message };
    renderAdmin();
  }
}

async function onUnredeem(code) {
  try {
    const result = await api("/api/admin/unredeem", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ code }),
    });
    adminRedeemNotice = {
      ok: result.ok,
      message: result.message,
      award: result.award,
      redeem: result.redeem,
    };
    renderAdmin();
  } catch (error) {
    adminRedeemNotice = { ok: false, message: error.message };
    renderAdmin();
  }
}

function adminTable(title, headers, rows, action = null) {
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, headers.map((header) => el("th", {}, header)))),
    el("tbody", {}, rows.length
      ? rows.map((row) => el("tr", {}, row.map((cell) => el("td", {}, cell))))
      : el("tr", {}, el("td", { colspan: headers.length, class: "empty" }, "暂无数据"))),
  ]);
  return el("section", { class: "question-section" }, [
    el("div", { class: "table-heading" }, [
      title ? el("h2", {}, title) : null,
      action,
    ]),
    el("div", { class: "table-wrap" }, table),
  ]);
}

function collapsibleAdminTable(title, summary, headers, rows) {
  const table = adminTable("", headers, rows);
  const summaryText = el("small", {}, summary);
  return el("details", {
    class: "admin-details",
    ontoggle: (event) => {
      summaryText.textContent = event.currentTarget.open ? "收起" : summary;
    },
  }, [
    el("summary", {}, [
      el("span", {}, title),
      summaryText,
    ]),
    table,
  ]);
}

function renderError(message) {
  return [
    sectionHead("页面错误", "暂时无法加载", "请刷新页面，或联系现场工作人员。"),
    el("div", { class: "notice" }, message),
  ];
}

function route() {
  const appEl = $("#app");
  if (appEl) appEl.dataset.stage = "";
  if (location.pathname === "/admin/submissions") return renderAdminSubmissions();
  if (location.pathname === "/admin") return renderAdmin();
  if (location.pathname === "/project/shexi-graduation") return renderProject();
  return renderHome();
}

document.addEventListener("keydown", (event) => {
  if (imageModal && imageGallery && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    showGalleryImage(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (event.key !== "Escape") return;
  if (imageModal) {
    closeImageModal(event);
  } else if (cyberGiftModal) {
    collectCyberGift();
  } else if (confirmModal) {
    confirmModal = null;
    renderProject();
  }
});

route();
