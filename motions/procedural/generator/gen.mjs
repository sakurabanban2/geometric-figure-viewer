import fs from "node:fs";
import path from "node:path";

const OUT = "C:\\Users\\ranak\\geometric-figure-viewer\\motions\\procedural";
fs.mkdirSync(OUT, { recursive: true });

const FPS = 30;
const L1 = 42;
const L2 = 42;
const ARM1 = 28;
const ARM2 = 25;
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;

const JOINTS = [
  ["Hips", null, [0, 0, 0]],
  ["LeftUpLeg", "Hips", [9, -4, 0]],
  ["LeftLeg", "LeftUpLeg", [0, -L1, 0]],
  ["LeftFoot", "LeftLeg", [0, -L2, 0]],
  ["LeftToeBase", "LeftFoot", [0, -7, 11], [0, 0, 5]],
  ["RightUpLeg", "Hips", [-9, -4, 0]],
  ["RightLeg", "RightUpLeg", [0, -L1, 0]],
  ["RightFoot", "RightLeg", [0, -L2, 0]],
  ["RightToeBase", "RightFoot", [0, -7, 11], [0, 0, 5]],
  ["Spine", "Hips", [0, 10, 0]],
  ["Spine1", "Spine", [0, 15, 0]],
  ["Neck", "Spine1", [0, 18, 0]],
  ["Head", "Neck", [0, 8, 0], [0, 16, 0]],
  ["LeftShoulder", "Spine1", [3, 15, 0]],
  ["LeftArm", "LeftShoulder", [14, 0, 0]],
  ["LeftForeArm", "LeftArm", [0, -ARM1, 0]],
  ["LeftHand", "LeftForeArm", [0, -ARM2, 0], [0, -10, 0]],
  ["RightShoulder", "Spine1", [-3, 15, 0]],
  ["RightArm", "RightShoulder", [-14, 0, 0]],
  ["RightForeArm", "RightArm", [0, -ARM1, 0]],
  ["RightHand", "RightForeArm", [0, -ARM2, 0], [0, -10, 0]],
];

function hierarchy() {
  const lines = [];
  const children = (name) => JOINTS.filter((joint) => joint[1] === name);
  const write = (joint, depth) => {
    const pad = "  ".repeat(depth);
    const [name, parent, offset, end] = joint;
    lines.push(`${pad}${parent ? "JOINT" : "ROOT"} ${name}`);
    lines.push(`${pad}{`);
    lines.push(`${pad}  OFFSET ${offset.map((v) => v.toFixed(4)).join(" ")}`);
    lines.push(`${pad}  CHANNELS ${parent ? "3" : "6 Xposition Yposition Zposition"} Zrotation Xrotation Yrotation`);
    for (const child of children(name)) write(child, depth + 1);
    if (end) {
      lines.push(`${pad}  End Site`);
      lines.push(`${pad}  {`);
      lines.push(`${pad}    OFFSET ${end.map((v) => v.toFixed(4)).join(" ")}`);
      lines.push(`${pad}  }`);
    }
    lines.push(`${pad}}`);
  };
  write(JOINTS[0], 0);
  return lines.join("\n");
}

// Planar (y, z) helpers. A limb with world pitch phi points along (-cos phi, -sin phi).
const dirOf = (phi) => [-Math.cos(phi), -Math.sin(phi)];
const rot = ([y, z], a) => [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

function twoBone(root, target, a, b, bendBack = true) {
  const d = [target[0] - root[0], target[1] - root[1]];
  const reach = Math.min(Math.hypot(d[0], d[1]), a + b - 1e-3);
  const phiD = Math.atan2(-d[1], -d[0]);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + reach * reach - b * b) / (2 * a * reach))));
  const inner = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - reach * reach) / (2 * a * b))));
  const bend = Math.PI - inner;
  return bendBack ? { upper: phiD - alpha, bend } : { upper: phiD + alpha, bend: -bend };
}

function frameOf(pose) {
  const values = [];
  for (const [name, parent] of JOINTS) {
    const r = pose.rot[name] ?? [0, 0, 0];
    if (!parent) values.push(...pose.root, r[0], r[1], r[2]);
    else values.push(r[0], r[1], r[2]);
  }
  return values.map((v) => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(4)).join(" ");
}

function writeMotion(file, seconds, poseAt) {
  const frames = Math.round(seconds * FPS);
  const body = [];
  for (let index = 0; index < frames; index += 1) body.push(frameOf(poseAt(index / FPS, seconds)));
  const text = `HIERARCHY\n${hierarchy()}\nMOTION\nFrames: ${frames}\nFrame Time: ${(1 / FPS).toFixed(8)}\n${body.join("\n")}\n`;
  fs.writeFileSync(path.join(OUT, file), text);
  console.log(file, frames, "frames");
}

// Leg with fixed ankle target; returns local X rotations (degrees) for UpLeg, Leg, Foot.
function plantedLeg(rootYZ, pelvisPitch, ankle, footWorld = 0) {
  const legRoot = add(rootYZ, rot([-4, 0], pelvisPitch));
  const { upper, bend } = twoBone(legRoot, ankle, L1, L2);
  return { up: deg(upper - pelvisPitch), knee: deg(bend), foot: deg(footWorld - upper - bend) };
}

// Kneeling leg: knee fixed on the floor, shin lying backward.
function kneelingRoot(knee, thigh, pelvisPitch) {
  const legRoot = add(knee, scale([Math.cos(thigh), Math.sin(thigh)], L1));
  return add(legRoot, scale([Math.cos(pelvisPitch), Math.sin(pelvisPitch)], 4));
}
function kneelingLeg(thigh, pelvisPitch) {
  const shin = Math.PI / 2;
  return { up: deg(thigh - pelvisPitch), knee: deg(shin - thigh), foot: 57 };
}

function arms(rot, { raise = 0, spread = 15, elbow = -20, twist = 0 }) {
  rot.LeftArm = [spread, raise, twist];
  rot.RightArm = [-spread, raise, -twist];
  rot.LeftForeArm = [0, elbow, 0];
  rot.RightForeArm = [0, elbow, 0];
}

const wave = (t, period, phase = 0) => Math.sin((TAU * t) / period + phase);
const ease = (t, period, phase = 0) => {
  const s = wave(t, period, phase);
  return Math.sign(s) * Math.pow(Math.abs(s), 0.7);
};

writeMotion("hip-thrust-standing.bvh", 6.6, (t) => {
  const s = ease(t, 0.55);
  const P = rad(-12 * s);
  const root = [91 + 1.2 * wave(t, 0.275), 6 * s];
  const rot = {};
  rot.Hips = [0, deg(P), 0];
  for (const [side, x] of [["Left", 1], ["Right", -1]]) {
    const leg = plantedLeg(root, P, [7, 0]);
    rot[`${side}UpLeg`] = [x * 6, leg.up, 0];
    rot[`${side}Leg`] = [0, leg.knee, 0];
    rot[`${side}Foot`] = [0, leg.foot, 0];
  }
  rot.Spine = [0, 9 * s, 0];
  rot.Spine1 = [0, 5 * s + 3, 0];
  rot.Neck = [0, -3 * s, 0];
  rot.Head = [0, 4 * wave(t, 0.55, 0.6), 0];
  arms(rot, { raise: -20, spread: 22, elbow: -85, twist: 20 });
  return { root: [0, root[0], root[1]], rot };
});

function riding(t, { bounce, grind, period }) {
  const s = wave(t, period);
  const thigh = rad(-25 + bounce * s);
  const P = rad(10 + grind * wave(t, period, Math.PI / 2));
  const root = kneelingRoot([6, 0], thigh, P);
  const rot = {};
  rot.Hips = [0, deg(P), 0];
  for (const [side, x] of [["Left", 1], ["Right", -1]]) {
    const leg = kneelingLeg(thigh, P);
    rot[`${side}UpLeg`] = [x * 18, leg.up, 0];
    rot[`${side}Leg`] = [0, leg.knee, 0];
    rot[`${side}Foot`] = [0, leg.foot, 0];
  }
  rot.Spine = [0, 8 - 0.5 * deg(P - rad(10)), 0];
  rot.Spine1 = [0, 6 - 0.3 * deg(P - rad(10)), 0];
  rot.Neck = [0, -6, 0];
  rot.Head = [0, -6 + 5 * wave(t, period, 1.2), 0];
  arms(rot, { raise: -45, spread: 12, elbow: -25 });
  return { root: [0, root[0], root[1]], rot };
}

writeMotion("riding-up-down.bvh", 6.4, (t) => riding(t, { bounce: 22, grind: 6, period: 0.8 }));
writeMotion("riding-grind.bvh", 6.0, (t) => riding(t, { bounce: 6, grind: 18, period: 1.0 }));

writeMotion("all-fours-rocking.bvh", 6.3, (t) => {
  const s = ease(t, 0.7);
  const thigh = rad(6 * s);
  const P = rad(60 + 4 * s);
  const root = kneelingRoot([6, 0], thigh, P);
  const rot = {};
  rot.Hips = [0, deg(P), 0];
  for (const [side, x] of [["Left", 1], ["Right", -1]]) {
    const leg = kneelingLeg(thigh, P);
    rot[`${side}UpLeg`] = [x * 8, leg.up, 0];
    rot[`${side}Leg`] = [0, leg.knee, 0];
    rot[`${side}Foot`] = [0, leg.foot, 0];
  }
  const s1 = rad(25);
  const s2 = rad(12 - 3 * s);
  rot.Spine = [0, deg(s1), 0];
  rot.Spine1 = [0, deg(s2), 0];
  rot.Neck = [0, -50, 0];
  rot.Head = [0, -15 + 4 * wave(t, 0.7, 0.8), 0];
  const chest = P + s1 + s2;
  const spine = add(root, rot2([0, 10], P));
  const spine1 = add(spine, rot2([0, 15], P + s1));
  const shoulder = add(spine1, rot2([0, 15], chest));
  const hand = [6, 44];
  const arm = twoBone(shoulder, hand, ARM1, ARM2, false);
  rot.LeftArm = [8, deg(arm.upper - chest), 0];
  rot.RightArm = [-8, deg(arm.upper - chest), 0];
  rot.LeftForeArm = [0, deg(arm.bend), 0];
  rot.RightForeArm = [0, deg(arm.bend), 0];
  rot.LeftHand = [0, deg(-Math.PI / 2 - arm.upper - arm.bend), 0];
  rot.RightHand = [0, deg(-Math.PI / 2 - arm.upper - arm.bend), 0];
  return { root: [0, root[0], root[1]], rot };
});

function rot2(v, a) {
  return rot(v, a);
}

writeMotion("bridge-hip-thrust-lying.bvh", 6.0, (t) => {
  const s = (1 - Math.cos((TAU * t) / 1.2)) / 2;
  const lift = 26 * Math.pow(s, 0.8);
  const rootY = 12 + lift;
  const tilt = Math.atan2(lift, 45);
  const P = -Math.PI / 2 + tilt;
  const root = [rootY, 0];
  const rot = {};
  rot.Hips = [0, deg(P), 0];
  for (const [side, x] of [["Left", 1], ["Right", -1]]) {
    const leg = plantedLeg(root, P, [7, 44]);
    rot[`${side}UpLeg`] = [x * (16 + 8 * wave(t, 1.2, Math.PI)), leg.up, 0];
    rot[`${side}Leg`] = [0, leg.knee, 0];
    rot[`${side}Foot`] = [0, leg.foot, 0];
  }
  rot.Spine = [0, -deg(tilt) * 0.6, 0];
  rot.Spine1 = [0, -deg(tilt) * 0.4, 0];
  rot.Neck = [0, 20, 0];
  rot.Head = [0, 10, 0];
  arms(rot, { raise: 0, spread: 18, elbow: 0 });
  return { root: [0, root[0], root[1]], rot };
});
