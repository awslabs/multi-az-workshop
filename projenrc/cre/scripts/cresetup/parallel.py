"""One helper for independent AWS waits run at once (review 10i H5): unbootstrap, teardown and
setup:aws use it; crelib re-exports it for the build scripts."""
import concurrent.futures


def parallel(fn, items):
    """fn over items at once; every result, in order, or the first failure once all have ended."""
    items = list(items)
    if not items:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(len(items), 8))) as pool:
        futures = [pool.submit(fn, x) for x in items]
        concurrent.futures.wait(futures)
    return [f.result() for f in futures]
