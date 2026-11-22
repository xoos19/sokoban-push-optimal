// A push-optimal Sokoban solver, written for this competition.
//
// The idea: a generated level is a hallway with independent rooms off it
// (each room 3 or 4 boxes, one door), and a box pushed out of a room can
// never come back — so the level's push-optimum is the sum of its rooms'
// optima, and each room can be solved on its own. For each room the solver
// runs a breadth-first search over pushes (the first solved state it meets
// is push-optimal), with two prunings that never cut a solvable state:
// dead squares (a box there can never reach a goal, found by pulling back
// from the goals) and frozen 2x2 blocks of walls and boxes. The search is
// capped by a fixed number of states, never by the clock, so two runs of
// the program answer byte for byte alike.
//
// Moves are written in LURD (a lower letter a step, an upper one a push);
// only pushes count for the score, but the walk between pushes is part of
// the answer, so the solver records the player's walk to each push.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** The most states one room search keeps before it gives up: work, not time. */
const MAX_STATES = 250_000;

const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

/** Parse XSB text: # wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares a box can be pushed from onto some goal, found by pulling back from the goals over open floor. */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * The rooms of a level: cut the dead squares of the player's row (the
 * hallway — a box there reaches no goal) out of the floor, and each
 * connected part left that holds boxes is a room. Null when the level is
 * no set of rooms (a box starts in the hallway, a part's boxes and goals
 * do not match, or a goal is cut off).
 */
function roomsOf(level: Level): { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** A state's key: the player's region (named by its lowest square) and the boxes' squares. */
function stateKey(boxes: number[], low: number, size: number): number | string {
  if (boxes.length <= 5) {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  }
  return `${boxes.join(',')}|${low}`;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters; '' when unreachable. */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) return '';
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The push-optimal solution of `level` in at most `maxStates` states:
 * {pushes, moves}, or null when the search gives up (or the level has no
 * solution). Breadth-first over pushes, so the first solved state met is
 * optimal; a state is the boxes plus the player's reachable region.
 */
function solvePushOptimal(level: Level, maxStates = MAX_STATES): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  if (level.boxes.some((b) => !live[b])) return null;

  const occupied = new Uint8Array(size);
  // Two stamp arrays: `seen` marks the state being expanded, `mark` the
  // region a candidate push would leave the player in. They must stay
  // apart — a candidate's flood fill would otherwise overwrite the marks
  // the expansion still reads.
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  // The squares the player reaches from `from` with `occupied` in the way,
  // marked in `arr` with a fresh stamp; the lowest of them. The stamp used
  // is left in `stamp` for the caller to read.
  const reach = (arr: Int32Array, from: number): number => {
    const s = ++stamp;
    let low = from;
    let n = 0;
    stack[n++] = from;
    arr[from] = s;
    while (n > 0) {
      const p = stack[--n]!;
      if (p < low) low = p;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
        if (wall[q] === 0 && occupied[q] === 0 && arr[q] !== s) {
          arr[q] = s;
          stack[n++] = q;
        }
      }
    }
    return low;
  };
  // Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal.
  const frozenBlock = (t: number): boolean => {
    for (const a of [t, t - 1, t - w, t - w - 1]) {
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d]))
        continue;
      if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d]))
        return true;
    }
    return false;
  };
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);

  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const index = new Map<number | string, number>();
  for (const b of level.boxes) occupied[b] = 1;
  index.set(stateKey(level.boxes, reach(seen, level.player), size), 0);
  for (const b of level.boxes) occupied[b] = 0;
  let found = solved(level.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < statesBoxes.length; head++) {
    const boxes = statesBoxes[head]!;
    for (const b of boxes) occupied[b] = 1;
    // Mark this state's region: the player can push a box only from a
    // square it reaches.
    reach(seen, statesPlayer[head]!);
    const regionStamp = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== regionStamp || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = stateKey(next, reach(mark, b), size);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (statesBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, statesBoxes.length);
        statesBoxes.push(next!);
        statesPlayer.push(b);
        parent.push(head);
        if (solved(next!)) {
          found = statesBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s]!;
    const from = boxes.find((b) => !nextBoxes.includes(b))!;
    const to = nextBoxes.find((b) => !boxes.includes(b))!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occupied[b] = 1;
    const walk = walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    if (walk === '' && player !== from - d) return null;
    moves += walk + dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * The level solved room by room: each room's push-optimal solution in
 * turn, the other rooms' boxes standing as walls (on their goals once
 * their room is done), the player walking on from where the last room
 * left it. Null when a room's search gives up, or the level is no set of
 * rooms and the search over the whole level gives up.
 */
function solveByRooms(level: Level): { pushes: number; moves: string } | null {
  const rooms = roomsOf(level);
  if (rooms === null) return solvePushOptimal(level);
  let player = level.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms)
      if (other !== room) for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solvePushOptimal(sub);
    if (solved === null) return null;
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const text = readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8');
  const solved = solveByRooms(parseLevel(text));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${solved === null ? '' : solved.moves}\n`);
}
