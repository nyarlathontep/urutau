const form = document.getElementById('auth-form');
const errorEl = document.getElementById('auth-error');
const submitBtn = document.getElementById('submit-btn');
const tabs = document.querySelectorAll('.tab');
const passwordInput = form.querySelector('input[name="password"]');
let mode = 'login';
let coolingDown = false;

function setMode(next) {
  mode = next;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  submitBtn.textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  errorEl.hidden = true;
}

tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.tab)));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (coolingDown) return;

  errorEl.hidden = true;
  submitBtn.disabled = true;

  const data = Object.fromEntries(new FormData(form));
  const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      window.location.href = '/';
      return;
    }
    if (res.status === 429) {
      startCooldown(json.retryAfter ?? 60, json.error);
      return;
    }
    errorEl.textContent = json.error || 'Não foi possível continuar.';
    errorEl.hidden = false;
    submitBtn.disabled = false;
  } catch {
    errorEl.textContent = 'Falha de conexão com o servidor.';
    errorEl.hidden = false;
    submitBtn.disabled = false;
  }
});

function startCooldown(seconds, message) {
  coolingDown = true;
  errorEl.textContent = message || 'Muitas tentativas. Aguarde um pouco.';
  errorEl.hidden = false;

  let remaining = Math.max(1, Math.ceil(seconds));
  const label = mode === 'login' ? 'Entrar' : 'Criar conta';

  submitBtn.disabled = true;
  const tick = () => {
    if (remaining <= 0) {
      coolingDown = false;
      submitBtn.disabled = false;
      submitBtn.textContent = label;
      return;
    }
    submitBtn.textContent = `Aguarde ${remaining}s`;
    remaining -= 1;
    setTimeout(tick, 1000);
  };
  tick();
}

// Se já estiver logado, pula para o fórum
fetch('/api/auth/me').then(r => { if (r.ok) window.location.href = '/'; }).catch(() => {});
// correcao
