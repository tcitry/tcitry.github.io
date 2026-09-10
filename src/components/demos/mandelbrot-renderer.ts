import type { Palette } from "./mandelbrot-palettes";
import { FS_WEBGL1, FS_WEBGL2, VS_WEBGL1, VS_WEBGL2 } from "./mandelbrot-shaders";

export type RenderView = {
  re: number;
  im: number;
  scale: number;
  maxIter: number;
  palette: Palette;
};

const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建着色器");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建程序");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

export class MandelbrotRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject | null = null;
  private loc = {
    resolution: null as WebGLUniformLocation | null,
    center: null as WebGLUniformLocation | null,
    scale: null as WebGLUniformLocation | null,
    maxIter: null as WebGLUniformLocation | null,
    a: null as WebGLUniformLocation | null,
    b: null as WebGLUniformLocation | null,
    c: null as WebGLUniformLocation | null,
    d: null as WebGLUniformLocation | null,
    interior: null as WebGLUniformLocation | null,
    colorScale: null as WebGLUniformLocation | null,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl2 = canvas.getContext("webgl2", CONTEXT_OPTIONS);
    const gl =
      gl2 ??
      canvas.getContext("webgl", CONTEXT_OPTIONS) ??
      canvas.getContext("experimental-webgl", CONTEXT_OPTIONS);
    if (!gl) {
      throw new Error("当前浏览器不支持 WebGL，无法渲染分形。");
    }
    this.gl = gl as WebGLRenderingContext;
    const is2 = gl2 !== null;
    this.program = link(
      this.gl,
      is2 ? VS_WEBGL2 : VS_WEBGL1,
      is2 ? FS_WEBGL2 : FS_WEBGL1,
    );

    if (is2) {
      const vao = gl2.createVertexArray();
      if (vao) {
        gl2.bindVertexArray(vao);
        this.vao = vao;
      }
    }

    const buf = this.gl.createBuffer();
    if (!buf) throw new Error("无法创建缓冲");
    this.buffer = buf;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, TRIANGLE, this.gl.STATIC_DRAW);

    this.gl.useProgram(this.program);
    const aPos = this.gl.getAttribLocation(this.program, "aPos");
    this.gl.enableVertexAttribArray(aPos);
    this.gl.vertexAttribPointer(aPos, 2, this.gl.FLOAT, false, 0, 0);

    const u = (name: string) => this.gl.getUniformLocation(this.program, name);
    this.loc.resolution = u("uResolution");
    this.loc.center = u("uCenter");
    this.loc.scale = u("uScale");
    this.loc.maxIter = u("uMaxIter");
    this.loc.a = u("uPaletteA");
    this.loc.b = u("uPaletteB");
    this.loc.c = u("uPaletteC");
    this.loc.d = u("uPaletteD");
    this.loc.interior = u("uInterior");
    this.loc.colorScale = u("uColorScale");

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.BLEND);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  render(view: RenderView) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.useProgram(this.program);
    if (this.vao) {
      (gl as WebGL2RenderingContext).bindVertexArray(this.vao);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    }
    gl.uniform2f(this.loc.resolution, width, height);
    gl.uniform2f(this.loc.center, view.re, view.im);
    gl.uniform1f(this.loc.scale, view.scale);
    gl.uniform1f(this.loc.maxIter, view.maxIter);
    const p = view.palette;
    gl.uniform3f(this.loc.a, p.a[0], p.a[1], p.a[2]);
    gl.uniform3f(this.loc.b, p.b[0], p.b[1], p.b[2]);
    gl.uniform3f(this.loc.c, p.c[0], p.c[1], p.c[2]);
    gl.uniform3f(this.loc.d, p.d[0], p.d[1], p.d[2]);
    gl.uniform3f(this.loc.interior, p.interior[0], p.interior[1], p.interior[2]);
    gl.uniform1f(this.loc.colorScale, p.colorScale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    if (this.vao) {
      (gl as WebGL2RenderingContext).deleteVertexArray(this.vao);
    }
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}

export function screenToWorld(
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  re: number,
  im: number,
  scale: number,
) {
  const minDim = Math.min(cssW, cssH);
  const uvx = (cssX - cssW * 0.5) / minDim;
  const uvy = (cssH * 0.5 - cssY) / minDim;
  return { re: re + uvx * scale, im: im + uvy * scale };
}

export function panByPixels(
  dx: number,
  dy: number,
  cssW: number,
  cssH: number,
  scale: number,
) {
  const minDim = Math.min(cssW, cssH);
  return {
    dre: (-dx / minDim) * scale,
    dim: (dy / minDim) * scale,
  };
}
