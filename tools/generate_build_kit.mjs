import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, 'generated');

const materials = {
    oakA: [0.43, 0.24, 0.11, 1],
    oakB: [0.54, 0.32, 0.16, 1],
    oakC: [0.35, 0.18, 0.075, 1],
    oakEdge: [0.24, 0.12, 0.055, 1],
    tileA: [0.72, 0.71, 0.68, 1],
    tileB: [0.62, 0.62, 0.60, 1],
    grout: [0.26, 0.27, 0.28, 1],
    plaster: [0.82, 0.82, 0.79, 1],
    plasterSide: [0.69, 0.69, 0.67, 1],
    trim: [0.90, 0.90, 0.87, 1],
    concrete: [0.46, 0.47, 0.46, 1],
    concreteDark: [0.30, 0.31, 0.31, 1],
    charcoal: [0.12, 0.15, 0.18, 1],
    charcoalSide: [0.075, 0.09, 0.11, 1],
    darkWoodA: [0.16, 0.085, 0.045, 1],
    darkWoodB: [0.235, 0.13, 0.065, 1],
    darkWoodEdge: [0.09, 0.045, 0.025, 1],
    doorWood: [0.40, 0.20, 0.085, 1],
    doorWoodInset: [0.27, 0.12, 0.045, 1],
    doorDark: [0.09, 0.11, 0.13, 1],
    metal: [0.64, 0.67, 0.68, 1],
    stairOak: [0.48, 0.27, 0.12, 1],
    collisionProxy: [0.95, 0.05, 0.85, 1]
};

const faceDefinitions = [
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [0, 0, 1], corners: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] }
];

function box(center, size, material, rotationX = 0) {
    return { center, size, material, rotationX };
}

function appendBox(target, definition) {
    const [cx, cy, cz] = definition.center;
    const [sx, sy, sz] = definition.size;
    const angle = Number(definition.rotationX || 0) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const baseVertex = target.positions.length / 3;

    for (const face of faceDefinitions) {
        for (const corner of face.corners) {
            const localX = corner[0] * sx * 0.5;
            const localY = corner[1] * sy * 0.5;
            const localZ = corner[2] * sz * 0.5;
            target.positions.push(
                cx + localX,
                cy + (localY * cosine) - (localZ * sine),
                cz + (localY * sine) + (localZ * cosine)
            );
            target.normals.push(
                face.normal[0],
                (face.normal[1] * cosine) - (face.normal[2] * sine),
                (face.normal[1] * sine) + (face.normal[2] * cosine)
            );
        }
        target.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        const offset = baseVertex + ((target.positions.length / 3 - baseVertex) - 4);
        target.indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
    }
}

function mesh(material, faces) { return { material, faces }; }

function appendMesh(target, definition) {
    for (const face of definition.faces) {
        // Convex, outward-wound face; a fan preserves the exact walkable surface.
        const a = face[0], b = face[1], c = face[2];
        const ab = b.map((n, i) => n - a[i]), ac = c.map((n, i) => n - a[i]);
        const cross = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
        const length = Math.hypot(...cross);
        const normal = cross.map((n) => n / length);
        const base = target.positions.length / 3;
        face.forEach((vertex, i) => {
            target.positions.push(...vertex);
            target.normals.push(...normal);
            target.uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
        });
        for (let i = 1; i < face.length - 1; i++) target.indices.push(base, base + i, base + i + 1);
    }
}

// Eight corners: four perimeter vertices on top, then their lower counterparts.
function solidQuad(material, top, bottom) {
    return mesh(material, [top, [...bottom].reverse(), ...top.map((point, i) => {
        const next = (i + 1) % 4;
        return [point, bottom[i], bottom[next], top[next]];
    })]);
}

function alignedBuffer(buffer, alignment = 4, padByte = 0) {
    const remainder = buffer.length % alignment;
    if (!remainder) return buffer;
    return Buffer.concat([buffer, Buffer.alloc(alignment - remainder, padByte)]);
}

function floatBuffer(values) {
    const array = new Float32Array(values);
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function indexBuffer(values) {
    const array = new Uint16Array(values);
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function minMaxPositions(values) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < values.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], values[index + axis]);
            max[axis] = Math.max(max[axis], values[index + axis]);
        }
    }
    return { min, max };
}

function validateWinding(name, materialName, geometry) {
    for (let index = 0; index < geometry.indices.length; index += 3) {
        const ia = geometry.indices[index] * 3;
        const ib = geometry.indices[index + 1] * 3;
        const ic = geometry.indices[index + 2] * 3;
        const ab = [
            geometry.positions[ib] - geometry.positions[ia],
            geometry.positions[ib + 1] - geometry.positions[ia + 1],
            geometry.positions[ib + 2] - geometry.positions[ia + 2]
        ];
        const ac = [
            geometry.positions[ic] - geometry.positions[ia],
            geometry.positions[ic + 1] - geometry.positions[ia + 1],
            geometry.positions[ic + 2] - geometry.positions[ia + 2]
        ];
        const cross = [
            (ab[1] * ac[2]) - (ab[2] * ac[1]),
            (ab[2] * ac[0]) - (ab[0] * ac[2]),
            (ab[0] * ac[1]) - (ab[1] * ac[0])
        ];
        const dot = (cross[0] * geometry.normals[ia])
            + (cross[1] * geometry.normals[ia + 1])
            + (cross[2] * geometry.normals[ia + 2]);
        if (dot <= 0) throw new Error(`Invalid triangle winding in ${name}/${materialName}`);
    }
}

function writeGlb(name, boxes) {
    const materialNames = [...new Set(boxes.map((item) => item.material))];
    const grouped = new Map(materialNames.map((material) => [material, {
        positions: [],
        normals: [],
        uvs: [],
        indices: []
    }]));

    for (const definition of boxes) {
        (definition.faces ? appendMesh : appendBox)(grouped.get(definition.material), definition);
    }
    for (const [materialName, geometry] of grouped) validateWinding(name, materialName, geometry);

    const gltf = {
        asset: { version: '2.0', generator: 'yx_shellcreator build-kit generator' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name, mesh: 0 }],
        meshes: [{ name, primitives: [] }],
        materials: materialNames.map((materialName) => ({
            name: materialName,
            pbrMetallicRoughness: {
                baseColorFactor: materials[materialName],
                metallicFactor: 0,
                roughnessFactor: 0.82
            },
            doubleSided: false
        })),
        accessors: [],
        bufferViews: [],
        buffers: [{ byteLength: 0 }]
    };

    const chunks = [];
    let byteOffset = 0;
    const addBufferView = (buffer, target) => {
        const aligned = alignedBuffer(buffer);
        const viewIndex = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length, target });
        chunks.push(aligned);
        byteOffset += aligned.length;
        return viewIndex;
    };
    const addAccessor = (bufferView, componentType, count, type, extra = {}) => {
        const accessorIndex = gltf.accessors.length;
        gltf.accessors.push({ bufferView, componentType, count, type, ...extra });
        return accessorIndex;
    };

    for (const [materialIndex, materialName] of materialNames.entries()) {
        const geometry = grouped.get(materialName);
        const bounds = minMaxPositions(geometry.positions);
        const positionView = addBufferView(floatBuffer(geometry.positions), 34962);
        const normalView = addBufferView(floatBuffer(geometry.normals), 34962);
        const uvView = addBufferView(floatBuffer(geometry.uvs), 34962);
        const indexView = addBufferView(indexBuffer(geometry.indices), 34963);
        const vertexCount = geometry.positions.length / 3;

        gltf.meshes[0].primitives.push({
            attributes: {
                POSITION: addAccessor(positionView, 5126, vertexCount, 'VEC3', bounds),
                NORMAL: addAccessor(normalView, 5126, vertexCount, 'VEC3'),
                TEXCOORD_0: addAccessor(uvView, 5126, geometry.uvs.length / 2, 'VEC2')
            },
            indices: addAccessor(indexView, 5123, geometry.indices.length, 'SCALAR'),
            material: materialIndex,
            mode: 4
        });
    }

    const binaryChunk = Buffer.concat(chunks);
    gltf.buffers[0].byteLength = binaryChunk.length;
    const jsonChunk = alignedBuffer(Buffer.from(JSON.stringify(gltf), 'utf8'), 4, 0x20);
    const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunk.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binaryHeader = Buffer.alloc(8);
    binaryHeader.writeUInt32LE(binaryChunk.length, 0);
    binaryHeader.writeUInt32LE(0x004e4942, 4);

    fs.mkdirSync(outputDirectory, { recursive: true });
    // Local binary compiler input: same geometry as the GLB, no online conversion.
    fs.writeFileSync(path.join(outputDirectory, `${name}.mesh.json`), JSON.stringify({
        name, geometries: [...grouped].map(([material, geometry]) => ({ material, ...geometry }))
    }));
    fs.writeFileSync(path.join(outputDirectory, `${name}.glb`), Buffer.concat([
        header,
        jsonHeader,
        jsonChunk,
        binaryHeader,
        binaryChunk
    ]));
}

const floorSize = 2.5;
const floorThickness = 0.12;
const wallWidth = 2.5;
const wallHeight = 3.0;
const wallThickness = 0.16;

const oakFloor = [box([0, floorThickness * 0.42, 0], [floorSize, floorThickness * 0.84, floorSize], 'oakEdge')];
const plankCount = 10;
const plankWidth = floorSize / plankCount;
for (let index = 0; index < plankCount; index += 1) {
    const centerX = (-floorSize * 0.5) + (plankWidth * (index + 0.5));
    oakFloor.push(box(
        [centerX, floorThickness * 0.92, 0],
        [plankWidth - 0.008, floorThickness * 0.16, floorSize - 0.012],
        ['oakA', 'oakB', 'oakC', 'oakB'][index % 4]
    ));
}

const tileFloor = [box([0, floorThickness * 0.42, 0], [floorSize, floorThickness * 0.84, floorSize], 'grout')];
const tileCount = 4;
const tileSize = floorSize / tileCount;
for (let x = 0; x < tileCount; x += 1) {
    for (let z = 0; z < tileCount; z += 1) {
        tileFloor.push(box(
            [(-floorSize * 0.5) + (tileSize * (x + 0.5)), floorThickness * 0.92, (-floorSize * 0.5) + (tileSize * (z + 0.5))],
            [tileSize - 0.018, floorThickness * 0.16, tileSize - 0.018],
            ((x + z) % 3 === 0) ? 'tileB' : 'tileA'
        ));
    }
}

const whiteWall = [
    box([0, wallHeight * 0.5, 0], [wallWidth, wallHeight, wallThickness], 'plaster'),
    box([0, 0.065, (wallThickness * 0.5) + 0.018], [wallWidth, 0.13, 0.036], 'trim'),
    box([0, 0.065, -(wallThickness * 0.5) - 0.018], [wallWidth, 0.13, 0.036], 'trim')
];

const openingWidth = 1.0;
const openingHeight = 2.15;
const sideWidth = (wallWidth - openingWidth) * 0.5;
const doorwayWall = [
    box([-(openingWidth + sideWidth) * 0.5, wallHeight * 0.5, 0], [sideWidth, wallHeight, wallThickness], 'plaster'),
    box([(openingWidth + sideWidth) * 0.5, wallHeight * 0.5, 0], [sideWidth, wallHeight, wallThickness], 'plaster'),
    box([0, openingHeight + ((wallHeight - openingHeight) * 0.5), 0], [openingWidth, wallHeight - openingHeight, wallThickness], 'plaster'),
    box([-(openingWidth * 0.5) - 0.035, openingHeight * 0.5, (wallThickness * 0.5) + 0.018], [0.07, openingHeight, 0.036], 'trim'),
    box([(openingWidth * 0.5) + 0.035, openingHeight * 0.5, (wallThickness * 0.5) + 0.018], [0.07, openingHeight, 0.036], 'trim'),
    box([0, openingHeight + 0.035, (wallThickness * 0.5) + 0.018], [openingWidth + 0.14, 0.07, 0.036], 'trim'),
    box([-(openingWidth * 0.5) - 0.035, openingHeight * 0.5, -(wallThickness * 0.5) - 0.018], [0.07, openingHeight, 0.036], 'trim'),
    box([(openingWidth * 0.5) + 0.035, openingHeight * 0.5, -(wallThickness * 0.5) - 0.018], [0.07, openingHeight, 0.036], 'trim'),
    box([0, openingHeight + 0.035, -(wallThickness * 0.5) - 0.018], [openingWidth + 0.14, 0.07, 0.036], 'trim')
];

const concreteFloor = [
    box([0, floorThickness * 0.5, 0], [floorSize, floorThickness, floorSize], 'concreteDark'),
    box([0, floorThickness + 0.012, 0], [floorSize - 0.018, 0.024, floorSize - 0.018], 'concrete')
];

const darkWoodFloor = [box([0, floorThickness * 0.42, 0], [floorSize, floorThickness * 0.84, floorSize], 'darkWoodEdge')];
for (let index = 0; index < plankCount; index += 1) {
    const centerX = (-floorSize * 0.5) + (plankWidth * (index + 0.5));
    darkWoodFloor.push(box(
        [centerX, floorThickness * 0.92, 0],
        [plankWidth - 0.008, floorThickness * 0.16, floorSize - 0.012],
        index % 2 === 0 ? 'darkWoodA' : 'darkWoodB'
    ));
}

const concreteWall = [
    box([0, wallHeight * 0.5, 0], [wallWidth, wallHeight, wallThickness], 'concrete'),
    box([0, 0.06, (wallThickness * 0.5) + 0.012], [wallWidth, 0.12, 0.024], 'concreteDark'),
    box([0, 0.06, -(wallThickness * 0.5) - 0.012], [wallWidth, 0.12, 0.024], 'concreteDark')
];

const charcoalWall = [
    box([0, wallHeight * 0.5, 0], [wallWidth, wallHeight, wallThickness], 'charcoal'),
    box([0, 0.065, (wallThickness * 0.5) + 0.018], [wallWidth, 0.13, 0.036], 'charcoalSide'),
    box([0, 0.065, -(wallThickness * 0.5) - 0.018], [wallWidth, 0.13, 0.036], 'charcoalSide')
];

const concreteDoorway = doorwayWall.map((definition) => ({
    ...definition,
    material: definition.material === 'trim' ? 'concreteDark' : 'concrete'
}));

const woodDoor = [
    box([0, 1.05, 0], [0.94, 2.10, 0.075], 'doorWood'),
    box([0, 1.54, 0.043], [0.70, 0.72, 0.018], 'doorWoodInset'),
    box([0, 0.56, 0.043], [0.70, 0.72, 0.018], 'doorWoodInset'),
    box([0, 1.54, -0.043], [0.70, 0.72, 0.018], 'doorWoodInset'),
    box([0, 0.56, -0.043], [0.70, 0.72, 0.018], 'doorWoodInset'),
    box([0.34, 1.02, 0.082], [0.11, 0.045, 0.13], 'metal'),
    box([0.34, 1.02, -0.082], [0.11, 0.045, 0.13], 'metal')
];

const modernDoor = [
    box([0, 1.05, 0], [0.94, 2.10, 0.075], 'doorDark'),
    box([0, 1.68, 0.043], [0.76, 0.025, 0.018], 'metal'),
    box([0, 1.28, 0.043], [0.76, 0.025, 0.018], 'metal'),
    box([0, 0.88, 0.043], [0.76, 0.025, 0.018], 'metal'),
    box([0, 0.48, 0.043], [0.76, 0.025, 0.018], 'metal'),
    box([0.34, 1.02, 0.082], [0.12, 0.04, 0.13], 'metal'),
    box([0.34, 1.02, -0.082], [0.12, 0.04, 0.13], 'metal')
];

function staircase(material, sideMaterial) {
    const steps = [];
    const stepCount = 20;
    const run = 5.0;
    const rise = 3.0;
    const stepDepth = run / stepCount;
    const stepHeight = rise / stepCount;
    for (let index = 0; index < stepCount; index += 1) {
        const height = stepHeight * (index + 1);
        steps.push(box(
            [0, height * 0.5, (-run * 0.5) + (stepDepth * (index + 0.5))],
            [1.40, height, stepDepth + 0.006],
            index % 3 === 0 ? sideMaterial : material
        ));
    }
    return steps;
}

const oakStairs = staircase('stairOak', 'doorWoodInset');
const concreteStairs = staircase('concrete', 'concreteDark');
// No rotated-box end lip: the top meets the floor at exactly 0m and 3m.
const stairCollision = [
    solidQuad('collisionProxy', [[-0.70, 0, -2.5], [-0.70, 3, 2.5], [0.70, 3, 2.5], [0.70, 0, -2.5]],
        [[-0.70, -0.08, -2.5], [-0.70, 2.92, 2.5], [0.70, 2.92, 2.5], [0.70, -0.08, -2.5]])
];

function spiral(material, smooth = false) {
    const pieces = [];
    const count = smooth ? 80 : 20;
    const sweep = Math.PI * 1.5;
    const point = (radius, angle, height) => [radius * Math.cos(angle), height, radius * Math.sin(angle)];
    for (let i = 0; i < count; i++) {
        const a = sweep * i / count, b = sweep * (i + 1) / count;
        const low = smooth ? 3 * i / count : 3 * (i + 1) / count;
        const high = 3 * (i + 1) / count;
        const top = [point(0.55, a, low), point(0.55, b, high), point(1.85, b, high), point(1.85, a, low)];
        pieces.push(solidQuad(material, top, top.map(([x, y, z]) => [x, y - 0.10, z])));
    }
    // Inner and outer posts provide a visible/collidable guard without narrowing
    // the 1.3m tread. Keep both landings open for connecting the floor above/below.
    for (let i = 1; i < 20; i++) {
        const angle = sweep * i / 20;
        for (const radius of [0.52, 1.88]) {
            pieces.push(box(point(radius, angle, 3 * i / 20 + 0.48), [0.055, 0.96, 0.055], material));
        }
    }
    for (let i = 0; i < 20; i++) {
        const a = sweep * i / 20, b = sweep * (i + 1) / 20;
        for (const radius of [0.52, 1.88]) {
            const top = [point(radius - 0.025, a, 3*i/20 + 0.96), point(radius - 0.025, b, 3*(i+1)/20 + 0.96),
                point(radius + 0.025, b, 3*(i+1)/20 + 0.96), point(radius + 0.025, a, 3*i/20 + 0.96)];
            pieces.push(solidQuad(material, top, top.map(([x,y,z]) => [x,y-0.045,z])));
        }
    }
    return pieces;
}

writeGlb('yx_floor_oak', oakFloor);
writeGlb('yx_floor_tile', tileFloor);
writeGlb('yx_floor_concrete', concreteFloor);
writeGlb('yx_floor_darkwood', darkWoodFloor);
writeGlb('yx_wall_white', whiteWall);
writeGlb('yx_wall_concrete', concreteWall);
writeGlb('yx_wall_charcoal', charcoalWall);
writeGlb('yx_wall_doorway', doorwayWall);
writeGlb('yx_wall_doorway_concrete', concreteDoorway);
writeGlb('yx_door_wood', woodDoor);
writeGlb('yx_door_modern', modernDoor);
writeGlb('yx_stairs_oak', oakStairs);
writeGlb('yx_stairs_concrete', concreteStairs);
writeGlb('yx_stairs_collision', stairCollision);
writeGlb('yx_spiral_oak', spiral('stairOak'));
writeGlb('yx_spiral_concrete', spiral('concrete'));
writeGlb('yx_spiral_collision', spiral('collisionProxy', true));

console.log(`Generated 17 GLB source models in ${outputDirectory}`);
