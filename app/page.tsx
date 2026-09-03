'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowDownRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  Info,
  ShieldCheck,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
type PricePoint = {
  date: string;
  close: number;
};

type DrawdownPoint = PricePoint & {
  rolling_high: number;
  drawdown_pct: number;
};

type Signal = {
  model_name: string;
  model_version: string;
  ticker: string;
  query_time: string;
  data_as_of: string | null;
  source: string;
  temperature_score: number;
  zone: string;
  base_action: string;
  base_multiplier: number;
  action: string;
  dca_multiplier: number;
  action_reason: string;
  deep_drawdown_triggered: boolean;
  metrics: {
    latest_price: number | null;
    lookback_high: number | null;
    lookback_days: number;
    drawdown_pct: number | null;
    pe: number | null;
    pe_field: string | null;
    ten_year_yield_pct: number | null;
    vxn: number | null;
    recent_drawdowns: DrawdownPoint[];
    price_history: PricePoint[];
  };
  component_scores: {
    drawdown: number;
    valuation: number;
    rate: number;
    vxn: number;
    macro: number;
  };
  data_quality: {
    score: number;
    out_of: number;
  };
  warnings: string[];
};

type ZoneStyle = {
  label: string;
  short: string;
  color: string;
  text: string;
  border: string;
  soft: string;
  ring: string;
};

const ZONE_STYLES: Record<string, ZoneStyle> = {
  低估区: {
    label: '低估区',
    short: '绿灯加速',
    color: '#54d89a',
    text: 'text-emerald-300',
    border: 'border-emerald-300/25',
    soft: 'bg-emerald-300/10',
    ring: 'shadow-[0_0_36px_rgba(84,216,154,0.16)]',
  },
  计划区: {
    label: '计划区',
    short: '黄灯按计划',
    color: '#f6c85f',
    text: 'text-amber-200',
    border: 'border-amber-300/25',
    soft: 'bg-amber-300/10',
    ring: 'shadow-[0_0_36px_rgba(246,200,95,0.16)]',
  },
  高温区: {
    label: '高温区',
    short: '停止新增',
    color: '#ff9d6c',
    text: 'text-orange-200',
    border: 'border-orange-300/25',
    soft: 'bg-orange-300/10',
    ring: 'shadow-[0_0_36px_rgba(255,157,108,0.16)]',
  },
  极高温区: {
    label: '极高温区',
    short: '降速',
    color: '#fb7185',
    text: 'text-rose-200',
    border: 'border-rose-300/25',
    soft: 'bg-rose-300/10',
    ring: 'shadow-[0_0_36px_rgba(251,113,133,0.18)]',
  },
};

function zoneStyle(zone: string): ZoneStyle {
  return ZONE_STYLES[zone] ?? ZONE_STYLES.计划区;
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '暂无';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatQueryTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function millisecondsUntilNextAutomaticUpdate(now = new Date()): number {
  const todayAtNineOhFiveUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    1,
    5,
  );
  const nextUpdate =
    todayAtNineOhFiveUtc > now.getTime()
      ? todayAtNineOhFiveUtc
      : todayAtNineOhFiveUtc + 24 * 60 * 60 * 1000;
  return Math.max(1_000, nextUpdate - now.getTime());
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  hint,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  hint: string;
  tone?: 'default' | 'warm' | 'cool';
}) {
  const toneClass =
    tone === 'warm'
      ? 'text-orange-200'
      : tone === 'cool'
        ? 'text-cyan-200'
        : 'text-slate-100';

  return (
    <Card className="border-white/10 bg-[#0d1b2d]/85 text-slate-100 shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            <Icon className="size-4 text-cyan-300/80" aria-hidden="true" />
            {label}
          </div>
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80 shadow-[0_0_12px_rgba(103,232,249,0.8)]" />
        </div>
        <div className={`text-3xl font-semibold tracking-[-0.04em] ${toneClass}`}>
          {value}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm text-slate-300">{detail}</div>
        <div className="text-xs leading-5 text-slate-500">{hint}</div>
      </CardContent>
    </Card>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const degrees = Math.max(0, Math.min(100, score)) * 3.6;
  return (
    <div
      className="relative size-[190px] shrink-0 rounded-full p-[11px] sm:size-[220px]"
      style={{
        background: `conic-gradient(${color} ${degrees}deg, rgba(148,163,184,0.13) ${degrees}deg 360deg)`,
      }}
      aria-label={`温度分 ${score.toFixed(1)} 分`}
    >
      <div className="flex size-full flex-col items-center justify-center rounded-full border border-white/10 bg-[#0a1728] shadow-inner shadow-black/20">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          temperature
        </div>
        <div className="mt-1 text-[4.4rem] font-semibold leading-none tracking-[-0.08em] text-slate-50">
          {score.toFixed(1)}
        </div>
        <div className="mt-2 text-xs text-slate-500">满分 100</div>
      </div>
    </div>
  );
}

function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-52 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500">
        暂无足够的价格历史
      </div>
    );
  }

  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 86 - ((point.close - min) / spread) * 68;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(' ');
  const area = `0,90 ${line} 100,90`;
  const latest = points[points.length - 1];
  const first = points[0];
  const periodChange = ((latest.close / first.close) - 1) * 100;

  return (
    <div>
      <div className="relative h-52 overflow-hidden rounded-2xl border border-white/10 bg-[#091625] px-2 py-3">
        <svg
          className="h-full w-full"
          viewBox="0 0 100 90"
          preserveAspectRatio="none"
          role="img"
          aria-label="QQQ 最近价格走势"
        >
          <title>QQQ 最近价格走势</title>
          <defs>
            <linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#63d8e8" stopOpacity="0.27" />
              <stop offset="100%" stopColor="#63d8e8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[22, 45, 68].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="rgba(148,163,184,0.12)"
              strokeDasharray="1.5 2.8"
            />
          ))}
          <polygon points={area} fill="url(#price-area)" />
          <polyline
            points={line}
            fill="none"
            stroke="#72e2ef"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx="100"
            cy={coords[coords.length - 1].split(',')[1]}
            r="2"
            fill="#f6c85f"
            stroke="#091625"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="pointer-events-none absolute inset-x-4 top-3 flex justify-between text-[11px] text-slate-600">
          <span>{formatNumber(max)}</span>
          <span>{formatNumber(min)}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {formatDate(first.date)} — {formatDate(latest.date)} · {points.length} 个交易日
        </span>
        <span className={periodChange >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
          {periodChange >= 0 ? '+' : ''}
          {periodChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function SignalLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
      {[0, 1].map((item) => (
        <Card key={item} className="min-h-[310px] animate-pulse border-white/10 bg-[#0d1b2d]/85">
          <CardContent className="flex h-full flex-col justify-between p-6">
            <div className="space-y-3">
              <div className="h-3 w-32 rounded-full bg-white/10" />
              <div className="h-10 w-3/4 rounded-xl bg-white/10" />
              <div className="h-4 w-1/2 rounded-full bg-white/10" />
            </div>
            <div className="h-24 w-full rounded-2xl bg-white/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Home() {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSignal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/qqq', { cache: 'no-store' });
      const payload = (await response.json()) as Signal & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '暂时无法读取 Yahoo 数据');
      }
      setSignal(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法读取数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => {
      void loadSignal();
    }, 0);

    let timeoutId: number | undefined;
    const scheduleNextUpdate = () => {
      timeoutId = window.setTimeout(() => {
        void loadSignal().finally(scheduleNextUpdate);
      }, millisecondsUntilNextAutomaticUpdate());
    };
    scheduleNextUpdate();

    return () => {
      window.clearTimeout(initialLoadId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [loadSignal]);

  const style = useMemo(
    () => zoneStyle(signal?.zone ?? '计划区'),
    [signal?.zone],
  );

  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-7 lg:px-10">
        <header className="mb-7 flex flex-col gap-5 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200 shadow-[0_0_24px_rgba(103,232,249,0.12)]">
              <Activity className="size-5" aria-hidden="true" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/70">
                Signal desk / QQQ
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">
                QQQ 周度定投信号
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="h-8 gap-2 rounded-full border-white/10 bg-white/[0.04] px-3 text-xs text-slate-300"
            >
              <Database className="size-3.5 text-cyan-300" aria-hidden="true" />
              Yahoo Finance
            </Badge>
          </div>
        </header>

        {error ? (
          <Card className="border-rose-300/20 bg-rose-300/[0.07] text-slate-100">
            <CardContent className="flex flex-col items-start gap-4 p-6">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose-300" aria-hidden="true" />
                <div>
                  <p className="font-medium">暂时无法完成查询</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{error}</p>
                  <p className="mt-2 text-xs text-slate-500">站点会在每天北京时间 09:00 自动再次更新。</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : loading && !signal ? (
          <SignalLoading />
        ) : signal ? (
          <>
            <section className="grid gap-4 lg:grid-cols-[1.32fr_0.68fr]">
              <Card className={`overflow-hidden border-white/10 bg-[#0d1b2d]/90 text-slate-100 ${style.ring}`}>
                <CardContent className="p-6 sm:p-8">
                  <div className="mb-7 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Weekly allocation signal
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                        当前温度分
                      </h2>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                        分数越高代表温度越高，用来控制定投速度，不是收益预测。
                      </p>
                    </div>
                    <Badge className={`rounded-full border ${style.border} ${style.soft} ${style.text}`}>
                      {style.label} · {style.short}
                    </Badge>
                  </div>

                  <div className="flex flex-col items-center gap-7 md:flex-row md:items-center">
                    <ScoreRing score={signal.temperature_score} color={style.color} />
                    <div className="w-full min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        This week&apos;s action
                      </div>
                      <div className={`mt-2 text-3xl font-semibold tracking-[-0.05em] ${style.text}`}>
                        {signal.action}
                      </div>
                      <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
                        {signal.action_reason}
                      </p>
                      <div className="mt-5 grid max-w-md grid-cols-2 gap-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
                          <div className="text-[11px] text-slate-500">定投倍率</div>
                          <div className="mt-1 text-lg font-semibold text-white">
                            {signal.dca_multiplier.toFixed(1)}x
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
                          <div className="text-[11px] text-slate-500">深回撤触发</div>
                          <div className="mt-1 text-lg font-semibold text-white">
                            {signal.deep_drawdown_triggered ? '已触发' : '未触发'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-3.5 text-cyan-300/80" aria-hidden="true" />
                      数据截至 {formatDate(signal.data_as_of)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="size-3.5 text-cyan-300/80" aria-hidden="true" />
                      每日北京时间 09:00 自动更新 · 更新于 {formatQueryTime(signal.query_time)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0d1b2d]/90 text-slate-100">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg text-white">模型状态</CardTitle>
                    <Gauge className="size-5 text-cyan-300/80" aria-hidden="true" />
                  </div>
                  <CardDescription className="text-slate-500">当前查询的可信度与纪律边界</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.06] p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      数据完整度 {signal.data_quality.score}/{signal.data_quality.out_of}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      QQQ 行情、PE、10 年期利率和 VXN 均已返回。
                    </p>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                      <span>温度区间</span>
                      <span>行动边界</span>
                    </div>
                    <div className="space-y-2">
                      {[
                        ['0–39', '低估区', '加速', 'bg-emerald-300'],
                        ['40–70', '计划区', '按计划', 'bg-amber-300'],
                        ['71–85', '高温区', '停建仓', 'bg-orange-300'],
                        ['86+', '极高温区', '降速', 'bg-rose-300'],
                      ].map(([range, label, action, dot]) => (
                        <div key={label} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2.5 text-sm">
                          <span className="flex items-center gap-2 text-slate-300">
                            <span className={`size-2 rounded-full ${dot}`} />
                            {range} · {label}
                          </span>
                          <span className="text-xs text-slate-500">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-cyan-300/70" aria-hidden="true" />
                    连续 2 个交易日回撤达到 12% 时，定投倍率切换至 1.5x。
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="mt-4 grid gap-4 md:grid-cols-3">
              <MetricCard
                icon={ArrowDownRight}
                label="回撤"
                value={formatPercent(signal.metrics.drawdown_pct)}
                detail={`${signal.metrics.lookback_days}日高点 ${formatNumber(signal.metrics.lookback_high)}`}
                hint={signal.deep_drawdown_triggered ? '已满足深回撤覆盖条件' : '未达到连续两日 -12% 触发线'}
                tone="cool"
              />
              <MetricCard
                icon={TrendingUp}
                label="估值"
                value={`PE ${formatNumber(signal.metrics.pe, 1)}`}
                detail={signal.metrics.pe_field ? `Yahoo · ${signal.metrics.pe_field}` : 'Yahoo PE 字段暂无'}
                hint={`估值温度 ${signal.component_scores.valuation.toFixed(1)} / 100`}
                tone={signal.component_scores.valuation >= 70 ? 'warm' : 'default'}
              />
              <MetricCard
                icon={Waves}
                label="利率与波动"
                value={formatPercent(signal.metrics.ten_year_yield_pct)}
                detail={`VXN ${formatNumber(signal.metrics.vxn)}`}
                hint={`宏观温度 ${signal.component_scores.macro.toFixed(1)} / 100`}
                tone="default"
              />
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
              <Card className="border-white/10 bg-[#0d1b2d]/85 text-slate-100">
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg text-white">QQQ 近期价格</CardTitle>
                    <CardDescription className="mt-1 text-slate-500">Yahoo 日线 · 仅用于观察趋势，不改变周度规则</CardDescription>
                  </div>
                  <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.07] px-3 py-2 text-right">
                    <div className="text-[11px] text-slate-500">最新收盘</div>
                    <div className="mt-0.5 text-lg font-semibold text-cyan-100">
                      ${formatNumber(signal.metrics.latest_price)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <PriceChart points={signal.metrics.price_history} />
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0d1b2d]/85 text-slate-100">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg text-white">分数构成</CardTitle>
                    <Zap className="size-5 text-amber-200/80" aria-hidden="true" />
                  </div>
                  <CardDescription className="text-slate-500">回撤优先，估值与波动辅助</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    ['回撤', signal.component_scores.drawdown, 'bg-cyan-300'],
                    ['估值', signal.component_scores.valuation, 'bg-amber-300'],
                    ['利率与波动', signal.component_scores.macro, 'bg-violet-300'],
                  ].map(([label, score, bar]) => (
                    <div key={label as string}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-slate-300">{label as string}</span>
                        <span className="font-mono text-xs text-slate-500">{Number(score).toFixed(1)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, Number(score)))}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-slate-400">
                    当前动作依据：{signal.action_reason}
                  </div>
                </CardContent>
              </Card>
            </section>

            <footer className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>{signal.source} · 模型 {signal.model_version}</span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-cyan-300/70" aria-hidden="true" />
                数据仅供辅助决策，不构成投资建议
              </span>
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
