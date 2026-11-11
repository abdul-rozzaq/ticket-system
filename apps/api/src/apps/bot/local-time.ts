const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalParts {
  /** YYYY-MM-DD in the given time zone. */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

export function localParts(d: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** The instant the local day containing `d` began (exact for zones without a DST change inside that day). */
export function startOfLocalDay(d: Date, tz: string): Date {
  const p = localParts(d, tz);
  return new Date(d.getTime() - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 - d.getMilliseconds());
}
