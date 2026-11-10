'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  BookOpen,
  Brain,
  ChartColumn,
  FileText,
  Filter,
  Home,
  KanbanSquare,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Send,
  Ticket,
  Users,
  Building2,
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
  icon: React.ComponentType<{ size?: number }>;
  admin?: boolean;
  staff?: boolean;
};

const NAV: NavItem[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: Home },
  { href: '/my-tickets', key: 'nav.myTickets', icon: ListChecks },
  { href: '/board', key: 'nav.board', icon: KanbanSquare, admin: true },
  { href: '/tickets', key: 'nav.tickets', icon: Ticket, admin: true },
  { href: '/filtered', key: 'nav.filtered', icon: Filter, admin: true },
  { href: '/groups', key: 'nav.groups', icon: Building2, admin: true },
  { href: '/users', key: 'nav.users', icon: Users, admin: true },
  { href: '/templates', key: 'nav.templates', icon: FileText },
  { href: '/kb', key: 'nav.kb', icon: BookOpen },
  { href: '/settings', key: 'nav.settings', icon: Settings, admin: true },
  { href: '/telegram', key: 'nav.telegram', icon: Send, admin: true },
  { href: '/ai', key: 'nav.ai', icon: Brain, admin: true },
  { href: '/stats', key: 'nav.stats', icon: ChartColumn, admin: true },
  { href: '/audit', key: 'nav.audit', icon: ScrollText, admin: true },
];

function navFor(role: 'ADMIN' | 'STAFF'): NavItem[] {
  return NAV.filter((n) => role === 'ADMIN' || !n.admin);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = React.useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('auth/me'), retry: false });

  React.useEffect(() => setOpen(false), [path]);
  // admin-only paths bounce STAFF to the dashboard (the API enforces the real permission; this is only navigation)
  const blocked =
    !!me.data && me.data.role !== 'ADMIN' && NAV.some((n) => n.admin && path.startsWith(n.href));
  React.useEffect(() => {
    if (me.data?.mustChangePassword) router.replace('/login');
    else if (blocked) router.replace('/dashboard');
  }, [me.data, blocked, router]);

  if (me.isLoading || !me.data || blocked) return <Spinner />; // 401 → api.ts redirects to /login
  const user = me.data;
  const items = navFor(user.role);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { [CSRF_HEADER_NAME]: '1' } });
    router.replace('/login');
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold">
        <Bot size={18} /> {t('app.name')}
      </div>
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm',
            path.startsWith(n.href) ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
          )}
        >
          <n.icon size={16} /> {t(n.key)}
        </Link>
      ))}
      <div className="mt-auto border-t pt-3">
        <div className="px-2 text-xs text-muted-foreground">
          {user.displayName} · {t(`role.${user.role}`)}
        </div>
        <button
          onClick={logout}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
        >
          <LogOut size={16} /> {t('nav.logout')}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r bg-card md:block">{sidebar}</aside>
      <div className="flex items-center justify-between border-b bg-card px-3 py-2 md:hidden">
        <span className="text-sm font-semibold">{t('app.name')}</span>
        <button onClick={() => setOpen(!open)} aria-label="menu" className="p-1">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && <div className="border-b bg-card md:hidden">{sidebar}</div>}
      <main className="min-w-0 p-4 md:p-6">{children}</main>
    </div>
  );
}
