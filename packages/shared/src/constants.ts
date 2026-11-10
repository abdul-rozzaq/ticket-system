export const ROLES = ['ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const URGENCIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const SYSTEM_TYPES = ['AMOCRM', 'BITRIX24', 'PBX', 'OTHER'] as const;
export type SystemType = (typeof SYSTEM_TYPES)[number];

export const ASSIGNMENT_STRATEGIES = [
  'MANUAL',
  'FIXED_OWNER',
  'ROUND_ROBIN',
  'LEAST_LOADED',
  'ON_DUTY',
] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export const TICKET_EVENT_TYPES = [
  'CREATED',
  'MESSAGE_ATTACHED',
  'ASSIGNED',
  'REASSIGNED',
  'STATUS_CHANGED',
  'NOTE_ADDED',
  'FIRST_RESPONSE',
  'CLOSED',
  'MERGED',
  'REMINDER_SENT',
  'SLA_BREACHED',
  'AI_CLASSIFIED',
  'SNOOZED',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

/** Funnel stage keys that are not per-staff. */
export const SYSTEM_STAGES = ['NEW', 'WAITING', 'OVERDUE', 'CLOSED'] as const;

export const QUEUES = {
  intake: 'intake',
  userbotCommands: 'userbot-commands',
  userbotEvents: 'userbot-events',
  reminders: 'reminders',
  folders: 'folders',
  kb: 'kb',
  digests: 'digests',
  botOutbox: 'bot-outbox',
} as const;

export const WS_EVENTS = {
  ticketCreated: 'ticket.created',
  ticketUpdated: 'ticket.updated',
  reminder: 'reminder',
  slaWarning: 'sla.warning',
  draftReady: 'draft.ready',
} as const;

export const DEFAULT_SETTINGS = {
  'intake.debounceSeconds': 25,
  'intake.confidenceThreshold': 0.6,
  'intake.minChars': 6,
  'intake.contextMessages': 5,
  /** Comma-separated extras to the built-in lists (matched case-insensitively). */
  'intake.urgentKeywords': '',
  'intake.stopWords': '',
  'assignment.strategy': 'MANUAL',
  /** Mirror the funnel into Telegram chat folders. */
  'funnel.foldersEnabled': true,
  /** One folder per staff member in addition to the system folders. */
  'funnel.staffFolders': true,
  'funnel.reconcileDebounceSeconds': 5,
  /**
   * Telegram refuses folders with no chats. 'placeholder' keeps empty funnel folders alive by including Saved Messages
   * (tabs stay put); 'remove' deletes empty folders and re-creates them when the first chat arrives.
   */
  'funnel.emptyFolders': 'placeholder',
  'commands.deleteAfterUse': true,
  'reactions.enabled': true,
  'activity.pingEnabled': true,
  'reminders.unassignedMinutes': 10,
  'reminders.assignedHours': 4,
  'reminders.waitingHours': 24,
  'sla.firstResponseMinutes': 30,
  'sla.resolutionMinutes': 480,
} as const;
