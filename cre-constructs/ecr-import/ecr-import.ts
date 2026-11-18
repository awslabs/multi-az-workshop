import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
  /** The image as `docker save` writes it (a tarball), as an S3 asset (`buildOutputAsset`). */
  readonly tarball: s3_assets.Asset;
  /** The repository's name. @default the construct id, lowercased */
  readonly repositoryName?: string;
  /**
   * The tag it is pushed as. A tag already in the repository is never pushed again, so give one that
   * changes with the image (its version), or leave it out.
   * @default the tarball's content hash: a new image, a new tag
   */
  readonly tag?: string;
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

interface Artifact {
  readonly kind: 'image' | 'helm';
  readonly bucket: string;
  readonly key: string;
  readonly repository: string;
  readonly tag: string;
}

/**
 * Loads container images and Helm charts into ECR in the account the stack deploys to, from S3
 * assets: for an account that has no registry of ours (a Workshop Studio team account), where a
 * DockerImageAsset can't be pushed ahead of the deploy.
 *
 * One custom resource and one CodeBuild build for all of them: the resource's handler
 * (handler/index.py) looks up which tags aren't in their repositories yet and starts the build
 * (build/import.py) for only those, so a redeploy or a rollback pushes nothing again. The build
 * loads an image as `docker save` wrote it and pushes it; it pushes a chart as the OCI artifact
 * `helm push` makes, through ECR's API. Every artifact's `ready` is that resource: depend on it before
 * anything pulls. The repositories are deleted, images and all, with the stack.
 */
export class CreEcrImport extends Construct {
  public readonly project: codebuild.Project;
  private readonly artifacts: Artifact[] = [];
  private readonly ready: cdk.CustomResource;
  /** The handler that looks up which tags are in ECR already (it needs DescribeImages on each repository). */
  private readonly lookup: lambda.Function;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const source = new s3_assets.Asset(this, 'BuildSource', { path: path.join(__dirname, 'build') });
    this.project = new codebuild.Project(this, 'Import', {
      description: 'Loads container images and Helm charts from S3 assets into ECR (CreEcrImport).',
      source: codebuild.Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        // Docker in the build: `docker load` and `docker push`.
        privileged: true,
      },
      // Every missing artifact, one after another.
      timeout: cdk.Duration.minutes(90),
    });
    source.grantRead(this.project);

    const code = lambda.Code.fromAsset(path.join(__dirname, 'handler'));
    const fn = (name: string, handler: string) => new lambda.Function(this, name, {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: `index.${handler}`,
      timeout: cdk.Duration.minutes(1),
      code,
      environment: { PROJECT: this.project.projectName },
    });
    const onEvent = fn('Start', 'on_event');
    const isComplete = fn('Check', 'is_complete');
    onEvent.addToRolePolicy(new iam.PolicyStatement({ actions: ['codebuild:StartBuild'], resources: [this.project.projectArn] }));
    isComplete.addToRolePolicy(new iam.PolicyStatement({ actions: ['codebuild:BatchGetBuilds'], resources: [this.project.projectArn] }));
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: onEvent,
      isCompleteHandler: isComplete,
      queryInterval: cdk.Duration.seconds(30),
      totalTimeout: cdk.Duration.hours(2),
    });
    this.ready = new cdk.CustomResource(this, 'Imports', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::CreEcrImport',
      properties: {
        Registry: `${Aws.ACCOUNT_ID}.dkr.ecr.${Aws.REGION}.${Aws.URL_SUFFIX}`,
        // Every artifact added: the handler starts a build for the ones not in ECR yet.
        Artifacts: cdk.Lazy.string({ produce: () => cdk.Stack.of(this).toJsonString(this.artifacts) }),
      },
    });
    this.ready.node.addDependency(this.project);
    this.lookup = onEvent;
  }

  /** A container image, `docker save`d, loaded into its own repository and pushed as `tag` (by default its content hash). */
  public addImage(id: string, props: CreEcrImageProps): CreEcrArtifact {
    const repository = this.repository(id, props.repositoryName ?? id.toLowerCase());
    return this.add(repository, props.tarball, 'image', props.tag ?? props.tarball.assetHash);
  }

  /** A Helm chart, pushed as the OCI artifact `helm push` makes (`oci://<registry>/<prefix>` then names it). */
  public addHelmChart(id: string, props: CreEcrHelmChartProps): CreEcrArtifact {
    const repository = this.repository(id, `${props.repositoryPrefix ?? ''}${props.name}`);
    return this.add(repository, props.chart, 'helm', props.version);
  }

  private repository(id: string, name: string): ecr.Repository {
    return new ecr.Repository(this, `${id}Repository`, { repositoryName: name, emptyOnDelete: true, removalPolicy: cdk.RemovalPolicy.DESTROY });
  }

  private add(repository: ecr.Repository, asset: s3_assets.Asset, kind: 'image' | 'helm', tag: string): CreEcrArtifact {
    // The build reads this artifact's object only, and pushes to this artifact's repository only.
    this.project.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${asset.bucket.bucketArn}/${asset.s3ObjectKey}`],
    }));
    repository.grantPullPush(this.project);
    this.lookup.addToRolePolicy(new iam.PolicyStatement({ actions: ['ecr:DescribeImages'], resources: [repository.repositoryArn] }));
    this.ready.node.addDependency(repository);
    this.artifacts.push({ kind, bucket: asset.s3BucketName, key: asset.s3ObjectKey, repository: repository.repositoryName, tag });
    const registry = `${Aws.ACCOUNT_ID}.dkr.ecr.${Aws.REGION}.${Aws.URL_SUFFIX}`;
    return {
      repository,
      tag,
      uri: kind === 'image' ? `${repository.repositoryUri}:${tag}` : `oci://${registry}/${repository.repositoryName}`,
      ready: this.ready,
    };
  }
}
