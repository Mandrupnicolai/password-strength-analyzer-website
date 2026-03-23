const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const commonPasswords = new Set(
  [
    "password",
    "123456",
    "123456789",
    "12345678",
    "12345",
    "qwerty",
    "qwerty123",
    "abc123",
    "111111",
    "000000",
    "iloveyou",
    "letmein",
    "admin",
    "welcome",
    "monkey",
    "dragon",
    "football",
    "baseball",
    "login",
    "princess",
    "sunshine",
    "shadow",
    "ashley",
    "trustno1",
    "passw0rd",
    "p@ssw0rd",
  ].map((s) => s.toLowerCase()),
);

const commonBases = [
  "password",
  "letmein",
  "welcome",
  "admin",
  "qwerty",
  "iloveyou",
  "princess",
  "football",
  "baseball",
  "dragon",
  "monkey",
  "sunshine",
  "shadow",
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hasLower(s) {
  return /[a-z]/.test(s);
}
function hasUpper(s) {
  return /[A-Z]/.test(s);
}
function hasDigit(s) {
  return /\d/.test(s);
}
function hasSymbol(s) {
  return /[^A-Za-z0-9]/.test(s);
}

function estimateCharsetSize(pw) {
  let size = 0;
  if (hasLower(pw)) size += 26;
  if (hasUpper(pw)) size += 26;
  if (hasDigit(pw)) size += 10;
  if (hasSymbol(pw)) size += 33; // conservative-ish: common printable symbols
  return Math.max(size, 1);
}

function log2(x) {
  return Math.log(x) / Math.log(2);
}

function normalizeLeetspeak(s) {
  // Very small normalization pass for obvious substitutions.
  // Keep it conservative to avoid false positives.
  return s
    .toLowerCase()
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t")
    .replaceAll("@", "a")
    .replaceAll("$", "s")
    .replaceAll("!", "i");
}

function uniqueRatio(s) {
  if (s.length === 0) return 0;
  return new Set([...s]).size / s.length;
}

function countRuns(s) {
  // Count ascending/descending runs of 3+ in letters or digits (e.g. abc, cba, 123, 321).
  const lower = s.toLowerCase();
  let runs = 0;
  let runLen = 1;
  let dir = 0; // -1, 0, +1

  const isAlphaNum = (ch) => /[a-z0-9]/.test(ch);
  const code = (ch) => ch.charCodeAt(0);

  for (let i = 1; i < lower.length; i++) {
    const prev = lower[i - 1];
    const cur = lower[i];
    if (!isAlphaNum(prev) || !isAlphaNum(cur)) {
      runLen = 1;
      dir = 0;
      continue;
    }

    const d = code(cur) - code(prev);
    const step = d === 1 ? 1 : d === -1 ? -1 : 0;

    if (step !== 0 && (dir === 0 || step === dir)) {
      dir = step;
      runLen += 1;
      if (runLen === 3) runs += 1;
      if (runLen > 3 && runLen % 2 === 1) runs += 1; // longer sequences get more penalty
    } else {
      runLen = 1;
      dir = 0;
    }
  }

  return runs;
}

function repeatedChunkPenalty(s) {
  // Penalize obvious repetition like "abcabcabc" or "!!!!!!" or "aaaaaa".
  if (s.length < 6) return 0;
  let penalty = 0;

  // Same-char streaks
  const streaks = s.match(/(.)\1{3,}/g);
  if (streaks) penalty += streaks.reduce((acc, m) => acc + Math.min(12, m.length * 2), 0);

  // Repeated multi-char chunk: check small chunk sizes
  for (const k of [2, 3, 4]) {
    if (s.length < k * 3) continue;
    const chunk = s.slice(0, k);
    if (chunk.repeat(Math.floor(s.length / k)) === s.slice(0, k * Math.floor(s.length / k))) {
      penalty += 10;
      break;
    }
  }

  return clamp(penalty, 0, 25);
}

function entropyBits(pw) {
  if (!pw) return 0;
  const size = estimateCharsetSize(pw);
  let bits = pw.length * log2(size);

  // Reduce for low uniqueness and for obvious patterns
  const u = uniqueRatio(pw);
  if (u < 0.55) bits *= 0.82;
  if (u < 0.40) bits *= 0.72;

  const runs = countRuns(pw);
  if (runs > 0) bits *= 1 - clamp(runs * 0.06, 0, 0.24);

  const repPenalty = repeatedChunkPenalty(pw);
  if (repPenalty > 0) bits *= 1 - repPenalty / 160;

  // Normalize a bit: extremely short passwords are often overestimated by charset math
  if (pw.length <= 6) bits *= 0.62;
  if (pw.length === 7) bits *= 0.72;

  return Math.max(0, bits);
}

function scoreFromEntropy(bits) {
  // Map bits to 0..100 with a smooth-ish curve.
  // ~28 bits => ~25, ~40 => ~50, ~60 => ~80, ~80 => ~95
  const s = 100 * (1 - Math.exp(-bits / 28));
  return clamp(Math.round(s), 0, 100);
}

function verdictFromScore(score) {
  if (score >= 85) return { label: "Very strong", tone: "good" };
  if (score >= 70) return { label: "Strong", tone: "good" };
  if (score >= 50) return { label: "Okay", tone: "warn" };
  if (score >= 30) return { label: "Weak", tone: "warn" };
  return { label: "Very weak", tone: "bad" };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const units = [
    ["year", 365 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];

  const parts = [];
  let remaining = seconds;
  for (const [name, size] of units) {
    if (remaining >= size && parts.length < 2) {
      const value = Math.floor(remaining / size);
      remaining -= value * size;
      parts.push(`${value} ${name}${value === 1 ? "" : "s"}`);
    }
  }
  if (parts.length === 0) return "< 1 second";
  return parts.join(" ");
}

function crackTimeEstimates(bits) {
  // Expected guesses to crack on average is half the search space.
  const guesses = Math.pow(2, Math.max(0, bits - 1));
  const estimates = [
    { id: "tOnlineSlow", rate: 100 }, // guesses/s (rate-limited online)
    { id: "tOnlineFast", rate: 10_000 }, // guesses/s (unthrottled online)
    { id: "tOfflineFast", rate: 10_000_000_000 }, // guesses/s (fast offline)
  ];
  for (const e of estimates) {
    const seconds = guesses / e.rate;
    $(e.id).textContent = formatDuration(seconds);
  }
}

function analyze(pw) {
  const feedback = [];
  const lower = pw.toLowerCase();
  const normalized = normalizeLeetspeak(pw);

  const isCommon = commonPasswords.has(lower) || commonPasswords.has(normalized);
  const hasCommonBase = commonBases.some((b) => normalized.includes(b));

  if (!pw) {
    return {
      score: 0,
      entropy: 0,
      classes: 0,
      feedback: ["Type a password to see analysis."],
      flags: { isCommon: false, hasCommonBase: false },
    };
  }

  const classes =
    (hasLower(pw) ? 1 : 0) + (hasUpper(pw) ? 1 : 0) + (hasDigit(pw) ? 1 : 0) + (hasSymbol(pw) ? 1 : 0);

  if (pw.length < 12) feedback.push("Add length: aim for 12+ characters (16+ is better).");
  if (!hasLower(pw) || !hasUpper(pw))
    feedback.push("Mix upper- and lowercase letters (if allowed).");
  if (!hasDigit(pw)) feedback.push("Add digits (but avoid predictable placements like a trailing “1”).");
  if (!hasSymbol(pw)) feedback.push("Add a symbol (avoid common ones only at the end).");

  const runs = countRuns(pw);
  if (runs > 0) feedback.push("Avoid sequences like “abc”, “cba”, “123”, or “321”.");

  const u = uniqueRatio(pw);
  if (u < 0.55) feedback.push("Avoid lots of repeated characters or chunks.");

  if (hasCommonBase) feedback.push("Avoid common base words (even with substitutions like “p@ssw0rd”).");
  if (isCommon) feedback.push("This is a very common password—avoid it entirely.");

  if (/^\w+$/.test(pw) && pw.length < 14)
    feedback.push("Consider adding spaces or punctuation, or use a longer passphrase.");

  let bits = entropyBits(pw);
  let score = scoreFromEntropy(bits);

  // Hard caps for known-bad patterns
  if (isCommon) {
    score = Math.min(score, 8);
    bits = Math.min(bits, 10);
  } else if (hasCommonBase && pw.length < 16) {
    score = Math.min(score, 35);
  }

  // Ensure at least one positive note when it's strong
  if (score >= 70) {
    feedback.unshift("Good: length and character variety look solid.");
  }

  return { score, entropy: bits, classes, feedback, flags: { isCommon, hasCommonBase } };
}

function setTone(el, tone) {
  el.style.color =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "";
}

function render(pw) {
  const result = analyze(pw);
  $("length").textContent = `Length: ${pw.length}`;

  const classLabels = [];
  if (hasLower(pw)) classLabels.push("a-z");
  if (hasUpper(pw)) classLabels.push("A-Z");
  if (hasDigit(pw)) classLabels.push("0-9");
  if (hasSymbol(pw)) classLabels.push("symbol");
  $("classes").textContent = `Classes: ${classLabels.length ? classLabels.join(" + ") : "—"}`;

  $("entropy").textContent = pw ? `Entropy: ${result.entropy.toFixed(1)} bits` : "Entropy: —";

  $("meter").style.width = `${result.score}%`;
  $("score").textContent = `Score: ${result.score} / 100`;

  const verdict = verdictFromScore(result.score);
  $("verdict").textContent = verdict.label;
  setTone($("verdict"), verdict.tone);

  // feedback list
  const ul = $("feedback");
  ul.innerHTML = "";
  for (const item of result.feedback.slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
  if (result.feedback.length > 8) {
    const li = document.createElement("li");
    li.textContent = `…and ${result.feedback.length - 8} more suggestions.`;
    ul.appendChild(li);
  }

  crackTimeEstimates(result.entropy);
  $("copy").disabled = pw.length === 0;
}

const pwInput = $("pw");
const toggleBtn = $("toggle");
const copyBtn = $("copy");

pwInput.addEventListener("input", () => render(pwInput.value));
pwInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pwInput.value = "";
    render("");
  }
});

function setReveal(isRevealed) {
  pwInput.type = isRevealed ? "text" : "password";
  toggleBtn.textContent = isRevealed ? "Showing" : "Show";
  toggleBtn.setAttribute("aria-pressed", String(isRevealed));
}

// "Press to show": hidden by default, only revealed while the button is held down.
toggleBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  setReveal(true);
});
toggleBtn.addEventListener("pointerup", () => setReveal(false));
toggleBtn.addEventListener("pointercancel", () => setReveal(false));
toggleBtn.addEventListener("pointerleave", () => setReveal(false));
toggleBtn.addEventListener("blur", () => setReveal(false));
toggleBtn.addEventListener("click", (e) => e.preventDefault());
toggleBtn.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    setReveal(true);
  }
});
toggleBtn.addEventListener("keyup", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    setReveal(false);
  }
});

copyBtn.addEventListener("click", async () => {
  const pw = pwInput.value;
  if (!pw) return;

  try {
    await navigator.clipboard.writeText(pw);
    const prev = copyBtn.textContent;
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = prev), 900);
  } catch {
    // Fallback
    pwInput.select();
    document.execCommand("copy");
  }
});

render("");
setReveal(false);
