# sokoban-push-optimal

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/xoos19/sokoban-push-optimal/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/xoos19/sokoban-push-optimal/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver. A generated level is a hallway with independent rooms off it, and a box pushed out of a room can never come back — so the level's optimum is the sum of its rooms' optima, and each room is solved on its own with a breadth-first search over pushes, pruned by dead squares and frozen 2x2 blocks. First solved state met is push-optimal, so every level is answered in exactly P* pushes.

Practice set: **1,000,000 / 1,000,000** (all five instances in P* pushes, verified by the kit's own checker and `grade-local`).

`main.ts` reads every instance under `/input/<id>/level.txt` and writes `/output/<id>/solution.txt`.

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
