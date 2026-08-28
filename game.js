"use strict";

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
  document.getElementById("board-title").textContent = `STAGE ${stage.stageNumber}: ${stage.name}`;
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

// --- quiz phase ---

let quizState = null;

function startQuizPhase(stage) {
  const questions = generateQuestions(stage, stage.questionCount);
  quizState = { stage, questions, index: 0 };
  if (DEV_MODE) window.__quizState = quizState;
  showScreen("king");
  document.getElementById("king-line").textContent = "王「さて、勇者よ。答えてもらおうか。」";
  renderQuestion();
}

function renderQuestion() {
  const { questions, index } = quizState;
  const q = questions[index];
  document.getElementById("question-progress").textContent = `第${index + 1}問 / 全${questions.length}問`;
  document.getElementById("question-text").textContent = q.text;

  const choicesEl = document.getElementById("choices");
  choicesEl.innerHTML = "";
  for (const choice of q.choices) {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.addEventListener("click", () => handleAnswer(btn, choice, q));
    choicesEl.appendChild(btn);
  }
}

function handleAnswer(clickedBtn, choice, question) {
  const buttons = document.querySelectorAll(".choice-btn");
  buttons.forEach((b) => (b.disabled = true));

  const isCorrect = choice === question.correctLabel;
  buttons.forEach((b) => {
    if (b.textContent === question.correctLabel) b.classList.add("correct");
    else if (b === clickedBtn) b.classList.add("wrong");
  });

  const lines = isCorrect ? DB.kingLines.correct : DB.kingLines.incorrect;
  const line = pickRandom(lines);
  document.getElementById("king-line").textContent = `王「${line}」`;

  setTimeout(() => {
    if (!isCorrect) {
      endGame(line);
      return;
    }
    quizState.index += 1;
    if (quizState.index >= quizState.questions.length) {
      clearStage(line);
    } else {
      renderQuestion();
    }
  }, 1400);
}

function clearStage(line) {
  const hasNextStage = stageIndex + 1 < DB.stageOrder.length;
  document.getElementById("clear-line").textContent = `王「${line}」`;
  document.getElementById("clear-heading").textContent = hasNextStage
    ? `STAGE ${currentStage.stageNumber} クリア!`
    : "全ステージ制覇!";
  const btn = document.getElementById("btn-clear-continue");
  btn.textContent = hasNextStage ? "次のステージへ" : "タイトルへ戻る";
  showScreen("clear");
}

function endGame(line) {
  document.getElementById("over-line").textContent = `王「${line}」`;
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
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="color:#d9605c;padding:24px;">読み込みエラー: ${err.message}</p>`;
});
