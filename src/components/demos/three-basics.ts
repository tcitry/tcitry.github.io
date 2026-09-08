import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type SceneState = {
  geometry: 'cube' | 'sphere' | 'torus';
  material: string;
  light: number;
  wireframe: boolean;
  rotation: boolean;
};

export const initialSceneState: SceneState = {
  geometry: 'cube', material: '#257f81', light: 2.4, wireframe: false, rotation: false,
};

export interface SceneController {
  update(state: SceneState): void;
  reset(): void;
  dispose(): void;
}

/** Owns only the scene and canvas; React owns the controls and their state. */
export function createThreeBasicsScene(
  host: HTMLElement,
  onStatus: (status: 'ready' | 'error', message?: string) => void,
): SceneController {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', '可交互的 3D 场景');
  canvas.setAttribute('aria-describedby', 'three-camera-help');
  canvas.tabIndex = 0;
  host.append(canvas);
  const abort = new AbortController();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    onStatus('error', '当前浏览器无法创建 WebGL 2 场景。请尝试启用图形加速或换一个浏览器；你仍可阅读概念说明和入门文章。');
    return { update() {}, reset() {}, dispose() { canvas.remove(); } };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8eee3');
  scene.fog = new THREE.Fog('#e8eee3', 8, 18);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
  camera.position.set(4, 2.8, 5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 3.8;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  controls.saveState();

  const geometries: Record<string, THREE.BufferGeometry> = {
    cube: new THREE.BoxGeometry(1.65, 1.65, 1.65),
    sphere: new THREE.SphereGeometry(1.1, 32, 24),
    torus: new THREE.TorusGeometry(0.82, 0.3, 20, 48),
  };
  const material = new THREE.MeshStandardMaterial({ color: '#257f81', roughness: 0.43, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometries.cube, material);
  const grid = new THREE.GridHelper(18, 36, '#abbba3', '#cdd8c5');
  grid.position.y = -1.15;
  scene.add(mesh, grid);
  const ambient = new THREE.HemisphereLight(0xffffff, 0x738063, 1.5);
  const key = new THREE.DirectionalLight(0xfff7e9, 3.36);
  key.position.set(3, 5, 4);
  scene.add(ambient, key);

  let state = { ...initialSceneState };
  let frame = 0;
  let visible = true;
  let disposed = false;
  let failed = false;
  let previousTime = 0;
  const cancelFrame = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  };
  const invalidate = () => {
    if (!disposed && !failed && visible && !document.hidden && !frame) frame = requestAnimationFrame(render);
  };
  function render(time: number) {
    frame = 0;
    if (disposed || failed || !visible || document.hidden) return;
    if (state.rotation && previousTime) mesh.rotation.y += Math.min((time - previousTime) / 1000, 0.05) * 0.45;
    previousTime = time;
    controls.update();
    renderer.render(scene, camera);
    if (state.rotation) invalidate();
  }
  controls.addEventListener('change', invalidate);

  const update = (next: SceneState) => {
    if (disposed || failed) return;
    if (state.rotation !== next.rotation) previousTime = 0;
    state = { ...next };
    mesh.geometry = geometries[state.geometry];
    mesh.geometry.computeBoundingBox();
    mesh.position.y = -1.15 - mesh.geometry.boundingBox!.min.y;
    material.color.set(state.material);
    material.wireframe = state.wireframe;
    ambient.intensity = state.light * 0.625;
    key.intensity = state.light * 1.4;
    invalidate();
  };
  const reset = () => {
    if (disposed || failed) return;
    mesh.rotation.set(0, 0, 0);
    // Drain residual camera damping before restoring the saved camera position.
    controls.enableDamping = false;
    controls.update();
    controls.reset();
    controls.enableDamping = true;
    previousTime = 0;
    update(initialSceneState);
  };

  canvas.addEventListener('keydown', event => {
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    switch (event.key) {
      case 'ArrowLeft': spherical.theta -= 0.12; break;
      case 'ArrowRight': spherical.theta += 0.12; break;
      case 'ArrowUp': spherical.phi = Math.max(0.1, spherical.phi - 0.12); break;
      case 'ArrowDown': spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + 0.12); break;
      case '+': case '=': spherical.radius = Math.max(controls.minDistance, spherical.radius / 1.1); break;
      case '-': spherical.radius = Math.min(controls.maxDistance, spherical.radius * 1.1); break;
      default: return;
    }
    event.preventDefault();
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update();
    invalidate();
  }, { signal: abort.signal });

  const resize = new ResizeObserver(() => {
    if (disposed || failed) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(host);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible) invalidate(); else cancelFrame();
  });
  intersection.observe(host);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelFrame(); else invalidate();
  }, { signal: abort.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    failed = true;
    cancelFrame();
    onStatus('error', 'WebGL 图形上下文已中断，暂时无法显示 3D。请重新加载页面；你仍可阅读概念说明和入门文章。');
  }, { signal: abort.signal });

  update(initialSceneState);
  onStatus('ready');

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    abort.abort();
    resize.disconnect();
    intersection.disconnect();
    controls.removeEventListener('change', invalidate);
    controls.dispose();
    Object.values(geometries).forEach(geometry => geometry.dispose());
    material.dispose();
    grid.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  return { update, reset, dispose };
}
