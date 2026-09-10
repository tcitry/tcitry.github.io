import { DEFAULT_IM, DEFAULT_RE, DEFAULT_SCALE, iterForScale } from "./mandelbrot-math";

export type Preset = {
  id: string;
  name: string;
  hint: string;
  re: number;
  im: number;
  scale: number;
  iter: number;
};

export const PRESETS: Preset[] = [
  {
    id: "overview",
    name: "全景",
    hint: "心脏线与主圆盘",
    re: DEFAULT_RE,
    im: DEFAULT_IM,
    scale: DEFAULT_SCALE,
    iter: 180,
  },
  {
    id: "seahorse",
    name: "海马谷",
    hint: "主圆盘衔接处的螺旋海马",
    re: -0.743643887037151,
    im: 0.13182590420533,
    scale: 0.0036,
    iter: 480,
  },
  {
    id: "elephant",
    name: "象谷",
    hint: "周期 2 圆盘颈部",
    re: 0.270925,
    im: -0.004927,
    scale: 0.00115,
    iter: 520,
  },
  {
    id: "spiral",
    name: "螺旋",
    hint: "双臂对数螺旋",
    re: -0.761574,
    im: -0.0847596,
    scale: 0.00085,
    iter: 560,
  },
  {
    id: "mini",
    name: "迷你",
    hint: "主刺上的微型曼德勃罗",
    re: -1.768778833,
    im: -0.001738913,
    scale: 0.00009,
    iter: 760,
  },
  {
    id: "starfish",
    name: "星鱼",
    hint: "周期 3 圆盘的放射触须",
    re: -0.154,
    im: 1.031,
    scale: 0.018,
    iter: 360,
  },
  {
    id: "tendril",
    name: "触须",
    hint: "北侧圆盘边缘细丝",
    re: -0.235125,
    im: 0.827215,
    scale: 0.0052,
    iter: 420,
  },
  {
    id: "needle",
    name: "针尖",
    hint: "指向 −2 的细长主刺",
    re: -1.985,
    im: 0,
    scale: 0.028,
    iter: 280,
  },
];

export function presetIter(preset: Preset, autoIter: boolean) {
  return autoIter ? Math.max(preset.iter, iterForScale(preset.scale)) : preset.iter;
}
