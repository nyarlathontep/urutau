const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmtDate = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ← NOVO: constantes de preferências
const THEME_KEY = 'devforum_theme';
const FONT_KEY  = 'devforum_fontscale';
const DEFAULT_THEME = 'dark';
const DEFAULT_FONT  = 0.75;

const state = { user: null, filter: 'all', topics: [] };

// ← NOVO: aplica tema em <html data-theme="light"> e persiste
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem(THEME_KEY, theme);
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = theme;
}

// ← NOVO: aplica escala via CSS var --zoom (afeta body inteiro)
function applyFontScale(scale) {
  scale = Math.max(0.6, Math.min(1.2, Number(scale) || DEFAULT_FONT));
  document.documentElement.style.setProperty('--zoom', scale);
  localStorage.setItem(FONT_KEY, scale);
  const range = document.getElementById('font-size-range');
  const out = document.getElementById('font-size-value');
  if (range) range.value = scale;
  if (out) out.textContent = Math.round(scale * 100) + '%';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || 'Erro inesperado');
    err.status = res.status;
    throw err;
  }
  return json;
}

// ==========================================================
// Boot
// ==========================================================
(async function boot() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
  } catch (err) {
    if (err.status === 401) { window.location.href = '/login.html'; return; }
    throw err;
  }
  $('#current-user').textContent = '@' + state.user.username;

  // ← NOVO: garante preferências aplicadas mesmo se o inline script falhou
  applyTheme(localStorage.getItem(THEME_KEY) || DEFAULT_THEME);
  applyFontScale(parseFloat(localStorage.getItem(FONT_KEY)) || DEFAULT_FONT);

  // ← NOVO: monta a sidebar antes de carregar tópicos (hamburger já funciona)
  setupSidebar();

  await refresh();
})();

async function refresh() {
  state.topics = await api('/api/topics');
  renderTopics();
  updateProfileStats(); // ← NOVO
}

// ==========================================================
// Renderização
// ==========================================================
function renderTopics() {
  const container = $('#topics');
  const list = state.topics.filter((t) => {
    if (state.filter === 'public') return t.visibility === 'public';
    if (state.filter === 'mine') return t.author === state.user.username;
    return true;
  });

  $('#empty').classList.toggle('hidden', list.length > 0); // ← corrigido do bug anterior
  container.innerHTML = list.map(topicCard).join('');
}

// topicCard() permanece exatamente igual
function topicCard(t) {
  const pinned = t.pinned ? '<span class="badge pinned">Fixado</span>' : '';
  const priv = t.visibility === 'private' ? '<span class="badge private">Privado</span>' : '';

  const repliesHtml = t.replies.length
    ? `<ul>${t.replies.map((r) => `
        <li class="reply">
          <div class="reply-head"><strong>@${esc(r.author)}</strong> <time>${fmtDate(r.createdAt)}</time></div>
          <p>${esc(r.body)}</p>
        </li>`).join('')}
      </ul>`
    : '<p class="meta" style="margin-top:8px">Sem respostas ainda.</p>';

  return `
  <article class="topic card" data-id="${t.id}">
    <div class="votes">
      <button class="vote up ${t.myVote === 1 ? 'active' : ''}" data-vote="1" title="Votar a favor">▲</button>
      <span class="score">${t.score}</span>
      <button class="vote down ${t.myVote === -1 ? 'active' : ''}" data-vote="-1" title="Votar contra">▼</button>
    </div>
    <div class="topic-main">
      <header class="topic-head">
        ${pinned}${priv}
        <h3>${esc(t.title)}</h3>
      </header>
      <p class="body">${esc(t.body)}</p>
      <footer class="meta">
        <span>por @${esc(t.author)}</span>
        <span>${fmtDate(t.createdAt)}</span>
        <span>${t.replies.length} resposta(s)</span>
      </footer>
      <details class="replies">
        <summary>Respostas (${t.replies.length})</summary>
        ${repliesHtml}
        <form class="reply-form">
          <input name="body" placeholder="Escreva uma resposta..." maxlength="1000" required>
          <button type="submit" class="primary small">Responder</button>
        </form>
      </details>
    </div>
  </article>`;
}

// ==========================================================
// ← NOVO: Sidebar + Preferências
// ==========================================================
function setupSidebar() {
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('sidebar-overlay');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const closeBtn  = document.getElementById('sidebar-close');
  if (!sidebar || !overlay || !toggleBtn) return;

  function openSidebar() {
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sidebar.classList.add('open');
    });
    sidebar.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!overlay.classList.contains('open')) overlay.hidden = true;
    }, 250);
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  closeBtn?.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });

  // Troca de views
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      document.querySelectorAll('.sidebar-item')
        .forEach((i) => i.classList.toggle('active', i === item));
      document.querySelectorAll('.sidebar-view')
        .forEach((v) => { v.hidden = v.id !== 'view-' + view; });
    });
  });

  // Controles de configuração
  const themeSel  = document.getElementById('theme-select');
  const fontRange = document.getElementById('font-size-range');
  const fontOut   = document.getElementById('font-size-value');
  const resetBtn  = document.getElementById('reset-settings');

  // Sincroniza controles com valores salvos
  if (themeSel) themeSel.value = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
  const curFont = parseFloat(localStorage.getItem(FONT_KEY)) || DEFAULT_FONT;
  if (fontRange) fontRange.value = curFont;
  if (fontOut)   fontOut.textContent = Math.round(curFont * 100) + '%';

  themeSel?.addEventListener('change', (e) => applyTheme(e.target.value));
  fontRange?.addEventListener('input', (e) => applyFontScale(e.target.value));
  resetBtn?.addEventListener('click', () => {
    applyTheme(DEFAULT_THEME);
    applyFontScale(DEFAULT_FONT);
  });
}

// ← NOVO: estatísticas no perfil
function updateProfileStats() {
  if (!state.user) return;
  const avatar = document.getElementById('profile-avatar');
  const uname  = document.getElementById('profile-username');
  const stats  = document.getElementById('profile-stats');
  if (avatar) avatar.textContent = state.user.username.charAt(0).toUpperCase();
  if (uname)  uname.textContent  = '@' + state.user.username;
  if (stats) {
    const myTopics = state.topics.filter((t) => t.author === state.user.username).length;
    const myReplies = state.topics.reduce(
      (acc, t) => acc + t.replies.filter((r) => r.author === state.user.username).length, 0
    );
    stats.textContent = `${myTopics} tópico(s) · ${myReplies} resposta(s)`;
  }
}

// ==========================================================
// Ações (votos, respostas, filtros, novo tópico, logout)
// — permanecem exatamente iguais às do arquivo original
// ==========================================================
$('#topics').addEventListener('click', async (e) => {
  const voteBtn = e.target.closest('[data-vote]');
  if (!voteBtn) return;
  const card = voteBtn.closest('.topic');
  const topic = state.topics.find((t) => t.id === card.dataset.id);
  if (!topic) return;
  const value = Number(voteBtn.dataset.vote);
  const next = topic.myVote === value ? 0 : value;
  try {
    await api(`/api/topics/${topic.id}/vote`, { method: 'POST', body: JSON.stringify({ value: next }) });
    await refresh();
  } catch (err) { alert(err.message); }
});

$('#topics').addEventListener('submit', async (e) => {
  if (!e.target.matches('.reply-form')) return;
  e.preventDefault();
  const card = e.target.closest('.topic');
  const body = new FormData(e.target).get('body');
  try {
    await api(`/api/topics/${card.dataset.id}/reply`, {
      method: 'POST', body: JSON.stringify({ body })
    });
    await refresh();
  } catch (err) { alert(err.message); }
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.filter = chip.dataset.filter;
    renderTopics();
    updateProfileStats();
  });
});

$('#new-topic-btn').addEventListener('click', () => $('#topic-form').classList.toggle('hidden'));
$('#cancel-topic').addEventListener('click', () => $('#topic-form').classList.add('hidden'));

$('#topic-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = $('#topic-error');
  errEl.hidden = true;
  try {
    await api('/api/topics', {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        body: fd.get('body'),
        visibility: fd.get('visibility')
      })
    });
    e.target.reset();
    $('#topic-form').classList.add('hidden');
    await refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login.html';
});
