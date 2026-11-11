// Shapes returned by the API (only the fields the panel uses).
export type Role = 'ADMIN' | 'STAFF';
export type TicketStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  onDuty: boolean;
  available: boolean;
  workingHours: unknown;
  telegramLinked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
