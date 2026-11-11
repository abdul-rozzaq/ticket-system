/** Telegram message ids on the page look like "123" or "message123"; the server wants the bare number. */
export const bareMessageId = (id: string | null): string | undefined => {
  const m = id ? /(\d{1,15})$/.exec(id) : null;
  return m ? m[1] : undefined;
};
