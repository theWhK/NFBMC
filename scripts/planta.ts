// Checagem da planta de Porto Gordo (rode antes de commitar mudanças no mapa):
//   node scripts/planta.ts [saida.svg]
// - ruas que se cruzam sem cruzamento (fora as obras de arte, que passam por cima/baixo);
// - obras de arte: altura livre sobre as ruas de baixo e a água, cobertura dos túneis;
// - rampa máxima das ruas (no chão e nas obras);
// - corridas só em rua (cada amostra no nível dela);
// - desenha o mapa de cima num SVG (o mesmo sentido do mapa do jogo: +X para a esquerda).
import { writeFileSync } from "node:fs";
import {
  AIRPORT,
  BUILDINGS,
  DISTRICTS,
  LAKE,
  LANDMARKS,
  NAV,
  QUAY_Z,
  RACES,
  RACE_IDS,
  RIVER,
  ROADS,
  ROUNDABOUTS,
  STRUCTURES,
  WORLD_BOUNDS,
  heightAt,
  isOnRoad,
  raceMarker,
  trackCorridor,
} from "../shared/src/index.ts";
import { TUNNEL_COVER, UNDER_CLEARANCE, locate } from "../shared/src/levels.ts";

type P = [number, number];
const problems: string[] = [];

// --- Cruzamentos sem nó --------------------------------------------------------
function segInter(a: P, b: P, c: P, d: P): P | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + rx * t, a[1] + rz * t];
}
const boxes = ROADS.map((r) => {
  const xs = r.points.map((p) => p[0]);
  const zs = r.points.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
});
const nodePos = new Map(NAV.map((n) => [n.id, [n.x, n.z] as P]));
let crossings = 0;
const structureCrossings: string[] = [];
for (let i = 0; i < ROADS.length; i++) {
  for (let j = i + 1; j < ROADS.length; j++) {
    const [a0, a1, a2, a3] = boxes[i];
    const [b0, b1, b2, b3] = boxes[j];
    if (a1 < b0 || b1 < a0 || a3 < b2 || b3 < a2) continue;
    const ri = ROADS[i];
    const rj = ROADS[j];
    const shared = [ri.a, ri.b].filter((n) => n === rj.a || n === rj.b);
    let found: P | null = null;
    outer: for (let a = 0; a < ri.points.length - 1; a++) {
      for (let b = 0; b < rj.points.length - 1; b++) {
        const hit = segInter(ri.points[a], ri.points[a + 1], rj.points[b], rj.points[b + 1]);
        if (!hit) continue;
        if (shared.some((n) => Math.hypot(nodePos.get(n)![0] - hit[0], nodePos.get(n)![1] - hit[1]) < 8)) continue;
        found = hit;
        break outer;
      }
    }
    if (!found) continue;
    if (ri.structure >= 0 || rj.structure >= 0) {
      const st = STRUCTURES[ri.structure >= 0 ? ri.structure : rj.structure];
      const other = ri.structure >= 0 ? rj : ri;
      const loc = locate(st, found[0], found[1], 5)!;
      const gap = st.kind === "tunel" ? loc.ground - loc.y : loc.y - loc.ground;
      const ok = other.structure >= 0 ? false : st.kind === "tunel" ? gap >= TUNNEL_COVER : gap >= UNDER_CLEARANCE + 0.5;
      structureCrossings.push(`${st.name} x ${other.a}-${other.b} (${other.kind}): ${gap.toFixed(1)} m ${ok ? "ok" : "BAIXO"}`);
      if (!ok) problems.push(`obra ${st.name} cruza ${other.a}-${other.b} com só ${gap.toFixed(1)} m`);
      continue;
    }
    crossings++;
    problems.push(`ruas ${ri.a}-${ri.b} e ${rj.a}-${rj.b} se cruzam sem cruzamento em (${found[0].toFixed(0)}, ${found[1].toFixed(0)})`);
  }
}

// --- Obras de arte ----------------------------------------------------------------
const structureReport: string[] = [];
for (const st of STRUCTURES) {
  let maxGrade = 0;
  let maxAt = 0;
  let maxGap = 0;
  let minWater = Infinity;
  for (let i = 1; i < st.points.length; i++) {
    // No túnel, as pontas são a encosta do morro (rua no chão): conta só o miolo.
    if (st.kind === "tunel" && (st.s[i] < 25 || st.s[i] > st.length - 25)) continue;
    const g = Math.abs(st.y[i] - st.y[i - 1]) / (st.s[i] - st.s[i - 1]);
    if (g > maxGrade) {
      maxGrade = g;
      maxAt = st.s[i];
    }
    const gap = st.kind === "tunel" ? st.ground[i] - st.y[i] : st.y[i] - st.ground[i];
    maxGap = Math.max(maxGap, gap);
  }
  if (st.kind !== "tunel") {
    for (let i = 0; i < st.points.length; i++) {
      const [x, z] = st.points[i];
      const wet = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 < 1 || heightAt(x, z) < (RIVER.floor[RIVER.floor.length - 1] ?? 0) - 1 || z < QUAY_Z;
      if (wet) minWater = Math.min(minWater, st.y[i] - Math.min(heightAt(x, z), 0));
    }
  }
  if (maxGrade > 0.12) problems.push(`${st.name}: rampa de ${(maxGrade * 100).toFixed(1)}%`);
  structureReport.push(`${st.kind.padEnd(7)} ${st.name.padEnd(22)} ${st.length.toFixed(0).padStart(5)} m, ${st.kind === "tunel" ? "cobertura" : "altura"} máx ${maxGap.toFixed(1)} m, rampa máx ${(maxGrade * 100).toFixed(1)}% (em ${maxAt.toFixed(0)} m), trecho fora do chão ${(st.sOut - st.sIn).toFixed(0)} m, ${st.pillars.length} pilares`);
}

// --- Rampas das ruas no chão --------------------------------------------------------
let worst = { grade: 0, road: "" };
for (const road of ROADS) {
  if (road.structure >= 0) continue;
  const p = road.points;
  for (let i = 4; i < p.length; i += 2) {
    const d = Math.hypot(p[i][0] - p[i - 4][0], p[i][1] - p[i - 4][1]);
    const g = Math.abs(heightAt(...p[i]) - heightAt(...p[i - 4])) / d;
    if (g > worst.grade) worst = { grade: g, road: `${road.a}-${road.b} (${road.kind}) em (${p[i][0].toFixed(0)}, ${p[i][1].toFixed(0)})` };
  }
}
if (worst.grade > 0.18) problems.push(`rampa de ${(worst.grade * 100).toFixed(1)}% em ${worst.road}`);

// --- Corridas -----------------------------------------------------------------------
const raceReport: string[] = [];
for (const id of RACE_IDS) {
  const track = RACES[id].track;
  let off = 0;
  const levels = track.levels;
  track.samples.forEach((s, i) => {
    if (!isOnRoad(s.x, s.z, levels?.[i] ?? -1)) off++;
  });
  const onStructure = levels ? new Set([...levels].filter((l) => l >= 0)).size : 0;
  trackCorridor(track);
  raceReport.push(`${id.padEnd(15)} ${(track.length / 1000).toFixed(2)} km x${RACES[id].laps}  obras: ${onStructure}  fora da rua: ${off}`);
  if (off > 8) problems.push(`corrida ${id}: ${off} amostras fora da rua`);
}

console.log(`Ruas: ${ROADS.length}, cruzamentos: ${NAV.length}, prédios: ${BUILDINGS.length}, lanchonetes/garagens: ${LANDMARKS.length}`);
console.log(`Rampa máxima no chão: ${(worst.grade * 100).toFixed(1)}% (${worst.road})`);
console.log("\nObras de arte:\n  " + structureReport.join("\n  "));
console.log("\nObras cruzando ruas:\n  " + structureCrossings.join("\n  "));
console.log("\nCorridas:\n  " + raceReport.join("\n  "));
console.log(`\nProblemas (${problems.length}):\n  ` + problems.slice(0, 60).join("\n  "));

// --- Desenho -------------------------------------------------------------------------
const out = process.argv[2];
if (out) {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const scale = Number(process.argv[3] ?? 0.5);
  const W = (maxX - minX) * scale;
  const H = (maxZ - minZ) * scale;
  const X = (x: number) => ((maxX - x) * scale).toFixed(1);
  const Z = (z: number) => ((maxZ - z) * scale).toFixed(1);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#24506e">`);
  for (const d of DISTRICTS) parts.push(`<polygon points="${d.polygon.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ")}" fill="${d.ground}" stroke="#222" stroke-width="1" opacity="0.9"/>`);
  // Relevo: curvas de nível a cada 10 m (pontinhos).
  for (let x = minX; x < maxX; x += 40) for (let z = minZ; z < maxZ; z += 40) {
    const h = heightAt(x, z);
    if (h > 8) parts.push(`<rect x="${X(x)}" y="${Z(z)}" width="${40 * scale}" height="${40 * scale}" fill="#000" opacity="${Math.min(0.35, h / 200).toFixed(2)}"/>`);
  }
  // Rio e lago.
  parts.push(`<polyline points="${RIVER.points.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ")}" fill="none" stroke="#2f7aa0" stroke-width="${50 * scale}" stroke-linejoin="round"/>`);
  parts.push(`<ellipse cx="${X(LAKE.x)}" cy="${Z(LAKE.z)}" rx="${LAKE.rx * scale}" ry="${LAKE.rz * scale}" fill="#2f7aa0"/>`);
  for (const b of BUILDINGS) {
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    const pts = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([u, v]) => [b.x + c * u * b.w / 2 + s * v * b.d / 2, b.z - s * u * b.w / 2 + c * v * b.d / 2]);
    const fill = b.kind === "tower" ? "#3b3b48" : b.kind === "landmark" ? "#ff3a8c" : "#b9ad9a";
    parts.push(`<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ")}" fill="${fill}"/>`);
  }
  const color = { rodovia: "#f0b419", avenida: "#f4efe6", rua: "#d8d0c4", viela: "#c4b8a8", pista: "#9a9a9a", taxiway: "#b0b0a0" } as const;
  const order = [...ROADS].sort((a, b) => (a.structure >= 0 ? 1 : 0) - (b.structure >= 0 ? 1 : 0));
  for (const r of order) {
    const pts = r.points.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ");
    if (r.structure >= 0) {
      const st = STRUCTURES[r.structure];
      const c = st.kind === "tunel" ? "#7a2bd9" : st.kind === "ponte" ? "#ff4a2a" : "#ff8c00";
      parts.push(`<polyline points="${pts}" fill="none" stroke="#111" stroke-width="${r.width * scale + 4}" ${st.kind === "tunel" ? 'stroke-dasharray="6 4"' : ""}/>`);
      parts.push(`<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${r.width * scale}"/>`);
      for (const p of st.pillars) parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="1.5" fill="#000"/>`);
    } else {
      parts.push(`<polyline points="${pts}" fill="none" stroke="${color[r.kind]}" stroke-width="${Math.max(1, r.width * scale)}" stroke-linejoin="round"/>`);
    }
  }
  for (const ra of ROUNDABOUTS) parts.push(`<circle cx="${X(ra.x)}" cy="${Z(ra.z)}" r="${(ra.r - 12) * scale}" fill="#4a8a3a"/>`);
  const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, c: string) =>
    parts.push(`<rect x="${X(b.maxX)}" y="${Z(b.maxZ)}" width="${(b.maxX - b.minX) * scale}" height="${(b.maxZ - b.minZ) * scale}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/>`);
  box(AIRPORT.area, "#fff");
  box(AIRPORT.apron, "#0ff");
  box(AIRPORT.terminal, "#f0f");
  box(AIRPORT.hangars, "#ff0");
  const palette = ["#ff2a6d", "#05d9e8", "#d1f7ff", "#ff9a1f", "#7cff4f", "#c56cf0", "#ffe14f", "#ff6b6b"];
  if (process.argv.includes("--corridas")) {
    RACE_IDS.forEach((id, k) => {
      const t = RACES[id].track;
      parts.push(`<polyline points="${t.samples.filter((_, i) => i % 3 === 0).map((s) => `${X(s.x)},${Z(s.z)}`).join(" ")}" fill="none" stroke="${palette[k % palette.length]}" stroke-width="2.5" opacity="0.85"/>`);
      const m = raceMarker(id);
      parts.push(`<text x="${X(m.x)}" y="${Z(m.z)}" font-size="13" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="0.6">${id}</text>`);
    });
  }
  if (process.argv.includes("--nos")) {
    for (const n of NAV) if (!n.id.includes("~") && !/^x\d/.test(n.id)) parts.push(`<text x="${X(n.x)}" y="${Z(n.z)}" font-size="9" font-family="sans-serif" fill="#000">${n.id}</text>`);
  }
  for (const d of DISTRICTS) {
    const cx = d.polygon.reduce((s, p) => s + p[0], 0) / d.polygon.length;
    const cz = d.polygon.reduce((s, p) => s + p[1], 0) / d.polygon.length;
    parts.push(`<text x="${X(cx)}" y="${Z(cz)}" font-size="16" font-family="sans-serif" font-weight="bold" fill="#fff" stroke="#000" stroke-width="0.8" text-anchor="middle">${d.name}</text>`);
  }
  for (const st of STRUCTURES) {
    const [x, z] = st.points[Math.floor(st.points.length / 2)];
    parts.push(`<text x="${X(x)}" y="${Z(z)}" font-size="11" font-family="sans-serif" fill="#ffe" stroke="#000" stroke-width="0.5">${st.name}</text>`);
  }
  parts.push("</svg>");
  writeFileSync(out, parts.join("\n"));
  console.log(`\nMapa: ${out}`);
}
