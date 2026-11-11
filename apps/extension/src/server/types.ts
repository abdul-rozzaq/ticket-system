// Shapes returned by the ticket server (only the fields the extension uses).
export type SrvStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';

export interface SrvGroup {
  id: string;
  companyName: string;
  title: string;
  systemType: 'AMOCRM' | 'BITRIX24' | 'PBX' | 'OTHER';
  isActive: boolean;
  language: 'uz' | 'ru';
}

export interface SrvTicket {
  id: string;
  number: number;
  status: SrvStatus;
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
  summary: string;
  category: string;
  slaDeadline: string;
  openedAt: string;
  closedAt: string | null;
  assigneeId: string | null;
  assignee?: { id: string; displayName: string } | null;
  solutionNote: string | null;
  needsReview: boolean;
}

export interface SrvTicketDetail extends SrvTicket {
  events: { id: string; type: string; actorId: string | null; createdAt: string; payload: Record<string, unknown> }[];
  messages: { id: string; direction: 'IN' | 'OUT'; text: string; isInternalNote: boolean; sentAt: string; senderName: string | null }[];
}

export interface SrvByChat {
  group: SrvGroup;
  current: SrvTicket | null;
  lastClosed: SrvTicket | null;
}

export interface SrvTemplate {
  id: string;
  category: string;
  title: string;
  bodyUz: string;
  bodyRu: string | null;
  keywords: string[];
  usageCount: number;
}

export interface SrvDraft {
  id: string;
  ticketId: string;
  ticketNumber: number;
  chatId: string;
  draft: string | null;
  notFound: boolean;
  mode: 'llm' | 'extractive' | 'none';
  sources: { type: 'article' | 'template'; id: string; title: string; score: number }[];
  masked: { text: string; hits: number };
  maskPolicy: string;
  vectorUsed: boolean;
  warning?: string;
}

export const SYSTEM_LABEL: Record<SrvGroup['systemType'], string> = {
  AMOCRM: 'AmoCRM',
  BITRIX24: 'Bitrix24',
  PBX: 'Online PBX',
  OTHER: 'Boshqa',
};
