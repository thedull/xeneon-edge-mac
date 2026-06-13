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
    this.data = [];
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

  _niceMax(dataMax) {
    if (this.max != null) return this.max;
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
    const padR = 10;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);
    const x0 = padL;
    const y0 = padT;

    const dataMax = this.data.length ? Math.max(...this.data) : 0;
    const max = this._niceMax(dataMax);
    const min = this.min;
    const yOf = (v) => y0 + plotH - ((v - min) / (max - min || 1)) * plotH;
    const xOf = (i, n) => x0 + (n <= 1 ? plotW : (i / (n - 1)) * plotW);

    // horizontal gridlines + y labels
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

    // series
    const n = this.data.length;
    if (n > 0) {
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = xOf(i, n);
        const y = yOf(this.data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (this.fill) {
        const lastX = xOf(n - 1, n);
        ctx.lineTo(lastX, y0 + plotH);
        ctx.lineTo(x0, y0 + plotH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, y0, 0, y0 + plotH);
        grad.addColorStop(0, this._rgba(0.45));
        grad.addColorStop(1, this._rgba(0.02));
        ctx.fillStyle = grad;
        ctx.fill();
      }
      // redraw the line on top (fill may have closed the path)
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = xOf(i, n);
        const y = yOf(this.data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.stroke();
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
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText('time →', x0 + plotW, h - 4);
  }

  _rgba(alpha) {
    // accept #rrggbb
    const c = this.color.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
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
