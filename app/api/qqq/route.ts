type PricePoint = {
  date: string;
  close: number;
  timestamp: number;
};

type DrawdownPoint = PricePoint & {
  rolling_high: number;
  drawdown_pct: number;
};

type YahooChartResult = {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type YahooChartPayload = {
  chart?: {
    result?: Array<YahooChartResult | null>;
    error?: { description?: string | null } | null;
  };
};

type YahooValue = {
  raw?: number;
};

type YahooSummary = {
  summaryDetail?: Record<string, YahooValue | undefined>;
  defaultKeyStatistics?: Record<string, YahooValue | undefined>;
};

const TICKER = 'QQQ';
const RATE_SYMBOL = '^TNX';
const VXN_SYMBOL = '^VXN';
const LOOKBACK_DAYS = 252;
const DEEP_DRAWDOWN_THRESHOLD = -12;
const DEEP_DRAWDOWN_DAYS = 2;
const YAHOO_HEADERS = {
  accept: 'application/json,text/plain,*/*',
  'user-agent': 'Mozilla/5.0 (compatible; QQQWeeklySignal/1.0)',
};

const jsonHeaders = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}

async function yahooJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }
  return response.json();
}

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return '';
  return Array.from(setCookie.matchAll(/([A-Za-z0-9_]+=[^;]+)/g))
    .map((match) => match[1])
    .join('; ');
}

function chartUrl(symbol: string): string {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set('range', '2y');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'div,splits');
  url.searchParams.set('includeAdjustedClose', 'true');
  return url.toString();
}

function chartSeries(payload: unknown, symbol: string): PricePoint[] {
  const chart = (payload as YahooChartPayload).chart;
  const result = chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points: PricePoint[] = [];

  for (let index = 0; index < Math.min(timestamps.length, closes.length); index += 1) {
    const timestamp = timestamps[index];
    const close = closes[index];
    if (!Number.isFinite(timestamp) || close === null || !Number.isFinite(close)) {
      continue;
    }
    points.push({
      timestamp,
      close,
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    });
  }

  if (!points.length) {
    const message = chart?.error?.description || `${symbol} 没有返回日线数据`;
    throw new Error(message);
  }
  return points;
}

function rawNumber(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as YahooValue).raw;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

async function yahooPe(): Promise<{ value: number | null; field: string | null; warning?: string }> {
  const modules = 'summaryDetail,defaultKeyStatistics';

  try {
    // quoteSummary is public but Yahoo currently expects a short-lived crumb
    // and cookie pair. Keep both in memory for this request only.
    const session = await fetch('https://fc.yahoo.com', { headers: YAHOO_HEADERS });
    const cookie = cookieHeader(session.headers.get('set-cookie'));
    const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YAHOO_HEADERS, ...(cookie ? { cookie } : {}) },
    });
    const crumb = (await crumbResponse.text()).trim();
    if (!crumb || crumbResponse.status >= 400) {
      throw new Error(`Yahoo crumb HTTP ${crumbResponse.status}`);
    }

    const url = new URL(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(TICKER)}`,
    );
    url.searchParams.set('modules', modules);
    url.searchParams.set('crumb', crumb);
    const payload = (await (async () => {
      const response = await fetch(url.toString(), {
        headers: { ...YAHOO_HEADERS, ...(cookie ? { cookie } : {}) },
      });
      if (!response.ok) throw new Error(`Yahoo quoteSummary HTTP ${response.status}`);
      return response.json();
    })()) as {
      quoteSummary?: { result?: Array<YahooSummary | null> };
    };
    const summary = payload.quoteSummary?.result?.[0];
    const candidates: Array<[string, number | null]> = [
      ['trailingPE', rawNumber(summary?.summaryDetail?.trailingPE)],
      ['trailingPE', rawNumber(summary?.defaultKeyStatistics?.trailingPE)],
      ['forwardPE', rawNumber(summary?.summaryDetail?.forwardPE)],
      ['forwardPE', rawNumber(summary?.defaultKeyStatistics?.forwardPE)],
    ];
    const selected = candidates.find(([, value]) => value !== null && value > 0);
    if (selected) return { value: selected[1], field: selected[0] };
    return {
      value: null,
      field: null,
      warning: 'Yahoo 未返回 trailingPE/forwardPE，估值项按中性分计算。',
    };
  } catch (error) {
    return {
      value: null,
      field: null,
      warning: `Yahoo PE 查询失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

function rollingHigh(series: PricePoint[], index: number, lookback: number): number {
  const start = Math.max(0, index - lookback + 1);
  let high = Number.NEGATIVE_INFINITY;
  for (let cursor = start; cursor <= index; cursor += 1) {
    high = Math.max(high, series[cursor].close);
  }
  return high;
}

function drawdownRows(series: PricePoint[]): DrawdownPoint[] {
  return series.map((point, index) => {
    const high = rollingHigh(series, index, LOOKBACK_DAYS);
    return {
      ...point,
      rolling_high: high,
      drawdown_pct: (point.close / high - 1) * 100,
    };
  });
}

function linearScore(value: number | null, low: number, high: number): { score: number; available: boolean } {
  if (value === null) return { score: 50, available: false };
  const score = ((value - low) / (high - low)) * 100;
  return { score: Math.max(0, Math.min(100, score)), available: true };
}

function centeredScore(
  value: number | null,
  neutral: number,
  slope: number,
  higherIsHot: boolean,
): { score: number; available: boolean } {
  if (value === null) return { score: 50, available: false };
  const direction = higherIsHot ? 1 : -1;
  const score = 50 + direction * (value - neutral) * slope;
  return { score: Math.max(0, Math.min(100, score)), available: true };
}

function getZone(score: number): { name: string; action: string; multiplier: number; description: string } {
  if (score < 40) return { name: '低估区', action: '加速定投', multiplier: 1.5, description: '绿灯：在原定投基础上加速。' };
  if (score <= 70) return { name: '计划区', action: '按计划定投', multiplier: 1, description: '黄灯：维持既定计划，不提前补仓。' };
  if (score <= 85) return { name: '高温区', action: '停建仓', multiplier: 0, description: '停止新增建仓，等待温度回落。' };
  return { name: '极高温区', action: '降速定投', multiplier: 0.5, description: '降至半额定投，避免在高温区追高。' };
}

async function readSeries(symbol: string): Promise<PricePoint[]> {
  return chartSeries(await yahooJson(chartUrl(symbol)), symbol);
}

export async function GET(): Promise<Response> {
  const warnings: string[] = [];
  let qqqSeries: PricePoint[] = [];
  let rateSeries: PricePoint[] = [];
  let vxnSeries: PricePoint[] = [];

  try {
    qqqSeries = await readSeries(TICKER);
  } catch (error) {
    return jsonResponse(
      {
        error: `QQQ 行情查询失败：${error instanceof Error ? error.message : '未知错误'}`,
        warnings: ['Yahoo 可能暂时限流或网络不可用，请稍后重试。'],
      },
      502,
    );
  }

  try {
    rateSeries = await readSeries(RATE_SYMBOL);
  } catch (error) {
    warnings.push(`10年期利率查询失败：${error instanceof Error ? error.message : '未知错误'}`);
  }

  try {
    vxnSeries = await readSeries(VXN_SYMBOL);
  } catch (error) {
    warnings.push(`VXN 查询失败：${error instanceof Error ? error.message : '未知错误'}`);
  }

  const qqqWithDrawdown = drawdownRows(qqqSeries);
  const latest = qqqWithDrawdown[qqqWithDrawdown.length - 1];
  const recentDrawdowns = qqqWithDrawdown.slice(-5);
  const deepRows = recentDrawdowns.slice(-DEEP_DRAWDOWN_DAYS);
  const deepTriggered =
    deepRows.length === DEEP_DRAWDOWN_DAYS &&
    deepRows.every((row) => row.drawdown_pct <= DEEP_DRAWDOWN_THRESHOLD);

  const rateRaw = rateSeries.length ? rateSeries[rateSeries.length - 1].close : null;
  const rate = rateRaw === null ? null : Math.abs(rateRaw) >= 20 ? rateRaw / 10 : rateRaw;
  const vxn = vxnSeries.length ? vxnSeries[vxnSeries.length - 1].close : null;
  const valuation = await yahooPe();
  if (valuation.warning) warnings.push(valuation.warning);

  const drawdownComponent = linearScore(latest.drawdown_pct, -12, 0);
  const valuationComponent = linearScore(valuation.value, 18, 26);
  const rateComponent = centeredScore(rate, 4, 25, true);
  const vxnComponent = centeredScore(vxn, 22.65, 3, false);
  const macroScore = (rateComponent.score + vxnComponent.score) / 2;
  const temperature = Math.max(
    0,
    Math.min(
      100,
      0.45 * drawdownComponent.score + 0.35 * valuationComponent.score + 0.2 * macroScore,
    ),
  );
  const roundedTemperature = Math.round(temperature * 10) / 10;
  const zone = getZone(roundedTemperature);
  const action = deepTriggered
    ? '1.5倍定投（连续2日深回撤触发）'
    : zone.action;
  const multiplier = deepTriggered ? 1.5 : zone.multiplier;

  const checks = {
    QQQ历史: qqqSeries.length > 0,
    最新收盘价: Number.isFinite(latest.close),
    '252日高点': Number.isFinite(latest.rolling_high),
    回撤计算: Number.isFinite(latest.drawdown_pct),
    PE: valuation.value !== null,
    '10年期利率': rate !== null,
    VXN: vxn !== null,
    最近两日规则: recentDrawdowns.length >= DEEP_DRAWDOWN_DAYS,
    最新交易日: Boolean(latest.date),
    数据均来自Yahoo: true,
  };
  const qualityScore = Object.values(checks).filter(Boolean).length;
  if (qualityScore < 10) warnings.push(`数据完整度 ${qualityScore}/10，请复核缺失字段。`);

  return jsonResponse({
    model_name: 'QQQ 周度定投信号',
    model_version: 'QQQ-Weekly-DCA-v1.0',
    ticker: TICKER,
    query_time: new Date().toISOString(),
    data_as_of: latest.date,
    source: 'Yahoo Finance via公开接口',
    temperature_score: roundedTemperature,
    zone: zone.name,
    base_action: zone.action,
    base_multiplier: zone.multiplier,
    action,
    dca_multiplier: multiplier,
    action_reason: deepTriggered
      ? '最近 2 个交易日收盘回撤均达到 -12%，覆盖温度区间动作。'
      : zone.description,
    deep_drawdown_triggered: deepTriggered,
    metrics: {
      latest_price: latest.close,
      lookback_high: latest.rolling_high,
      lookback_days: LOOKBACK_DAYS,
      drawdown_pct: latest.drawdown_pct,
      pe: valuation.value,
      pe_field: valuation.field,
      ten_year_yield_pct: rate,
      vxn,
      recent_drawdowns: recentDrawdowns.map(({ timestamp: _timestamp, ...row }) => row),
      price_history: qqqSeries.slice(-45).map(({ timestamp: _timestamp, ...point }) => point),
    },
    component_scores: {
      drawdown: Math.round(drawdownComponent.score * 100) / 100,
      valuation: Math.round(valuationComponent.score * 100) / 100,
      rate: Math.round(rateComponent.score * 100) / 100,
      vxn: Math.round(vxnComponent.score * 100) / 100,
      macro: Math.round(macroScore * 100) / 100,
    },
    component_available: {
      回撤: drawdownComponent.available,
      估值: valuationComponent.available,
      '10年期利率': rateComponent.available,
      VXN: vxnComponent.available,
    },
    data_quality: {
      score: qualityScore,
      out_of: 10,
      checks,
    },
    warnings,
  });
}
