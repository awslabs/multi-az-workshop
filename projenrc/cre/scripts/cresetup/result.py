"""Exit codes, the one failure every cresetup step raises, and the one main() they share.

  must(reply, what) -> reply.data ({} when empty), or raises Failed with the code its kind means
  entry(name, parse, work) -> the exit code: the command line shape every step's main() has

A reply is anything with .ok, .kind (ok | refused | creds | failed | ...) and .message.
"""
import sys
import time

OK, REFUSED, CREDS, FAILED = 0, 10, 11, 20


class Failed(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def must(reply, what):
    if not reply.ok:
        code = {"refused": REFUSED, "creds": CREDS}.get(reply.kind, FAILED)
        raise Failed(code, f"{what}: {reply.message}")
    return reply.data or {}


def entry(name, parse, work, ok_message="done"):
    """Every step's main() and setup_project's (review 10i G8). parse() -> args; a usage error is 10
    with a RESULT line (--help is 0). work(args, say, out) -> {output: value} or None: printed as
    KEY=value lines. Failed is its own code; a step's own parser refusing inside work (ap.error) is
    10; an interrupt (Ctrl-C, an agent tool's SIGINT) is 20; any other exception is a bug, still 20.
    Every exit ends with a RESULT line, never a bare traceback: the recipe reads the last stdout
    line. say() prints a timestamped line to stderr."""
    t0 = time.time()

    def say(msg):
        print(f"[{time.strftime('%H:%M:%S')} +{time.time() - t0:.1f}s] {msg}", file=sys.stderr, flush=True)

    def out(k, v):
        print(f"{k}={v}", flush=True)

    def done(code):
        print(f"RESULT code={code}")
        return code

    try:
        a = parse()
    except SystemExit as e:
        if e.code in (0, None):
            raise
        return done(REFUSED)
    try:
        outputs = work(a, say, out) or {}
    except Failed as e:
        say(f"❌ {e}")
        return done(e.code)
    except SystemExit:
        # A step's argparse refused what it was given (its error is printed above): nothing changed by it.
        say(f"❌ {name}: a step's arguments were refused (above)")
        return done(REFUSED)
    except KeyboardInterrupt:
        say("❌ interrupted: every step done so far is recorded; re-run to carry on")
        return done(FAILED)
    except Exception as e:  # noqa: BLE001: a bug is still 20, never a bare traceback
        say(f"❌ {name} failed: {type(e).__name__}: {e}")
        return done(FAILED)
    for k, v in outputs.items():
        out(k, v)
    say(f"✅ {ok_message}")
    return done(OK)
