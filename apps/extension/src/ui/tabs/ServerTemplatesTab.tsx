// Server mode: templates managed in the admin panel (read-only here). Variables: {mijoz_nomi} {tizim} {xodim}.
import { useMemo, useState } from 'preact/hooks';
import { api } from '../../shared/messages';
import { insertWithToast, usePanel } from '../context';
import { useApi, useChatTicket } from '../server';
import { applyVars, searchTemplates, unresolvedVars } from '../../logic/templates';
import { SYSTEM_LABEL, type SrvTemplate } from '../../server/types';
import type { Template } from '../../shared/types';

/** Server template -> the shape the local search/variable helpers understand. */
export const toLocalTemplate = (t: SrvTemplate, lang: 'uz' | 'ru'): Template => ({
  id: t.id,
  category: t.category as Template['category'],
  title: t.title,
  body: lang === 'ru' && t.bodyRu ? t.bodyRu : t.bodyUz,
  keywords: t.keywords,
});

export function ServerTemplatesTab() {
  const { chat, bridge, server } = usePanel();
  const list = useApi<SrvTemplate[]>('templates');
  const byChat = useChatTicket(chat?.chatId ?? null);
  const group = byChat.data?.group ?? null;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const vars = {
    mijoz_nomi: group?.companyName ?? null,
    tizim: group ? SYSTEM_LABEL[group.systemType] : null,
    xodim: server.user?.displayName ?? null,
  };
  const lang = group?.language ?? 'uz';
  const templates = useMemo(() => (list.data ?? []).map((t) => toLocalTemplate(t, lang)), [list.data, lang]);
  const usage = useMemo(() => Object.fromEntries((list.data ?? []).map((t) => [t.id, t.usageCount])), [list.data]);
  const cats = useMemo(() => Array.from(new Set(templates.map((t) => t.category))), [templates]);
  const shown = useMemo(() => searchTemplates(templates, q, { category: cat, favourites: [], usage }), [templates, q, cat, usage]);

  const use = async (t: Template) => {
    if (await insertWithToast(bridge, applyVars(t.body, vars))) void api(`templates/${t.id}/use`, { method: 'POST', body: {} });
  };

  if (list.loading && !list.data) return <div class="tp-muted">Yuklanmoqda…</div>;
  if (list.error) return <div class="tp-warnbox">Server xatosi: {list.error.error}</div>;

  return (
    <div>
      <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Qidirish…" />
      <div class="tp-row" style={{ margin: '6px 0' }}>
        <button class={`tp-chip ${!cat ? 'st-IN_PROGRESS' : ''}`} onClick={() => setCat(null)}>barchasi</button>
        {cats.map((c) => (
          <button class={`tp-chip ${cat === c ? 'st-IN_PROGRESS' : ''}`} onClick={() => setCat(cat === c ? null : c)}>{c}</button>
        ))}
      </div>
      {shown.map((t) => {
        const body = applyVars(t.body, vars);
        const missing = unresolvedVars(body);
        return (
          <div class="tp-tpl" onClick={() => use(t)} title="Bosish = composerga qo'yish">
            <div class="tp-row between">
              <span class="t">{t.title}</span>
              <span class="tp-small tp-muted">{usage[t.id] ? `×${usage[t.id]}` : ''}</span>
            </div>
            <div class="b">{body}</div>
            {missing.length > 0 && <div class="tp-small tp-muted">To'ldirilmagan: {missing.map((v) => `{${v}}`).join(', ')}</div>}
          </div>
        );
      })}
      {!shown.length && <div class="tp-muted">Topilmadi</div>}
      <div class="tp-small tp-muted" style={{ marginTop: '6px' }}>Shablonlar admin panelda tahrirlanadi.</div>
    </div>
  );
}
