const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmtDate = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const state = { user: null, filter: 'all', topics: [] };

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

// ----------------------------------------------------------
// Boot
// ----------------------------------------------------------
(async function boot() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
  } catch (err) {
    if (err.status === 401) { window.location.href = '/login.html'; return; }
    throw err;
  }
  $('#current-user').textContent = '@' + state.user.username;
  await refresh();
})();

async function refresh() {
  state.topics = await api('/api/topics');
  renderTopics();
}

// ----------------------------------------------------------
// Renderização
// ----------------------------------------------------------
function renderTopics() {
  const container = $('#topics');
  const list = state.topics.filter((t) => {
    if (state.filter === 'public') return t.visibility === 'public';
    if (state.filter === 'mine') return t.author === state.user.username;
    return true;
  });

  // ✅ Toggle da CLASSE, que é o que o CSS realmente controla
  $('#empty').classList.toggle('hidden', list.length > 0);
  container.innerHTML = list.map(topicCard).join('');
}

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

// ----------------------------------------------------------
// Ações
// ----------------------------------------------------------
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
      method: 'POST',
      body: JSON.stringify({ body })
    });
    await refresh();
  } catch (err) { alert(err.message); }
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.filter = chip.dataset.filter;
    renderTopics();
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
