import { G, type Body, type ScenarioId } from "./orbit-types";

export type ScenarioDef = {
  id: ScenarioId;
  label: string;
  hint: string;
  viewRadius: number;
};

export const SCENARIOS: readonly ScenarioDef[] = [
  { id: "garden", label: "星系", hint: "恒星锚定，行星与卫星沿轨道运行", viewRadius: 520 },
  { id: "binary", label: "双星", hint: "两颗恒星互绕，外侧行星受扰动", viewRadius: 480 },
  { id: "figure8", label: "八字", hint: "等质量三体的近似八字编舞", viewRadius: 280 },
  { id: "slingshot", label: "弹弓", hint: "观察天体掠过巨星时的轨迹与速度变化", viewRadius: 560 },
  { id: "empty", label: "空白", hint: "轻点放置，拖拽抛出", viewRadius: 420 },
];

function circularSpeed(attractorMass: number, radius: number): number {
  return Math.sqrt((G * attractorMass) / Math.max(radius, 1));
}

export function populateScenario(
  id: ScenarioId,
  spawn: (x: number, y: number, vx: number, vy: number, mass: number, kind?: Body["kind"], pinned?: boolean) => Body,
): number {
  switch (id) {
    case "garden": {
      spawn(0, 0, 0, 0, 2200, "star", true);
      const v1 = circularSpeed(2200, 190);
      spawn(190, 0, 0, v1, 52, "planet");
      spawn(208, 0, 0, v1 + circularSpeed(52, 18), 8, "moon");
      const v2 = circularSpeed(2200, 318);
      spawn(0, 318, -v2, 0, 78, "planet");
      const v3 = circularSpeed(2200, 460);
      spawn(-460, 40, 0, -v3 * 0.97, 36, "planet");
      return 520;
    }
    case "binary": {
      const m = 920;
      const sep = 220;
      const v = 0.5 * circularSpeed(m * 2, sep);
      spawn(-sep / 2, 0, 0, -v, m, "star");
      spawn(sep / 2, 0, 0, v, m, "star");
      const vP = circularSpeed(m * 2, 360);
      spawn(0, 360, -vP, 0, 48, "planet");
      spawn(40, -420, 70, 90, 12, "moon");
      return 480;
    }
    case "figure8": {
      const S = 125;
      const M = 95;
      const vs = Math.sqrt((G * M) / S);
      const p1x = -0.97000436 * S;
      const p1y = 0.24308753 * S;
      const v1x = 0.466203685 * vs;
      const v1y = 0.43236573 * vs;
      const a = spawn(p1x, p1y, v1x, v1y, M, "planet");
      const b = spawn(-p1x, -p1y, v1x, v1y, M, "planet");
      const c = spawn(0, 0, -2 * v1x, -2 * v1y, M, "planet");
      a.r = 122;
      a.g = 176;
      a.b = 188;
      b.r = 210;
      b.g = 196;
      b.b = 168;
      c.r = 198;
      c.g = 206;
      c.b = 214;
      return 280;
    }
    case "slingshot": {
      spawn(0, 0, 0, 0, 2200, "star", true);
      const rj = 300;
      const vj = circularSpeed(2200, rj);
      spawn(rj, 0, 0, vj, 260, "giant");
      spawn(250, -110, 48, 210, 7, "moon");
      spawn(-520, 220, 130, -28, 6, "dust");
      return 560;
    }
    case "empty":
    default:
      return 420;
  }
}
