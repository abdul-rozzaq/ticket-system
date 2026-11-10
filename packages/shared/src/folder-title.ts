// Telegram chat-folder titles are limited to 12 characters. Emoji take two UTF-16 units, so the limit is applied to the
// UTF-16 length (the stricter reading) and never splits a surrogate pair.
export const FOLDER_TITLE_MAX = 12;

export function folderTitle(title: string, max = FOLDER_TITLE_MAX): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  let out = '';
  for (const ch of clean) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

/** "👤 Ali" for a staff member, shortened to fit. */
export const staffFolderTitle = (displayName: string): string => folderTitle(`👤 ${displayName}`);
