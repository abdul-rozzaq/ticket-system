// F5: searchable templates with categories, favourites, usage counter, variables, preview.
import { useMemo, useState } from 'preact/hooks';
import { insertWithToast, resolveCurrent, templateVars, usePanel } from '../context';
import { applyVars, searchTemplates, unresolvedVars } from '../../logic/templates';
import { updateMock } from '../../shared/storage';
import type { Template } from '../../shared/types';

const CATS = ['salomlashuv', 'AmoCRM', 'Bitrix', 'PBX', 'yopish'];

export async function bumpUsage(id: string) {
  await updateMock((m) => ({ ...m, usage: { ...m.usage, [id]: (m.usage[id] ?? 0) + 1 } }));
}

export function TemplatesTab() {
  const { app, chat, bridge } = usePanel();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const { client } = resolveCurrent(app, chat);
  const vars = templateVars(app, client);

  const list = useMemo(() => {
    let l = searchTemplates(app.mock.templates, q, { category: cat, favourites: app.mock.favourites, usage: app.mock.usage });
    if (favOnly) l = l.filter((t) => app.mock.favourites.includes(t.id));
    return l;
  }, [q, cat, favOnly, app.mock]);

  const use = async (t: Template) => {
    if (await insertWithToast(bridge, applyVars(t.body, vars))) bumpUsage(t.id);
  };
  const toggleFav = (id: string) =>
    updateMock((m) => ({ ...m, favourites: m.favourites.includes(id) ? m.favourites.filter((x) => x !== id) : [...m.favourites, id] }));

  return (
    <div>
      <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Qidirish… (yoki composerda ; yozing)" />
      <div class="tp-row" style={{ margin: '6px 0' }}>
        <button class={`tp-chip ${!cat && !favOnly ? 'st-IN_PROGRESS' : ''}`} onClick={() => { setCat(null); setFavOnly(false); }}>barchasi</button>
        <button class={`tp-chip ${favOnly ? 'st-IN_PROGRESS' : ''}`} onClick={() => setFavOnly(!favOnly)}>★ sevimli</button>
        {CATS.map((c) => (
          <button class={`tp-chip ${cat === c ? 'st-IN_PROGRESS' : ''}`} onClick={() => setCat(cat === c ? null : c)}>{c}</button>
        ))}
      </div>
      {preview && (
        <div class="tp-card tp-section">
          <div class="tp-row between"><b>{preview.title}</b><button class="tp-iconbtn" onClick={() => setPreview(null)}>×</button></div>
          <div class="tp-pre">{applyVars(preview.body, vars)}</div>
          {unresolvedVars(applyVars(preview.body, vars)).length > 0 && (
            <div class="tp-small tp-warnbox" style={{ marginTop: '4px' }}>
              To'ldirilmagan: {unresolvedVars(applyVars(preview.body, vars)).map((v) => `{${v}}`).join(', ')} — chatni mijozga bog'lang.
            </div>
          )}
          <div class="tp-row" style={{ marginTop: '6px' }}>
            <button class="tp-btn small primary" onClick={() => use(preview)}>Qo'yish</button>
            <button class="tp-btn small" onClick={() => insertWithToast(bridge, applyVars(preview.body, vars), true).then((ok) => { if (ok) bumpUsage(preview.id); })}>
              Almashtirish
            </button>
          </div>
        </div>
      )}
      <div>
        {list.map((t) => (
          <div class="tp-tpl" onClick={() => use(t)} title="Bosish = composerga qo'yish">
            <div class="tp-row between">
              <span class="t">{t.title}</span>
              <span class="tp-row" style={{ gap: '2px' }}>
                <span class="tp-small tp-muted">{app.mock.usage[t.id] ? `×${app.mock.usage[t.id]}` : ''}</span>
                <button class="tp-iconbtn tp-small" onClick={(e) => { e.stopPropagation(); setPreview(t); }}>ko'rish</button>
                <button class={`tp-star ${app.mock.favourites.includes(t.id) ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFav(t.id); }}>★</button>
              </span>
            </div>
            <div class="b">{applyVars(t.body, vars)}</div>
          </div>
        ))}
        {!list.length && <div class="tp-muted">Topilmadi</div>}
      </div>
    </div>
  );
}
