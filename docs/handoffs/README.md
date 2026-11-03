# Handoffs

One JSON file per task: `docs/handoffs/<task_id>.json`, validated by `docs/handoffs/handoff.schema.json`
(checked in `tests/unit/contracts.test.ts`).

Central mechanism: `main` is the integration branch and holds the only authoritative copy. An agent working in a
worktree writes its handoff file in its own branch and also returns the same JSON in its final message. The
integration manager merges the branch, sets `status`, `result_commit` and `next_action`, and commits the file on
`main`. A file in a feature worktree is a draft; it is not visible to other worktrees until it is on `main`.

Before starting, the next agent checks that its worktree contains the `base_commit` and `contract_version` named in its
brief (`git merge-base --is-ancestor <base_commit> HEAD`, `grep PROTOCOL_VERSION packages/protocol/src/index.ts`).

Status flow: `planned -> in_progress -> ready_for_review -> accepted`, or `blocked` with the reason in `known_gaps`.
`ready_for_review` is not acceptance: only the integration manager sets `accepted`, after the integrated checks.

Fields: task_id, owner, status, base_commit, result_commit, contract_version, changed_files, tests_run, evidence,
known_gaps, next_action.
