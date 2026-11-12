# Handover to Claude Code: Let Go of a Balloon

What is in this folder:

- `docs/superpowers/specs/...-design.md`: what to build (the design, approved by SK)
- `docs/superpowers/plans/...-let-go-of-a-balloon.md`: how to build it, step by step
- `docs/reference/`: the shared rules, the original brief, the city list and the 3D style prototype

How to start:

1. Make a new folder on your computer called `let-go-of-a-balloon`. Your Documents folder is a good place for it.
2. Unzip the handover file and move everything from it into that folder.
3. Open Claude Code and point it at that folder.
4. Paste this as your first message:

   Read docs/superpowers/specs/2026-11-12-let-go-of-a-balloon-design.md and docs/superpowers/plans/2026-11-12-let-go-of-a-balloon.md, plus the reference files they list. Both are approved. Build it with the superpowers subagent-driven-development skill, task by task, starting with Task 0. Use the impeccable and unslop skills for every screen, as the plan says. If any skill the plan names is not installed, tell me before you start. I am not technical: explain anything I have to do myself click by click.

What to expect: Claude Code will first help you set up a free Cloudflare account and the GitHub repository. After that, it sends you preview links to open on your phone at a few check-in points.

The design document is the source of truth. The live city list is the "Launch cities" sheet, and `docs/reference/launch-cities.csv` is a copy of it.
