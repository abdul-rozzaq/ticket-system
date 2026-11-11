import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { APP_ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

const DAY = 86_400_000;
const MIN = 60_000;

/**
 * DEMO_MODE=true: fills an EMPTY system with believable data so the panel, Kanban, statistics and the extension can be
 * shown without Telegram. Never touches a database that already has client groups or tickets. Everything is
 * fictional; the Telegram chat ids are fake (-1009…), so nothing here can reach a real chat.
 * The demo staff share ONE password from DEMO_PASSWORD (never logged); do not enable this on a real installation.
 */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    if (!this.env.DEMO_MODE) return;
    try {
      if (await this.seed())
        this.logger.warn('DEMO_MODE: demo data created. Do not use this on a real installation.');
    } catch (e) {
      this.logger.error(`demo seed failed: ${String(e).slice(0, 300)}`);
    }
  }

  /** Returns true when data was created. Safe to call repeatedly. */
  async seed(now = Date.now()): Promise<boolean> {
    const password = this.env.DEMO_PASSWORD;
    if (!password) {
      this.logger.warn('DEMO_MODE is on but DEMO_PASSWORD (10+ chars) is not set: demo data skipped.');
      return false;
    }
    if ((await this.prisma.clientGroup.count()) || (await this.prisma.ticket.count())) return false;

    const passwordHash = await this.auth.hashPassword(password);
    const staff = [];
    for (const [username, displayName] of [
      ['demo.ali', 'Ali Valiyev'],
      ['demo.vali', 'Vali Karimov'],
    ] as const) {
      staff.push(
        await this.prisma.user.upsert({
          where: { username },
          update: {},
          create: {
            username,
            displayName,
            role: 'STAFF',
            passwordHash,
            mustChangePassword: false,
            onDuty: username === 'demo.ali',
          },
        }),
      );
    }
    const [ali, vali] = staff;

    const fast = await this.prisma.slaPolicy.create({
      data: { name: 'VIP (15 daqiqa)', firstResponseMinutes: 15, resolutionMinutes: 240, isDefault: false },
    });
    const mk = (
      i: number,
      title: string,
      companyName: string,
      systemType: 'AMOCRM' | 'BITRIX24' | 'PBX' | 'OTHER',
      slaPolicyId?: string,
    ) =>
      this.prisma.clientGroup.create({
        data: {
          telegramChatId: `c:900000000${i}`,
          title,
          companyName,
          systemType,
          isConfirmed: true,
          defaultOwnerId: i % 2 ? ali.id : vali.id,
          slaPolicyId,
        },
      });
    const g = [
      await mk(1, 'Alfa Trade | TP', 'Alfa Trade', 'AMOCRM', fast.id),
      await mk(2, 'Beta Logistics | TP', 'Beta Logistics', 'PBX'),
      await mk(3, 'Gamma Group | TP', 'Gamma Group', 'BITRIX24'),
      await mk(4, 'Delta Med | TP', 'Delta Med', 'AMOCRM'),
    ];

    type Spec = {
      g: number;
      summary: string;
      system: 'AMOCRM' | 'BITRIX24' | 'PBX' | 'OTHER';
      urgency?: 'LOW' | 'NORMAL' | 'HIGH';
      openedAgoMin: number;
      firstResponseMin?: number;
      resolutionMin?: number;
      assignee?: string;
      status: 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
      solution?: string;
      slaMin?: number;
    };
    const specs: Spec[] = [
      // history (closed) for the statistics: one per day-ish, with response/resolution times
      ...Array.from({ length: 12 }, (_, i): Spec => ({
        g: i % 4,
        summary: [
          'Webhook ishlamayapti',
          'Qo‘ng‘iroqlar yozilmayapti',
          'Lead kartochka ochilmayapti',
          'Hisobot yuklanmayapti',
        ][i % 4],
        system: (['AMOCRM', 'PBX', 'AMOCRM', 'BITRIX24'] as const)[i % 4],
        openedAgoMin: ((12 - i) * DAY) / MIN + 90,
        firstResponseMin: 5 + ((i * 7) % 40),
        resolutionMin: 30 + ((i * 37) % 300),
        assignee: i % 2 ? ali.id : vali.id,
        status: 'CLOSED',
        solution: 'Sozlama tuzatildi, mijoz tasdiqladi',
      })),
    ];
    const open: Spec[] = [
      {
        g: 0,
        summary: 'AmoCRM da yangi lead kartochka ochilmayapti',
        system: 'AMOCRM',
        urgency: 'HIGH',
        openedAgoMin: 6,
        status: 'NEW',
      },
      {
        g: 1,
        summary: 'PBX dan chiquvchi qo‘ng‘iroq ketmayapti',
        system: 'PBX',
        openedAgoMin: 190,
        firstResponseMin: 20,
        assignee: ali.id,
        status: 'IN_PROGRESS',
        slaMin: -30,
      },
      {
        g: 2,
        summary: 'Bitrix24 da hisobot yuklanmayapti',
        system: 'BITRIX24',
        openedAgoMin: 45,
        firstResponseMin: 10,
        assignee: vali.id,
        status: 'WAITING_CLIENT',
      },
      {
        g: 3,
        summary: 'Webhook manzili o‘zgargandan keyin ishlamayapti',
        system: 'AMOCRM',
        urgency: 'LOW',
        openedAgoMin: 400,
        assignee: vali.id,
        status: 'IN_PROGRESS',
        firstResponseMin: 15,
      },
    ];

    for (const s of [...specs, ...open]) {
      const openedAt = new Date(now - s.openedAgoMin * MIN);
      const group = g[s.g];
      const policy = group.slaPolicyId ? fast : null;
      const frLimit = policy?.firstResponseMinutes ?? 30;
      const first =
        s.firstResponseMin != null ? new Date(openedAt.getTime() + s.firstResponseMin * MIN) : null;
      const closedAt =
        s.status === 'CLOSED' && s.resolutionMin != null
          ? new Date(openedAt.getTime() + s.resolutionMin * MIN)
          : null;
      const slaDeadline =
        s.slaMin != null
          ? new Date(now + s.slaMin * MIN)
          : first
            ? new Date(openedAt.getTime() + (policy?.resolutionMinutes ?? 480) * MIN)
            : new Date(openedAt.getTime() + frLimit * MIN);
      const t = await this.prisma.ticket.create({
        data: {
          clientGroupId: group.id,
          status: s.status,
          assigneeId: s.assignee ?? null,
          urgency: s.urgency ?? 'NORMAL',
          systemType: s.system,
          category: 'demo',
          summary: s.summary,
          aiConfidence: 0.9,
          openedAt,
          firstResponseAt: first,
          closedAt,
          closedById: closedAt ? (s.assignee ?? null) : null,
          solutionNote: s.solution ?? null,
          slaDeadline,
          lastActivityAt: closedAt ?? first ?? openedAt,
        },
      });
      await this.prisma.ticketMessage.create({
        data: {
          ticketId: t.id,
          chatId: group.telegramChatId,
          direction: 'IN',
          text: s.summary,
          senderName: 'Mijoz',
          sentAt: openedAt,
        },
      });
      await this.prisma.ticketEvent.create({
        data: { ticketId: t.id, type: 'CREATED', createdAt: openedAt },
      });
      if (closedAt)
        await this.prisma.ticketEvent.create({
          data: { ticketId: t.id, type: 'CLOSED', actorId: s.assignee ?? null, createdAt: closedAt },
        });
    }

    await this.prisma.template.createMany({
      data: [
        {
          category: 'salomlashuv',
          title: 'Salomlashuv',
          bodyUz: 'Assalomu alaykum, {mijoz_nomi}! Murojaatingiz qabul qilindi, tez orada javob beramiz.',
          keywords: ['salom'],
        },
        {
          category: 'AmoCRM',
          title: 'Webhook tekshirish',
          bodyUz:
            '{mijoz_nomi}, webhook manzili https:// bilan boshlanishini va faol ekanini tekshiring. Natijani yozib yuboring.',
          keywords: ['webhook'],
        },
        {
          category: 'PBX',
          title: 'Qo‘ng‘iroq ketmayapti',
          bodyUz: 'Iltimos, {tizim} da SIP akkaunt holatini va balansni tekshiring. Xato matnini yuboring.',
          keywords: ['qongiroq', 'sip'],
        },
        {
          category: 'yopish',
          title: 'Yopish',
          bodyUz: 'Muammo hal bo‘ldi deb hisoblaymiz. Savol bo‘lsa yozing. — {xodim}',
          keywords: ['yopish'],
        },
      ],
    });
    const kb = (
      problem: string,
      solution: string,
      systemType: 'AMOCRM' | 'BITRIX24' | 'PBX',
      tags: string[],
    ) => ({
      problem,
      solution,
      systemType,
      tags,
      status: 'APPROVED' as const,
      lang: 'uz',
      category: 'demo',
    });
    await this.prisma.kbArticle.createMany({
      data: [
        kb(
          'AmoCRM da lead kartochka ochilmaydi',
          'Brauzer keshini tozalang, qayta kiring. Davom etsa, foydalanuvchi huquqlarini tekshiring.',
          'AMOCRM',
          ['lead'],
        ),
        kb(
          'Webhook ishlamayapti',
          'Webhook manzili https bo‘lishi va 200 qaytarishi kerak. Manzilni qayta saqlang.',
          'AMOCRM',
          ['webhook'],
        ),
        kb(
          'Bitrix24 hisobot yuklanmaydi',
          'Hisobot davrini qisqartiring va filtrlarni tozalang, so‘ng qayta yuklang.',
          'BITRIX24',
          ['hisobot'],
        ),
        kb(
          'PBX dan chiquvchi qo‘ng‘iroq ketmaydi',
          'SIP akkaunt faolligi va balansni tekshiring, trunk sozlamasini qayta saqlang.',
          'PBX',
          ['sip'],
        ),
      ],
    });
    return true;
  }
}
