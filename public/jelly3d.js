import * as THREE from '/vendor/three.module.js';

/** Mounts the independently simulated soft-body cloud behind the storefront. */
export function createJellyScene(container) {
  if (!container) return () => {};

  const PHYSICS = Object.freeze({ mass: 1.15, stiffness: 38, damping: 8.2, intensity: 2.4, gravity: 5.5 });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(2.8, 2.55, 5.1);
  camera.lookAt(0, 0.55, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  const rearRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  for (const layerRenderer of [renderer, rearRenderer]) {
    layerRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    layerRenderer.setClearColor(0x000000, 0);
    layerRenderer.outputColorSpace = THREE.SRGBColorSpace;
    layerRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    layerRenderer.toneMappingExposure = 1.18;
  }
  renderer.domElement.className = 'jelly-three-canvas jelly-front-layer';
  rearRenderer.domElement.className = 'jelly-three-canvas jelly-rear-layer';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Foreground purple and yellow soft-body sculptures. Drag a shape to move it; scroll to grow the cloud.');
  rearRenderer.domElement.setAttribute('aria-hidden', 'true');
  container.classList.add('jelly-scene-host');
  container.prepend(renderer.domElement);
  container.prepend(rearRenderer.domElement);
  const hint = document.createElement('span');
  hint.className = 'jelly-hint';
  hint.textContent = 'DRAG A SHAPE · SCROLL TO GROW';
  container.append(hint);

  // Studio reflections give the soft forms their glossy, toy-like finish.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512; envCanvas.height = 256;
  const envCtx = envCanvas.getContext('2d');
  const sky = envCtx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#f4f5ff'); sky.addColorStop(.36, '#d5d8e7'); sky.addColorStop(.62, '#8790ad'); sky.addColorStop(1, '#343d68');
  envCtx.fillStyle = sky; envCtx.fillRect(0, 0, 512, 256);
  for (const [x, w, color] of [[36, 38, '#ffffff'], [152, 68, '#f5f2ff'], [318, 48, '#ffd84f'], [438, 30, '#ffffff']]) {
    envCtx.fillStyle = color; envCtx.globalAlpha = .78; envCtx.fillRect(x, 0, w, 180);
  }
  envCtx.globalAlpha = 1;
  const environment = new THREE.CanvasTexture(envCanvas);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.SRGBColorSpace;
  scene.environment = environment;

  const hemisphere = new THREE.HemisphereLight(0xe9ebff, 0x59617d, 2.2);
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.2); keyLight.position.set(-3, 5, 4);
  const blueLight = new THREE.PointLight(0x7584ff, 24, 9, 2); blueLight.position.set(2.4, 2.2, 1.4);
  const rimLight = new THREE.PointLight(0xffffff, 16, 8, 2); rimLight.position.set(-2, 2.4, -2.2);
  for (const light of [hemisphere, keyLight, blueLight, rimLight]) {
    light.layers.enable(1);
    scene.add(light);
  }

  const softBodies = [];
  const geometries = [];
  const materials = [];
  let nextPhase = .6;

  function makeSoftMaterial(color, roughness = .22) {
    const uniforms = {
      uTime: { value: 0 },
      uJiggle: { value: 0 },
      uImpactPoint: { value: new THREE.Vector3() },
      uDisplacement: { value: new THREE.Vector3() },
    };
    const material = new THREE.MeshPhysicalMaterial({
      color, roughness, metalness: .015, transmission: .08, thickness: .32,
      ior: 1.34, clearcoat: 1, clearcoatRoughness: .075, envMapIntensity: 1.6,
    });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uJiggle;\nuniform vec3 uImpactPoint;\nuniform vec3 uDisplacement;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float softDistance = distance(position, uImpactPoint);
          float impactWave = sin(uTime * 10.0 - softDistance * 13.0) * exp(-softDistance * 3.3);
          float cloudWave = sin(uTime * 2.1 + position.x * 2.0 + position.z * 1.7);
          transformed += objectNormal * (impactWave * uJiggle * 0.15 + cloudWave * uJiggle * 0.025);
          transformed += uDisplacement * (0.045 + exp(-softDistance * 2.4) * 0.14);`);
    };
    materials.push(material);
    return { material, uniforms };
  }

  function addBody({ color, position, scale = 1, mass = PHYSICS.mass, growth = .65, type = 'orb', size = .3, phase = nextPhase, layer = 0 }) {
    const root = new THREE.Group();
    root.layers.set(layer);
    root.position.set(...position);
    root.rotation.order = 'XYZ';
    root.scale.setScalar(scale);
    scene.add(root);
    const { material, uniforms } = makeSoftMaterial(color, type === 'orb' ? .17 : .23);
    const addMesh = (geometry, rotation = [0, 0, 0]) => {
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.layers.set(layer);
      mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      root.add(mesh);
    };

    if (type === 'cross') {
      const radius = size * .23;
      const length = size * .82;
      addMesh(new THREE.CapsuleGeometry(radius, length, 12, 36), [Math.PI / 2, 0, 0]);
      addMesh(new THREE.CapsuleGeometry(radius, length, 12, 36), [0, 0, Math.PI / 2]);
      addMesh(new THREE.SphereGeometry(radius * 1.28, 36, 32));
    } else {
      addMesh(new THREE.SphereGeometry(size, 44, 36));
    }

    const base = root.position.clone();
    const baseRotation = new THREE.Vector3(Math.sin(phase * 1.3) * .22, Math.cos(phase * .8) * .3, Math.sin(phase * .7) * .2);
    root.rotation.set(baseRotation.x, baseRotation.y, baseRotation.z);
    const body = {
      root, uniforms, material, base, target: base.clone(), velocity: new THREE.Vector3(),
      baseRotation, angularVelocity: new THREE.Vector3(),
      wobblePosition: new THREE.Vector3(), wobbleVelocity: new THREE.Vector3(),
      scale, growth, mass, phase, type, layer, dragging: false, floorY: -1.75,
    };
    softBodies.push(body);
    nextPhase += 1.71;
    return body;
  }

  // Each silhouette is its own scene object with its own position, drag target, and spring state.
  // Keep the foreground forms near the scale of the product imagery. This lets
  // them sit across a few glass cards as playful 3D accents without hiding the
  // collection controls or product labels as the cloud follows the scroll.
  // Keep a stable depth hierarchy: the two hero forms stay forward while the
  // smaller accents drift behind them. Their x/y positions remain distinct,
  // so the rear forms can still be reached and dragged independently.
  addBody({ color: 0x3045f5, position: [1.05, .82, .95], scale: .72, growth: .3, type: 'cross', size: 1.18, phase: .2, layer: 0 });
  addBody({ color: 0xf5bd22, position: [.55, 1.52, .58], scale: .41, growth: .2, type: 'cross', size: 1.12, phase: 1.4, layer: 0 });
  addBody({ color: 0xe7e9f5, position: [1.82, 1.03, -1.02], scale: .37, growth: .22, type: 'cross', size: 1.08, phase: 2.7, layer: 1 });
  addBody({ color: 0xf32455, position: [-.02, -.66, -.82], scale: .29, growth: .22, size: .55, phase: 3.8, layer: 1 });
  addBody({ color: 0xf32455, position: [2.12, -.52, -1.12], scale: .3, growth: .2, size: .58, phase: 5.2, layer: 1 });
  addBody({ color: 0xf5f1e9, position: [1.04, 1.62, -1.28], scale: .19, growth: .18, size: .54, phase: 6.4, layer: 1 });

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(1);
  const pointer = new THREE.Vector2();
  const clock = new THREE.Clock();
  const dragPoint = new THREE.Vector3();
  const dragOffset = new THREE.Vector3();
  const dragPlane = new THREE.Plane();
  const planeNormal = new THREE.Vector3();
  const hitLocal = new THREE.Vector3();
  const drag = { body: null, x: 0, y: 0, lastImpulse: 0 };
  let disposed = false;
  let animationFrame = 0;
  let width = 0;
  let height = 0;

  function resize() {
    width = window.innerWidth; height = window.innerHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    rearRenderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function setPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(softBodies.map(body => body.root), true)[0];
    if (!hit) return null;
    let node = hit.object;
    while (node && !softBodies.some(body => body.root === node)) node = node.parent;
    return node ? { body: softBodies.find(body => body.root === node), hit } : null;
  }

  function applyImpulse(body, hit, dx, dy, strength) {
    if (hit) {
      hitLocal.copy(hit.point);
      body.root.worldToLocal(hitLocal);
      body.uniforms.uImpactPoint.value.copy(hitLocal);
    }
    const impulse = new THREE.Vector3(dx, .3, -dy);
    if (impulse.lengthSq() < .0001) impulse.set(hitLocal.x, .5, hitLocal.z);
    impulse.normalize();
    body.wobbleVelocity.addScaledVector(impulse, PHYSICS.intensity * strength / PHYSICS.mass);
    body.velocity.addScaledVector(impulse, strength * .18 / body.mass);
    // Drag motion and off-center hits create torque on this object only.
    body.angularVelocity.x += (dy * 2.8 + hitLocal.z * .12) * strength;
    body.angularVelocity.y += (dx * 2.2 + hitLocal.x * .1) * strength;
    body.angularVelocity.z += ((dx - dy) * 2.1 + hitLocal.x * hitLocal.z * .08) * strength;
  }

  function onPointerMove(event) {
    if (drag.body) event.preventDefault();
    const dx = (event.clientX - drag.x) / Math.max(width, 1);
    const dy = (event.clientY - drag.y) / Math.max(height, 1);
    const result = setPointer(event);
    if (drag.body) {
      const point = raycaster.ray.intersectPlane(dragPlane, dragPoint);
      if (point) {
        point.project(camera);
        point.x = THREE.MathUtils.clamp(point.x, -.9, .9);
        point.y = THREE.MathUtils.clamp(point.y, -.88, .88);
        point.unproject(camera);
        drag.body.target.copy(point).add(dragOffset);
      }
      applyImpulse(drag.body, result?.hit, dx, dy, Math.min(1.4, .3 + Math.hypot(dx, dy) * 8));
    } else if (result && (Math.abs(dx) + Math.abs(dy) > .0015) && performance.now() - drag.lastImpulse > 100) {
      applyImpulse(result.body, result.hit, dx, dy, .13);
      drag.lastImpulse = performance.now();
    }
    drag.x = event.clientX; drag.y = event.clientY;
  }

  function isControl(target) { return Boolean(target?.closest?.('a,button,input,textarea,select,label,[role="button"]')); }
  function onPointerDown(event) {
    if (isControl(event.target)) return;
    const result = setPointer(event);
    if (!result) return;
    event.preventDefault();
    drag.body = result.body;
    drag.body.dragging = true;
    drag.x = event.clientX; drag.y = event.clientY;
    dragOffset.copy(drag.body.root.position).sub(result.hit.point);
    camera.getWorldDirection(planeNormal);
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, result.hit.point);
    document.body.classList.add('jelly-dragging');
    applyImpulse(drag.body, result.hit, .12, -.1, 1.35);
  }

  function onPointerUp() {
    if (drag.body) drag.body.dragging = false;
    drag.body = null;
    document.body.classList.remove('jelly-dragging');
  }

  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  function animate() {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), .033);
    const time = clock.elapsedTime;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);

    for (const body of softBodies) {
      const flow = scrollProgress * Math.PI * 1.35 + body.phase;
      const drift = new THREE.Vector3(
        body.base.x + Math.sin(flow) * (.2 + scrollProgress * .45) + Math.sin(time * .24 + body.phase) * .12,
        body.base.y + scrollProgress * .45 + Math.cos(flow * .8) * .18 + Math.sin(time * .42 + body.phase) * .1,
        body.base.z + Math.cos(flow) * .22,
      );
      const scaleTarget = body.scale * (1 + scrollProgress * body.growth);
      body.root.scale.lerp(new THREE.Vector3(scaleTarget, scaleTarget, scaleTarget), Math.min(1, dt * 3.2));

      const target = body.dragging ? body.target : drift;
      const acceleration = target.clone().sub(body.root.position).multiplyScalar(25 / body.mass)
        .addScaledVector(body.velocity, -7.4 / body.mass);
      acceleration.y -= PHYSICS.gravity * .45;
      body.velocity.addScaledVector(acceleration, dt);
      body.velocity.clampLength(0, 3.8);
      body.root.position.addScaledVector(body.velocity, dt);
      if (body.root.position.y < body.floorY) {
        body.root.position.y = body.floorY;
        if (body.velocity.y < -.12) body.velocity.y = -body.velocity.y * .28;
        else body.velocity.y = 0;
        body.velocity.x *= .8; body.velocity.z *= .8;
      }

      const wobbleAcceleration = body.wobbleVelocity.clone().multiplyScalar(-PHYSICS.damping / PHYSICS.mass)
        .addScaledVector(body.wobblePosition, -PHYSICS.stiffness / PHYSICS.mass);
      body.wobbleVelocity.addScaledVector(wobbleAcceleration, dt);
      body.wobblePosition.addScaledVector(body.wobbleVelocity, dt);
      body.wobblePosition.clampLength(0, .52);
      body.wobbleVelocity.clampLength(0, 4);
      body.uniforms.uTime.value = time;
      body.uniforms.uDisplacement.value.copy(body.wobblePosition);
      body.uniforms.uJiggle.value = Math.min(1.25, body.wobblePosition.length() * 1.8 + body.wobbleVelocity.length() * .08);
      const spinTarget = new THREE.Vector3(
        body.baseRotation.x + Math.sin(time * .38 + body.phase) * .36 + scrollProgress * .82,
        body.baseRotation.y + Math.cos(time * .31 + body.phase) * .42 + scrollProgress * 1.65,
        body.baseRotation.z + Math.sin(time * .47 + body.phase) * .32 - scrollProgress * .64,
      );
      const spinAcceleration = spinTarget.sub(new THREE.Vector3(body.root.rotation.x, body.root.rotation.y, body.root.rotation.z)).multiplyScalar(body.dragging ? 1.2 : 2.4)
        .addScaledVector(body.angularVelocity, -(body.dragging ? 1.15 : .72));
      body.angularVelocity.addScaledVector(spinAcceleration, dt);
      body.angularVelocity.clampLength(0, 2.2);
      body.root.rotation.x += body.angularVelocity.x * dt;
      body.root.rotation.y += body.angularVelocity.y * dt;
      body.root.rotation.z += body.angularVelocity.z * dt;
    }

    camera.layers.set(1);
    rearRenderer.render(scene, camera);
    camera.layers.set(0);
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  }
  animationFrame = requestAnimationFrame(animate);

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    window.removeEventListener('resize', resize);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    environment.dispose();
    renderer.dispose(); renderer.domElement.remove();
    rearRenderer.dispose(); rearRenderer.domElement.remove();
    hint.remove();
  };
}

