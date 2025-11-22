// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { ContainerAndRepo, RepoAndContainerProps } from './container-and-repo';

/**
 * Properties for EKS Application construct
 */
export interface EKSApplicationProps {
  /**
   * The EKS cluster to deploy the application to
   */
  readonly cluster: eks.ICluster;

  /**
   * Container and repository builder for managing container images
   */
  readonly containerAndRepoBuilder: ContainerAndRepo;

  /**
   * Database cluster for the application
   */
  readonly databaseCluster: rds.IDatabaseCluster;

  /**
   * Namespace for the application
   */
  readonly namespace: string;
}

/**
 * Construct that deploys an application to EKS with Istio service mesh
 */
export class EKSApplication extends Construct {
  /**
   * Application target group for load balancer integration
   */
  public readonly appTargetGroup: elbv2.IApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EKSApplicationProps) {
    super(scope, id);

    const app = `${props.namespace}-app`;
    const svc = `${props.namespace}-service`;
    const sa = `${props.namespace}-sa`;
    const shutdownDelay = cdk.Duration.seconds(30);

    // Create container repositories
    const appContainer = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'container.tar.gz',
      repositoryName: props.namespace,
    } as RepoAndContainerProps);

    const cwAgentContainer = props.containerAndRepoBuilder.addContainerAndRepo({
      containerImageS3ObjectKey: 'cloudwatch-agent.tar.gz',
      repositoryName: 'cloudwatch-agent/cloudwatch-agent',
    } as RepoAndContainerProps);

    // Create IAM role for pods
    const podRole = new iam.Role(this, 'PodRole', {
      description: 'The IAM role used by the front-end EKS fleet',
      assumedBy: new iam.ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
    });

    // Policy is attached to role via roles parameter
    new iam.ManagedPolicy(this, 'PodManagedPolicy', {
      description: 'Allows the EKS pod front end to perform standard operational actions',
      statements: [
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:GetObjectVersion'],
          effect: iam.Effect.ALLOW,
          resources: [cdk.Fn.sub('arn:${AWS::Partition}:s3:::*')],
        }),
        new iam.PolicyStatement({
          actions: ['kms:Decrypt'],
          effect: iam.Effect.ALLOW,
          resources: [cdk.Fn.sub('arn:${AWS::Partition}:kms:*:${AWS::AccountId}:key/*')],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          effect: iam.Effect.ALLOW,
          resources: [(props.databaseCluster as rds.DatabaseCluster).secret!.secretFullArn!],
        }),
      ],
      roles: [podRole],
    });

    // Policy is attached to role via roles parameter
    new iam.ManagedPolicy(this, 'PodCloudWatchManagedPolicy', {
      description: 'Allows the EKS pod front ends to write CWL and put metrics',
      statements: [
        new iam.PolicyStatement({
          actions: [
            'cloudwatch:PutMetricData',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
      roles: [podRole],
    });

    // Policy is attached to role via roles parameter
    new iam.ManagedPolicy(this, 'xrayManagedPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
            'xray:GetSamplingStatisticSummaries',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
      roles: [podRole],
    });

    // Create namespace
    const appNamespace = new eks.KubernetesManifest(this, 'AppNamespace', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            labels: {
              name: props.namespace,
              'istio-injection': 'enabled',
            },
            name: props.namespace,
          },
        },
      ],
    });

    (appNamespace.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Create service account
    const appServiceAccount = new eks.KubernetesManifest(this, 'AppServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: sa,
            namespace: props.namespace,
          },
        },
      ],
    });

    (appServiceAccount.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    appServiceAccount.node.addDependency(appNamespace);

    // Create pod identity association
    const podIdentity = new eks.CfnPodIdentityAssociation(this, 'PodIdentityAssociation', {
      clusterName: props.cluster.clusterName,
      namespace: props.namespace,
      serviceAccount: sa,
      roleArn: podRole.roleArn,
    });

    podIdentity.node.addDependency(appServiceAccount);

    // Create service
    const appService = new eks.KubernetesManifest(this, 'AppService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            labels: {
              app: app,
            },
            name: svc,
            namespace: props.namespace,
            annotations: {
              'service.kubernetes.io/topology-mode': 'auto',
            },
          },
          spec: {
            type: 'ClusterIP',
            ports: [
              {
                port: 5000,
                targetPort: 5000,
                protocol: 'TCP',
                name: 'http',
              },
            ],
            selector: {
              app: app,
            },
          },
        },
      ],
    });

    appService.node.addDependency(appNamespace);
    (appService.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Create Istio virtual service
    const istioVirtualService = new eks.KubernetesManifest(this, 'IstioVirtualService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'networking.istio.io/v1alpha3',
          kind: 'VirtualService',
          metadata: {
            name: `${props.namespace}-virtual-service`,
            namespace: props.namespace,
          },
          spec: {
            hosts: ['*.local'],
            http: [
              {
                match: [
                  {
                    uri: {
                      prefix: '/',
                    },
                  },
                ],
                route: [
                  {
                    destination: {
                      host: svc,
                      port: {
                        number: 5000,
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    istioVirtualService.node.addDependency(appService);
    (istioVirtualService.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Create CloudWatch agent config map
    const agentConfigMap = props.cluster.addManifest('CloudWatchAgentConfigMap', [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: 'cwagentemfconfig',
          namespace: props.namespace,
        },
        data: {
          'cwagentconfig.json': `{"agent":{"omit_hostname":true,"region":"${cdk.Aws.REGION}"},"logs":{"metrics_collected":{"emf":{}}},"traces":{"traces_collected":{"xray":{},"otlp":{}} } }`,
        },
      },
    ]);
    agentConfigMap.node.addDependency(appNamespace);
    (agentConfigMap.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Create deployment
    const appDeployment = new eks.KubernetesManifest(this, 'AppDeployment', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: app,
            namespace: props.namespace,
            labels: {
              app: app,
            },
          },
          spec: {
            replicas: 6,
            selector: {
              matchLabels: {
                app: app,
              },
            },
            strategy: {
              type: 'RollingUpdate',
              rollingUpdate: {
                maxUnavailable: 0,
                maxSurge: 2,
              },
            },
            template: {
              metadata: {
                labels: {
                  app: app,
                },
                annotations: {
                  version: cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID)), // Using stack ID fragment as nonce
                },
              },
              spec: {
                topologySpreadConstraints: [
                  {
                    labelSelector: {
                      matchLabels: {
                        app: app,
                      },
                    },
                    maxSkew: 1,
                    topologyKey: 'topology.kubernetes.io/zone',
                    whenUnsatisfiable: 'ScheduleAnyway',
                  },
                  {
                    labelSelector: {
                      matchLabels: {
                        app: app,
                      },
                    },
                    maxSkew: 1,
                    topologyKey: 'kubernetes.io/hostname',
                    whenUnsatisfiable: 'ScheduleAnyway',
                  },
                ],
                terminationGracePeriodSeconds: shutdownDelay.toSeconds(),
                serviceAccountName: sa,
                volumes: [
                  {
                    name: 'cwagentconfig',
                    configMap: {
                      name: 'cwagentemfconfig',
                    },
                  },
                ],
                containers: [
                  {
                    image: `${appContainer.repository.repositoryUri}:latest`,
                    imagePullPolicy: 'Always',
                    name: app,
                    ports: [
                      {
                        containerPort: 5000,
                      },
                    ],
                    env: [
                      {
                        name: 'DB_SECRET',
                        value: (props.databaseCluster as rds.DatabaseCluster).secret!.secretName,
                      },
                    ],
                  },
                  {
                    image: `${cwAgentContainer.repository.repositoryUri}:latest`,
                    imagePullPolicy: 'IfNotPresent',
                    name: 'cloudwatch-agent',
                    env: [
                      {
                        name: 'RUN_WITH_IRSA',
                        value: 'True',
                      },
                    ],
                    resources: {
                      limits: {
                        cpu: '200m',
                        memory: '100Mi',
                      },
                      requests: {
                        cpu: '200m',
                        memory: '100Mi',
                      },
                    },
                    volumeMounts: [
                      {
                        name: 'cwagentconfig',
                        mountPath: '/etc/cwagentconfig',
                      },
                    ],
                    ports: [
                      {
                        containerPort: 25888, // cloudwatch agent
                        protocol: 'TCP',
                      },
                      {
                        containerPort: 2000, // xray
                        protocol: 'TCP',
                      },
                      {
                        containerPort: 4317, // otlp grpc
                        protocol: 'TCP',
                      },
                      {
                        containerPort: 4318, // otlp http
                        protocol: 'TCP',
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    });

    appDeployment.node.addDependency(appService);
    appDeployment.node.addDependency(istioVirtualService);
    appDeployment.node.addDependency(podIdentity);
    appDeployment.node.addDependency(agentConfigMap);
    appDeployment.node.addDependency(appContainer.dependable);
    appDeployment.node.addDependency(cwAgentContainer.dependable);
    (appDeployment.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );

    // Create target group
    const tgp = new elbv2.ApplicationTargetGroup(this, 'AppTargetGroup', {
      healthCheck: {
        enabled: true,
        port: 'traffic-port',
        interval: cdk.Duration.seconds(10),
        protocol: elbv2.Protocol.HTTP,
        timeout: cdk.Duration.seconds(2),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        path: '/health',
      },
      port: 5000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      loadBalancingAlgorithmType: elbv2.TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
      deregistrationDelay: shutdownDelay,
      vpc: props.cluster.vpc,
      protocolVersion: elbv2.ApplicationProtocolVersion.HTTP1,
    });

    tgp.setAttribute('load_balancing.cross_zone.enabled', 'true');
    this.appTargetGroup = tgp;

    // Create target group binding
    const targetGroupBinding = new eks.KubernetesManifest(this, 'TargetGroupBinding', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'elbv2.k8s.aws/v1beta1',
          kind: 'TargetGroupBinding',
          metadata: {
            name: `${props.namespace}-target-group-binding`,
            namespace: props.namespace,
          },
          spec: {
            serviceRef: {
              name: svc,
              port: 5000,
            },
            targetGroupARN: tgp.targetGroupArn,
            targetType: 'ip',
          },
        },
      ],
    });

    targetGroupBinding.node.addDependency(appService);
    (targetGroupBinding.node.findChild('Resource').node.defaultChild as cdk.CfnResource).addPropertyOverride(
      'ServiceTimeout',
      '300'
    );
  }
}
