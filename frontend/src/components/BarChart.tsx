import { useEffect, useRef, useState } from 'react';
import { money, moneyShort } from '../lib/format';

export interface Series { key: string; name: string; color: string }
export interface Datum { label: string; sub?: string; values: Record<string, number> }

/** Rect with only the top corners rounded — bars stay anchored to the baseline */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Round axis: step from {1, 2, 5}×10ⁿ so labels read ₹10K, ₹20K… never ₹6.3K */
const niceScale = (v: number) => {
  if (v <= 0) return { max: 1000, ticks: [0, 250, 500, 750, 1000] };
  const rough = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= rough)!;
  const n = Math.ceil(v / step);
  return { max: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
};

export function BarChart({ data, series, mode = 'stacked', height = 260, ariaLabel }: { data: Datum[]; series: Series[]; mode?: 'stacked' | 'grouped'; height?: number; ariaLabel: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 52, r: 8, t: 12, b: 30 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const totals = data.map((d) => (mode === 'stacked' ? series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0) : Math.max(...series.map((x) => d.values[x.key] ?? 0))));
  const { max, ticks } = niceScale(Math.max(...totals) * 1.05);
  const band = iw / data.length;
  const barW = Math.min(mode === 'stacked' ? 30 : 18, band * (mode === 'stacked' ? 0.58 : 0.34));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));

  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%' }} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={i === 0 ? undefined : '3 4'} />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="num">
              {moneyShort(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          let acc = 0;
          return (
            <g key={i}>
              {hover === i && <rect x={pad.l + band * i + 2} y={pad.t} width={band - 4} height={ih} rx={6} fill="var(--surface-3)" opacity={0.7} />}
              {mode === 'stacked'
                ? series.map((s, si) => {
                    const v = d.values[s.key] ?? 0;
                    if (!v) return null;
                    const top = y(acc + v);
                    const gap = acc > 0 ? 2 : 0; // 2px surface gap between stacked segments
                    const h = Math.max(0, y(acc) - top - gap);
                    acc += v;
                    const isTop = series.slice(si + 1).every((x) => !(d.values[x.key] ?? 0));
                    return isTop ? (
                      <path key={s.key} d={topRounded(cx - barW / 2, top, barW, h, 4)} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={cx - barW / 2} y={top} width={barW} height={h} fill={s.color} />
                    );
                  })
                : series.map((s, si) => {
                    const v = d.values[s.key] ?? 0;
                    const gx = cx - (series.length * barW + (series.length - 1) * 2) / 2 + si * (barW + 2);
                    return <path key={s.key} d={topRounded(gx, y(v), barW, y(0) - y(v), 4)} fill={s.color} />;
                  })}
              {(data.length - 1 - i) % labelEvery === 0 && (
                <text x={cx} y={height - 10} textAnchor="middle" fontSize="11" fill={hover === i ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={hover === i ? 600 : 400}>
                  {d.label}
                </text>
              )}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(pad.l + band * hover + band / 2, 90), w - 90),
            top: Math.max(4, y(totals[hover]) - 12),
          }}
        >
          <div className="chart-tip__title">{data[hover].sub ?? data[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="chart-tip__row">
              <span className="sw" style={{ background: s.color }} />
              <span>{s.name}</span>
              <strong className="num">{money(data[hover].values[s.key] ?? 0)}</strong>
            </div>
          ))}
          {mode === 'stacked' && (
            <div className="chart-tip__row total">
              <span />
              <span>Total</span>
              <strong className="num">{money(totals[hover])}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}
