# Core (`core`)

Always installed.

**What it is.** The classes every project uses whatever modules it lists: `CreApp`, `CreStack`,
`CreCfnParameter`, `CreIamStack`, `CreVersions`, the naming and partition helpers, and the
Workshop Studio values a `CreCfnParameter` can take (`fromMagic`).

**App and stack classes.** `CreApp` (core) is the app: it strips CDK metadata from every template,
writes `cre-stacks.json` (the stacks the pipeline is generated from) next to the templates, and fails
the synth on a top-level stack that isn't a `CreStack`, a stack with no resources (CloudFormation refuses
one, and with no CDK metadata outputs alone leave it empty), or a parameter without a default or a source.
`CreStack` is the base of every top-level stack: its deploy `region` (required), `dependsOn`,
`assumeRole` and `executionRole`; the asset-bucket synthesizer and parameters; named by its id; no
`env` (refused). Its container images go to the project's own ECR repository `cre/<project>`
(`creImageRepository()`), never CDK's shared bootstrap repository, because the project's runner role
may push only there; the name comes from the cdk.json context `cre:projectName` (projen writes it),
and without it a stack with a container image fails the synth. `CreCfnParameter` is every parameter the pipeline passes: `from` another stack's
value (it adds the output there) or `fromVariable`.
The modules ship the standard stacks: `CreDashboardStack` (observability), `CreEdgeStack`
(auth/cloudfront-signer), `CreDnsStack` (dns), `CrePrivateNetworkStack`,
`CreEgressOnlyNetworkStack`, their base `CreNetworkStack`, and `CrePeeringStack` (networking).

**Where stacks are defined.** In the CDK app, nowhere else. `npx projen` synthesizes it (no
bundling, no asset staging), reads what `CreApp` recorded, and generates the committed
`cre-stacks.json` and one deploy job per stack, in dependency order. `check:stack-plan` fails the
build when the app has changed since. The steering file `cre-pipelines.md` is the full guide.

**No environment inside a stack.** Code refers to where a stack is deployed only through
`Aws.REGION`, `Aws.ACCOUNT_ID`, `Aws.PARTITION` and `Aws.URL_SUFFIX` (`import { Aws } from
'aws-cdk-lib'`) in template strings, never `cdk.Aws.*`, `Fn.sub`, `Stack.of(this).region`, a region
string, `arn:aws:` or an `amazonaws.com` endpoint (service principals excepted), so one template
deploys to any region and partition (commercial, GovCloud, China, EUSC). A stack that must
be in one region uses `requireDeployRegion` (a CloudFormation Rule on `AWS::Region`).
