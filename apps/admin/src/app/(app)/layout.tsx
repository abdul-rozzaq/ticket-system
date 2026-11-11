'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Brain,
  Building2,
  ChartColumn,
  FileText,
  Filter,
  Headset,
  Home,
  KanbanSquare,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Send,
  Settings,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { t, type I18nKey } from '@/lib/i18n';
import { CSRF_HEADER_NAME } from '@/lib/csrf';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';

type NavItem = {
  href: string;
  key: I18nKey;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  admin?: boolean;
};
type NavGroup = { title?: I18nKey; items: NavItem[] };

// Grouped navigation. Admin-only items are hidden for STAFF (the API enforces the real permission).
const GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', key: 'nav.dashboard', icon: Home },
      { href: '/my-tickets', key: 'nav.myTickets', icon: ListChecks },
    ],
  },
  {
    title: 'nav.group.work',
    items: [
      { href: '/board', key: 'nav.board', icon: KanbanSquare, admin: true },
      { href: '/tickets', key: 'nav.tickets', icon: Ticket, admin: true },
      { href: '/filtered', key: 'nav.filtered', icon: Filter, admin: true },
      { href: '/groups', key: 'nav.groups', icon: Building2, admin: true },
    ],
  },
  {
    title: 'nav.group.knowledge',
    items: [
      { href: '/templates', key: 'nav.templates', icon: FileText },
      { href: '/kb', key: 'nav.kb', icon: BookOpen },
    ],
  },
  {
    title: 'nav.group.admin',
    items: [
      { href: '/users', key: 'nav.users', icon: Users, admin: true },
      { href: '/stats', key: 'nav.stats', icon: ChartColumn, admin: true },
      { href: '/telegram', key: 'nav.telegram', icon: Send, admin: true },
      { href: '/ai', key: 'nav.ai', icon: Brain, admin: true },
      { href: '/settings', key: 'nav.settings', icon: Settings, admin: true },
      { href: '/audit', key: 'nav.audit', icon: ScrollText, admin: true },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.items);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = React.useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me'), retry: false });

  React.useEffect(() => setOpen(false), [path]);
  // admin-only paths bounce STAFF to the dashboard (the API enforces the real permission; this is only navigation)
  const blocked =
    !!me.data && me.data.role !== 'ADMIN' && ALL.some((n) => n.admin && path.startsWith(n.href));
  React.useEffect(() => {
    if (blocked) router.replace('/dashboard');
  }, [me.data, blocked, router]);

  if (me.isLoading || !me.data || blocked) return <Spinner />; // 401 → api.ts redirects to /login
  const user = me.data;
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => user.role === 'ADMIN' || !n.admin),
  })).filter((g) => g.items.length);
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { [CSRF_HEADER_NAME]: '1' } });
    router.replace('/login');
  }

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground" aria-label="Asosiy menyu">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
          <Headset size={16} />
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">{t('app.name')}</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && (
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
                {t(g.title)}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map((n) => {
                const active = path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors',
                      active
                        ? 'bg-sidebar-accent font-medium text-white shadow-[inset_2px_0_0_var(--primary)]'
                        : 'hover:bg-sidebar-accent/60 hover:text-white',
                    )}
                  >
                    <n.icon size={16} className={active ? 'text-white' : 'text-sidebar-muted'} />
                    {t(n.key)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-white">{user.displayName}</div>
            <div className="text-[11px] text-sidebar-muted">{t(`role.${user.role}`)}</div>
          </div>
          <button
            onClick={logout}
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
            className="ml-auto rounded p-1.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen md:block">{sidebar}</aside>
      <div className="flex h-12 items-center justify-between bg-sidebar px-4 text-white md:hidden">
        <span className="text-sm font-semibold">{t('app.name')}</span>
        <button onClick={() => setOpen(!open)} aria-label="menu" className="p-1">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && <div className="md:hidden">{sidebar}</div>}
      <main className="min-w-0 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
