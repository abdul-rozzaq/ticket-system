import { z } from 'zod';
import { ASSIGNMENT_STRATEGIES, ROLES, SYSTEM_TYPES, TICKET_STATUSES, URGENCIES } from './constants';

export const passwordSchema = z.string().min(10).max(128);
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/i)
  .transform((s) => s.toLowerCase());

export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const workingHoursSchema = z.object({
  tz: z.string().default('Asia/Tashkent'),
  /** 0 = Sunday ... 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  from: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('09:00'),
  to: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('18:00'),
});
export type WorkingHours = z.infer<typeof workingHoursSchema>;

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1).max(80),
  role: z.enum(ROLES).default('STAFF'),
  password: passwordSchema,
  workingHours: workingHoursSchema.optional(),
});
export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  onDuty: z.boolean().optional(),
  available: z.boolean().optional(),
  workingHours: workingHoursSchema.optional(),
});
export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

export const clientGroupSchema = z.object({
  telegramChatId: z.string().min(1),
  title: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  systemType: z.enum(SYSTEM_TYPES).default('OTHER'),
  language: z.enum(['uz', 'ru']).default('uz'),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  assignmentStrategy: z.enum(ASSIGNMENT_STRATEGIES).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const ticketFilterSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assigneeId: z.string().uuid().optional(),
  clientGroupId: z.string().uuid().optional(),
  systemType: z.enum(SYSTEM_TYPES).optional(),
  urgency: z.enum(URGENCIES).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const closeTicketSchema = z.object({ solutionNote: z.string().max(2000).optional() });
export const setStatusSchema = z.object({ status: z.enum(['IN_PROGRESS', 'WAITING_CLIENT']) });
export const assignSchema = z.object({
  assigneeId: z.string().uuid(),
  handoverNote: z.string().max(500).optional(),
});
export const noteSchema = z.object({ text: z.string().min(1).max(2000) });

export const aiClassificationSchema = z.object({
  isRequest: z.boolean(),
  confidence: z.number().min(0).max(1),
  systemType: z.enum(SYSTEM_TYPES).default('OTHER'),
  category: z.string().max(60).default('other'),
  urgency: z.enum(URGENCIES).default('NORMAL'),
  language: z.enum(['uz', 'ru', 'en', 'other']).default('uz'),
  summary: z.string().max(300).default(''),
});
export type AiClassification = z.infer<typeof aiClassificationSchema>;

export const aiDraftRequestSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().optional(),
});
