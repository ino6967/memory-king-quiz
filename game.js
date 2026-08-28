"use strict";

const OMINOUS_CHANCE = 0.15;

const DEV_MODE = new URLSearchParams(location.search).get("dev") === "1";

const screens = {
  title: document.getElementById("screen-title"),
  board: document.getElementById("screen-board"),
  king: document.getElementById("screen-king"),
  clear: document.getElementById("screen-clear"),
  over: document.getElementById("screen-over"),
};

function showScreen(name) {
  for (const s of Object.values(screens)) s.classList.remove("active");
  screens[name].classList.add("active");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleN(arr, n) {
  return shuffle(arr).slice(0, n);
}

let DB = null;
let currentStage = null;
let peopleById = null;
let timerHandle = null;
let stageIndex = 0;

async function loadDB() {
  const res = await fetch("world-db.json");
  if (!res.ok) throw new Error("world-db.json の読み込みに失敗した");
  return res.json();
}

function resolveStage(stageId) {
  const def = DB.stages[stageId];
  const people = def.peopleIds.map((id) => DB.people[id]);
  return { ...def, people };
}

function relLine(label, person) {
  if (!person) return "";
  return `<div class="rel"><span>${label}:</span> ${person.name}</div>`;
}

function renderBoard(stage) {
  document.getElementById("stage-tag").textContent = `STAGE ${stage.stageNumber}`;
  document.getElementById("board-title").textContent = stage.name;
  const container = document.getElementById("board-people");
  container.innerHTML = "";
  for (const p of stage.people) {
    const card = document.createElement("div");
    card.className = "person-card";
    const father = p.fatherId ? peopleById[p.fatherId] : null;
    const mother = p.motherId ? peopleById[p.motherId] : null;
    const spouse = p.spouseId ? peopleById[p.spouseId] : null;
    const children = (p.childIds || []).map((id) => peopleById[id]);
    card.innerHTML = `
      <div class="name">${p.name}</div>
      <div class="title">${p.title}</div>
      ${relLine("父", father)}
      ${relLine("母", mother)}
      ${relLine("配偶者", spouse)}
      ${children.length ? `<div class="rel"><span>子:</span> ${children.map((c) => c.name).join("・")}</div>` : ""}
    `;
    container.appendChild(card);
  }
}

function startMemoryPhase(stage) {
  renderBoard(stage);
  paintBoardScene();
  showScreen("board");
  const total = DEV_MODE ? 5 : stage.memorizeSeconds;
  let remaining = total;
  const fill = document.getElementById("timer-fill");
  const text = document.getElementById("timer-text");
  fill.style.width = "100%";
  text.textContent = String(remaining);

  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    remaining -= 1;
    fill.style.width = `${Math.max(0, (remaining / total) * 100)}%`;
    text.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(timerHandle);
      startQuizPhase(stage);
    }
  }, 1000);
}

// --- question templates ---

function collectCandidates(stage) {
  const candidates = [];
  for (const p of stage.people) {
    if (p.fatherId && peopleById[p.fatherId]) candidates.push({ type: "father", person: p });
    if (p.motherId && peopleById[p.motherId]) candidates.push({ type: "mother", person: p });
    if (p.spouseId && peopleById[p.spouseId]) candidates.push({ type: "spouse", person: p });
    if (p.childIds && p.childIds.length > 0) candidates.push({ type: "firstchild", person: p });
    candidates.push({ type: "title", person: p });
    candidates.push({ type: "byTitle", person: p });
  }
  return candidates;
}

function buildQuestion(candidate, stage) {
  const p = candidate.person;
  const others = stage.people.filter((x) => x.id !== p.id);

  switch (candidate.type) {
    case "father": {
      const correct = peopleById[p.fatherId];
      const pool = others.filter((x) => x.id !== correct.id).map((x) => x.name);
      return makePersonQuestion(`${p.name}の父上は誰じゃ?`, correct.name, pool);
    }
    case "mother": {
      const correct = peopleById[p.motherId];
      const pool = others.filter((x) => x.id !== correct.id).map((x) => x.name);
      return makePersonQuestion(`${p.name}の母上は誰じゃ?`, correct.name, pool);
    }
    case "spouse": {
      const correct = peopleById[p.spouseId];
      const pool = others.filter((x) => x.id !== correct.id).map((x) => x.name);
      return makePersonQuestion(`${p.name}の配偶者は誰じゃ?`, correct.name, pool);
    }
    case "firstchild": {
      const correct = peopleById[p.childIds[0]];
      const pool = others.filter((x) => x.id !== correct.id).map((x) => x.name);
      return makePersonQuestion(`${p.name}の第一子は誰じゃ?`, correct.name, pool);
    }
    case "title": {
      const pool = [...new Set(others.map((x) => x.title))].filter((t) => t !== p.title);
      return makePersonQuestion(`${p.name}の身分は何じゃ?`, p.title, pool);
    }
    case "byTitle": {
      const pool = others.map((x) => x.name);
      return makePersonQuestion(`${p.title}は誰じゃ?`, p.name, pool);
    }
    default:
      throw new Error(`unknown template: ${candidate.type}`);
  }
}

function makePersonQuestion(text, correctLabel, distractorPool) {
  const distractors = sampleN(distractorPool, Math.min(3, distractorPool.length));
  const choices = shuffle([correctLabel, ...distractors]);
  return { text, choices, correctLabel };
}

function generateQuestions(stage, count) {
  const candidates = collectCandidates(stage);
  const chosen = sampleN(candidates, Math.min(count, candidates.length));
  return chosen.map((c) => buildQuestion(c, stage));
}

// --- pixel-art scene rendering ---

const PX = {
  wall: "#1a1224",
  wallShade: "#241a33",
  pillar: "#241a33",
  gold: "#c9a24b",
  robe: "#5b3b8c",
  cushion: "#8c2f3a",
  carpetA: "#8c2f3a",
  carpetB: "#a9832f",
  floor: "#120c1a",
  floorA: "#1c1526",
  floorB: "#241a33",
  skin: "#e8b98a",
  ink: "#0a0710",
  angry: "rgba(226,72,63,.55)",
  glass: ["#5f86c9", "#4f9e72", "#8a5fc9", "#c14a52", "#c9a24b"],
  wood: "#6b4a2d",
  woodDark: "#4a3320",
  parchment: "#ece3d3",
};

function drawKingSprite(ctx, cx, topY, mood, scale) {
  scale = scale || 1;
  const s = (v) => v * scale;
  ctx.fillStyle = PX.robe;
  ctx.beginPath();
  ctx.moveTo(cx - s(16), topY + s(40));
  ctx.lineTo(cx - s(9), topY + s(14));
  ctx.lineTo(cx + s(9), topY + s(14));
  ctx.lineTo(cx + s(16), topY + s(40));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PX.gold;
  ctx.fillRect(cx - s(9), topY + s(13), s(18), s(3));

  ctx.fillStyle = PX.skin;
  ctx.fillRect(cx - s(7), topY, s(14), s(14));

  ctx.fillStyle = PX.gold;
  ctx.fillRect(cx - s(8), topY - s(6), s(16), s(6));
  ctx.fillRect(cx - s(8), topY - s(10), s(3), s(4));
  ctx.fillRect(cx - s(2), topY - s(12), s(4), s(6));
  ctx.fillRect(cx + s(5), topY - s(10), s(3), s(4));
  ctx.fillStyle = "#c14a52";
  ctx.fillRect(cx - s(1), topY - s(11), s(2), s(2));

  ctx.fillStyle = PX.ink;
  if (mood === "angry") {
    ctx.fillRect(cx - s(6), topY + s(3), s(4), s(2));
    ctx.fillRect(cx - s(5), topY + s(2), s(3), s(2));
    ctx.fillRect(cx + s(2), topY + s(2), s(3), s(2));
    ctx.fillRect(cx + s(3), topY + s(3), s(4), s(2));
    ctx.fillRect(cx - s(5), topY + s(6), s(2), s(2));
    ctx.fillRect(cx + s(3), topY + s(6), s(2), s(2));
    ctx.fillRect(cx - s(4), topY + s(11), s(8), s(2));
    ctx.fillStyle = PX.angry;
    ctx.fillRect(cx - s(7), topY + s(8), s(4), s(3));
    ctx.fillRect(cx + s(3), topY + s(8), s(4), s(3));
  } else if (mood === "happy") {
    ctx.fillRect(cx - s(5), topY + s(5), s(2), s(2));
    ctx.fillRect(cx + s(3), topY + s(5), s(2), s(2));
    ctx.fillRect(cx - s(4), topY + s(10), s(8), s(2));
    ctx.fillRect(cx - s(5), topY + s(9), s(2), s(2));
    ctx.fillRect(cx + s(3), topY + s(9), s(2), s(2));
  } else {
    ctx.fillRect(cx - s(5), topY + s(5), s(2), s(2));
    ctx.fillRect(cx + s(3), topY + s(5), s(2), s(2));
    ctx.fillRect(cx - s(3), topY + s(10), s(6), s(2));
  }
}

function drawThroneScene(ctx, w, h, mood) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PX.wall;
  ctx.fillRect(0, 0, w, h);

  const archCx = w / 2, archW = 46, archTopY = 6, archBottomY = 58;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(archCx - archW / 2, archBottomY);
  ctx.lineTo(archCx - archW / 2, archTopY + 14);
  ctx.quadraticCurveTo(archCx - archW / 2, archTopY, archCx, archTopY);
  ctx.quadraticCurveTo(archCx + archW / 2, archTopY, archCx + archW / 2, archTopY + 14);
  ctx.lineTo(archCx + archW / 2, archBottomY);
  ctx.closePath();
  ctx.clip();
  let ci = 0;
  for (let gy = archTopY; gy < archBottomY; gy += 8) {
    for (let gx = archCx - archW / 2; gx < archCx + archW / 2; gx += 8) {
      ctx.fillStyle = PX.glass[ci % PX.glass.length];
      ctx.fillRect(gx, gy, 8, 8);
      ci++;
    }
  }
  ctx.restore();

  ctx.fillStyle = PX.pillar;
  ctx.fillRect(6, 0, 14, h);
  ctx.fillRect(w - 20, 0, 14, h);
  ctx.fillStyle = PX.gold;
  ctx.fillRect(6, 0, 3, h);
  ctx.fillRect(w - 20 + 11, 0, 3, h);

  const floorY = h - 34;
  ctx.fillStyle = PX.floor;
  ctx.fillRect(0, floorY, w, 34);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w / 2 - 14, floorY + 2);
  ctx.lineTo(w / 2 + 14, floorY + 2);
  ctx.lineTo(w / 2 + 38, h);
  ctx.lineTo(w / 2 - 38, h);
  ctx.closePath();
  ctx.clip();
  for (let ty = floorY; ty < h; ty += 6) {
    ctx.fillStyle = Math.floor(ty / 6) % 2 === 0 ? PX.carpetA : PX.carpetB;
    ctx.fillRect(0, ty, w, 4);
  }
  ctx.restore();

  const tx = w / 2, ty0 = floorY - 42;
  ctx.fillStyle = PX.gold;
  ctx.fillRect(tx - 22, ty0, 44, 42);
  ctx.fillStyle = PX.wall;
  ctx.fillRect(tx - 18, ty0 + 4, 36, 34);
  ctx.fillStyle = PX.cushion;
  ctx.fillRect(tx - 14, ty0 + 24, 28, 14);
  ctx.fillStyle = PX.gold;
  ctx.fillRect(tx - 25, ty0 + 36, 6, 12);
  ctx.fillRect(tx + 19, ty0 + 36, 6, 12);

  drawKingSprite(ctx, tx, ty0 + 8, mood, 1);
}

function drawLibraryScene(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PX.wallShade;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(201,162,75,.10)";
  ctx.beginPath();
  ctx.ellipse(w / 2, 18, 42, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  function shelf(x0) {
    ctx.fillStyle = PX.wall;
    ctx.fillRect(x0, 6, 32, h - 42);
    let ci = 0;
    for (let sy = 10; sy < h - 42; sy += 10) {
      for (let sx = x0 + 2; sx < x0 + 30; sx += 4) {
        ctx.fillStyle = PX.glass[ci % PX.glass.length];
        ctx.fillRect(sx, sy, 3, 8);
        ci++;
      }
    }
  }
  shelf(2);
  shelf(w - 34);

  const cx = w / 2;
  ctx.fillStyle = PX.wood;
  ctx.fillRect(cx - 14, h - 40, 28, 30);
  ctx.fillStyle = PX.woodDark;
  ctx.fillRect(cx - 14, h - 42, 28, 6);
  ctx.fillStyle = PX.parchment;
  ctx.fillRect(cx - 17, h - 54, 34, 12);
  ctx.fillStyle = PX.gold;
  ctx.fillRect(cx - 19, h - 54, 4, 12);
  ctx.fillRect(cx + 15, h - 54, 4, 12);

  ctx.fillStyle = PX.floor;
  ctx.fillRect(0, h - 10, w, 10);
  for (let fx = 0; fx < w; fx += 10) {
    ctx.fillStyle = Math.floor(fx / 10) % 2 === 0 ? PX.floorA : PX.floorB;
    ctx.fillRect(fx, h - 10, 10, 10);
  }
}

function drawBustScene(canvasId, mood) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PX.wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(201,162,75,.12)";
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2 - 4, w * 0.42, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  drawKingSprite(ctx, w / 2, h * 0.32, mood, 1.6);
}

function paintKingScene(mood) {
  const canvas = document.getElementById("king-scene");
  if (!canvas) return;
  drawThroneScene(canvas.getContext("2d"), canvas.width, canvas.height, mood);
}

function paintBoardScene() {
  const canvas = document.getElementById("board-scene");
  if (!canvas) return;
  drawLibraryScene(canvas.getContext("2d"), canvas.width, canvas.height);
}

function reactScene(mood) {
  paintKingScene(mood);
  const frame = document.getElementById("king-scene-frame");
  const flash = document.getElementById("king-flash");
  frame.classList.remove("shake");
  flash.classList.remove("play", "flash-good", "flash-bad");
  void frame.offsetWidth;
  if (mood === "angry") frame.classList.add("shake");
  flash.classList.add(mood === "angry" ? "flash-bad" : "flash-good", "play");
}

// --- quiz phase ---

let quizState = null;

function renderDots() {
  const { questions, index } = quizState;
  const dots = document.getElementById("dots");
  dots.innerHTML = "";
  questions.forEach((_, i) => {
    const d = document.createElement("span");
    d.className = "dot" + (i < index ? " filled" : "") + (i === index ? " current" : "");
    dots.appendChild(d);
  });
}

function startQuizPhase(stage) {
  const questions = generateQuestions(stage, stage.questionCount);
  quizState = { stage, questions, index: 0 };
  if (DEV_MODE) window.__getQuiz = () => quizState;
  showScreen("king");
  paintKingScene("neutral");
  document.getElementById("king-line").textContent = "王「さて、勇者よ。答えてもらおうか。」";
  renderQuestion();
}

function renderQuestion() {
  const { questions, index } = quizState;
  const q = questions[index];
  renderDots();
  document.getElementById("question-text").textContent = q.text;

  const choicesEl = document.getElementById("choices");
  choicesEl.innerHTML = "";
  for (const choice of q.choices) {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.dataset.choice = choice;
    btn.innerHTML = `<span class="cursor">▶</span><span>${choice}</span>`;
    btn.addEventListener("click", () => handleAnswer(btn, choice, q));
    choicesEl.appendChild(btn);
  }
}

function handleAnswer(clickedBtn, choice, question) {
  const buttons = document.querySelectorAll(".choice-btn");
  buttons.forEach((b) => (b.disabled = true));

  const isCorrect = choice === question.correctLabel;
  buttons.forEach((b) => {
    if (b.dataset.choice === question.correctLabel) b.classList.add("correct");
    else if (b === clickedBtn) b.classList.add("wrong");
  });

  let line;
  if (isCorrect) {
    line = Math.random() < OMINOUS_CHANCE ? pickRandom(DB.kingLines.ominous) : pickRandom(DB.kingLines.correct);
  } else {
    line = pickRandom(DB.kingLines.incorrect);
  }
  document.getElementById("king-line").textContent = `王「${line}」`;
  reactScene(isCorrect ? "happy" : "angry");

  setTimeout(() => {
    if (!isCorrect) {
      endGame(line);
      return;
    }
    quizState.index += 1;
    if (quizState.index >= quizState.questions.length) {
      renderDots();
      clearStage(line);
    } else {
      renderQuestion();
      paintKingScene("neutral");
    }
  }, 1400);
}

function clearStage(line) {
  const hasNextStage = stageIndex + 1 < DB.stageOrder.length;
  document.getElementById("clear-line").textContent = `王「${line}」`;
  document.getElementById("clear-mark").textContent = hasNextStage ? "STAGE CLEAR" : "VICTORY";
  document.getElementById("clear-heading").textContent = hasNextStage
    ? `STAGE ${currentStage.stageNumber} 、記憶、証明さる`
    : "全ステージ制覇!";
  const btn = document.getElementById("btn-clear-continue");
  btn.textContent = hasNextStage ? "次のステージへ" : "タイトルへ戻る";
  drawBustScene("clear-scene", "happy");
  showScreen("clear");
}

function endGame(line) {
  document.getElementById("over-line").textContent = `王「${line}」`;
  drawBustScene("over-scene", "angry");
  showScreen("over");
}

function playStage(id) {
  currentStage = resolveStage(id);
  peopleById = Object.fromEntries(currentStage.people.map((p) => [p.id, p]));
  startMemoryPhase(currentStage);
}

function onClearContinue() {
  stageIndex += 1;
  if (stageIndex < DB.stageOrder.length) {
    playStage(DB.stageOrder[stageIndex]);
  } else {
    showScreen("title");
  }
}

// --- boot ---

async function init() {
  DB = await loadDB();

  document.getElementById("btn-start").addEventListener("click", () => {
    stageIndex = 0;
    playStage(DB.stageOrder[stageIndex]);
  });
  document.getElementById("btn-retry").addEventListener("click", () => showScreen("title"));
  document.getElementById("btn-clear-continue").addEventListener("click", onClearContinue);

  drawBustScene("title-scene", "neutral");
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="color:#d9605c;padding:24px;">読み込みエラー: ${err.message}</p>`;
});
