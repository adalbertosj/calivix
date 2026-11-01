// Conversa com o servidor do Calivix. No navegador o servidor é a própria origem; nos apps nativos o
// endereço fica guardado no aparelho (o mesmo app serve para mais de um servidor, se for o caso).
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };

export const sessao = {
  get servidor() { return window.CalivixNativo ? (LS('calivix.servidor') || '') : location.origin; },
  set servidor(v) { LS('calivix.servidor', v ? v.replace(/\/+$/, '') : null); },
  get token() { return LS('calivix.token'); },
  set token(v) { LS('calivix.token', v); },
  get aparelho() { return LS('calivix.aparelho'); },
  set aparelho(v) { LS('calivix.aparelho', v); },
};

export async function api(metodo, caminho, corpo, { bruto = false, semToken = false } = {}) {
  const h = {};
  if (corpo !== undefined && corpo !== null) h['content-type'] = 'application/json';
  if (!semToken && sessao.token) h.authorization = 'Bearer ' + sessao.token;
  let r;
  try {
    r = await fetch(sessao.servidor + caminho, { method: metodo, headers: h, body: corpo == null ? undefined : JSON.stringify(corpo) });
  } catch {
    throw Object.assign(new Error('Sem conexão com o servidor do Calivix. Confira se este aparelho está na sua Tailnet.'), { offline: true });
  }
  if (bruto) { if (!r.ok) throw new Error('Erro ' + r.status); return r; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || 'Erro ' + r.status), { status: r.status });
  return j;
}

export function eventos(aoEvento) {
  let es, parado = false;
  const abrir = () => {
    if (parado) return;
    es = new EventSource(`${sessao.servidor}/api/eventos?token=${encodeURIComponent(sessao.token || '')}`);
    es.onmessage = (m) => { try { aoEvento(JSON.parse(m.data)); } catch { /* pulso */ } };
    es.onerror = () => { es.close(); setTimeout(abrir, 4000); };
  };
  abrir();
  return () => { parado = true; es && es.close(); };
}
