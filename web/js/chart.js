// chart.js — dependency-free rolling area/line chart on a canvas. Responsive
// (ResizeObserver + devicePixelRatio), with y-axis ticks, a unit label, faint
// gridlines and a "time →" hint — styled after a Grafana-like time series.
export class AreaChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.label = opts.label || '';
    this.unit = opts.unit || '';
    this.color = opts.color || '#5bc8ff';
    this.fill = opts.fill !== false;
    this.min = opts.min ?? 0;
    this.max = opts.max ?? null; // null = auto-scale from data
    this.capacity = opts.capacity ?? 150;
    this.ticks = opts.ticks ?? 3;
    this.format = opts.format || ((v) => String(Math.round(v)));
    // Optional second series drawn on an independent right-hand axis (e.g. upload
    // alongside download): { color, unit, format, min, max }.
    this.series2 = opts.series2 || null;
    this.data = [];
    this.data2 = [];
    this._raf = 0;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
  }

  push(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return;
    this.data.push(v);
    while (this.data.length > this.capacity) this.data.shift();
    this._schedule();
  }

  // Push a primary + secondary sample together (for the dual-axis network chart).
  pushPair(a, b) {
    if (typeof a === 'number' && !Number.isNaN(a)) {
      this.data.push(a);
      while (this.data.length > this.capacity) this.data.shift();
    }
    if (this.series2 && typeof b === 'number' && !Number.isNaN(b)) {
      this.data2.push(b);
      while (this.data2.length > this.capacity) this.data2.shift();
    }
    this._schedule();
  }

  destroy() {
    this._ro?.disconnect();
    cancelAnimationFrame(this._raf);
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.draw();
    });
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  _niceMax(dataMax, forcedMax = this.max) {
    if (forcedMax != null) return forcedMax;
    if (dataMax <= 0) return 1;
    const headroom = dataMax * 1.25;
    const mag = Math.pow(10, Math.floor(Math.log10(headroom)));
    return Math.ceil(headroom / mag) * mag;
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const padL = 44;
    const padB = 16;
    const padT = 18;
    const padR = this.series2 ? 46 : 10; // room for the right-hand axis labels
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);
    const x0 = padL;
    const y0 = padT;

    const dataMax = this.data.length ? Math.max(...this.data) : 0;
    const max = this._niceMax(dataMax);
    const min = this.min;
    const yOf = (v) => y0 + plotH - ((v - min) / (max - min || 1)) * plotH;
    const xOf = (i, n) => x0 + (n <= 1 ? plotW : (i / (n - 1)) * plotW);

    // horizontal gridlines + left y labels
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let t = 0; t <= this.ticks; t += 1) {
      const val = min + ((max - min) * t) / this.ticks;
      const y = yOf(val);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + plotW, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'right';
      ctx.fillText(this.format(val), x0 - 6, y);
    }

    // faint vertical gridlines
    const vlines = 5;
    for (let i = 1; i < vlines; i += 1) {
      const x = x0 + (plotW * i) / vlines;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + plotH);
      ctx.stroke();
    }

    // optional secondary (right-hand) axis + labels
    let yOf2 = null;
    if (this.series2) {
      const s2min = this.series2.min ?? 0;
      const s2max = this._niceMax(
        this.data2.length ? Math.max(...this.data2) : 0,
        this.series2.max ?? null,
      );
      yOf2 = (v) => y0 + plotH - ((v - s2min) / (s2max - s2min || 1)) * plotH;
      const fmt2 = this.series2.format || ((v) => String(Math.round(v)));
      ctx.fillStyle = hexRgba(this.series2.color, 0.7);
      ctx.textAlign = 'left';
      for (let t = 0; t <= this.ticks; t += 1) {
        const val = s2min + ((s2max - s2min) * t) / this.ticks;
        ctx.fillText(fmt2(val), x0 + plotW + 6, yOf2(val));
      }
    }

    // primary series (with gradient fill)
    this._series(this.data, yOf, xOf, this.color, this.fill, x0, y0, plotH);
    // secondary series (line only) on the right axis
    if (this.series2 && yOf2) {
      this._series(this.data2, yOf2, xOf, this.series2.color, false, x0, y0, plotH);
    }

    // labels
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(`↑ ${this.unit}`, x0 - 2, 12);
    if (this.label) {
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fillText(this.label, x0 + 28, 12);
    }
    if (this.series2 && this.series2.unit) {
      ctx.fillStyle = hexRgba(this.series2.color, 0.75);
      ctx.textAlign = 'right';
      ctx.fillText(`${this.series2.unit} ↑`, x0 + plotW + padR - 2, 12);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText('time →', x0 + plotW, h - 4);
  }

  // Draw one polyline (optionally with a gradient area fill) against a y-mapper.
  _series(data, yOf, xOf, color, fill, x0, y0, plotH) {
    const ctx = this.ctx;
    const n = data.length;
    if (n === 0) return;
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = xOf(i, n);
        const y = yOf(data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    if (fill) {
      trace();
      ctx.lineTo(xOf(n - 1, n), y0 + plotH);
      ctx.lineTo(x0, y0 + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + plotH);
      grad.addColorStop(0, hexRgba(color, 0.45));
      grad.addColorStop(1, hexRgba(color, 0.02));
      ctx.fillStyle = grad;
      ctx.fill();
    }
    trace();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// #rrggbb + alpha → rgba() string.
function hexRgba(hex, alpha) {
  const c = String(hex).replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Threshold color for a 0–100 usage gauge (disk): >90 red, >75 yellow,
// >50 green, else blue. Pure + exported so it can be unit-tested.
export function gaugeColor(pct) {
  if (pct > 90) return '#ff4d6d';
  if (pct > 75) return '#ffd166';
  if (pct > 50) return '#57e08e';
  return '#5bc8ff';
}

// Pure geometry for the 270° arc gauge so it never clips the canvas. The arc is
// 2r wide and ~1.71r tall (top at 12-o'clock, bottom at the two lower endpoints
// at ±135°). Returns the radius, stroke width and center. Unit-tested.
export function gaugeMetrics(w, h, pad = 8) {
  let r = Math.min((w - 2 * pad) / 2.2, (h - 2 * pad) / 1.95);
  r = Math.max(8, r);
  const lw = Math.max(5, r * 0.18);
  const cx = w / 2;
  const cy = pad + r + lw / 2; // the arc's top point lands at `pad`
  return { pad, r, lw, cx, cy };
}

// Radial 270° arc gauge: a big centered value, colored by threshold.
export class Gauge {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 100;
    this.value = opts.value ?? 0;
    this.format = opts.format || ((v) => `${Math.round(v)}%`);
    this.trackColor = opts.trackColor || 'rgba(255,255,255,0.10)';
    this.colorFor = opts.colorFor || gaugeColor;
    this._raf = 0;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
  }

  set(value) {
    if (typeof value === 'number' && !Number.isNaN(value)) this.value = value;
    this._schedule();
  }

  destroy() {
    this._ro?.disconnect();
    cancelAnimationFrame(this._raf);
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.draw();
    });
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const start = Math.PI * 0.75; // 135° (lower-left)
    const end = Math.PI * 2.25; // +270° (lower-right); the gap sits at the bottom
    const span = end - start;
    const { r, lw, cx, cy } = gaugeMetrics(w, h);
    const frac = Math.max(0, Math.min(1, (this.value - this.min) / (this.max - this.min || 1)));

    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.trackColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();

    if (frac > 0) {
      ctx.strokeStyle = this.colorFor(this.value);
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + span * frac);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(r * 0.5)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(this.format(this.value), cx, cy);
  }
}

// helper: bytes/sec → short human string for chart y labels
export function humanRate(bytesPerSec) {
  const units = ['B/s', 'K', 'M', 'G'];
  let v = Math.max(0, bytesPerSec);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${i === 0 ? '' : units[i]}`;
}
