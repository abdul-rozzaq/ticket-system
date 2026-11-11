// GramJS (MTProto) implementation of TelegramUserClient.
//
// NOT VERIFIED against a real Telegram account: this file compiles against GramJS 2.26 typings and follows its
// documented flows, but it has never talked to Telegram. See docs/testing/manual-tests.md before trusting it.
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import { Raw } from 'telegram/events/Raw';
import { StringSession } from 'telegram/sessions';
import { fromMtproto, parseStoredPeer } from '@tp/shared';
import type {
  Logger,
  StartResult,
  SubmitCodeResult,
  TelegramUserClient,
  TgDialog,
  TgMe,
  TgMessage,
  TgReaction,
  FolderOp,
  FolderOpResult,
  FolderState,
  TgFolder,
} from './ports';

export interface GramjsOptions {
  apiId: number;
  apiHash: string;
  logger: Logger;
}

/** Canonical key ("c:123" / "g:45" / "u:7") for an MTProto Peer. */
function peerKey(p: Api.TypePeer | undefined): string | null {
  if (!p) return null;
  if (p instanceof Api.PeerChannel) return fromMtproto('channel', p.channelId.toString()).key;
  if (p instanceof Api.PeerChat) return fromMtproto('chat', p.chatId.toString()).key;
  if (p instanceof Api.PeerUser) return fromMtproto('user', p.userId.toString()).key;
  return null;
}

export class GramjsClient implements TelegramUserClient {
  private client: TelegramClient | null = null;
  private phone: string | null = null;
  private phoneCodeHash: string | null = null;
  private msgHandlers: Array<(m: TgMessage) => void> = [];
  private reactionHandlers: Array<(r: TgReaction) => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private handlersAttached = false;
  private watchdog?: NodeJS.Timeout;

  constructor(private readonly o: GramjsOptions) {}

  private make(session: string): TelegramClient {
    const c = new TelegramClient(new StringSession(session), this.o.apiId, this.o.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      // GramJS is chatty at info level; keep it quiet and never log message bodies.
      baseLogger: undefined,
    });
    c.setLogLevel('error' as never);
    return c;
  }

  async start(session: string | null): Promise<StartResult> {
    await this.stop();
    this.client = this.make(session ?? '');
    await this.client.connect();
    if (!session) return 'NEED_LOGIN';
    // A revoked/expired session connects fine but is not authorised.
    const authorised = await this.client.checkAuthorization().catch(() => false);
    if (!authorised) return 'NEED_LOGIN';
    this.attachHandlers();
    // GramJS silently reconnects; this watchdog tells the worker when the connection is really gone.
    this.watchdog = setInterval(() => {
      if (this.client && !this.client.connected) this.disconnectHandlers.forEach((h) => h());
    }, 15_000);
    this.watchdog.unref();
    return 'READY';
  }

  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    const c = this.client;
    this.client = null;
    this.handlersAttached = false;
    if (c) await c.disconnect().catch(() => undefined);
  }

  private get c(): TelegramClient {
    if (!this.client) throw new Error('telegram client not started');
    return this.client;
  }

  // ------------------------------------------------------------------ login (admin panel drives these via commands)

  async sendCode(phone: string): Promise<void> {
    if (!this.client) {
      this.client = this.make('');
      await this.client.connect();
    }
    const r = await this.c.sendCode({ apiId: this.o.apiId, apiHash: this.o.apiHash }, phone);
    this.phone = phone;
    this.phoneCodeHash = r.phoneCodeHash;
  }

  async submitCode(code: string): Promise<SubmitCodeResult> {
    if (!this.phone || !this.phoneCodeHash) throw new Error('no login in progress');
    try {
      await this.c.invoke(
        new Api.auth.SignIn({ phoneNumber: this.phone, phoneCodeHash: this.phoneCodeHash, phoneCode: code }),
      );
    } catch (e) {
      if ((e as { errorMessage?: string }).errorMessage === 'SESSION_PASSWORD_NEEDED')
        return { needPassword: true };
      throw e;
    }
    return { session: this.sessionString(), phone: this.phone };
  }

  async submitPassword(password: string): Promise<{ session: string; phone?: string }> {
    await this.c.signInWithPassword(
      { apiId: this.o.apiId, apiHash: this.o.apiHash },
      {
        password: async () => password,
        onError: async (e: Error) => {
          throw e;
        },
      },
    );
    return { session: this.sessionString(), phone: this.phone ?? undefined };
  }

  private sessionString(): string {
    return (this.c.session as StringSession).save();
  }

  async logOut(): Promise<void> {
    await this.c.invoke(new Api.auth.LogOut()).catch(() => undefined);
    await this.stop();
  }

  async me(): Promise<TgMe> {
    const me = (await this.c.getMe()) as Api.User;
    return {
      phone: me.phone ? `+${me.phone}` : undefined,
      username: me.username ?? undefined,
      premium: !!me.premium,
    };
  }

  // ------------------------------------------------------------------ reading

  async getDialogs(): Promise<TgDialog[]> {
    const dialogs = await this.c.getDialogs({ limit: 500 }); // also fills the entity cache used for deletion later
    const out: TgDialog[] = [];
    for (const d of dialogs) {
      const e = d.entity;
      const isGroup = e instanceof Api.Chat || (e instanceof Api.Channel && !!e.megagroup);
      if (!isGroup || !d.id) continue;
      const key =
        e instanceof Api.Channel
          ? fromMtproto('channel', e.id.toString()).key
          : fromMtproto('chat', (e as Api.Chat).id.toString()).key;
      out.push({ chatId: key, title: (e as Api.Chat | Api.Channel).title ?? '' });
    }
    return out;
  }

  private attachHandlers() {
    if (this.handlersAttached) return;
    this.handlersAttached = true;
    this.c.addEventHandler((ev: NewMessageEvent) => void this.onNewMessage(ev), new NewMessage({}));
    this.c.addEventHandler(
      (u: Api.TypeUpdate) => this.onRawUpdate(u),
      new Raw({ types: [Api.UpdateMessageReactions] }),
    );
  }

  private async onNewMessage(ev: NewMessageEvent) {
    try {
      const m = ev.message;
      const key = peerKey(m.peerId);
      const isGroup =
        m.peerId instanceof Api.PeerChat ||
        (m.peerId instanceof Api.PeerChannel && !!(m.chat as Api.Channel | undefined)?.megagroup);
      if (!key || !isGroup) return; // private chats and broadcast channels are none of our business
      let senderName: string | null = null;
      try {
        const s = await m.getSender();
        senderName = s ? ((s as Api.User).firstName ?? (s as Api.Channel).title ?? null) : null;
      } catch {
        /* sender lookup is best effort */
      }
      const tg: TgMessage = {
        chatId: key,
        messageId: String(m.id),
        senderId: m.senderId ? m.senderId.toString() : null,
        senderName,
        text: m.message ?? '',
        outgoing: !!m.out,
        replyToMessageId:
          m.replyTo && 'replyToMsgId' in m.replyTo && m.replyTo.replyToMsgId
            ? String(m.replyTo.replyToMsgId)
            : null,
        date: new Date((m.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        hasMedia: !!m.media,
      };
      this.msgHandlers.forEach((h) => h(tg));
    } catch (e) {
      this.o.logger.warn('message handler failed', { err: (e as Error).name });
    }
  }

  /** Best effort: Telegram only exposes who reacted in small groups, and only the user's own reaction is flagged `my`. */
  private onRawUpdate(u: Api.TypeUpdate) {
    try {
      if (!(u instanceof Api.UpdateMessageReactions)) return;
      const key = peerKey(u.peer);
      if (!key) return;
      const mine = (u.reactions.recentReactions ?? []).filter((r) => r.my);
      for (const r of mine) {
        if (r.reaction instanceof Api.ReactionEmoji) {
          const reaction: TgReaction = {
            chatId: key,
            messageId: String(u.msgId),
            emoji: r.reaction.emoticon,
            byMe: true,
          };
          this.reactionHandlers.forEach((h) => h(reaction));
        }
      }
    } catch (e) {
      this.o.logger.warn('reaction handler failed', { err: (e as Error).name });
    }
  }

  // ------------------------------------------------------------------ chat folders (dialog filters)
  //
  // Limits (10 folders / 100 chats, 20 / 200 with Premium) are Telegram's documented defaults, hard-coded here.
  // Telegram refuses a folder with an EMPTY include list (FILTER_INCLUDE_EMPTY): the API therefore never asks for one
  // (empty funnel folders hold a "self" placeholder = Saved Messages, or are removed, depending on a setting).

  private inputPeerKey(p: Api.TypeInputPeer): string | null {
    if (p instanceof Api.InputPeerChannel) return fromMtproto('channel', p.channelId.toString()).key;
    if (p instanceof Api.InputPeerChat) return fromMtproto('chat', p.chatId.toString()).key;
    if (p instanceof Api.InputPeerUser) return fromMtproto('user', p.userId.toString()).key;
    if (p instanceof Api.InputPeerSelf) return 'self';
    return null;
  }

  async listFolders(): Promise<FolderState> {
    const res = await this.c.invoke(new Api.messages.GetDialogFilters());
    const folders: TgFolder[] = [];
    for (const f of res.filters) {
      // "All chats" (DialogFilterDefault) is not a real folder; shared chat-list folders and normal ones count against the quota.
      if (f instanceof Api.DialogFilter || f instanceof Api.DialogFilterChatlist) {
        folders.push({
          id: f.id,
          title: f.title.text,
          chatKeys: f.includePeers.map((p) => this.inputPeerKey(p)).filter((k): k is string => !!k),
        });
      }
    }
    const dialogs = await this.getDialogs();
    let premium = false;
    try {
      premium = !!(await this.me()).premium;
    } catch {
      /* assume the lower limits */
    }
    return {
      folders,
      dialogKeys: [...dialogs.map((d) => d.chatId), 'self'],
      limits: premium
        ? { maxFolders: 20, maxChatsPerFolder: 200 }
        : { maxFolders: 10, maxChatsPerFolder: 100 },
      premium,
    };
  }

  private async toInputPeer(key: string): Promise<Api.TypeInputPeer | null> {
    if (key === 'self') return new Api.InputPeerSelf();
    const peer = parseStoredPeer(key);
    if (!peer || (peer.kind !== 'channel' && peer.kind !== 'chat')) return null;
    try {
      const entity = await this.c.getInputEntity(
        peer.kind === 'channel'
          ? new Api.PeerChannel({ channelId: bigInt(peer.id) })
          : new Api.PeerChat({ chatId: bigInt(peer.id) }),
      );
      return entity as Api.TypeInputPeer;
    } catch {
      return null; // not in the entity cache / not accessible: skipped, reported back
    }
  }

  async applyFolderOp(op: FolderOp): Promise<FolderOpResult> {
    if (op.op === 'delete') {
      await this.c.invoke(new Api.messages.UpdateDialogFilter({ id: op.telegramFilterId })); // no filter = delete
      return { key: op.key, op: 'delete', ok: true, filterId: op.telegramFilterId };
    }
    const peers: Api.TypeInputPeer[] = [];
    const skipped: string[] = [];
    for (const k of op.chatKeys) {
      const p = await this.toInputPeer(k);
      if (p) peers.push(p);
      else skipped.push(k);
    }
    if (!peers.length) throw new Error('FILTER_INCLUDE_EMPTY (no chat could be resolved)');
    let id: number;
    if (op.op === 'update') id = op.telegramFilterId;
    else {
      const existing = (await this.c.invoke(new Api.messages.GetDialogFilters())).filters;
      id = Math.max(1, ...existing.map((f) => ('id' in f ? f.id : 1))) + 1; // folder ids start at 2
    }
    const filter = new Api.DialogFilter({
      id,
      title: new Api.TextWithEntities({ text: op.title, entities: [] }),
      pinnedPeers: [],
      includePeers: peers,
      excludePeers: [],
    });
    await this.c.invoke(new Api.messages.UpdateDialogFilter({ id, filter }));
    return { key: op.key, op: op.op, ok: true, filterId: id, skipped: skipped.length ? skipped : undefined };
  }

  // ------------------------------------------------------------------ the only other write: deleting our own messages

  async deleteOwnMessages(chatId: string, messageIds: string[]): Promise<void> {
    const peer = parseStoredPeer(chatId);
    if (!peer || (peer.kind !== 'channel' && peer.kind !== 'chat')) throw new Error('unsupported chat id');
    const tgPeer =
      peer.kind === 'channel'
        ? new Api.PeerChannel({ channelId: bigInt(peer.id) })
        : new Api.PeerChat({ chatId: bigInt(peer.id) });
    const entity = await this.c.getInputEntity(tgPeer);
    const ids = messageIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const msgs = await this.c.getMessages(entity, { ids });
    // Safety: only ever delete messages that WE sent, whatever the caller asked for.
    const own = msgs
      .filter((m): m is Api.Message => !!m && m instanceof Api.Message && !!m.out)
      .map((m) => m.id);
    if (own.length) await this.c.deleteMessages(entity, own, { revoke: true });
  }

  onMessage(h: (m: TgMessage) => void) {
    this.msgHandlers.push(h);
  }
  onReaction(h: (r: TgReaction) => void) {
    this.reactionHandlers.push(h);
  }
  onDisconnect(h: () => void) {
    this.disconnectHandlers.push(h);
  }
}
