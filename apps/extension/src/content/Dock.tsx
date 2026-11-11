// F2: draggable, resizable, collapsible dock. Geometry persisted in settings.dock.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../shared/types';
import { patchSettings } from '../shared/storage';
import { Panel } from '../ui/Panel';
import { localBridge } from './localBridge';

type Geo = Settings['dock'];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function Dock({ initial, onHide }: { initial: Geo; onHide: () => void }) {
  const [geo, setGeo] = useState<Geo>(initial);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const save = (g: Geo) => patchSettings({ dock: g }).catch(() => undefined);

  // Keep inside the viewport on window resize.
  useEffect(() => {
    const onResize = () => setGeo((g) => ({ ...g, y: clamp(g.y, 0, innerHeight - 40) }));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const x = geo.x == null ? Math.max(0, innerWidth - geo.w - 16) : clamp(geo.x, 0, Math.max(0, innerWidth - 80));

  const drag = (e: PointerEvent, mode: 'move' | 'resize') => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY, ...geoRef.current, x };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.mx;
      const dy = ev.clientY - start.my;
      if (mode === 'move') setGeo({ ...geoRef.current, x: clamp(start.x + dx, 0, innerWidth - 80), y: clamp(start.y + dy, 0, innerHeight - 40) });
      // Resize handle sits bottom-left (the dock lives on the right edge).
      else setGeo({ ...geoRef.current, x: clamp(start.x + dx, 0, innerWidth - 280), w: clamp(start.w - dx, 280, 900), h: clamp(start.h + dy, 200, innerHeight - 20) });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      save(geoRef.current);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const toggleCollapse = () => {
    const g = { ...geo, collapsed: !geo.collapsed };
    setGeo(g);
    save(g);
  };

  return (
    <div class={`tp-dock ${geo.collapsed ? 'collapsed' : ''}`} style={{ left: `${x}px`, top: `${geo.y}px`, width: `${geo.w}px`, height: `${geo.h}px` }}>
      <div class="tp-titlebar" onPointerDown={(e) => drag(e, 'move')} onDblClick={toggleCollapse}>
        <span class="tp-title">TP Assistant</span>
        <button class="tp-iconbtn" title="Yig'ish" onClick={toggleCollapse}>{geo.collapsed ? '▢' : '—'}</button>
        <button class="tp-iconbtn" title="Yopish (Alt+T)" onClick={onHide}>×</button>
      </div>
      {!geo.collapsed && <Panel bridge={localBridge} />}
      {!geo.collapsed && <div class="tp-resize" onPointerDown={(e) => drag(e, 'resize')} />}
    </div>
  );
}
