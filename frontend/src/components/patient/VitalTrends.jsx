import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// One small chart per vital sign, each on its own scale.
// Tooltips are synchronised across the charts so a moment in time reads across all vitals.
// Temperatures are shown in °F; readings recorded in °C are converted.

const SERIES_1 = 'var(--series-1)';
const SERIES_2 = 'var(--series-2)';
const AXIS_TICK = { fontSize: 11, fill: 'var(--text-muted)' };

const toF = (v, unit) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const isC = unit ? String(unit).toUpperCase().startsWith('C') : n < 50; // unit missing: values under 50 are Celsius
  return Math.round((isC ? n * 9 / 5 + 32 : n) * 10) / 10;
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

const METRICS = [
  { key: 'pulse', title: 'Pulse', unit: 'bpm', domain: [40, 160] },
  {
    key: 'bp', title: 'Blood pressure', unit: 'mmHg', domain: [40, 200],
    lines: [
      { key: 'bpSystolic', name: 'Systolic', color: SERIES_1 },
      { key: 'bpDiastolic', name: 'Diastolic', color: SERIES_2, dashed: true },
    ],
  },
  { key: 'spo2', title: 'SpO2', unit: '%', domain: [80, 100] },
  { key: 'temperature', title: 'Temperature', unit: '°F', domain: [94, 106] },
  { key: 'respiratoryRate', title: 'Respiratory rate', unit: '/min', domain: [6, 40] },
];

const fmtWhen = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtTick = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

function VitalTooltip({ active, payload, label, unit, lines }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="muted" style={{ fontSize: '0.78rem' }}>{fmtWhen(label)}</div>
      {payload.map((p) => {
        const def = lines.find((l) => l.key === p.dataKey);
        return (
          <div key={p.dataKey}>
            {lines.length > 1 && <span className="muted">{def?.name}: </span>}
            <strong className="tabular">{p.value} {unit}</strong>
          </div>
        );
      })}
    </div>
  );
}

export default function VitalTrends({ vitals, height = 150 }) {
  const data = useMemo(() => [...(vitals || [])]
    .map((v) => ({
      t: new Date(v.recordedAt || v.RECORDED_AT || v.recorded_at).getTime(),
      pulse: num(v.pulse ?? v.PULSE),
      bpSystolic: num(v.bpSystolic ?? v.BP_SYSTOLIC),
      bpDiastolic: num(v.bpDiastolic ?? v.BP_DIASTOLIC),
      spo2: num(v.spo2 ?? v.SPO2),
      temperature: toF(v.temperature ?? v.TEMPERATURE, v.tempUnit ?? v.temp_unit ?? v.TEMP_UNIT),
      respiratoryRate: num(v.respiratoryRate ?? v.RESPIRATORY_RATE ?? v.respiratory_rate),
    }))
    .filter((d) => Number.isFinite(d.t))
    .sort((a, b) => a.t - b.t), [vitals]);

  const charts = METRICS.map((m) => {
    const lines = m.lines || [{ key: m.key, name: m.title, color: SERIES_1 }];
    const has = lines.some((l) => data.some((d) => d[l.key] != null));
    if (!has) return null;
    const latest = [...data].reverse().find((d) => lines.some((l) => d[l.key] != null));
    const latestText = lines.map((l) => latest?.[l.key]).filter((v) => v != null).join('/');
    return (
      <section key={m.key} className="chart-card" aria-label={`${m.title} trend`}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h3>{m.title}</h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="tabular" style={{ fontWeight: 650 }}>{latestText} <span className="muted" style={{ fontWeight: 400 }}>{m.unit}</span></span>
          </span>
        </div>
        <p className="chart-sub">
          {latest ? <>Latest {fmtWhen(latest.t)} · </> : null}Recorded values are shown without an inferred reference range.
        </p>
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <LineChart data={data} syncId="vital-trends" margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={40} />
              <YAxis domain={m.domain} allowDataOverflow={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<VitalTooltip unit={m.unit} lines={lines} />} cursor={{ stroke: 'var(--text-muted)', strokeDasharray: '3 3' }} />
              {lines.map((l) => (
                <Line
                  key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2}
                  strokeDasharray={l.dashed ? '5 4' : undefined} connectNulls isAnimationActive={false}
                  dot={{ r: 3, fill: l.color, stroke: 'var(--surface)', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {lines.length > 1 && (
          <ul className="chart-legend" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
            {lines.map((l) => (
              <li key={l.key}>
                <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? '5 4' : undefined} /></svg>
                {l.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }).filter(Boolean);

  if (charts.length === 0) return null;
  return (
    <div>
      <div className="chart-grid">{charts}</div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        Values retain their recorded time and unit context; temperature is displayed in °F on this trend chart.
      </p>
    </div>
  );
}
