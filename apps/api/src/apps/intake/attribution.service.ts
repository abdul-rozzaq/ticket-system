import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

export interface Attribution {
  userId: string;
  /** 0..1. A single staff member pinging that chat around the send time = high; several = low. */
  confidence: number;
}

const BEFORE_MS = 15_000; // the extension pings when the human presses Send; Telegram's timestamp may be slightly later
const AFTER_MS = 3_000;

/**
 * All staff share ONE Telegram account, so "who actually answered" is a heuristic: correlate the outgoing message
 * with the extension's "I am sending in chat X" ping that happened a few seconds earlier.
 */
@Injectable()
export class AttributionService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, chatKey: string, ts = new Date()): Promise<void> {
    await this.prisma.staffActivity.create({ data: { userId, chatId: chatKey, ts } });
  }

  async attribute(chatKey: string, sentAt: Date): Promise<Attribution | null> {
    const rows = await this.prisma.staffActivity.findMany({
      where: {
        chatId: chatKey,
        ts: { gte: new Date(sentAt.getTime() - BEFORE_MS), lte: new Date(sentAt.getTime() + AFTER_MS) },
      },
      orderBy: { ts: 'desc' },
    });
    if (!rows.length) return null;
    const users = new Set(rows.map((r) => r.userId));
    if (users.size === 1) return { userId: rows[0].userId, confidence: 0.9 };
    // several people pinged the same chat: pick the ping closest to the send time, but admit we are unsure
    const closest = [...rows].sort(
      (a, b) => Math.abs(a.ts.getTime() - sentAt.getTime()) - Math.abs(b.ts.getTime() - sentAt.getTime()),
    )[0];
    return { userId: closest.userId, confidence: 0.5 };
  }
}
