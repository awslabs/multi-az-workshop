"""Run one subprocess, with a time limit: the one runner setup, the aws CLI calls (aws.py) and
crelib.run share. The git tasks run their children through cregit.run_child instead, which holds
signals while a child runs.

Never raises for a command's own failure: the caller reads `code`. A command that runs past its
limit is killed and reported as code 124 with "timed out after Ns" in `err`, so a hung network
call can't stall an unattended run. A missing executable is 127, like a shell.
"""
import dataclasses
import subprocess

TIMEOUT = 124


@dataclasses.dataclass(frozen=True)
class Result:
    code: int
    out: str      # bytes with text=False
    err: str

    @property
    def ok(self):
        return self.code == 0


def run(cmd, timeout, env=None, cwd=None, input=None, text=True):
    """`cmd` is a list (never a shell string); timeout None: no limit. stdin is `input`, or closed,
    so a command that would prompt fails at once instead of waiting unseen. text=False: stdout is
    bytes (a signature); stderr is always text, undecodable bytes replaced."""
    if isinstance(input, str):
        input = input.encode()
    stdin = {"input": input} if input is not None else {"stdin": subprocess.DEVNULL}
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env, cwd=cwd, **stdin)
    except subprocess.TimeoutExpired:
        return Result(TIMEOUT, "" if text else b"", f"{cmd[0]} timed out after {timeout}s")
    except OSError as e:
        return Result(127, "" if text else b"", f"{cmd[0]}: command not found ({e.strerror or e})"
                      if isinstance(e, FileNotFoundError) else f"{cmd[0]}: {e.strerror or e}")
    out = p.stdout.decode(errors="replace") if text else p.stdout
    return Result(p.returncode, out, p.stderr.decode(errors="replace"))


def last_line(text, otherwise=""):
    """The last non-blank line of a command's output (where a CLI says why it failed), stripped;
    `otherwise` when there is none. The one copy for every script."""
    lines = [x.strip() for x in (text or "").strip().splitlines() if x.strip()]
    return lines[-1] if lines else otherwise
