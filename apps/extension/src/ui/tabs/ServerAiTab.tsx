// Server mode: AI reply draft. The server builds the context from the stored conversation, masks secrets, searches the
// knowledge base and asks the configured provider; this tab only shows the result and puts it into the composer.
// Nothing is sent to the customer automatically.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../../shared/messages';
import { insertWithToast, usePanel } from '../context';
import { toast, useBus, useIntentReplay } from '../hooks';
import type { SrvDraft } from '../../server/types';
import { bareMessageId } from '../../server/util';

type Stage = 'idle' | 'running' | 'done';

function highlightMasks(text: string): string {
  const esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return esc.replace(/\[([A-Z_]{3,16})\]/g, '<mark class="tp-mask">[$1]</mark>');
}

export function ServerAiTab() {
  const { chat, bridge } = usePanel();
  const chatId = chat?.chatId ?? null;
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<SrvDraft | null>(null);
  const [text, setText] = useState('');
  const [sourceMsgId, setSourceMsgId] = useState<string | null>(null);

  const show = (d: SrvDraft) => {
    setResult(d);
    setText(d.draft ?? '');
    setStage('done');
  };

  const run = async (messageId: string | null) => {
    if (!chatId) return toast("Telegram'da chatni oching", 'warn');
    setStage('running');
    setResult(null);
    const r = await api<SrvDraft>('ai/draft', { method: 'POST', body: { chatId, messageId: bareMessageId(messageId) } });
    if (!r.ok) {
      toast(r.status === 404 ? "Bu chatda ochiq tiket yo'q" : `AI xatosi: ${r.error}`, r.status === 404 ? 'warn' : 'err');
      setStage('idle');
      return;
    }
    show(r.data);
  };

  // "AI javob" on a message hover menu
  useBus((e) => {
    if (e.type === 'ai') {
      setSourceMsgId(e.messageId);
      void run(e.messageId);
    }
  });
  useIntentReplay('ai', 'server-ai-tab', (e) => {
    if (e.type !== 'ai') return;
    setSourceMsgId(e.messageId);
    void run(e.messageId);
  });

  // a draft produced by the ".ai" command typed in Telegram arrives over the realtime channel (see realtime.ts)
  useEffect(() => {
    const onDraft = (ev: Event) => {
      const d = (ev as CustomEvent<SrvDraft>).detail;
      // the server's chat id format may differ from the page's, so no chat filter: the draft names its ticket instead
      if (d?.id) show(d);
    };
    window.addEventListener('tp-draft-ready', onDraft);
    return () => window.removeEventListener('tp-draft-ready', onDraft);
  }, []);

  const discard = async () => {
    if (result) await api(`ai/drafts/${result.id}/discard`, { method: 'POST', body: {} });
    setResult(null);
    setText('');
    setStage('idle');
  };

  return (
    <div>
      <div class="tp-section">
        <div class="tp-small tp-muted">Server mijozning oxirgi xabarlari asosida bilim bazasidan qoralama tayyorlaydi (maxfiy ma'lumotlar yashiriladi).</div>
        <div class="tp-row" style={{ marginTop: '4px' }}>
          <button class="tp-btn small primary" disabled={stage === 'running' || !chatId} onClick={() => run(sourceMsgId)}>
            {stage === 'running' ? '…' : 'AI javob'}
          </button>
          <span class="tp-small tp-muted">yoki Telegram'da <span class="tp-mono">.ai</span> yozing</span>
        </div>
      </div>

      {result && <div class="tp-small tp-muted tp-section">Tiket #{result.ticketNumber}</div>}
      {result?.warning &&<div class="tp-warnbox tp-section">{result.warning}</div>}

      {result && result.masked.hits > 0 && (
        <div class="tp-section">
          <h4>AI ko'radigan matn ({result.masked.hits} ta yashirildi)</h4>
          <div class="tp-pre tp-small" dangerouslySetInnerHTML={{ __html: highlightMasks(result.masked.text) }} />
        </div>
      )}

      {stage === 'done' && result?.notFound && (
        <div class="tp-warnbox tp-section">Bazada topilmadi. Javob o'ylab topilmaydi — shablon yoki qo'lda javob bering.</div>
      )}

      {stage === 'done' && result && !result.notFound && (
        <div class="tp-section">
          <h4>Qoralama {result.mode === 'extractive' && <span class="tp-small tp-muted">(AI siz, maqoladan)</span>}</h4>
          <textarea value={text} rows={6} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="tp-row" style={{ marginTop: '4px' }}>
            <button class="tp-btn small primary" disabled={!text.trim()} onClick={() => insertWithToast(bridge, text, true)}>
              Composerga qo'yish
            </button>
            {sourceMsgId && (
              <button
                class="tp-btn small"
                title="Tajribaviy: Telegram menyusidagi Reply ni bosadi"
                onClick={async () => {
                  const ok = await bridge.replyToMessage(sourceMsgId);
                  if (!ok) toast("Reply rejimini yoqib bo'lmadi — oddiy qo'yiladi", 'warn');
                  await insertWithToast(bridge, text, true);
                }}
              >
                Javob (reply) sifatida
              </button>
            )}
            <button class="tp-btn small" onClick={discard}>Tashlab yuborish</button>
          </div>
          <div class="tp-small tp-muted" style={{ marginTop: '4px' }}>
            Yuborishni o'zingiz bosasiz. O'zgartirmasdan yuborsangiz server buni hisobga oladi.
          </div>
        </div>
      )}

      {result && result.sources.length > 0 && (
        <div class="tp-section">
          <h4>Manbalar</h4>
          <div class="tp-row">
            {result.sources.map((s) => (
              <span class="tp-chip" title={`${s.type} · ball ${s.score.toFixed(2)}`}>
                {s.type === 'article' ? '📖' : '📄'} {s.title.slice(0, 40)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
