import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type ReactorMode =
  | 'standby'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'automating'
  | 'researching'
  | 'visuals'
  | 'media'
  | 'laptop'
  | 'memory'
  | 'plugin';

export type ReactorCommandKind =
  | 'research'
  | 'visuals'
  | 'automation'
  | 'youtube'
  | 'laptop'
  | 'memory'
  | 'plugin'
  | 'command';

export interface ReactorCommandCue {
  id: number;
  kind: ReactorCommandKind;
  label: string;
  active: boolean;
  outcome?: 'ok' | 'error';
}

interface ArcReactorSceneProps {
  mode: ReactorMode;
  commandCue?: ReactorCommandCue | null;
  stageOverlayOpen: boolean;
  brightness?: number;
  inputLevelRef: React.MutableRefObject<number>;
  outputLevelRef: React.MutableRefObject<number>;
  onCoreClick: () => void;
}

// Pre-allocated math helpers outside render loop (zero GC pressure)
const _dummyObj = new THREE.Object3D();
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3(0, 0, 0);
const _pointerNdc = new THREE.Vector2();
const _emissiveStandby = new THREE.Color(0x0ea5e9);
const _emissiveListening = new THREE.Color(0x38bdf8);
const _emissiveSpeaking = new THREE.Color(0x7dd3fc);
const _emissiveAutomating = new THREE.Color(0xf59e0b);
const _emissiveResearching = new THREE.Color(0x818cf8);
const _emissiveMedia = new THREE.Color(0xf43f5e);
const _emissiveLaptop = new THREE.Color(0x10b981);
const _emissiveMemory = new THREE.Color(0xfbbf24);
const _emissivePlugin = new THREE.Color(0x2dd4bf);
const _emissiveVisuals = new THREE.Color(0xc084fc);
const _emissiveError = new THREE.Color(0xf43f5e);
const _curColor = new THREE.Color(0x0ea5e9);
const _pulseColor = new THREE.Color(0x38bdf8);

function resolveCommandColor(kind: ReactorCommandKind): THREE.Color {
  switch (kind) {
    case 'research':
      return _emissiveResearching;
    case 'visuals':
      return _emissiveVisuals;
    case 'automation':
      return _emissiveAutomating;
    case 'youtube':
      return _emissiveMedia;
    case 'laptop':
      return _emissiveLaptop;
    case 'memory':
      return _emissiveMemory;
    case 'plugin':
      return _emissivePlugin;
    default:
      return _emissiveListening;
  }
}

export const ArcReactorScene: React.FC<ArcReactorSceneProps> = ({
  mode,
  commandCue = null,
  stageOverlayOpen,
  brightness = 1,
  inputLevelRef,
  outputLevelRef,
  onCoreClick,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<ReactorMode>(mode);
  const cueRef = useRef<ReactorCommandCue | null>(commandCue);
  const overlayOpenRef = useRef<boolean>(stageOverlayOpen);
  const brightnessRef = useRef<number>(THREE.MathUtils.clamp(brightness, 0.15, 2.0));
  const onCoreClickRef = useRef(onCoreClick);
  const [webglLost, setWebglLost] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    cueRef.current = commandCue;
  }, [commandCue]);

  useEffect(() => {
    overlayOpenRef.current = stageOverlayOpen;
  }, [stageOverlayOpen]);

  useEffect(() => {
    brightnessRef.current = THREE.MathUtils.clamp(brightness, 0.15, 2.0);
  }, [brightness]);

  useEffect(() => {
    onCoreClickRef.current = onCoreClick;
  }, [onCoreClick]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Detect software WebGL once per mount via renderer string
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param) || '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06090f);
    scene.fog = new THREE.FogExp2(0x06090f, 0.045);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.35, 6.4);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Procedural studio reflection map via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // Postprocessing bloom (GPU only; software WebGL skips multi-pass bloom)
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.36,
        0.38,
        0.82
      );
      composer.addPass(bloomPass);
    }

    // OrbitControls with smooth damping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 4.0;
    controls.maxDistance = 10.5;
    controls.maxPolarAngle = Math.PI * 0.72;
    controls.minPolarAngle = Math.PI * 0.28;

    let userInteracting = false;
    controls.addEventListener('start', () => {
      userInteracting = true;
    });
    controls.addEventListener('end', () => {
      userInteracting = false;
    });

    // Three-point studio lighting + dynamic core point light
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(4.5, 5.5, 5.0);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.5);
    rimLight.position.set(-4.5, -2.0, -4.0);
    scene.add(rimLight);

    const coreLight = new THREE.PointLight(0x38bdf8, 3.2, 12, 1.8);
    coreLight.position.set(0, 0, 0.8);
    scene.add(coreLight);

    // --- Procedural Arc Reactor 12-Part Composite Assembly ---
    const reactorRoot = new THREE.Group();
    scene.add(reactorRoot);

    const disposables: Array<{ dispose: () => void }> = [envTexture];

    // Materials (varied roughness & metalness >= 0.25 separation)
    const titaniumMat = new THREE.MeshPhysicalMaterial({
      color: 0x2b3444,
      metalness: 0.92,
      roughness: 0.24,
      anisotropy: 0.75,
      clearcoat: 0.25,
    });
    const darkAnodizedMat = new THREE.MeshStandardMaterial({
      color: 0x111722,
      metalness: 0.68,
      roughness: 0.56,
    });
    const copperCoilMat = new THREE.MeshStandardMaterial({
      color: 0xc27849,
      metalness: 0.88,
      roughness: 0.28,
    });
    const plasmaMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 2.2,
      roughness: 0.15,
      metalness: 0.1,
    });
    const sapphireGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.86,
      transparent: true,
      opacity: isSoftwareGl ? 0.28 : 1.0,
      ior: 1.76,
      thickness: 0.6,
      clearcoat: 1.0,
      depthWrite: false,
    });
    const commandTelemetryMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 2.8,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(
      titaniumMat,
      darkAnodizedMat,
      copperCoilMat,
      plasmaMat,
      sapphireGlassMat,
      commandTelemetryMat,
      pulseRingMat
    );

    // 1. Outer Chassis Ring (Layer Z = -0.18)
    const outerHousingGeo = new THREE.TorusGeometry(1.78, 0.14, 24, 96);
    const outerHousing = new THREE.Mesh(outerHousingGeo, darkAnodizedMat);
    outerHousing.position.z = -0.18;
    reactorRoot.add(outerHousing);
    disposables.push(outerHousingGeo);

    // 2. Machined Titanium Bezel (Layer Z = 0.0)
    const bezelShape = new THREE.Shape();
    bezelShape.absarc(0, 0, 1.66, 0, Math.PI * 2, false);
    const bezelHole = new THREE.Path();
    bezelHole.absarc(0, 0, 1.32, 0, Math.PI * 2, true);
    bezelShape.holes.push(bezelHole);
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 3,
      curveSegments: 72,
    });
    bezelGeo.center();
    const bezelMesh = new THREE.Mesh(bezelGeo, titaniumMat);
    reactorRoot.add(bezelMesh);
    disposables.push(bezelGeo);

    // 3. Plasma Toroid Core (Layer Z = 0.05)
    const plasmaRingGeo = new THREE.TorusGeometry(1.12, 0.11, 24, 84);
    const plasmaRing = new THREE.Mesh(plasmaRingGeo, plasmaMat);
    plasmaRing.position.z = 0.05;
    reactorRoot.add(plasmaRing);
    disposables.push(plasmaRingGeo);

    // 4. 10 Copper Induction Coils wound around Plasma Ring (InstancedMesh)
    const coilCount = 10;
    const coilGeo = new THREE.TorusGeometry(0.17, 0.042, 16, 28);
    const coilInstanced = new THREE.InstancedMesh(coilGeo, copperCoilMat, coilCount);
    for (let i = 0; i < coilCount; i++) {
      const theta = (i / coilCount) * Math.PI * 2;
      _dummyObj.position.set(Math.cos(theta) * 1.12, Math.sin(theta) * 1.12, 0.05);
      _dummyObj.rotation.set(0, 0, theta);
      _dummyObj.rotateX(Math.PI / 2);
      _dummyObj.scale.set(1, 1, 1);
      _dummyObj.updateMatrix();
      coilInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    coilInstanced.instanceMatrix.needsUpdate = true;
    coilInstanced.computeBoundingSphere();
    reactorRoot.add(coilInstanced);
    disposables.push(coilGeo);

    // 5. Gyroscopic Inner Containment Ring A (rotates smoothly)
    const gyroGroupA = new THREE.Group();
    const gyroArcGeo = new THREE.TorusGeometry(0.84, 0.032, 14, 48, Math.PI * 0.42);
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(gyroArcGeo, titaniumMat);
      seg.rotation.z = (i * Math.PI * 2) / 3;
      gyroGroupA.add(seg);
    }
    gyroGroupA.position.z = 0.16;
    reactorRoot.add(gyroGroupA);
    disposables.push(gyroArcGeo);

    // 6. Gyroscopic Inner Containment Ring B (counter-rotates)
    const gyroGroupB = new THREE.Group();
    const gyroInnerGeo = new THREE.TorusGeometry(0.64, 0.025, 12, 40, Math.PI * 0.65);
    for (let i = 0; i < 2; i++) {
      const seg = new THREE.Mesh(gyroInnerGeo, copperCoilMat);
      seg.rotation.z = i * Math.PI;
      gyroGroupB.add(seg);
    }
    gyroGroupB.position.z = 0.24;
    reactorRoot.add(gyroGroupB);
    disposables.push(gyroInnerGeo);

    // 7. Triangular Palladium Core Aperture
    const triShape = new THREE.Shape();
    const triR = 0.5;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
      const x = Math.cos(a) * triR;
      const y = Math.sin(a) * triR;
      if (i === 0) triShape.moveTo(x, y);
      else triShape.lineTo(x, y);
    }
    triShape.closePath();
    const triHole = new THREE.Path();
    const innerR = 0.34;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
      const x = Math.cos(a) * innerR;
      const y = Math.sin(a) * innerR;
      if (i === 0) triHole.moveTo(x, y);
      else triHole.lineTo(x, y);
    }
    triHole.closePath();
    triShape.holes.push(triHole);

    const triGeo = new THREE.ExtrudeGeometry(triShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    });
    triGeo.center();
    const triFrame = new THREE.Mesh(triGeo, titaniumMat);
    triFrame.position.z = 0.28;
    reactorRoot.add(triFrame);
    disposables.push(triGeo);

    // 8. Glowing Inner Core Disc + Interactive Hit Sphere
    const innerCoreGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.12, 48);
    innerCoreGeo.rotateX(Math.PI / 2);
    const innerCore = new THREE.Mesh(innerCoreGeo, plasmaMat);
    innerCore.position.z = 0.14;
    reactorRoot.add(innerCore);
    disposables.push(innerCoreGeo);

    // 9. Sapphire Optical Containment Lens (renderOrder after inner plasma)
    const lensGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.04, 64);
    lensGeo.rotateX(Math.PI / 2);
    const lensMesh = new THREE.Mesh(lensGeo, sapphireGlassMat);
    lensMesh.position.z = 0.34;
    lensMesh.renderOrder = 5;
    reactorRoot.add(lensMesh);
    disposables.push(lensGeo);

    // 10. 36 Audio-Reactive & Command-Choreographed Harmonic Fins (InstancedMesh perimeter)
    const finCount = 36;
    const finGeo = new THREE.BoxGeometry(0.036, 0.16, 0.08);
    const finInstanced = new THREE.InstancedMesh(finGeo, plasmaMat, finCount);
    finInstanced.frustumCulled = false;
    reactorRoot.add(finInstanced);
    disposables.push(finGeo);

    // 11. Command Telemetry Orbital Sweep Arcs (visual cue during active voice command processing)
    const telemetryGroup = new THREE.Group();
    const outerSweepGeo = new THREE.TorusGeometry(2.24, 0.02, 12, 72, Math.PI * 0.45);
    const innerSweepGeo = new THREE.TorusGeometry(2.42, 0.014, 10, 64, Math.PI * 0.28);
    for (let i = 0; i < 2; i++) {
      const arcOuter = new THREE.Mesh(outerSweepGeo, commandTelemetryMat);
      arcOuter.rotation.z = i * Math.PI;
      arcOuter.renderOrder = 6;
      telemetryGroup.add(arcOuter);

      const arcInner = new THREE.Mesh(innerSweepGeo, commandTelemetryMat);
      arcInner.rotation.z = i * Math.PI + Math.PI * 0.5;
      arcInner.renderOrder = 6;
      telemetryGroup.add(arcInner);
    }
    telemetryGroup.position.z = 0.22;
    telemetryGroup.scale.setScalar(0.86);
    reactorRoot.add(telemetryGroup);
    disposables.push(outerSweepGeo, innerSweepGeo);

    // 12. Command Acknowledgment Radial Shockwave Ring (fires on command start / completion)
    const pulseRingGeo = new THREE.TorusGeometry(1.22, 0.022, 12, 96);
    const pulseRingMesh = new THREE.Mesh(pulseRingGeo, pulseRingMat);
    pulseRingMesh.position.z = 0.42;
    pulseRingMesh.renderOrder = 7;
    pulseRingMesh.visible = false;
    reactorRoot.add(pulseRingMesh);
    disposables.push(pulseRingGeo);

    // Subtle floating ambient dust motes around the reactor
    const dustCount = 120;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = 2.4 + Math.random() * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.85;
      dustPositions[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
      dustPositions[i * 3 + 1] = Math.sin(phi) * r * 0.7;
      dustPositions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r - 1.2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x7dd3fc,
      size: 0.024,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);
    disposables.push(dustGeo, dustMat);

    // Raycaster for clicking the Arc Reactor core directly to start/stop voice
    const raycaster = new THREE.Raycaster();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // Ignore orbit drags
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects([innerCore, bezelMesh, triFrame], false);
      if (hits.length > 0) {
        onCoreClickRef.current();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const onContextRestored = () => {
      setWebglLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
      if (bloomPass) bloomPass.resolution.set(w, h);
    };
    window.addEventListener('resize', onResize);

    // Pre-warm shaders on GPU devices
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Animation state (spring/damped transitions + command shockwave cue state)
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let smoothedAudio = 0;
    let smoothedBrightness = brightnessRef.current;
    let explodeFactor = 0;
    let spinSpeed = 0.28;
    let telemetryMix = 0;
    let lastCueId = -1;
    let lastCueActive = false;
    let pulseProgress = 1; // 1 = inactive, 0..1 = expanding shockwave

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const animate = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      const curMode = modeRef.current;
      const curCue = cueRef.current;
      const overlayOpen = overlayOpenRef.current;

      // Detect new command start or completion to trigger radial shockwave pulse
      if (curCue && (curCue.id !== lastCueId || curCue.active !== lastCueActive)) {
        lastCueId = curCue.id;
        lastCueActive = curCue.active;
        pulseProgress = 0;
        if (!curCue.active && curCue.outcome === 'error') {
          _pulseColor.copy(_emissiveError);
        } else if (!curCue.active && curCue.outcome === 'ok') {
          _pulseColor.copy(_emissiveLaptop);
        } else {
          _pulseColor.copy(resolveCommandColor(curCue.kind));
        }
      }

      const rawAudio = Math.min(
        1,
        Math.max((inputLevelRef.current || 0) * 2.5, (outputLevelRef.current || 0) * 2.4)
      );
      smoothedAudio = THREE.MathUtils.damp(smoothedAudio, rawAudio, 10, delta);

      // Mode-driven 3D transitions (layer separation, spin velocity, emissive color)
      let targetExplode = 0;
      let targetSpin = 0.25;
      let targetColor = _emissiveStandby;
      let targetIntensity = 1.25;
      const isProcessingCommand = Boolean(curCue?.active);

      if (curMode === 'connecting') {
        targetExplode = 0.22;
        targetSpin = 1.15;
        targetColor = _emissiveListening;
        targetIntensity = 1.8;
      } else if (curMode === 'listening') {
        targetExplode = 0.14 + smoothedAudio * 0.22;
        targetSpin = 0.75 + smoothedAudio * 1.4;
        targetColor = _emissiveListening;
        targetIntensity = 1.65 + smoothedAudio * 1.5;
      } else if (curMode === 'speaking') {
        targetExplode = 0.26 + smoothedAudio * 0.3;
        targetSpin = 1.1 + smoothedAudio * 1.8;
        targetColor = _emissiveSpeaking;
        targetIntensity = 1.9 + smoothedAudio * 1.8;
      } else if (curMode === 'automating') {
        targetExplode = 0.58;
        targetSpin = 1.75;
        targetColor = _emissiveAutomating;
        targetIntensity = 2.15;
      } else if (curMode === 'researching') {
        targetExplode = 0.48;
        targetSpin = 1.45;
        targetColor = _emissiveResearching;
        targetIntensity = 2.05;
      } else if (curMode === 'media') {
        targetExplode = 0.34;
        targetSpin = 0.95;
        targetColor = _emissiveMedia;
        targetIntensity = 1.85;
      } else if (curMode === 'laptop') {
        targetExplode = 0.54;
        targetSpin = 1.9;
        targetColor = _emissiveLaptop;
        targetIntensity = 2.15;
      } else if (curMode === 'memory') {
        targetExplode = 0.3 + Math.sin(elapsed * 4.5) * 0.08;
        targetSpin = 1.25;
        targetColor = _emissiveMemory;
        targetIntensity = 2.05;
      } else if (curMode === 'plugin') {
        targetExplode = 0.44;
        targetSpin = 1.6;
        targetColor = _emissivePlugin;
        targetIntensity = 2.0;
      } else if (curMode === 'visuals') {
        targetExplode = 0.5;
        targetSpin = 1.5;
        targetColor = _emissiveVisuals;
        targetIntensity = 2.1;
      }

      if (curCue?.active) {
        targetColor = resolveCommandColor(curCue.kind);
        targetExplode = Math.max(targetExplode, 0.44);
        targetSpin = Math.max(targetSpin, 1.45);
        targetIntensity = Math.max(targetIntensity, 2.05);
      } else if (curCue && curCue.outcome === 'error') {
        targetColor = _emissiveError;
      }

      if (overlayOpen) {
        targetExplode = Math.max(targetExplode, 0.48);
      }

      smoothedBrightness = THREE.MathUtils.damp(
        smoothedBrightness,
        brightnessRef.current,
        10,
        delta
      );

      explodeFactor = THREE.MathUtils.damp(explodeFactor, targetExplode, 4.5, delta);
      spinSpeed = THREE.MathUtils.damp(spinSpeed, targetSpin, 4.0, delta);

      _curColor.lerp(targetColor, 1 - Math.exp(-6 * delta));
      plasmaMat.emissive.copy(_curColor);
      plasmaMat.emissiveIntensity = THREE.MathUtils.damp(
        plasmaMat.emissiveIntensity,
        targetIntensity * smoothedBrightness,
        7,
        delta
      );
      coreLight.color.copy(_curColor);
      coreLight.intensity =
        (2.1 + smoothedAudio * 3.4 + explodeFactor * 1.2) * smoothedBrightness;
      rimLight.intensity = 1.4 * smoothedBrightness;
      commandTelemetryMat.emissiveIntensity = 2.3 * (0.4 + 0.6 * smoothedBrightness);
      dustMat.opacity = 0.38 * (0.35 + 0.65 * smoothedBrightness);
      if (bloomPass) {
        bloomPass.strength = 0.36 * (0.3 + 0.7 * smoothedBrightness);
      }
      renderer.toneMappingExposure = 1.02 * (0.72 + 0.28 * smoothedBrightness);

      // Telemetry Orbital Arcs visibility & spin during command execution
      const showTelemetry =
        isProcessingCommand ||
        curMode === 'researching' ||
        curMode === 'visuals' ||
        curMode === 'automating' ||
        curMode === 'laptop' ||
        curMode === 'memory' ||
        curMode === 'plugin' ||
        curMode === 'connecting';
      telemetryMix = THREE.MathUtils.damp(telemetryMix, showTelemetry ? 1 : 0, 7, delta);
      commandTelemetryMat.emissive.copy(_curColor);
      commandTelemetryMat.opacity = telemetryMix * 0.88;
      telemetryGroup.visible = telemetryMix > 0.02;
      telemetryGroup.scale.setScalar(0.86 + telemetryMix * 0.16);
      telemetryGroup.position.z = 0.22 + explodeFactor * 0.52;
      if (!prefersReduced && telemetryGroup.visible) {
        const sweepVel =
          curCue?.kind === 'laptop' || curMode === 'laptop'
            ? 2.8
            : curCue?.kind === 'automation' || curMode === 'automating'
              ? 2.2
              : 1.5;
        telemetryGroup.rotation.z -= delta * sweepVel;
        telemetryGroup.rotation.x = Math.sin(elapsed * 1.8) * 0.14 * telemetryMix;
        telemetryGroup.rotation.y = Math.cos(elapsed * 1.4) * 0.14 * telemetryMix;
      }

      // Radial Confirmation Shockwave Ring animation
      if (pulseProgress < 1 && !prefersReduced) {
        pulseProgress = Math.min(1, pulseProgress + delta * 1.55);
        const eased = 1 - Math.pow(1 - pulseProgress, 3);
        pulseRingMesh.visible = true;
        pulseRingMesh.scale.setScalar(0.85 + eased * 1.65);
        pulseRingMat.color.copy(_pulseColor);
        pulseRingMat.opacity = (1 - pulseProgress) * 0.85;
      } else {
        pulseRingMesh.visible = false;
        pulseRingMat.opacity = 0;
      }

      // Inner Core subtle encoding breath during memory/research commands
      const coreScalePulse =
        curCue?.kind === 'memory' || curMode === 'memory'
          ? 1 + Math.sin(elapsed * 6.5) * 0.1
          : 1 + smoothedAudio * 0.08;
      innerCore.scale.set(coreScalePulse, coreScalePulse, 1);

      // Exploded Z-axis choreography across the reactor layers
      outerHousing.position.z = -0.18 - explodeFactor * 0.65;
      bezelMesh.position.z = -explodeFactor * 0.18;
      plasmaRing.position.z = 0.05 + explodeFactor * 0.1;
      coilInstanced.position.z = 0.05 + explodeFactor * 0.14;
      gyroGroupA.position.z = 0.16 + explodeFactor * 0.42;
      gyroGroupB.position.z = 0.24 + explodeFactor * 0.68;
      triFrame.position.z = 0.28 + explodeFactor * 0.92;
      lensMesh.position.z = 0.34 + explodeFactor * 1.18;

      if (!prefersReduced) {
        gyroGroupA.rotation.z += delta * spinSpeed * 0.7;
        gyroGroupA.rotation.x = Math.sin(elapsed * 0.6) * (0.04 + explodeFactor * 0.16);
        gyroGroupB.rotation.z -= delta * spinSpeed * 1.15;
        gyroGroupB.rotation.y = Math.cos(elapsed * 0.5) * (0.04 + explodeFactor * 0.16);
        triFrame.rotation.z =
          curCue?.kind === 'automation' || curMode === 'automating'
            ? Math.round(elapsed * 3) * (Math.PI / 6) * 0.25
            : Math.sin(elapsed * 0.35) * 0.08;
        coilInstanced.rotation.z += delta * 0.08;
        dustPoints.rotation.y += delta * 0.03;

        // Subtle pointer parallax on root group when not dragging
        if (!userInteracting) {
          reactorRoot.rotation.y = THREE.MathUtils.damp(
            reactorRoot.rotation.y,
            _pointerNdc.x * 0.14,
            4,
            delta
          );
          reactorRoot.rotation.x = THREE.MathUtils.damp(
            reactorRoot.rotation.x,
            -_pointerNdc.y * 0.1,
            4,
            delta
          );
        }
      }

      // 36 audio-reactive & command-specific perimeter fins
      const activeKind = curCue?.active ? curCue.kind : null;
      const sweepTheta = elapsed * 4.2;
      for (let i = 0; i < finCount; i++) {
        const theta = (i / finCount) * Math.PI * 2 + elapsed * 0.12;
        const harmonic =
          Math.sin(i * 0.65 + elapsed * 4.5) * 0.5 +
          Math.cos(i * 0.35 - elapsed * 3.2) * 0.5;

        let commandPulse = 0;
        if (activeKind === 'research' || curMode === 'researching') {
          // Radar scanner beam circling the reactor
          const beam = Math.max(0, Math.cos(theta - sweepTheta));
          commandPulse = Math.pow(beam, 5) * 0.38;
        } else if (activeKind === 'automation' || curMode === 'automating') {
          // Alternating step-indexed actuator wave
          const stepIdx = Math.floor(elapsed * 8) % finCount;
          const dist = Math.min(Math.abs(i - stepIdx), finCount - Math.abs(i - stepIdx));
          commandPulse = dist < 4 ? (4 - dist) * 0.085 : 0.03;
        } else if (activeKind === 'laptop' || curMode === 'laptop') {
          // High-precision 4-quadrant lock bursts
          commandPulse = (i % 9 < 3 ? 0.24 : 0.03) * (0.6 + 0.4 * Math.sin(elapsed * 9));
        } else if (activeKind === 'memory' || curMode === 'memory') {
          // Smooth breathing ring toward core
          commandPulse = 0.16 * (0.5 + 0.5 * Math.sin(elapsed * 5 + i * 0.17));
        } else if (activeKind === 'plugin' || curMode === 'plugin') {
          // Hexagonal 6-lobe telemetry ripple
          commandPulse = 0.22 * Math.abs(Math.sin(theta * 3 + elapsed * 3.5));
        } else if (activeKind === 'visuals' || curMode === 'visuals') {
          // Prismatic double-helix aperture shimmer
          commandPulse = 0.24 * Math.abs(Math.sin(theta * 2 - elapsed * 4.2));
        } else if (activeKind === 'youtube' || curMode === 'media') {
          // Musical equalizer bars
          commandPulse = 0.24 * Math.abs(Math.sin(i * 0.55 + elapsed * 5.5));
        }

        const audioPulse =
          curMode === 'standby' && !activeKind
            ? 0.02 * Math.sin(elapsed * 1.6 + i * 0.2)
            : smoothedAudio * 0.34 * (0.5 + 0.5 * Math.abs(harmonic)) + 0.04;

        const pulse = Math.max(audioPulse, commandPulse);
        const radial = 1.94 + pulse + explodeFactor * 0.22;

        _dummyObj.position.set(
          Math.cos(theta) * radial,
          Math.sin(theta) * radial,
          0.02 + explodeFactor * 0.25
        );
        _dummyObj.rotation.set(0, 0, theta + Math.PI / 2);
        const lenScale = 1 + pulse * 3.4;
        _dummyObj.scale.set(1, lenScale, 1);
        _dummyObj.updateMatrix();
        finInstanced.setMatrixAt(i, _dummyObj.matrix);
      }
      finInstanced.instanceMatrix.needsUpdate = true;

      // Smooth camera transition when overlay drawers open/close
      if (!userInteracting) {
        const targetZ = overlayOpen ? 7.9 : curMode === 'automating' ? 7.0 : 6.1;
        const targetY = overlayOpen ? 0.55 : 0.22;
        _targetCamPos.set(0, targetY, targetZ);
        camera.position.lerp(_targetCamPos, 1 - Math.exp(-3.5 * delta));
        controls.target.lerp(_targetLookAt, 1 - Math.exp(-4.0 * delta));
      }

      controls.update();

      if (composer && !isSoftwareGl) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(animate);
      } else {
        frameId = requestAnimationFrame(animate);
      }
    };

    if (isSoftwareGl) {
      afterDraw(animate);
    } else {
      frameId = requestAnimationFrame(animate);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      if (composer) composer.dispose();
      for (const item of disposables) {
        item.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [inputLevelRef, outputLevelRef]);

  return (
    <div className="relative w-full h-full bg-[#06090F]">
      <div
        ref={mountRef}
        className="w-full h-full cursor-pointer"
        aria-label="Interactive 3D Arc Reactor — click center core to speak"
      />
      {webglLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#06090F]/90 text-xs text-slate-300">
          Restoring 3D Arc Reactor graphics context...
        </div>
      )}
    </div>
  );
};
