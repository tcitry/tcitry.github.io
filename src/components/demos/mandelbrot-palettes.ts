export type Rgb = [number, number, number];

export type Palette = {
  id: string;
  name: string;
  /** Inigo Quilez cosine palette: a + b * cos(2π (c t + d)) */
  a: Rgb;
  b: Rgb;
  c: Rgb;
  d: Rgb;
  interior: Rgb;
  colorScale: number;
};

export const PALETTES: Palette[] = [
  {
    id: "coast",
    name: "海岸",
    a: [0.07, 0.1, 0.16],
    b: [0.72, 0.55, 0.34],
    c: [0.55, 0.38, 0.22],
    d: [0.12, 0.28, 0.48],
    interior: [0.012, 0.012, 0.016],
    colorScale: 0.038,
  },
  {
    id: "ink",
    name: "墨海",
    a: [0.1, 0.12, 0.2],
    b: [0.42, 0.5, 0.62],
    c: [1.0, 0.75, 0.45],
    d: [0.0, 0.18, 0.42],
    interior: [0.008, 0.01, 0.02],
    colorScale: 0.042,
  },
  {
    id: "glacier",
    name: "冰川",
    a: [0.04, 0.14, 0.22],
    b: [0.28, 0.52, 0.62],
    c: [0.95, 0.85, 0.55],
    d: [0.15, 0.28, 0.5],
    interior: [0.004, 0.012, 0.03],
    colorScale: 0.04,
  },
  {
    id: "ember",
    name: "余烬",
    a: [0.2, 0.07, 0.03],
    b: [0.68, 0.32, 0.1],
    c: [0.9, 0.55, 0.3],
    d: [0.08, 0.22, 0.38],
    interior: [0.018, 0.008, 0.006],
    colorScale: 0.036,
  },
  {
    id: "silver",
    name: "银盐",
    a: [0.32, 0.33, 0.34],
    b: [0.42, 0.4, 0.36],
    c: [1.0, 1.0, 0.95],
    d: [0.0, 0.06, 0.12],
    interior: [0.02, 0.02, 0.022],
    colorScale: 0.048,
  },
];

export const DEFAULT_PALETTE_ID = PALETTES[0]!.id;

export function getPalette(id: string) {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}

export function nextPaletteId(id: string) {
  const i = PALETTES.findIndex((p) => p.id === id);
  return PALETTES[(i + 1) % PALETTES.length]!.id;
}

function rgbCss([r, g, b]: Rgb) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Sample the cosine palette into a CSS linear-gradient for swatches. */
export function paletteGradient(palette: Palette, stops = 8) {
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = (i / (stops - 1)) * 6 * palette.colorScale * 40;
    const col: Rgb = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      col[k] = clamp01(
        palette.a[k]! +
          palette.b[k]! *
            Math.cos(Math.PI * 2 * (palette.c[k]! * t + palette.d[k]!)),
      );
    }
    parts.push(rgbCss(col));
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}
