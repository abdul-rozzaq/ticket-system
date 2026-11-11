// F9 AI reply draft + F13 mask preview.
import { useState } from 'preact/hooks';
import { insertWithToast, resolveCurrent, templateVars, usePanel } from '../context';
import { toast, useBus, useIntentReplay } from '../hooks';
import { maskSensitive, type MaskResult } from '../../logic/mask';
import { buildLlmUserPrompt, LLM_SYSTEM_PROMPT, mockDraft, NOT_FOUND_MARKER, searchKb, type KbMatch } from '../../logic/ai';
import type { LlmResponse } from '../../shared/messages';
import { send } from '../../shared/messages';

type Stage = 'idle' | 'review' | 'running' | 'done';

export function AiTab() {
  const { app, chat, bridge } = usePanel();
  const flags = app.settings.flags;
  const [source, setSource] = useState('');
  const [sourceMsgId, setSourceMsgId] = useState<string | null>(null);
  const [mask, setMask] = useState<MaskResult | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [draft, setDraft] = useState('');
  const [sources, setSources] = useState<KbMatch[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [llmInfo, setLlmInfo] = useState<string>('');
  const { client } = resolveCurrent(app, chat);
  const vars = templateVars(app, client);

  useBus((e) => {
    if (e.type === 'ai') {
      setSource(e.text);
      setSourceMsgId(e.messageId);
      prepare(e.text);
    }
  });

  useIntentReplay('ai', 'ai-tab', (e) => {
    if (e.type !== 'ai') return;
    setSource(e.text);
    setSourceMsgId(e.messageId);
    prepare(e.text);
  });

  const loadLast = async () => {
    if (!flags.F7) return toast("F7 (xabarlarni o'qish) o'chirilgan — matnni qo'lda kiriting", 'warn');
    const msgs = await bridge.readMessages(30);
    const incoming = msgs.filter((m) => !m.outgoing).slice(-3);
    if (!incoming.length) return toast("Kiruvchi xabar topilmadi", 'warn');
    const text = incoming.map((m) => m.text).join('\n');
    setSource(text);
    setSourceMsgId(incoming[incoming.length - 1].id);
    prepare(text);
  };

  const prepare = (text: string) => {
    const m = flags.F13 ? maskSensitive(text) : { text, hits: [] };
    setMask(m);
    setDraft('');
    setSources([]);
    setNotFound(false);
    if (app.settings.approveMaskBeforeAi && m.hits.length) setStage('review');
    else run(m);
  };

  const run = async (m: MaskResult) => {
    setStage('running');
    setNotFound(false);
    try {
      if (flags.F9_LLM) {
        const found = searchKb(app.mock.kb, m.text, 4);
        setSources(found);
        if (!found.length) {
          // Nothing relevant in the KB: do not even ask the model.
          setLlmInfo('LLM chaqirilmadi: bazada mos maqola yo\'q');
          setNotFound(true);
          setStage('done');
          return;
        }
        const res = await send<LlmResponse>({
          type: 'TP_LLM',
          system: LLM_SYSTEM_PROMPT,
          user: buildLlmUserPrompt(m.text, found.map((f) => f.article), vars.mijoz_nomi ?? null),
        });
        if (!res?.ok) {
          toast(`LLM xatosi: ${res?.error}`, 'err');
          setStage('idle');
          return;
        }
        setLlmInfo(`${res.model} · ${res.ms} ms · in ${res.inputTokens ?? '?'} / out ${res.outputTokens ?? '?'} token`);
        if (!found.length || res.text.includes(NOT_FOUND_MARKER)) {
          setNotFound(true);
          setStage('done');
          return;
        }
        setDraft(res.text);
      } else {
        const r = mockDraft(m.text, app.mock.kb, vars);
        setSources(r.sources);
        setLlmInfo('mock rejim (LLM o\'chirilgan)');
        if (!r.found) {
          setNotFound(true);
          setStage('done');
          return;
        }
        setDraft(r.draft);
      }
      setStage('done');
    } catch (e) {
      toast(String(e), 'err');
      setStage('idle');
    }
  };

  return (
    <div>
      <div class="tp-section">
        <h4>Mijoz xabari</h4>
        <textarea value={source} onInput={(e) => setSource((e.target as HTMLTextAreaElement).value)} placeholder="Mijoz xabari (yoki pastdagi tugma bilan oxirgi xabarlarni oling)" />
        <div class="tp-row" style={{ marginTop: '4px' }}>
          <button class="tp-btn small" onClick={loadLast}>Oxirgi xabarlarni olish</button>
          <button class="tp-btn small primary" disabled={!source.trim() || stage === 'running'} onClick={() => prepare(source)}>
            {stage === 'running' ? '…' : 'AI javob'}
          </button>
          <span class="tp-small tp-muted">{flags.F9_LLM ? `LLM: ${app.settings.llm.model}` : 'mock rejim'}</span>
        </div>
      </div>

      {mask && flags.F13 && (
        <div class="tp-section">
          <h4>AI ko'radigan matn ({mask.hits.length} ta yashirildi)</h4>
          <div class="tp-pre tp-small" dangerouslySetInnerHTML={{ __html: highlightMasks(mask.text) }} />
          {stage === 'review' && (
            <div class="tp-row" style={{ marginTop: '6px' }}>
              <button class="tp-btn small primary" onClick={() => run(mask)}>Tasdiqlash va davom etish</button>
              <button class="tp-btn small" onClick={() => setStage('idle')}>Bekor</button>
            </div>
          )}
        </div>
      )}

      {stage === 'done' && notFound && (
        <div class="tp-warnbox tp-section">Bazada topilmadi. Javob o'ylab topilmaydi — shablon yoki qo'lda javob bering.</div>
      )}

      {stage === 'done' && draft && (
        <div class="tp-section">
          <h4>Qoralama</h4>
          <textarea value={draft} rows={5} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} />
          <div class="tp-row" style={{ marginTop: '4px' }}>
            <button class="tp-btn small primary" onClick={() => insertWithToast(bridge, draft)}>Composerga qo'yish</button>
            {sourceMsgId && (
              <button
                class="tp-btn small"
                title="Tajribaviy: Telegram menyusidagi Reply ni bosadi"
                onClick={async () => {
                  const ok = await bridge.replyToMessage(sourceMsgId);
                  if (!ok) toast("Reply rejimini yoqib bo'lmadi — oddiy qo'yiladi", 'warn');
                  await insertWithToast(bridge, draft);
                }}
              >
                Javob (reply) sifatida
              </button>
            )}
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div class="tp-section">
          <h4>Manbalar</h4>
          <div class="tp-row">
            {sources.map((s) => (
              <span class="tp-chip" title={`${s.article.problem}\n\n${s.article.solution}\nball: ${s.score} (${s.matched.join(', ')})`}>
                {s.article.id} · {s.article.problem.slice(0, 32)}… · {s.score}
              </span>
            ))}
          </div>
        </div>
      )}
      {llmInfo && <div class="tp-small tp-muted">{llmInfo}</div>}
    </div>
  );
}

function highlightMasks(text: string): string {
  const esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return esc.replace(/\[(PAROL|TOKEN|API_KEY|KARTA|TELEFON|HEX|BASE64|LOGIN|URL_PAROL)\]/g, '<mark class="tp-mask">[$1]</mark>');
}
