import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct, IDependable } from 'constructs';

/** One artifact in ECR: its repository, where to pull it from, and what to wait on before using it. */
export interface CreEcrArtifact {
  readonly repository: ecr.Repository;
  /** `<account>.dkr.ecr.<region>.<suffix>/<repository>:<tag>` (an image) or `oci://…/<repository>` with `tag` the chart version. */
  readonly uri: string;
  readonly tag: string;
  /** Depend on it (`node.addDependency`) before anything pulls the artifact: it is in ECR once this completes. */
  readonly ready: IDependable;
}

export interface CreEcrImageProps {
  /** The image as `docker save` writes it (a tarball), as an S3 asset: `new Asset(this, 'Img', { path: 'build/app.tar' })`. */
  readonly tarball: s3_assets.Asset;
  /** The repository's name. @default the construct id, lowercased */
  readonly repositoryName?: string;
  /** The tag it is pushed as. Change it (e.g. the image version) to push again. */
  readonly tag: string;
}

export interface CreEcrHelmChartProps {
  /** The chart as `helm package` writes it (`<name>-<version>.tgz`), as an S3 asset. */
  readonly chart: s3_assets.Asset;
  /** The chart's name: the repository is `<repositoryPrefix><name>`, as `helm push` names it. */
  readonly name: string;
  /** The chart's version (its tag in ECR). */
  readonly version: string;
  /** The repository name's prefix (the `oci://…/<prefix>` a helm install names). @default '' */
  readonly repositoryPrefix?: string;
}

/**
 * Loads container images and Helm charts into ECR in the account the stack deploys to, from S3
 * assets: for an account that has no registry of ours (a Workshop Studio team account), where a
 * DockerImageAsset can't be pushed ahead of the deploy. One CodeBuild project (Docker, so it loads
 * any `docker save` tarball and pushes it as it is; a chart is pushed as the OCI artifact `helm push`
 * makes, through ECR's own API) and one custom resource per artifact, which completes only when its
 * build has: depend on `ready` before anything pulls it. The repositories are deleted, images and
 * all, with the stack.
 */
export class CreEcrImport extends Construct {
  public readonly project: codebuild.Project;
  private readonly provider: cr.Provider;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const logGroup = new logs.LogGroup(this, 'BuildLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });
    this.project = new codebuild.Project(this, 'Import', {
      description: 'Loads container images and Helm charts from S3 assets into ECR (CreEcrImport).',
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        // Docker in the build: `docker load` and `docker push`.
        privileged: true,
      },
      timeout: cdk.Duration.minutes(30),
      logging: { cloudWatch: { logGroup } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        // The chart push, as a program the build runs (python3 -c "$HELM_PUSH"): no heredoc in a command.
        env: { variables: { HELM_PUSH } },
        phases: { build: { commands: BUILD_COMMANDS } },
      }),
    });
    this.project.addToRolePolicy(new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));

    const fn = (name: string, code: string) => new lambda.Function(this, name, {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(1),
      code: lambda.Code.fromInline(code),
      logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
    });
    const onEvent = fn('Start', ON_EVENT);
    const isComplete = fn('Check', IS_COMPLETE);
    onEvent.addToRolePolicy(new iam.PolicyStatement({ actions: ['codebuild:StartBuild'], resources: [this.project.projectArn] }));
    isComplete.addToRolePolicy(new iam.PolicyStatement({ actions: ['codebuild:BatchGetBuilds'], resources: [this.project.projectArn] }));
    this.provider = new cr.Provider(this, 'Provider', {
      onEventHandler: onEvent,
      isCompleteHandler: isComplete,
      // The framework's own functions' logs too: nothing outlives the stack (a recycled account).
      logGroup: new logs.LogGroup(this, 'ProviderLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
      queryInterval: cdk.Duration.seconds(20),
      totalTimeout: cdk.Duration.minutes(40),
    });
  }

  /** A container image, `docker save`d, loaded into its own repository and pushed as `tag`. */
  public addImage(id: string, props: CreEcrImageProps): CreEcrArtifact {
    const repository = this.repository(id, props.repositoryName ?? id.toLowerCase());
    return this.artifact(id, repository, props.tarball, 'image', props.tag, {});
  }

  /** A Helm chart, pushed as the OCI artifact `helm push` makes (`oci://<registry>/<prefix>` then names it). */
  public addHelmChart(id: string, props: CreEcrHelmChartProps): CreEcrArtifact {
    const repository = this.repository(id, `${props.repositoryPrefix ?? ''}${props.name}`);
    return this.artifact(id, repository, props.chart, 'helm', props.version, { ChartName: props.name });
  }

  private repository(id: string, name: string): ecr.Repository {
    return new ecr.Repository(this, `${id}Repository`, { repositoryName: name, emptyOnDelete: true, removalPolicy: cdk.RemovalPolicy.DESTROY });
  }

  private artifact(id: string, repository: ecr.Repository, asset: s3_assets.Asset, kind: 'image' | 'helm', tag: string,
    extra: Record<string, string>): CreEcrArtifact {
    asset.grantRead(this.project);
    repository.grantPullPush(this.project);
    const stack = cdk.Stack.of(this);
    const registry = `${stack.account}.dkr.ecr.${stack.region}.${stack.urlSuffix}`;
    const ready = new cdk.CustomResource(this, `${id}Import`, {
      serviceToken: this.provider.serviceToken,
      resourceType: 'Custom::CreEcrImport',
      properties: {
        ProjectName: this.project.projectName,
        Kind: kind,
        Bucket: asset.s3BucketName,
        Key: asset.s3ObjectKey,
        Registry: registry,
        Repository: repository.repositoryName,
        Tag: tag,
        ...extra,
      },
    });
    ready.node.addDependency(this.project);
    return {
      repository,
      tag,
      uri: kind === 'image' ? `${repository.repositoryUri}:${tag}` : `oci://${registry}/${repository.repositoryName}`,
      ready,
    };
  }
}

/**
 * The build: the artifact from S3, then pushed. An image: `docker load` (its own name, or an ID for an
 * untagged save), tagged into the repository, pushed. A chart: HELM_PUSH (no helm in the build).
 */
const BUILD_COMMANDS = [
  'aws s3 cp "s3://$BUCKET/$KEY" artifact --only-show-errors',
  'if [ "$KIND" = image ]; then '
    + 'aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" '
    + '&& REF=$(docker load -i artifact | sed -n "s/^Loaded image[^:]*: //p" | tail -1) '
    + '&& test -n "$REF" '
    + '&& docker tag "$REF" "$REGISTRY/$REPOSITORY:$TAG" '
    + '&& docker push "$REGISTRY/$REPOSITORY:$TAG"; '
    + 'else python3 -c "$HELM_PUSH"; fi',
];

/** A chart's push as `helm push` makes it (OCI manifest, Chart.yaml as the config), through ECR's API. */
export const HELM_PUSH = [
  'import hashlib, json, os, subprocess, tarfile',
  'repo, tag = os.environ["REPOSITORY"], os.environ["TAG"]',
  'def aws(*a):',
  '    return json.loads(subprocess.run(["aws", "ecr", *a, "--output", "json"], check=True, capture_output=True, text=True).stdout or "{}")',
  'def upload(blob):',
  '    digest = "sha256:" + hashlib.sha256(blob).hexdigest()',
  '    have = aws("batch-check-layer-availability", "--repository-name", repo, "--layer-digests", digest).get("layers") or [{}]',
  '    if have[0].get("layerAvailability") == "AVAILABLE":',
  '        return digest',
  '    up = aws("initiate-layer-upload", "--repository-name", repo)["uploadId"]',
  '    with open("part", "wb") as f:',
  '        f.write(blob)',
  '    aws("upload-layer-part", "--repository-name", repo, "--upload-id", up, "--part-first-byte", "0", "--part-last-byte",',
  '        str(len(blob) - 1), "--layer-part-blob", "fileb://part")',
  '    aws("complete-layer-upload", "--repository-name", repo, "--upload-id", up, "--layer-digests", digest)',
  '    return digest',
  'chart = open("artifact", "rb").read()',
  'with tarfile.open("artifact") as t:',
  '    member = next(m for m in t.getmembers() if m.name.count("/") == 1 and m.name.endswith("/Chart.yaml"))',
  '    meta = t.extractfile(member).read().decode()',
  // Chart.yaml as JSON, helm's config: its top-level scalar keys (name, version, apiVersion, ...).
  'conf = {}',
  'for line in meta.splitlines():',
  '    if line and not line[0].isspace() and ":" in line and not line.startswith("#"):',
  '        k, v = line.split(":", 1)',
  '        v = v.strip().strip(chr(34) + chr(39))',
  '        if v:',
  '            conf[k.strip()] = v',
  'config = json.dumps(conf).encode()',
  'manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",',
  '    "config": {"mediaType": "application/vnd.cncf.helm.config.v1+json", "digest": upload(config), "size": len(config)},',
  '    "layers": [{"mediaType": "application/vnd.cncf.helm.chart.content.v1.tar+gzip", "digest": upload(chart), "size": len(chart)}]}',
  'aws("put-image", "--repository-name", repo, "--image-tag", tag, "--image-manifest", json.dumps(manifest),',
  '    "--image-manifest-media-type", "application/vnd.oci.image.manifest.v1+json")',
  'print(f"pushed chart {repo}:{tag}")',
].join('\n');

const ON_EVENT = `
import boto3
cb = boto3.client("codebuild")
def handler(event, _):
    p = event["ResourceProperties"]
    if event["RequestType"] == "Delete":
        # The repository goes with the stack, images and all.
        return {"PhysicalResourceId": event.get("PhysicalResourceId", "none"), "Data": {"BuildId": ""}}
    env = [{"name": k, "value": p[n], "type": "PLAINTEXT"} for k, n in (("KIND", "Kind"), ("BUCKET", "Bucket"), ("KEY", "Key"),
           ("REGISTRY", "Registry"), ("REPOSITORY", "Repository"), ("TAG", "Tag"))]
    build = cb.start_build(projectName=p["ProjectName"], environmentVariablesOverride=env)["build"]
    return {"PhysicalResourceId": f'{p["Repository"]}:{p["Tag"]}', "Data": {"BuildId": build["id"]}}
`;

const IS_COMPLETE = `
import boto3
cb = boto3.client("codebuild")
def handler(event, _):
    if event["RequestType"] == "Delete":
        return {"IsComplete": True}
    build_id = event["Data"]["BuildId"]
    b = cb.batch_get_builds(ids=[build_id])["builds"][0]
    status = b["buildStatus"]
    if status == "IN_PROGRESS":
        return {"IsComplete": False}
    if status != "SUCCEEDED":
        raise RuntimeError(f"The ECR import build {build_id} ended {status}: see its log in CloudWatch ({b.get('logs', {}).get('groupName', '')}).")
    return {"IsComplete": True}
`;
