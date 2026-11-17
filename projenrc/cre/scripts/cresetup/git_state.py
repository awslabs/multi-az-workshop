"""The git operation in progress in a clone: one list, used by setup's adoption check (clone.py) and
the git tasks (scripts/lib/crelib.py imports it). Standard library only.

  operation(cwd, git_paths)   "am" | "rebase" | "merge" | "cherry-pick" | "revert" | "bisect" | ""

git_paths(names) returns `git rev-parse --git-path <name>` for each name, in order (the caller's
git runner: the git tasks hold signals in theirs).
"""
import os

PATHS = ("rebase-apply/applying", "rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD",
         "REVERT_HEAD", "BISECT_LOG", "sequencer", "sequencer/todo")


def operation(cwd, git_paths):
    # Every path in one `rev-parse` (a worktree keeps some in its own git dir): a process start costs
    # tens of milliseconds here, and this ran nine.
    where = dict(zip(PATHS, git_paths(PATHS)))

    def at(p):
        path = where.get(p, "")
        return path if os.path.isabs(path) or not cwd else os.path.join(cwd, path)

    def exists(p):
        return bool(where.get(p)) and os.path.exists(at(p))
    if exists("rebase-apply/applying"):
        # `git am` shares rebase-apply/ with an apply-style rebase, but `git rebase --abort`
        # refuses it (review 10d B13).
        return "am"
    if exists("rebase-merge") or exists("rebase-apply"):
        return "rebase"
    for path, op in (("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert"), ("BISECT_LOG", "bisect")):
        if exists(path):
            return op
    # A cherry-pick or revert of several commits whose stop the user committed past (`git commit`
    # instead of `--continue`): no *_HEAD left, but git's sequencer still holds the rest, and git
    # counts it as in progress (it refuses a switch). Its todo's first verb says which (review 10g B7).
    if exists("sequencer"):
        try:
            with open(at("sequencer/todo")) as f:
                first = next((ln.split()[0] for ln in f if ln.strip() and not ln.startswith("#")), "")
        except OSError:
            first = ""
        return "revert" if first == "revert" else "cherry-pick"
    return ""
