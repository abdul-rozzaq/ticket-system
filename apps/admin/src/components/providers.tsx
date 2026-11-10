'use client';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Toast = { id: number; text: string; tone: 'ok' | 'err' };
const ToastCtx = React.createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 6000 : 3000);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <ToastCtx.Provider value={push}>
        {children}
        <div
          className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
          aria-live="polite"
        >
          {toasts.map((x) => (
            <div
              key={x.id}
              className={`pointer-events-auto max-w-sm rounded-md border px-3 py-2 text-sm shadow-lg ${
                x.tone === 'err' ? 'border-destructive/40 bg-card text-destructive' : 'bg-card'
              }`}
            >
              {x.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </QueryClientProvider>
  );
}
