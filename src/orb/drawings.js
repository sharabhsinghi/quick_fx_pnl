// Trendline / horizontal-ray / Fibonacci-retracement drawing tools, built as a
// lightweight-charts series primitive (its plugin API) rather than pulling in
// a third-party drawing-tools package — these three tools are all we need.
//
// One DrawingsPrimitive instance is attached to the candlestick series and
// renders every committed drawing plus (optionally) one live preview while a
// shape is still being placed. ChartReplay.js owns the click/crosshair
// handling and the committed-drawings list; this file only knows how to draw.

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const FONT = '10px "IBM Plex Mono", monospace';
const ENDPOINT_HIT_R = 8;
const LINE_HIT_R = 6;

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Is media-space point `pt` on top of drawing `d` (within a few px)? Used both
// to start a drag (mousedown) and to show a grab cursor on hover. Returns
// `{ part: 'p1' | 'p2' | 'body' }` or null. Endpoints win over the body so a
// handle near the line itself still grabs the handle, not the whole shape.
export function hitTestDrawing(timeScale, series, pt, d) {
  const x1 = timeScale.timeToCoordinate(d.t1);
  const y1 = series.priceToCoordinate(d.p1);
  if (x1 === null || y1 === null) return null;

  if (Math.hypot(pt.x - x1, pt.y - y1) <= ENDPOINT_HIT_R) return { part: 'p1' };

  if (d.tool === 'ray') {
    if (pt.x >= x1 - LINE_HIT_R && Math.abs(pt.y - y1) <= LINE_HIT_R) return { part: 'body' };
    return null;
  }

  const x2 = timeScale.timeToCoordinate(d.t2);
  const y2 = series.priceToCoordinate(d.p2);
  if (x2 === null || y2 === null) return null;
  if (Math.hypot(pt.x - x2, pt.y - y2) <= ENDPOINT_HIT_R) return { part: 'p2' };

  if (d.tool === 'trend') {
    return distToSegment(pt.x, pt.y, x1, y1, x2, y2) <= LINE_HIT_R ? { part: 'body' } : null;
  }

  // fib: hit any level line spanning the anchors, or the faint diagonal
  const xLo = Math.min(x1, x2), xHi = Math.max(x1, x2);
  const onLevel = FIB_LEVELS.some((r) => {
    const y = series.priceToCoordinate(d.p1 + (d.p2 - d.p1) * r);
    return y !== null && pt.x >= xLo - LINE_HIT_R && pt.x <= xHi + LINE_HIT_R && Math.abs(pt.y - y) <= LINE_HIT_R;
  });
  if (onLevel) return { part: 'body' };
  return distToSegment(pt.x, pt.y, x1, y1, x2, y2) <= LINE_HIT_R ? { part: 'body' } : null;
}

export class DrawingsPrimitive {
  constructor(colors) {
    this._colors = colors; // { trend, ray, fib }
    this._drawings = [];
    this._preview = null;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  attached(param) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  setDrawings(drawings) {
    this._drawings = drawings || [];
    this._requestUpdate && this._requestUpdate();
  }

  setPreview(preview) {
    this._preview = preview;
    this._requestUpdate && this._requestUpdate();
  }

  paneViews() {
    return [{ renderer: () => ({ draw: (target) => this._draw(target) }) }];
  }

  _draw(target) {
    if (!this._chart || !this._series) return;
    const ts = this._chart.timeScale();
    const series = this._series;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const all = this._preview ? [...this._drawings, this._preview] : this._drawings;
      all.forEach(d => this._drawOne(ctx, ts, series, mediaSize, d));
    });
  }

  _drawOne(ctx, ts, series, mediaSize, d) {
    const x1 = ts.timeToCoordinate(d.t1);
    const y1 = series.priceToCoordinate(d.p1);
    if (x1 === null || y1 === null) return;
    const color = this._colors[d.tool] || this._colors.trend;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    if (d.preview) ctx.setLineDash([4, 3]);

    if (d.tool === 'ray') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(mediaSize.width, y1);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const x2 = ts.timeToCoordinate(d.t2);
    const y2 = series.priceToCoordinate(d.p2);
    if (x2 === null || y2 === null) { ctx.restore(); return; }

    if (d.tool === 'trend') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Fibonacci retracement: a level line per ratio between the two anchors,
    // spanning the anchors' time range, labelled with ratio + price. The
    // connecting diagonal is drawn faint, same as TradingView's default.
    const xLo = Math.min(x1, x2), xHi = Math.max(x1, x2);
    ctx.setLineDash(d.preview ? [4, 3] : []);
    FIB_LEVELS.forEach((r) => {
      const price = d.p1 + (d.p2 - d.p1) * r;
      const y = series.priceToCoordinate(price);
      if (y === null) return;
      ctx.beginPath();
      ctx.moveTo(xLo, y);
      ctx.lineTo(xHi, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${(r * 100).toFixed(1)}% ${price.toFixed(2)}`, xHi + 4, y);
    });
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}
