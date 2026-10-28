
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.querySelector("#engine-canvas");

if (!container) {
    throw new Error("Engine viewer container was not found.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#080d17");

const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
);

camera.position.set(3, 2, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;

container.querySelector(".engine-loading")?.remove();
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 3;
controls.maxDistance = 10;
controls.target.set(0, 0, 0);

const engineGroup = new THREE.Group();
scene.add(engineGroup);

const engineMaterial = new THREE.MeshStandardMaterial({
    color: "#536579",
    metalness: 0.85,
    roughness: 0.28
});

const headMaterial = new THREE.MeshStandardMaterial({
    color: "#9aabbc",
    metalness: 0.9,
    roughness: 0.22
});

const cylinderMaterial = new THREE.MeshStandardMaterial({
    color: "#60758a",
    metalness: 0.9,
    roughness: 0.24,
    emissive: "#071522",
    emissiveIntensity: 0.35
});

const exhaustMaterial = new THREE.MeshStandardMaterial({
    color: "#a6b4c2",
    metalness: 0.95,
    roughness: 0.22
});

const boltMaterial = new THREE.MeshStandardMaterial({
    color: "#d7e6f5",
    metalness: 1,
    roughness: 0.2
});

const hologramMaterial = new THREE.LineBasicMaterial({
    color: "#00e5ff",
    transparent: true,
    opacity: 0.9
});

const blockGeometry = new THREE.BoxGeometry(1.8, 1.5, 1.2);
const engineBlock = new THREE.Mesh(blockGeometry, engineMaterial);
engineGroup.add(engineBlock);

const blockEdges = new THREE.EdgesGeometry(blockGeometry);
const blockWireframe = new THREE.LineSegments(
    blockEdges,
    hologramMaterial
);
blockWireframe.scale.setScalar(1.003);
engineGroup.add(blockWireframe);

const headGeometry = new THREE.BoxGeometry(1.65, 0.35, 1.1);
const cylinderHead = new THREE.Mesh(headGeometry, headMaterial);
cylinderHead.position.y = 0.92;
engineGroup.add(cylinderHead);

const headEdges = new THREE.EdgesGeometry(headGeometry);
const headWireframe = new THREE.LineSegments(
    headEdges,
    hologramMaterial
);
headWireframe.scale.setScalar(1.003);
headWireframe.position.copy(cylinderHead.position);
engineGroup.add(headWireframe);

const boltGeometry = new THREE.CylinderGeometry(
    0.055, 0.055, 0.035, 12
);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    const x = -0.65 + (i % 3) * 0.65;
    const z = i < 3 ? -0.42 : 0.42;

    bolt.position.set(x, 1.12, z);
    engineGroup.add(bolt);
}

const cylinderGeometry = new THREE.CylinderGeometry(
    0.19, 0.19, 0.65, 24
);

for (let i = 0; i < 4; i++) {
    const cylinder = new THREE.Mesh(
        cylinderGeometry,
        cylinderMaterial
    );

    cylinder.position.set(-0.57 + i * 0.38, 0.38, 0.48);
    engineGroup.add(cylinder);
}

const oilPanGeometry = new THREE.BoxGeometry(1.35, 0.38, 1.0);
const oilPanMaterial = new THREE.MeshStandardMaterial({
    color: "#354657",
    metalness: 0.85,
    roughness: 0.32
});

const oilPan = new THREE.Mesh(oilPanGeometry, oilPanMaterial);
oilPan.position.set(0, -0.85, 0);
engineGroup.add(oilPan);

const oilPanEdges = new THREE.EdgesGeometry(oilPanGeometry);
const oilPanWireframe = new THREE.LineSegments(
    oilPanEdges,
    hologramMaterial
);
oilPanWireframe.position.copy(oilPan.position);
oilPanWireframe.scale.setScalar(1.003);
engineGroup.add(oilPanWireframe);

const sideBoltGeometry = new THREE.CylinderGeometry(
    0.045, 0.045, 0.06, 12
);

for (let i = 0; i < 3; i++) {
    const sideBolt = new THREE.Mesh(
        sideBoltGeometry,
        boltMaterial
    );

    sideBolt.rotation.x = Math.PI / 2;
    sideBolt.position.set(-0.48 + i * 0.48, -0.85, 0.53);
    engineGroup.add(sideBolt);
}

const exhaustGeometry = new THREE.CylinderGeometry(
    0.075, 0.095, 0.7, 16
);

for (let i = 0; i < 4; i++) {
    const exhaustPipe = new THREE.Mesh(
        exhaustGeometry,
        exhaustMaterial
    );

    exhaustPipe.position.set(
        -0.57 + i * 0.38,
        -0.05,
        -0.68
    );

    exhaustPipe.rotation.x = Math.PI / 2;
    engineGroup.add(exhaustPipe);
}

const mainLight = new THREE.DirectionalLight("#ffffff", 3);
mainLight.position.set(3, 4, 5);
scene.add(mainLight);

const cyanLight = new THREE.PointLight("#00e5ff", 12, 8);
cyanLight.position.set(-3, 1, 2);
scene.add(cyanLight);

const orangeLight = new THREE.PointLight("#ff8a00", 8, 8);
orangeLight.position.set(3, -1, -2);
scene.add(orangeLight);

scene.add(new THREE.AmbientLight("#ffffff", 1));

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function resizeRenderer() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) {
        return;
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

window.addEventListener("resize", resizeRenderer);

resizeRenderer();
animate();
