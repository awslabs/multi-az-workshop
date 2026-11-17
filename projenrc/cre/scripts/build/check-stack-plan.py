#!/usr/bin/env python3
"""Check the committed stack plan against the CDK app just synthesized.

    check-stack-plan.py [cre-stacks.json] [cdk.out] [--container-images on|off]

The pipeline is generated from cre-stacks.json, which `npx projen` writes from a plan-only synth of
the CDK app (CreApp records every CreStack's region, roles, parameter sources and the outputs other
stacks take, in cdk.out/cre-stacks.json). CI never regenerates files, so a stale plan would deploy
with a stale pipeline. What a stack must be (a CreStack under a CreApp, no fixed environment,
every parameter with a source or a default) CreApp refuses at synth, and check:generated proves the
committed plan and its jobs are what npx projen makes. This checks only what neither sees. Fails,
listing every problem, when:
  - the app's stacks (cdk.out/cre-stacks.json, this full synth's) differ from the ones the
    committed plan was generated from: run `npx projen` and commit;
  - a stack sets terminationProtection, which the change-set deploy never applies (review 10b D17);
  - a stack with `assumeRole` (another account) has a container image asset, which deploy:docker
    pushes to the deploy account (review 10c D6);
  - (`--container-images off`, from the project's `containerImages`) a stack has a container image
    asset (a LoadGenerator, any DockerImageAsset): nothing would build or push it, and the deploy
    would wait on a service whose image doesn't exist (review 10c A4).

Runs right after `cdk synth` (post-compile, and ci:build:cdk). Exit 0 clean, 1 with a report,
2 when the plan or the cloud assembly is missing.
"""
import json
import os
import pathlib
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import crelib  # noqa: E402  (the one cre-stacks.json reader)


def protected_stacks(cdk_out):
    """The stacks of the cloud assembly that set terminationProtection."""
    manifest = json.loads((cdk_out / "manifest.json").read_text())
    return sorted(a.get("properties", {}).get("stackName", artifact_id) for artifact_id, a in manifest.get("artifacts", {}).items()
                  if a.get("type") == "aws:cloudformation:stack" and a.get("properties", {}).get("terminationProtection"))


def check(synthesized, protected, app_plan):
    """synthesized: the committed plan's record of the app; app_plan: this synth's."""
    problems = []
    if app_plan != synthesized:
        problems.append("the CDK app's stacks changed since cre-stacks.json and the pipeline were generated: "
                        "run npx projen and commit the result.")
    for sid in protected:
        # The deploy creates and updates stacks through change sets, which carry no termination
        # protection: the stack would look protected in the app and not be (review 10b D17).
        problems.append(f"{sid}: sets terminationProtection, which the pipeline's deploy doesn't apply; remove it. "
                        "(The protection doesn't stop npx projen teardown, which deletes when run and asks nobody: "
                        "show the user its --dry-run list first.)")
    return problems


def image_stacks(cdk_out):
    """{stack: number of container image assets}, from the cloud assembly's asset manifests."""
    out = {}
    for f in sorted(cdk_out.glob("*.assets.json")):
        n = len(json.loads(f.read_text()).get("dockerImages") or {})
        if n:
            out[f.name[: -len(".assets.json")]] = n
    return out


def main(argv):
    images = ""
    if "--container-images" in argv:
        i = argv.index("--container-images")
        images = argv[i + 1] if i + 1 < len(argv) else ""
        argv = argv[:i] + argv[i + 2:]
        if images not in ("on", "off"):
            print("check-stack-plan: --container-images takes on or off.", file=sys.stderr)
            return 2
    plan_path = pathlib.Path(argv[1] if len(argv) > 1 else "cre-stacks.json")
    cdk_out = pathlib.Path(argv[2] if len(argv) > 2 else "cdk.out")
    if not plan_path.is_file() or not (cdk_out / "manifest.json").is_file():
        print(f"check-stack-plan: need {plan_path} and {cdk_out}/manifest.json; run npx projen and cdk synth first.", file=sys.stderr)
        return 2
    app_plan_file = cdk_out / "cre-stacks.json"
    if not app_plan_file.is_file():
        print(f"check-stack-plan: {app_plan_file} is missing: create the app with new CreApp() (from @cre/constructs).", file=sys.stderr)
        return 1
    try:
        app_plan = crelib.read_plan(app_plan_file)
        doc = crelib.plan_doc(plan_path)
        stacks, synthesized = doc["stacks"], doc.get("synthesized")
    except crelib.BadFile as e:
        print(f"check-stack-plan: {e}", file=sys.stderr)
        return 2
    problems = check(synthesized, protected_stacks(cdk_out), app_plan)
    # Mismatches between the app and the plan, then what the plan can't deploy as it is: each list
    # under its own heading (review 10d A7: an image problem was headed "doesn't match").
    mismatch, problems = problems, []
    with_role = {st["id"] for st in stacks if st.get("assumeRole")}
    for sid in image_stacks(cdk_out):
        if sid in with_role:
            # deploy:docker pushes to the deploy account's ECR; a stack in another account looks for
            # the image there (review 10c D6).
            problems.append(f"{sid} deploys to another account (assumeRole) and has a container image asset, which deploy:docker "
                            "would push to this account's ECR, not that one's. Move the image into a stack in this account.")
    if images == "off":
        for sid, n in image_stacks(cdk_out).items():
            problems.append(f"{sid} has {n} container image asset(s) (a LoadGenerator or another DockerImageAsset), but the project "
                            "doesn't build images: nothing would build or push them, and the deploy would wait on a service whose "
                            "image doesn't exist. Set containerImages: true in .projenrc.ts, then run npx projen.")
    if not mismatch and not problems:
        print(f"check-stack-plan: the CDK app matches the {len(stacks)} stack(s) the pipeline deploys.")
        return 0
    for heading, items in (("the CDK app doesn't match cre-stacks.json (the pipeline's plan)", mismatch),
                           ("the pipeline can't deploy the plan as it is", problems)):
        if items:
            print(f"check-stack-plan: {heading}:", file=sys.stderr)
            for p in items:
                print(f"  - {p}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
