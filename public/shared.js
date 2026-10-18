/* Shared client: API access, host token handling, SSE, DOM helpers. */
(function () {
  const TOKEN_KEY = 'auctionHostToken';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setToken(value) {
    try { sessionStorage.setItem(TOKEN_KEY, value); } catch { /* private mode */ }
  }

  async function request(path, { method = 'GET', body, host = false } = {}) {
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (host) {
      const token = getToken();
      if (token) headers['x-host-token'] = token;
    }
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      const err = new Error('Cannot reach the auction server');
      err.code = 'network';
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error && data.message) || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      err.details = data && data.error && data.error.details;
      if (res.status === 401) window.dispatchEvent(new CustomEvent('host-auth-required'));
      throw err;
    }
    return data;
  }

  function messageOf(err) {
    if (err && Array.isArray(err.details) && err.details.length) return err.details.join(' ');
    return err && err.message ? err.message : 'Something went wrong';
  }

  function connect(onSnapshot) {
    const es = new EventSource('/api/events');
    es.addEventListener('snapshot', ev => {
      try { onSnapshot(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
    });
    es.onerror = () => { /* EventSource reconnects automatically */ };
    return es;
  }

  // ---------- DOM helpers ----------
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // trusted constant strings only
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function money(n) {
    const value = Number(n) || 0;
    return '₹' + value.toLocaleString('en-IN');
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text;
    node.className = 'status-badge ' + (kind || '');
  }

  // ---------- host token modal ----------
  let modalOpen = false;

  function showHostModal() {
    if (modalOpen || document.getElementById('host-auth-modal')) return;
    modalOpen = true;
    const input = el('input', { type: 'password', id: 'host-token-input', placeholder: 'Host token', autocomplete: 'off' });
    const error = el('p', { class: 'modal-error', id: 'host-token-error' });
    const save = el('button', { type: 'button', class: 'btn btn-primary', text: 'Unlock host controls' });
    const cancel = el('button', { type: 'button', class: 'btn', text: 'Continue read-only' });
    const box = el('div', { class: 'modal-box', role: 'dialog', 'aria-label': 'Host authentication' }, [
      el('h2', { text: 'Host access required' }),
      el('p', { class: 'modal-text', text: 'Enter the host token to manage teams, players and the auction. Participants do not need a token.' }),
      input, error,
      el('div', { class: 'modal-actions' }, [save, cancel]),
    ]);
    const overlay = el('div', { id: 'host-auth-modal', class: 'popup' }, [box]);
    document.body.appendChild(overlay);
    input.focus();

    const submit = () => {
      const value = input.value.trim();
      if (!value) { error.textContent = 'Token cannot be empty'; return; }
      setToken(value);
      overlay.remove();
      modalOpen = false;
      window.location.reload();
    };
    save.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    cancel.addEventListener('click', () => { overlay.remove(); modalOpen = false; });
  }

  window.addEventListener('host-auth-required', showHostModal);

  window.Auction = {
    getToken, setToken, request, connect, el, money, clear, setStatus, messageOf,
    get: path => request(path),
    post: (path, body) => request(path, { method: 'POST', body, host: true }),
    patch: (path, body) => request(path, { method: 'PATCH', body, host: true }),
    del: path => request(path, { method: 'DELETE', host: true }),
    requireHostToken: () => { if (!getToken()) showHostModal(); },
    isHost: () => Boolean(getToken()),
  };
})();
