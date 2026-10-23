import { describe, it, expect, vi, afterEach } from 'vitest';
import { toCsv } from './exportReport';
import { shiftDate, describePeriod, dayLabel, todayStr } from './dates';
import { resizeImageToDataUrl } from './image';

describe('toCsv', () => {
  const columns = [
    { header: 'Name', value: (r) => r.name },
    { header: 'Hours', value: (r) => r.hours },
  ];

  it('writes a header row and one line per row, starting with a byte-order mark for Excel', () => {
    const csv = toCsv(columns, [{ name: 'Ahmed', hours: 4.5 }, { name: 'Vivek', hours: 0 }]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv.slice(1)).toBe('Name,Hours\r\nAhmed,4.5\r\nVivek,0\r\n');
  });

  it('quotes values with commas, quotes or line breaks, and doubles quotes inside', () => {
    const csv = toCsv(columns, [{ name: 'Costa, Daniel', hours: 1 }, { name: 'The "boss"', hours: 2 }, { name: 'Two\nlines', hours: 3 }]);
    expect(csv).toContain('"Costa, Daniel",1');
    expect(csv).toContain('"The ""boss""",2');
    expect(csv).toContain('"Two\nlines",3');
  });

  it('writes empty cells for missing values and keeps accented names intact', () => {
    const csv = toCsv(columns, [{ name: null, hours: undefined }, { name: 'Zoë Müller', hours: 1 }]);
    expect(csv).toContain('\r\n,\r\n');
    expect(csv).toContain('Zoë Müller,1');
  });

  it('with no rows is just the header', () => {
    expect(toCsv(columns, []).slice(1)).toBe('Name,Hours\r\n');
  });
});

describe('dates', () => {
  it('moves by a day, a week or a month, in either direction', () => {
    expect(shiftDate('2026-10-07', 'day', 1)).toBe('2026-10-08');
    expect(shiftDate('2026-10-01', 'day', -1)).toBe('2026-09-30');
    expect(shiftDate('2026-10-07', 'week', -1)).toBe('2026-09-30');
    expect(shiftDate('2026-12-30', 'week', 1)).toBe('2027-01-06');
  });

  it('a month always lands on the 1st, so the 31st never skips a month', () => {
    expect(shiftDate('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(shiftDate('2026-03-31', 'month', -1)).toBe('2026-02-01');
    expect(shiftDate('2026-12-15', 'month', 1)).toBe('2027-01-01');
  });

  it('today is a plain local YYYY-MM-DD', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('describes each kind of period', () => {
    expect(describePeriod('month', '2026-10-01', '2026-10-31')).toMatch(/2026/);
    expect(describePeriod('week', '2026-10-05', '2026-10-11')).toMatch(/–/);
    expect(describePeriod('day', '2026-10-07', '2026-10-07')).toMatch(/2026/);
  });

  it('labels chart days: weekday for a week, the date number for a month', () => {
    expect(dayLabel('2026-10-07', 'month')).toBe('7');
    expect(dayLabel('2026-10-07', 'week')).toMatch(/7/);
    expect(dayLabel('2026-10-07', 'week').length).toBeGreaterThan(1);
  });
});

describe('resizeImageToDataUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses anything that is not a PNG, JPEG or WebP picture', async () => {
    await expect(resizeImageToDataUrl(new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(resizeImageToDataUrl(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(resizeImageToDataUrl(null)).rejects.toThrow(/PNG, JPEG or WebP/);
  });

  it('shrinks a large picture so its longest side is the maximum, and returns a JPEG', async () => {
    const drawn = {};
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (img, x, y, w, h) => { drawn.w = w; drawn.h = h; } }),
      toDataURL: (type, quality) => `data:${type};q=${quality}`,
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? fakeCanvas : realCreate(tag)));
    vi.stubGlobal('Image', class { set src(v) { this.width = 1024; this.height = 512; setTimeout(() => this.onload()); } });

    const result = await resizeImageToDataUrl(new File(['x'], 'big.png', { type: 'image/png' }), 256, 0.8);
    expect(result).toBe('data:image/jpeg;q=0.8');
    expect([fakeCanvas.width, fakeCanvas.height]).toEqual([256, 128]);
    expect(drawn).toEqual({ w: 256, h: 128 });
    vi.restoreAllMocks();
  });

  it('never enlarges a small picture', async () => {
    const fakeCanvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/jpeg;base64,x' };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? fakeCanvas : realCreate(tag)));
    vi.stubGlobal('Image', class { set src(v) { this.width = 100; this.height = 80; setTimeout(() => this.onload()); } });
    await resizeImageToDataUrl(new File(['x'], 'small.jpg', { type: 'image/jpeg' }));
    expect([fakeCanvas.width, fakeCanvas.height]).toEqual([100, 80]);
    vi.restoreAllMocks();
  });

  it('reports a picture that cannot be opened', async () => {
    vi.stubGlobal('Image', class { set src(v) { setTimeout(() => this.onerror()); } });
    await expect(resizeImageToDataUrl(new File(['x'], 'broken.png', { type: 'image/png' }))).rejects.toThrow(/could not be opened/);
  });
});
