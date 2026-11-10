// Funnel -> Telegram folder reconciliation (pure). The userbot applies the resulting operations with MTProto
// (messages.updateDialogFilter); this module only decides WHAT to do, so it is fully testable with fakes.

export interface DesiredFolder {
  /** Stable key: "NEW" | "WAITING" | "OVERDUE" | "USER:<uuid>". */
  key: string;
  title: string;
  /** Canonical chat keys ("c:123", "g:45"); order = priority when a folder exceeds the chat limit. */
  chatKeys: string[];
  kind: 'SYSTEM' | 'STAFF';
}

export interface CurrentFolder {
  key: string;
  telegramFilterId: number;
  title: string;
  chatKeys: string[];
}

export interface FolderLimits {
  maxFolders: number; // 10, or 20 with Premium (counts ALL folders of the account)
  maxChatsPerFolder: number; // 100, or 200 with Premium
  /** Folders on the account that we did NOT create. We never touch them but they use up the quota. */
  foreignFolderCount: number;
}

export type FolderOp =
  | { op: 'create'; key: string; title: string; chatKeys: string[] }
  | {
      op: 'update';
      key: string;
      telegramFilterId: number;
      title: string;
      chatKeys: string[];
      reason: 'title' | 'chats' | 'both';
    }
  | { op: 'delete'; key: string; telegramFilterId: number };

export interface FolderPlan {
  ops: FolderOp[];
  warnings: string[];
  /** True when per-staff folders were dropped to fit the folder limit. */
  degraded: boolean;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function planFolderSync(
  desiredIn: DesiredFolder[],
  current: CurrentFolder[],
  limits: FolderLimits,
): FolderPlan {
  const warnings: string[] = [];
  let degraded = false;
  const budget = Math.max(0, limits.maxFolders - limits.foreignFolderCount);
  let desired = [...desiredIn];

  if (desired.length > budget) {
    const system = desired.filter((d) => d.kind === 'SYSTEM');
    if (system.length <= budget) {
      // Keep the funnel stages, drop the per-staff folders.
      desired = system;
      degraded = true;
      warnings.push(
        `Papkalar limiti: ${desiredIn.length} ta papka kerak, lekin faqat ${budget} ta bo'sh joy bor (jami ${limits.maxFolders}, boshqa papkalar ${limits.foreignFolderCount}). Xodim papkalari o'tkazib yuborildi, faqat tizim papkalari qoldi. Telegram Premium tavsiya etiladi.`,
      );
    } else {
      desired = system.slice(0, budget);
      degraded = true;
      warnings.push(`Papkalar limiti juda kichik: faqat birinchi ${budget} ta tizim papkasi yaratiladi.`);
    }
  }

  desired = desired.map((d) => {
    if (d.chatKeys.length <= limits.maxChatsPerFolder) {
      if (d.chatKeys.length >= limits.maxChatsPerFolder * 0.9)
        warnings.push(
          `"${d.title}" papkasi to'lib qolmoqda (${d.chatKeys.length}/${limits.maxChatsPerFolder}).`,
        );
      return d;
    }
    warnings.push(
      `"${d.title}" papkasida ${d.chatKeys.length} ta chat bor, limit ${limits.maxChatsPerFolder}: ortiqchasi kesildi.`,
    );
    return { ...d, chatKeys: d.chatKeys.slice(0, limits.maxChatsPerFolder) };
  });

  const cur = new Map(current.map((c) => [c.key, c]));
  const want = new Set(desired.map((d) => d.key));
  const ops: FolderOp[] = [];

  // Deletions first: they free quota for creations.
  for (const c of current)
    if (!want.has(c.key)) ops.push({ op: 'delete', key: c.key, telegramFilterId: c.telegramFilterId });
  for (const d of desired) {
    const c = cur.get(d.key);
    if (!c) {
      ops.push({ op: 'create', key: d.key, title: d.title, chatKeys: d.chatKeys });
      continue;
    }
    const titleChanged = c.title !== d.title;
    const chatsChanged = !sameSet(c.chatKeys, d.chatKeys);
    if (titleChanged || chatsChanged) {
      ops.push({
        op: 'update',
        key: d.key,
        telegramFilterId: c.telegramFilterId,
        title: d.title,
        chatKeys: d.chatKeys,
        reason: titleChanged && chatsChanged ? 'both' : titleChanged ? 'title' : 'chats',
      });
    }
  }
  return { ops, warnings, degraded };
}

/** Which folder should a customer chat with an open ticket be in? Exactly one, or none for closed tickets. */
export function folderKeyForTicket(t: {
  status: string;
  assigneeId: string | null;
  overdue: boolean;
}): string | null {
  if (t.status === 'CLOSED') return null;
  if (t.overdue) return 'OVERDUE';
  if (t.status === 'WAITING_CLIENT') return 'WAITING';
  if (t.assigneeId) return `USER:${t.assigneeId}`;
  return 'NEW';
}
