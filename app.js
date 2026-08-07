import { config } from "./config.js";
import { rankRepo } from "./utils/rank.js";

const input = document.getElementById("search");
const results = document.getElementById("results");
const recencyFilter = document.getElementById("recencyFilter");
const matchMode = document.getElementById("matchMode");
const freeMode = document.getElementById("freeMode");
const includeArchived = document.getElementById("includeArchived");
const tokenInput = document.getElementById("tokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const tokenStatus = document.getElementById("tokenStatus");
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpBtn = document.getElementById("closeHelpBtn");
const helpContent = document.getElementById("helpContent");
const pageTitle = document.getElementById("pageTitle");
const focusLabel = document.getElementById("focusLabel");
const modeLabel = document.getElementById("modeLabel");
const freeModeLabel = document.getElementById("freeModeLabel");
const includeArchivedLabel = document.getElementById("includeArchivedLabel");
const tokenLabel = document.getElementById("tokenLabel");
const helperText = document.getElementById("helperText");
const helpTitle = document.getElementById("helpTitle");

let controller = null;
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_VISIBLE_RESULTS = 12;

input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  await runSearch();
});

input.addEventListener("input", debounce(() => {
  if (input.value.trim().length >= 2) {
    runSearch();
  }
}, 300));

[recencyFilter, matchMode, freeMode, includeArchived].forEach((el) => {
  if (!el) return;
  el.addEventListener("change", () => {
    if (input.value.trim()) {
      runSearch();
    }
  });
});

if (helpBtn && helpModal && closeHelpBtn) {
  helpBtn.addEventListener("click", () => {
    helpModal.classList.remove("hidden");
    helpModal.setAttribute("aria-hidden", "false");
  });

  closeHelpBtn.addEventListener("click", () => {
    helpModal.classList.add("hidden");
    helpModal.setAttribute("aria-hidden", "true");
  });

  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      helpModal.classList.add("hidden");
      helpModal.setAttribute("aria-hidden", "true");
    }
  });
}

detectLanguage();

if (tokenInput && saveTokenBtn) {
  tokenInput.value = localStorage.getItem("fineSearch.githubToken") || "";

  saveTokenBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    localStorage.setItem("fineSearch.githubToken", token);
    tokenStatus.textContent = token
      ? "Token salvo localmente no navegador."
      : "Token removido. As buscas continuarão sem autenticação.";
  });

  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTokenBtn.click();
    }
  });
}

async function runSearch() {
  const raw = input.value.trim();
  if (!raw) {
    results.innerHTML = "<p class='empty'>Digite ao menos uma palavra-chave.</p>";
    return;
  }

  const keywords = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const query = buildQuery(keywords, matchMode.value, recencyFilter.value, freeMode.checked);
  const cacheKey = `${query}|${recencyFilter.value}|${matchMode.value}|${freeMode.checked ? "free" : "off"}|${includeArchived.checked ? "all" : "public"}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.timestamp + CACHE_TTL_MS > Date.now()) {
    render(cached.results);
    return;
  }

  if (controller) controller.abort();
  controller = new AbortController();

  results.innerHTML = "<p class='empty'>carregando...</p>";

  try {
    const url = new URL(config.api);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", config.perPage.toString());
    url.searchParams.set("order", "desc");

    if (recencyFilter.value === "updated") {
      url.searchParams.set("sort", "updated");
    }

    if (!includeArchived.checked) {
      url.searchParams.set("archived", "false");
    }

    const headers = {
      Accept: "application/vnd.github+json",
    };

    const token = localStorage.getItem("fineSearch.githubToken") || "";
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (!res.ok) throw new Error(`GitHub error ${res.status}`);

    const data = await res.json();
    const normalizedItems = (data.items || []).slice(0, MAX_VISIBLE_RESULTS).map(normalizeRepo);

    const ranked = normalizedItems
      .map((repo) => ({
        repo,
        score: rankRepo(repo, keywords, {
          recency: recencyFilter.value,
          matchMode: matchMode.value,
          freeMode: freeMode.checked,
          includeArchived: includeArchived.checked,
        }),
      }))
      .sort((a, b) => b.score - a.score);

    cache.set(cacheKey, {
      timestamp: Date.now(),
      results: ranked,
    });

    render(ranked);
  } catch (err) {
    if (err.name === "AbortError") return;
    results.innerHTML = "<p class='empty'>Não foi possível carregar os resultados. Tente novamente.</p>";
  }
}

function buildQuery(keywords, mode, recency, freeModeEnabled) {
  if (!keywords.length) return "";

  const fieldQuery = keywords
    .map((word) => `${word} in:name,description,readme`)
    .join(mode === "strict" ? " " : " OR ");
  const topicQuery = keywords.map((word) => `topic:${word}`).join(" OR ");

  if (freeModeEnabled) {
    const joined = keywords.join(" ");
    if (recency === "recent") return `${joined} created:>=${monthsAgo(3)}`;
    if (recency === "updated") return `${joined} pushed:>=${monthsAgo(1)}`;
    return joined;
  }

  if (mode === "strict") {
    const stricter = keywords
      .map((word) => `(${word} in:name,description,readme OR topic:${word})`)
      .join(" ");
    if (recency === "recent") return `${stricter} created:>=${monthsAgo(3)}`;
    if (recency === "updated") return `${stricter} pushed:>=${monthsAgo(1)}`;
    return stricter;
  }

  const fullQuery = topicQuery ? `${fieldQuery} OR ${topicQuery}` : fieldQuery;
  if (recency === "recent") return `${fullQuery} created:>=${monthsAgo(3)}`;
  if (recency === "updated") return `${fullQuery} pushed:>=${monthsAgo(1)}`;
  return fullQuery;
}

function normalizeRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description,
    stargazers_count: repo.stargazers_count || 0,
    forks_count: repo.forks_count || 0,
    created_at: repo.created_at,
    pushed_at: repo.pushed_at,
    archived: !!repo.archived,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
  };
}

function monthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

function detectLanguage() {
  const browserLang = navigator.language || "en";
  const lang = browserLang.toLowerCase().startsWith("pt") ? "pt" : browserLang.toLowerCase().startsWith("es") ? "es" : "en";
  applyLanguage(lang);
}

function applyLanguage(lang) {
  const translations = {
    en: {
      title: "GH Search",
      focus: "Focus",
      mode: "Mode",
      freeMode: "Free search without extra filters",
      includeArchived: "Include archived",
      token: "GitHub token",
      helper: "Press Enter to search. Smart mode is more flexible and the recent filter highlights new or recently updated projects.",
      tokenStatus: "The token is stored locally in the browser and only used for searches.",
      helpTitle: "How it works",
      helpContent: `<ul><li><strong>Focus:</strong> choose whether you want recent, updated, or any repositories.</li><li><strong>Mode:</strong> smart mode is more flexible, while strict mode uses tighter matching.</li><li><strong>Free search:</strong> removes extra filters and tries to match terms more openly.</li><li><strong>Include archived:</strong> shows or hides archived repositories.</li><li><strong>Token:</strong> optional, improves GitHub request authentication.</li></ul>`,
      buttonSave: "Save token",
      buttonHelp: "How it works",
      buttonClose: "Close",
    },
    pt: {
      title: "GH Search",
      focus: "Foco",
      mode: "Modo",
      freeMode: "Busca livre sem filtros extras",
      includeArchived: "Incluir arquivados",
      token: "Token GitHub",
      helper: "Pressione Enter para buscar. O modo inteligente é mais flexível e o filtro recente destaca projetos novos ou atualizados.",
      tokenStatus: "O token é salvo localmente no navegador e usado apenas para as buscas.",
      helpTitle: "Como funciona",
      helpContent: `<ul><li><strong>Foco:</strong> escolhe se você quer ver resultados mais recentes, atualizados ou qualquer um.</li><li><strong>Modo:</strong> o modo inteligente é mais flexível, enquanto o modo rígido usa correspondência mais estrita.</li><li><strong>Busca livre:</strong> remove filtros extras e tenta encontrar termos com menos restrição.</li><li><strong>Incluir arquivados:</strong> mostra ou esconde repositórios arquivados.</li><li><strong>Token:</strong> opcional, melhora a autenticação nas buscas no GitHub.</li></ul>`,
      buttonSave: "Salvar token",
      buttonHelp: "Como funciona",
      buttonClose: "Fechar",
    },
    es: {
      title: "GH Search",
      focus: "Enfoque",
      mode: "Modo",
      freeMode: "Búsqueda libre sin filtros extra",
      includeArchived: "Incluir archivados",
      token: "Token de GitHub",
      helper: "Presiona Enter para buscar. El modo inteligente es más flexible y el filtro reciente destaca proyectos nuevos o actualizados recientemente.",
      tokenStatus: "El token se guarda localmente en el navegador y solo se usa para las búsquedas.",
      helpTitle: "Cómo funciona",
      helpContent: `<ul><li><strong>Enfoque:</strong> elige si quieres ver repositorios más recientes, actualizados o cualquiera.</li><li><strong>Modo:</strong> el modo inteligente es más flexible, mientras que el modo estricto usa coincidencias más estrictas.</li><li><strong>Búsqueda libre:</strong> elimina filtros extra y trata de encontrar términos con menos restricción.</li><li><strong>Incluir archivados:</strong> muestra u oculta repositorios archivados.</li><li><strong>Token:</strong> opcional, mejora la autenticación de las búsquedas en GitHub.</li></ul>`,
      buttonSave: "Guardar token",
      buttonHelp: "Cómo funciona",
      buttonClose: "Cerrar",
    },
  };

  const t = translations[lang] || translations.en;
  if (pageTitle) pageTitle.textContent = t.title;
  if (focusLabel) focusLabel.textContent = t.focus;
  if (modeLabel) modeLabel.textContent = t.mode;
  if (freeModeLabel) freeModeLabel.textContent = t.freeMode;
  if (includeArchivedLabel) includeArchivedLabel.textContent = t.includeArchived;
  if (tokenLabel) tokenLabel.textContent = t.token;
  if (helperText) helperText.textContent = t.helper;
  if (tokenStatus) tokenStatus.textContent = t.tokenStatus;
  if (helpTitle) helpTitle.textContent = t.helpTitle;
  if (helpContent) helpContent.innerHTML = t.helpContent;
  if (saveTokenBtn) saveTokenBtn.textContent = t.buttonSave;
  if (helpBtn) helpBtn.textContent = t.buttonHelp;
  if (closeHelpBtn) closeHelpBtn.textContent = t.buttonClose;
}

function render(list) {
  results.innerHTML = "";

  if (!list.length) {
    results.innerHTML = "<p class='empty'>Nenhum resultado encontrado. Tente outra combinação.</p>";
    return;
  }

  const visible = list.slice(0, MAX_VISIBLE_RESULTS);
  let index = 0;

  function appendNext() {
    if (index >= visible.length) return;

    const { repo, score } = visible[index];
    const el = document.createElement("article");
    el.className = "repo";

    const createdAt = repo.created_at ? new Date(repo.created_at) : null;
    const updatedAt = repo.pushed_at ? new Date(repo.pushed_at) : null;
    const isFresh = createdAt && Date.now() - createdAt.getTime() < 1000 * 60 * 60 * 24 * 180;
    const hasRecentUpdate = updatedAt && Date.now() - updatedAt.getTime() < 1000 * 60 * 60 * 24 * 90;

    const badges = [];
    if (isFresh) badges.push('<span class="pill fresh">novo</span>');
    if (hasRecentUpdate) badges.push('<span class="pill updated">atualizado</span>');

    el.innerHTML = `
      <div class="repo-head">
        <a href="${repo.html_url}" target="_blank">${repo.full_name}</a>
        <div class="badges">${badges.join("")}</div>
      </div>
      <p>${repo.description || "Sem descrição disponível."}</p>
      <p class="meta">★ ${repo.stargazers_count} · forks ${repo.forks_count} · score ${score.toFixed(2)}</p>
      <p class="meta">Criado em ${createdAt ? createdAt.toLocaleDateString("pt-BR") : "—"} · Atualizado ${updatedAt ? updatedAt.toLocaleDateString("pt-BR") : "—"}</p>
    `;

    results.appendChild(el);
    index += 1;

    if (index < visible.length) {
      requestAnimationFrame(appendNext);
    }
  }

  requestAnimationFrame(appendNext);
}
