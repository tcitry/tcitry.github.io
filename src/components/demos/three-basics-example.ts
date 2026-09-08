import type {SceneState} from './three-basics';

/** A complete standalone scene, initialized from the demo's current controls. */
export function threeBasicsExample(state: SceneState): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Three.js 基础场景</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    p { position: fixed; bottom: 12px; left: 16px; font: 14px system-ui; }
  </style>
  <!-- 固定到与演示相同的 Three.js 版本；需要网络访问 CDN。 -->
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"
      }
    }
  </script>
</head>
<body>
  <canvas aria-label="可交互的 3D 场景"></canvas>
  <p>拖动查看 · 滚轮 / 双指缩放</p>
  <noscript>此示例需要启用 JavaScript。</noscript>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const canvas = document.querySelector('canvas');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (error) {
      document.querySelector('p').textContent = '无法创建 WebGL 2 场景，请检查浏览器图形加速。';
      throw error;
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

    const geometries = {
      cube: new THREE.BoxGeometry(1.65, 1.65, 1.65),
      sphere: new THREE.SphereGeometry(1.1, 32, 24),
      torus: new THREE.TorusGeometry(0.82, 0.3, 20, 48),
    };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.43, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometries.cube, material);
    // 以下值来自上方控件；改变控件后重新复制即可取得新的初始设置。
    mesh.geometry = geometries.${state.geometry};
    material.color.set('${state.material}');
    material.wireframe = ${state.wireframe};
    const rotation = ${state.rotation};
    mesh.geometry.computeBoundingBox();
    mesh.position.y = -1.15 - mesh.geometry.boundingBox.min.y;

    const grid = new THREE.GridHelper(18, 36, '#abbba3', '#cdd8c5');
    grid.position.y = -1.15;
    const ambient = new THREE.HemisphereLight(0xffffff, 0x738063);
    const key = new THREE.DirectionalLight(0xfff7e9);
    ambient.intensity = ${state.light.toFixed(1)} * 0.625;
    key.intensity = ${state.light.toFixed(1)} * 1.4;
    key.position.set(3, 5, 4);
    scene.add(mesh, grid, ambient, key);

    function resize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // 按实际经过的时间旋转，让不同刷新率下的转速一致。
    let previousTime;
    renderer.setAnimationLoop((time) => {
      const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      if (rotation) mesh.rotation.y += delta * 0.45;
      controls.update();
      renderer.render(scene, camera);
    });
  </script>
</body>
</html>`;
}
