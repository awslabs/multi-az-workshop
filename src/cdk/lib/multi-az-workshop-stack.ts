// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EvacuationMethod } from './types';
import { EnhancedApplicationLoadBalancer } from './constructs/enhanced-load-balancer';
import { NestedStackWithSource } from './constructs/nested-stack-with-source';
import { AZTaggerStack } from './nested-stacks/az-tagger-stack';
import { IpV6NetworkStack } from './nested-stacks/ipv6-network-stack';
import { DatabaseStack } from './nested-stacks/database-stack';
import { EC2FleetStack } from './nested-stacks/ec2-fleet-stack';
import { EKSStack } from './nested-stacks/eks-stack';
import { InstanceArchitecture } from './constructs/eks-cluster';
import { Route53ZonalDnsStack } from './nested-stacks/route53-zonal-dns-stack';
import { Route53HealthChecksStack } from './nested-stacks/route53-health-checks-stack';
import { ApplicationRecoveryControllerStack } from './nested-stacks/application-recovery-controller-stack';
import { SelfManagedHttpEndpointApigStack } from './nested-stacks/self-managed-http-endpoint-apig-stack';
import { SelfManagedHttpEndpointS3Stack } from './nested-stacks/self-managed-http-endpoint-s3-stack';
import { FaultInjectionStack } from './nested-stacks/fault-injection-stack';
import { SSMRandomFaultStack } from './nested-stacks/ssm-random-fault-stack';
import { LogQueryStack } from './nested-stacks/log-query-stack';
import { CodeDeployApplicationStack } from './nested-stacks/code-deploy-application-stack';
import { createService } from './utils/service-factory';
import {
  AvailabilityZoneMapper,
  IService,
  InstrumentedServiceMultiAZObservability,
  BasicServiceMultiAZObservability,
} from '@cdklabs/multi-az-observability';

/**
 * Properties for the MultiAZWorkshopStack
 */
export interface MultiAZWorkshopStackProps extends cdk.StackProps {
  // Additional props can be added here if needed
}

/**
 * Main stack for the Multi-AZ Workshop
 */
export class MultiAZWorkshopStack extends cdk.Stack {
  // Configuration constants
  private readonly evacuationMethod: EvacuationMethod = EvacuationMethod.ZonalShift;
  private readonly domain: string = 'example.com';
  // private readonly metricsNamespace: string = 'multi-az-workshop/frontend';
  private readonly frontEndLogGroupName: string = '/multi-az-workshop/frontend';
  // private readonly faultMetricJsonPath: string = '$.Fault';
  // private readonly successLatencyMetricJsonPath: string = '$.SuccessLatency';
  // private readonly azIdJsonPath: string = '$.AZ-ID';
  // private readonly operationNameJsonPath: string = '$.Operation';
  // private readonly instanceIdJsonPath: string = '$.InstanceId';
  private readonly arch: InstanceArchitecture = InstanceArchitecture.ARM_64;
  private readonly ec2Arch: ec2.InstanceArchitecture = ec2.InstanceArchitecture.ARM_64;

  // Python runtime for Lambda functions
  public static readonly pythonRuntime: lambda.Runtime = lambda.Runtime.PYTHON_3_13;

  // Nested stacks and resources
  private networkStack: IpV6NetworkStack;
  private databaseStack: DatabaseStack;
  private ec2Stack: EC2FleetStack;
  private eksStack: EKSStack;
  private codeDeployStack: CodeDeployApplicationStack;
  // private route53Stack?: Route53ZonalDnsStack;
  private azTaggerStack: AZTaggerStack;
  // private healthCheckStack?: Route53HealthChecksStack;
  private faultInjectionStack: FaultInjectionStack;
  // @ts-ignore - Stack state, not directly referenced
  private logQueryStack: LogQueryStack;
  // @ts-ignore - Stack state, not directly referenced
  private ssmRandomFaultStack: SSMRandomFaultStack;
  private loadBalancer: EnhancedApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: MultiAZWorkshopStackProps) {
    super(scope, id, props);

    // CloudFormation Parameters
    const assetsBucketName = new cdk.CfnParameter(this, 'AssetsBucketName', {
      type: 'String',
      minLength: 1,
      default: '{{.AssetsBucketName}}',
    });

    const assetsBucketPrefix = new cdk.CfnParameter(this, 'AssetsBucketPrefix', {
      type: 'String',
      default: '{{.AssetsBucketPrefix}}',
    });

    const participantRoleName = new cdk.CfnParameter(this, 'ParticipantRoleName', {
      type: 'String',
      default: '{{.ParticipantRoleName}}',
    });

    // Constants
    const availabilityZoneNames: string[] = [
      `${cdk.Aws.REGION}a`,
      `${cdk.Aws.REGION}b`,
      `${cdk.Aws.REGION}c`,
    ];

    const fleetSize: number = availabilityZoneNames.length * 2;

    // SSM Parameters for asset locations
    new ssm.StringParameter(this, 'bucket-ssm-parameter', {
      parameterName: 'BucketPath',
      stringValue: cdk.Fn.sub('s3://${AssetsBucketName}/${AssetsBucketPrefix}'),
    });

    new ssm.StringParameter(this, 'region-parameter', {
      parameterName: 'Region',
      stringValue: cdk.Aws.REGION,
    });

    new ssm.StringParameter(this, 'failing-deployment-asset', {
      parameterName: 'DeploymentAsset',
      stringValue: cdk.Fn.sub('s3://${AssetsBucketName}/${AssetsBucketPrefix}app_deploy_fail.zip'),
    });

    // Create availability zone mapper
    const azMapper = new AvailabilityZoneMapper(this, 'az-mapper', {
      availabilityZoneNames,
    });

    // Create availability zone configuration
    const availabilityZoneMap: Record<string, string> = {};
    const availabilityZoneIds: string[] = availabilityZoneNames.map((x) => {
      const azId = azMapper.availabilityZoneIdFromAvailabilityZoneLetter(x.slice(-1));
      availabilityZoneMap[x] = azId;
      return azId;
    });

    // Create AZ Tagger Stack
    this.azTaggerStack = new AZTaggerStack(this, 'az-tagger', {});

    // Create Network Stack
    this.networkStack = new IpV6NetworkStack(this, 'network', {
      availabilityZoneNames,
    });

    // Create Database Stack
    this.databaseStack = new DatabaseStack(this, 'database', {
      vpc: this.networkStack.vpc,
    });

    // Create log group for front-end
    const frontEndLogGroup = new logs.LogGroup(this, 'front-end-log-group', {
      logGroupName: this.frontEndLogGroupName,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create security group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'alb-security-group', {
      vpc: this.networkStack.vpc,
      allowAllOutbound: true,
      allowAllIpv6Outbound: this.networkStack.vpc.ipV6Enabled ? true : false,
    });

    // Allow inbound port 80 connections from the VPC for Lambda canary tests
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.networkStack.vpc.vpcCidrBlock),
      ec2.Port.tcp(80)
    );

    if (this.networkStack.vpc.ipV6Enabled) {
      albSecurityGroup.addIngressRule(
        ec2.Peer.ipv6(cdk.Fn.select(0, this.networkStack.vpc.vpcIpv6CidrBlocks)),
        ec2.Port.tcp(80)
      );
    }

    // Create EC2 Fleet Stack
    this.ec2Stack = new EC2FleetStack(this, 'ec2', {
      vpc: this.networkStack.vpc,
      instanceSize: ec2.InstanceSize.NANO,
      logGroup: frontEndLogGroup,
      fleetSize,
      cpuArch: this.ec2Arch,
      iamResourcePath: '/front-end/ec2-fleet/',
      database: this.databaseStack.database,
      loadBalancerSecurityGroup: albSecurityGroup,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      assetsBucketName: assetsBucketName.valueAsString,
      assetsBucketPrefix: assetsBucketPrefix.valueAsString,
    });

    this.ec2Stack.node.addDependency(this.azTaggerStack);

    // Create EKS Stack
    this.eksStack = new EKSStack(this, 'eks', {
      cpuArch: this.arch,
      vpc: this.networkStack.vpc,
      database: this.databaseStack.database,
      loadBalancerSecurityGroup: albSecurityGroup,
      adminRoleName: participantRoleName.valueAsString,
      iamResourcePath: '/front-end/eks-fleet/',
    });

    this.eksStack.node.addDependency(this.azTaggerStack);
    this.eksStack.node.addDependency(frontEndLogGroup);

    // Create target groups array
    const targetGroups: elbv2.IApplicationTargetGroup[] = [
      this.ec2Stack.targetGroup,
      this.eksStack.eksAppTargetGroup,
    ];

    // Create Enhanced Application Load Balancer
    this.loadBalancer = new EnhancedApplicationLoadBalancer(this, 'alb', {
      internetFacing: false,
      vpc: this.networkStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      http2Enabled: true,
      securityGroup: albSecurityGroup,
    });

    // Enable zonal shift attribute
    this.loadBalancer.setAttribute('zonal_shift.config.enabled', 'true');

    // Create Route53 Zonal DNS Stack (conditional)
    if (this.evacuationMethod !== EvacuationMethod.ZonalShift) {
      new Route53ZonalDnsStack(this, 'route-53-', {
        loadBalancer: this.loadBalancer,
        vpc: this.networkStack.vpc,
        domain: this.domain,
        availabilityZoneMap,
      });
    }

    // Create resources/stack for AZ evacuation based on evacuation method
    switch (this.evacuationMethod) {
      case EvacuationMethod.SelfManagedHttpEndpoint_APIG: {
        const apigStack = new SelfManagedHttpEndpointApigStack(this, 'apig-', {
          availabilityZoneIds,
          failOpen: true,
        });

        new Route53HealthChecksStack(this, 'health-checks-', {
          domainName: cdk.Fn.join('.', [
            apigStack.api.restApiId,
            'execute-api',
            cdk.Fn.sub('${AWS::Region}'),
            cdk.Fn.sub('${AWS::URLSuffix}'),
          ]),
          resourcePath: apigStack.resourcePath,
          evacuationMethod: this.evacuationMethod,
          availabilityZoneIdToRoutingControlArns: Object.fromEntries(
            availabilityZoneIds.map((x) => [x, undefined as any])
          ),
        });
        break;
      }
      case EvacuationMethod.ARC: {
        const arcStack = new ApplicationRecoveryControllerStack(this, 'ARC', {
          availabilityZoneIds,
        });

        new Route53HealthChecksStack(this, 'health-checks-', {
          evacuationMethod: this.evacuationMethod,
          domainName: '',
          resourcePath: '',
          availabilityZoneIdToRoutingControlArns: arcStack.routingControlsPerAvailabilityZoneId,
        });
        break;
      }
      case EvacuationMethod.SelfManagedHttpEndpoint_S3: {
        const s3Stack = new SelfManagedHttpEndpointS3Stack(this, 's3-', {
          availabilityZoneIds,
        });

        new Route53HealthChecksStack(this, 'health-checks-', {
          domainName: s3Stack.bucket.bucketRegionalDomainName,
          resourcePath: s3Stack.resourcePath,
          evacuationMethod: this.evacuationMethod,
          inverted: true,
          availabilityZoneIdToRoutingControlArns: Object.fromEntries(
            availabilityZoneIds.map((x) => [x, undefined as any])
          ),
        });
        break;
      }
      default:
      case EvacuationMethod.ZonalShift: {
        // No resources to deploy for zonal shift
        break;
      }
    }

    // Create service using service factory
    const wildRydesService: IService = createService({
      loadBalancer: this.loadBalancer,
      vpc: this.networkStack.vpc,
      serverLogGroups: [frontEndLogGroup],
      targetGroups: [this.ec2Stack.targetGroup],
    });

    // Create multi-AZ observability nested stack
    const mazNestedStack = new NestedStackWithSource(this, 'multi-az-observability-');
    const multiAvailabilityZoneObservability = new InstrumentedServiceMultiAZObservability(
      mazNestedStack,
      'instrumented-service-',
      {
        service: wildRydesService,
        createDashboards: true,
        interval: cdk.Duration.minutes(60),
        assetsBucketParameterName: 'AssetsBucketName',
        assetsBucketPrefixParameterName: 'AssetsBucketPrefix',
      }
    );

    // Create basic service multi-AZ observability
    new BasicServiceMultiAZObservability(this, 'basic-service-', {
      applicationLoadBalancerProps: {
        albTargetGroupMap: [
          {
            applicationLoadBalancer: this.loadBalancer,
            targetGroups,
          },
        ],
        latencyStatistic: 'p99',
        faultCountPercentThreshold: 1,
        latencyThreshold: cdk.Duration.millis(500),
      },
      createDashboard: true,
      datapointsToAlarm: 2,
      evaluationPeriods: 3,
      serviceName: 'WildRydes',
      period: cdk.Duration.seconds(60),
      interval: cdk.Duration.minutes(60),
    });

    // Add HTTP listener on port 80
    const listener = this.loadBalancer.addListener('http-listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([this.ec2Stack.targetGroup]),
    });

    // Make sure the alarms used for CodeDeploy are created before creating the listener
    listener.node.addDependency(mazNestedStack);

    // Create EKS routing rules for /home and /signin paths
    if (this.eksStack) {
      new elbv2.ApplicationListenerRule(this, 'eks-alb-routes', {
        action: elbv2.ListenerAction.forward([this.eksStack.eksAppTargetGroup]),
        conditions: [elbv2.ListenerCondition.pathPatterns(['/home', '/signin'])],
        priority: 1,
        listener,
      });
    }

    // Create Fault Injection Stack
    this.faultInjectionStack = new FaultInjectionStack(this, 'fault-injection', {
      azCount: availabilityZoneNames.length,
      azNames: this.networkStack.vpc.availabilityZones,
      database: this.databaseStack.database,
      logGroupName: '/fis/experiments',
      logGroupRetention: logs.RetentionDays.ONE_WEEK,
      autoScalingGroup: this.ec2Stack.autoScalingGroup,
      delayMilliseconds: cdk.Duration.millis(150),
      packetLossPercent: 30,
    });

    // Create SSM Random Fault Stack
    this.ssmRandomFaultStack = new SSMRandomFaultStack(this, 'ssm-random-fault', {
      latencyExperiments: this.faultInjectionStack.latencyExperiments,
      packetLossExperiments: this.faultInjectionStack.packetLossExperiments,
    });

    // Create Log Query Stack
    this.logQueryStack = new LogQueryStack(this, 'log-query-', {
      canaryLogGroup: multiAvailabilityZoneObservability.canaryLogGroup,
      serverSideLogGroup: frontEndLogGroup,
      service: wildRydesService,
      availabilityZoneIds,
    });

    // Create CodeDeploy Application Stack
    this.codeDeployStack = new CodeDeployApplicationStack(this, 'codedeploy', {
      ec2Fleet: this.ec2Stack,
      applicationKey: assetsBucketPrefix.valueAsString + 'app_deploy.zip',
      availabilityZoneCount: availabilityZoneIds.length,
      totalEC2InstancesInFleet: fleetSize,
      applicationName: 'multi-az-workshop',
      minimumHealthyHostsPerZone: 1,
      alarms: [
        multiAvailabilityZoneObservability.perOperationAlarmsAndRules['Ride']?.canaryRegionalAlarmsAndRules
          ?.availabilityOrLatencyAlarm,
        multiAvailabilityZoneObservability.perOperationAlarmsAndRules['Pay']?.canaryRegionalAlarmsAndRules
          ?.availabilityOrLatencyAlarm,
        multiAvailabilityZoneObservability.perOperationAlarmsAndRules['Signin']?.canaryRegionalAlarmsAndRules
          ?.availabilityOrLatencyAlarm,
        multiAvailabilityZoneObservability.perOperationAlarmsAndRules['Home']?.canaryRegionalAlarmsAndRules
          ?.availabilityOrLatencyAlarm,
      ].filter((alarm): alarm is cdk.aws_cloudwatch.IAlarm => alarm !== undefined),
    });

    this.codeDeployStack.node.addDependency(listener);
  }
}
