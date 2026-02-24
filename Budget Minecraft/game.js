import * as THREE from 'three';

const SAVE_PREFIX = 'minegame:levels:';
const CHUNK_SIZE = 16;
const RENDER_DISTANCE_CHUNKS = 4;
const BASE_HEIGHT = 4;
const MAX_HEIGHT = 14;
const TREE_CHANCE_THRESHOLD = 0.965;
const TREE_CLUSTER_SCALE = 0.35;
const TREE_SPACING = 5;
const AUTOSAVE_INTERVAL_MS = 30000;
let worldSeed = 1337;

const canvas = document.getElementById('game');
const mainMenu = document.getElementById('main-menu');
const startGameButton = document.getElementById('start-game');
const levelNameInput = document.getElementById('level-name');
const seedInput = document.getElementById('seed-input');
const hud = document.getElementById('hud');
const hudTitle = hud.querySelector('h1');
const crosshair = document.getElementById('crosshair');

hud.classList.add('hidden');
crosshair.classList.add('hidden');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 45, 260);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 450);
camera.position.set(0, 6, 14);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const hemi = new THREE.HemisphereLight(0xbde0ff, 0x5a4b3f, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(20, 40, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

function createPixelTexture(palette, size = 16) {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const shadeIndex = hash2D(x * 0.49 + 11.3, y * 0.61 - 8.2) > 0.5 ? 1 : 0;
      const variant = palette[shadeIndex] || palette[0];
      const index = (y * size + x) * 4;
      data[index] = variant[0];
      data[index + 1] = variant[1];
      data[index + 2] = variant[2];
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fract(n) {
  return n - Math.floor(n);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

const grassTexture = createPixelTexture([
  [98, 164, 66],
  [84, 148, 55]
]);
const dirtTexture = createPixelTexture([
  [126, 87, 56],
  [110, 75, 48]
]);
const stoneTexture = createPixelTexture([
  [133, 133, 133],
  [117, 117, 117]
]);
const trunkTexture = createPixelTexture([
  [115, 82, 54],
  [98, 69, 44]
]);
const leavesTexture = createPixelTexture([
  [58, 121, 47],
  [50, 106, 40]
]);

const groundMat = new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 1, metalness: 0 });
const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTexture, roughness: 1, metalness: 0 });
const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture, roughness: 1, metalness: 0 });
const trunkMat = new THREE.MeshStandardMaterial({ map: trunkTexture, roughness: 1, metalness: 0 });
const leavesMat = new THREE.MeshStandardMaterial({ map: leavesTexture, roughness: 1, metalness: 0 });

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const trunkGeometry = new THREE.BoxGeometry(0.9, 1, 0.9);
const leavesGeometry = new THREE.BoxGeometry(1, 1, 1);
const tempMatrix = new THREE.Matrix4();
const lookTarget = new THREE.Vector3();

const statusEl = document.getElementById('status');
const perfStatsEl = document.getElementById('perfStats');

let currentLevelName = 'default';
let yaw = Math.PI;
let pitch = -0.35;
let autosaveHandle = 0;
let fpsAccumulator = 0;
let fpsFrames = 0;
let fpsReportTimer = 0;
let streamedChunkX = Number.NaN;
let streamedChunkZ = Number.NaN;

const worldRoot = new THREE.Group();
scene.add(worldRoot);
const loadedChunks = new Map();
const chunkSolidBlocks = new Map();
const solidBlocks = new Set();

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function registerChunkBlocks(chunkKeyValue, positions) {
  const blockKeys = new Set();
  const categories = [positions.ground, positions.dirt, positions.stone, positions.trunk, positions.leaves];

  categories.forEach((list) => {
    list.forEach(([x, y, z]) => {
      const key = blockKey(x, y, z);
      blockKeys.add(key);
      solidBlocks.add(key);
    });
  });

  chunkSolidBlocks.set(chunkKeyValue, blockKeys);
}

function unregisterChunkBlocks(chunkKeyValue) {
  const blockKeys = chunkSolidBlocks.get(chunkKeyValue);
  if (!blockKeys) return;

  blockKeys.forEach((key) => {
    solidBlocks.delete(key);
  });

  chunkSolidBlocks.delete(chunkKeyValue);
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

let isGameStarted = false;

function sanitizeLevelName(value) {
  const trimmed = (value || '').trim();
  return trimmed || 'Untitled World';
}

function sanitizeSeed(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return Math.floor(Math.random() * 999_999_999);
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) | 0;
  }
  return hash;
}

function hash2D(x, z) {
  return fract(Math.sin((x + worldSeed * 0.0017) * 127.1 + (z - worldSeed * 0.0023) * 311.7) * 43758.5453123);
}

function valueNoise2D(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);

  const v00 = hash2D(x0, z0, worldSeed);
  const v10 = hash2D(x0 + 1, z0, worldSeed);
  const v01 = hash2D(x0, z0 + 1, worldSeed);
  const v11 = hash2D(x0 + 1, z0 + 1, worldSeed);

  const a = THREE.MathUtils.lerp(v00, v10, tx);
  const b = THREE.MathUtils.lerp(v01, v11, tx);
  return THREE.MathUtils.lerp(a, b, tz);
}

function fbm(x, z, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;

  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, z * frequency) * amplitude;
    sum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / sum;
}

function getTerrainHeight(x, z) {
  const ridge = fbm(x * 0.07, z * 0.07, 5);
  const detail = fbm((x + 300) * 0.18, (z - 130) * 0.18, 3);
  const terrain = ridge * 0.85 + detail * 0.15;

  return Math.max(
    1,
    Math.floor(BASE_HEIGHT + terrain * (MAX_HEIGHT - BASE_HEIGHT) + 1)
  );
}

function worldToChunkCoord(value) {
  return Math.floor(value / CHUNK_SIZE);
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function clearWorld() {
  for (const key of loadedChunks.keys()) {
    unloadChunkByKey(key);
  }
}

function createInstancedMesh(material, count, castShadow, receiveShadow) {
  const mesh = new THREE.InstancedMesh(blockGeometry, material, count);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

function addTree(positions, x, y, z) {
  const trunkHeight = 3 + Math.floor(hash2D(x + 44.7, z + 10.3) * 2);

  for (let i = 0; i < trunkHeight; i++) {
    positions.trunk.push([x, y + 1 + i, z]);
  }

  const canopyBaseY = y + trunkHeight;
  for (let lx = -2; lx <= 2; lx++) {
    for (let ly = 0; ly <= 2; ly++) {
      for (let lz = -2; lz <= 2; lz++) {
        const edge = Math.abs(lx) + Math.abs(lz) + ly;
        if (edge > 5) continue;
        if (ly === 2 && Math.abs(lx) + Math.abs(lz) > 1) continue;
        if (lx === 0 && lz === 0 && ly <= 1) continue;
        positions.leaves.push([x + lx, canopyBaseY + ly, z + lz]);
      }
    }
  }
}

function disposeChunkResources(chunkGroup) {
  const sharedGeometries = new Set([blockGeometry, trunkGeometry, leavesGeometry]);
  const sharedMaterials = new Set([groundMat, dirtMat, stoneMat, trunkMat, leavesMat]);

  chunkGroup.traverse((node) => {
    if (!node.isMesh) return;
    const { geometry, material } = node;

    if (geometry && !sharedGeometries.has(geometry)) {
      geometry.dispose?.();
    }

    if (Array.isArray(material)) {
      material.forEach((mat) => {
        if (mat && !sharedMaterials.has(mat)) {
          mat.dispose?.();
        }
      });
    } else if (material && !sharedMaterials.has(material)) {
      material.dispose?.();
    }
  });
}

function generateChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  if (loadedChunks.has(key)) {
    return loadedChunks.get(key);
  }

  const chunkGroup = new THREE.Group();
  chunkGroup.name = `chunk:${key}`;

  const positions = {
    ground: [],
    dirt: [],
    stone: [],
    trunk: [],
    leaves: []
  };

  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE;
  const maxZ = minZ + CHUNK_SIZE;

  for (let x = minX; x < maxX; x++) {
    for (let z = minZ; z < maxZ; z++) {
      const h = getTerrainHeight(x, z);

      for (let y = 0; y < h; y++) {
        if (y === h - 1) positions.ground.push([x, y, z]);
        else if (y >= h - 3) positions.dirt.push([x, y, z]);
        else positions.stone.push([x, y, z]);
      }

      const treeChance = hash2D(x * TREE_CLUSTER_SCALE + 180, z * TREE_CLUSTER_SCALE - 230, worldSeed);
      const spacingMask = hash2D(Math.floor(x / TREE_SPACING) + 740, Math.floor(z / TREE_SPACING) - 510, worldSeed);
      const canGrowTree = h >= 5;
      if (canGrowTree && treeChance > TREE_CHANCE_THRESHOLD && spacingMask > 0.65) {
        addTree(positions, x, h - 1, z);
      }
    }
  }

  registerChunkBlocks(key, positions);

  if (positions.ground.length > 0) {
    const groundMesh = createInstancedMesh(groundMat, positions.ground.length, true, true);
    positions.ground.forEach(([x, y, z], i) => {
      tempMatrix.makeTranslation(x, y, z);
      groundMesh.setMatrixAt(i, tempMatrix);
    });
    groundMesh.instanceMatrix.needsUpdate = true;
    chunkGroup.add(groundMesh);
  }

  if (positions.dirt.length > 0) {
    const dirtMesh = createInstancedMesh(dirtMat, positions.dirt.length, false, true);
    positions.dirt.forEach(([x, y, z], i) => {
      tempMatrix.makeTranslation(x, y, z);
      dirtMesh.setMatrixAt(i, tempMatrix);
    });
    dirtMesh.instanceMatrix.needsUpdate = true;
    chunkGroup.add(dirtMesh);
  }

  if (positions.stone.length > 0) {
    const stoneMesh = createInstancedMesh(stoneMat, positions.stone.length, false, true);
    positions.stone.forEach(([x, y, z], i) => {
      tempMatrix.makeTranslation(x, y, z);
      stoneMesh.setMatrixAt(i, tempMatrix);
    });
    stoneMesh.instanceMatrix.needsUpdate = true;
    chunkGroup.add(stoneMesh);
  }


  if (positions.trunk.length > 0) {
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMat, positions.trunk.length);
    trunkMesh.castShadow = false;
    trunkMesh.receiveShadow = false;
    positions.trunk.forEach(([x, y, z], i) => {
      tempMatrix.makeTranslation(x, y, z);
      trunkMesh.setMatrixAt(i, tempMatrix);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    chunkGroup.add(trunkMesh);
  }

  if (positions.leaves.length > 0) {
    const leavesMesh = new THREE.InstancedMesh(leavesGeometry, leavesMat, positions.leaves.length);
    leavesMesh.castShadow = false;
    leavesMesh.receiveShadow = false;
    positions.leaves.forEach(([x, y, z], i) => {
      tempMatrix.makeTranslation(x, y, z);
      leavesMesh.setMatrixAt(i, tempMatrix);
    });
    leavesMesh.instanceMatrix.needsUpdate = true;
    chunkGroup.add(leavesMesh);
  }

  worldRoot.add(chunkGroup);
  loadedChunks.set(key, chunkGroup);
  return chunkGroup;
}

function unloadChunkByKey(key) {
  const chunkGroup = loadedChunks.get(key);
  if (!chunkGroup) return;

  worldRoot.remove(chunkGroup);
  unregisterChunkBlocks(key);
  loadedChunks.delete(key);
}

function updateChunkStreaming(force = false) {
  const pcx = worldToChunkCoord(camera.position.x);
  const pcz = worldToChunkCoord(camera.position.z);
  if (!force && pcx === streamedChunkX && pcz === streamedChunkZ) {
    return;
  }

  streamedChunkX = pcx;
  streamedChunkZ = pcz;
  const desiredChunkKeys = new Set();

  for (let dx = -RENDER_DISTANCE_CHUNKS; dx <= RENDER_DISTANCE_CHUNKS; dx++) {
    for (let dz = -RENDER_DISTANCE_CHUNKS; dz <= RENDER_DISTANCE_CHUNKS; dz++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      desiredChunkKeys.add(key);
      if (!loadedChunks.has(key)) {
        generateChunk(cx, cz);
      }
    }
  }

  const loadedKeys = [...loadedChunks.keys()];
  for (const key of loadedKeys) {
    if (!desiredChunkKeys.has(key)) {
      unloadChunkByKey(key);
    }
  }

  setStatus(`Chunk ${pcx}, ${pcz} • Loaded chunks: ${loadedChunks.size}`);
}

function saveStorageKey(levelName) {
  return `${SAVE_PREFIX}${levelName}`;
}


function loadLevelByName(levelName) {
  const raw = localStorage.getItem(saveStorageKey(levelName));
  if (!raw) {
    setStatus('Could not load level.');
    return;
  }

  camera.position.set(0, getTerrainHeight(0, 0) + 5, 12);
}

function startGame() {
  if (isGameStarted) return;

  const levelName = sanitizeLevelName(levelNameInput.value);
  worldSeed = sanitizeSeed(seedInput.value);
  currentLevelName = levelName;

  levelNameInput.value = levelName;
  seedInput.value = String(worldSeed);
  hudTitle.textContent = `Mine Game — ${levelName}`;

  clearWorld();
  streamedChunkX = Number.NaN;
  streamedChunkZ = Number.NaN;
  updateChunkStreaming(true);

  mainMenu.classList.add('hidden');
  hud.classList.remove('hidden');
  crosshair.classList.remove('hidden');
  isGameStarted = true;
  requestMouseLock();
}

function requestMouseLock() {
  if (!isGameStarted || document.pointerLockElement === canvas) return;
  canvas.requestPointerLock?.();
}

startGameButton.addEventListener('click', startGame);
levelNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') startGame();
});
seedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') startGame();
});

canvas.addEventListener('pointerdown', () => {
  if (!isGameStarted) return;
  requestMouseLock();
});

window.addEventListener('pointermove', (event) => {
  if (!isGameStarted || document.pointerLockElement !== canvas) return;
  const dx = event.movementX;
  const dy = event.movementY;

  yaw -= dx * 0.004;
  pitch = Math.max(-1.2, Math.min(0.6, pitch - dy * 0.004));
});

const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

let velocityY = 0;
const gravity = 30;
const jumpVelocity = 10;
const playerHeight = 1.7;
const playerRadius = 0.32;
const maxStepHeight = 1.05;
const groundedEpsilon = 0.08;
const horizontalVelocity = new THREE.Vector2();
const desiredDirection = new THREE.Vector2();

const clock = new THREE.Clock();

function hasSolidBlock(x, y, z) {
  return solidBlocks.has(blockKey(x, y, z));
}

function collidesAt(px, py, pz) {
  const minX = Math.floor(px - playerRadius);
  const maxX = Math.floor(px + playerRadius);
  const minY = Math.floor(py - playerHeight);
  const maxY = Math.floor(py - 0.1);
  const minZ = Math.floor(pz - playerRadius);
  const maxZ = Math.floor(pz + playerRadius);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (hasSolidBlock(x, y, z)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isGrounded() {
  return collidesAt(camera.position.x, camera.position.y - groundedEpsilon, camera.position.z);
}

function attemptHorizontalMove(dx, dz, grounded) {
  if (dx === 0 && dz === 0) return;

  const targetX = camera.position.x + dx;
  const targetZ = camera.position.z + dz;
  if (!collidesAt(targetX, camera.position.y, targetZ)) {
    camera.position.x = targetX;
    camera.position.z = targetZ;
    return;
  }

  if (grounded) {
    for (let step = 0.2; step <= maxStepHeight; step += 0.2) {
      if (!collidesAt(targetX, camera.position.y + step, targetZ)) {
        camera.position.y += step;
        camera.position.x = targetX;
        camera.position.z = targetZ;
        return;
      }
    }
  }

  if (!collidesAt(targetX, camera.position.y, camera.position.z)) {
    camera.position.x = targetX;
  }
  if (!collidesAt(camera.position.x, camera.position.y, targetZ)) {
    camera.position.z = targetZ;
  }
}

function moveVertically(deltaY) {
  if (deltaY === 0) return;

  const direction = Math.sign(deltaY);
  let remaining = Math.abs(deltaY);

  while (remaining > 0) {
    const step = Math.min(0.12, remaining) * direction;
    const nextY = camera.position.y + step;

    if (collidesAt(camera.position.x, nextY, camera.position.z)) {
      velocityY = 0;
      return;
    }

    camera.position.y = nextY;
    remaining -= Math.abs(step);
  }
}

function updateCamera(dt) {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const grounded = isGrounded();

  desiredDirection.set(0, 0);
  if (keys.has('w')) desiredDirection.y += 1;
  if (keys.has('s')) desiredDirection.y -= 1;
  if (keys.has('d')) desiredDirection.x += 1;
  if (keys.has('a')) desiredDirection.x -= 1;
  if (desiredDirection.lengthSq() > 1) {
    desiredDirection.normalize();
  }

  const moveSpeed = keys.has('shift') ? 11 : 6;
  const controlResponse = grounded ? 16 : 5;
  const targetVelX = (forward.x * desiredDirection.y + right.x * desiredDirection.x) * moveSpeed;
  const targetVelZ = (forward.z * desiredDirection.y + right.z * desiredDirection.x) * moveSpeed;

  const blend = 1 - Math.exp(-controlResponse * dt);
  horizontalVelocity.x = THREE.MathUtils.lerp(horizontalVelocity.x, targetVelX, blend);
  horizontalVelocity.y = THREE.MathUtils.lerp(horizontalVelocity.y, targetVelZ, blend);

  const moveDeltaX = horizontalVelocity.x * dt;
  const moveDeltaZ = horizontalVelocity.y * dt;

  attemptHorizontalMove(moveDeltaX, moveDeltaZ, grounded);

  if (keys.has(' ') && grounded) {
    velocityY = jumpVelocity;
  }

  velocityY -= gravity * dt;
  moveVertically(velocityY * dt);

  lookTarget.set(
    camera.position.x + Math.sin(yaw) * Math.cos(pitch),
    camera.position.y + Math.sin(pitch),
    camera.position.z + Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(lookTarget);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (isGameStarted) {
    updateCamera(dt);
    updateChunkStreaming();
  } else {
    camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1);
  }
  renderer.render(scene, camera);
}

function refreshSavedLevelsList() {
  // Saved levels UI is optional in the current menu.
}

function saveCurrentLevel() {
  if (!isGameStarted) return;

  const payload = {
    name: currentLevelName,
    seed: worldSeed,
    savedAt: Date.now()
  };

  localStorage.setItem(saveStorageKey(currentLevelName), JSON.stringify(payload));
}

function startAutosave() {
  window.clearInterval(autosaveHandle);
  autosaveHandle = window.setInterval(() => {
    saveCurrentLevel();
  }, AUTOSAVE_INTERVAL_MS);
}

refreshSavedLevelsList();
startAutosave();
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
