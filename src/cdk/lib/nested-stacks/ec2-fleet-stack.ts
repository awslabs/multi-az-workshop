// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { IVpcIpV6 } from '../constructs/vpc-ipv6-construct';

/**
 * Props for EC2 Fleet Stack
 */
export interface EC2FleetStackProps extends cdk.NestedStackProps {
  /**
   * VPC where the EC2 fleet will be deployed
   */
  readonly vpc: IVpcIpV6;

  /**
   * Instance size for EC2 instances
   * @default InstanceSize.NANO
   */
  readonly instanceSize?: ec2.InstanceSize;

  /**
   * Log group for application logs
   */
  readonly logGroup: logs.ILogGroup;

  /**
   * CPU architecture for instances
   * @default ARM_64
   */
  readonly cpuArch?: ec2.InstanceArchitecture;

  /**
   * Application port
   * @default 5000
   */
  readonly port?: number;

  /**
   * CloudWatch agent config version
   * @default "0.01"
   */
  readonly cloudWatchAgentConfigVersion?: string;

  /**
   * Launch template metadata version
   * @default "0.01"
   */
  readonly launchTemplateMetadataVersion?: string;

  /**
   * IAM resource path
   * @default "/front-end/ec2-fleet/"
   */
  readonly iamResourcePath?: string;

  /**
   * Database cluster
   */
  readonly database: rds.DatabaseCluster;

  /**
   * Fleet size (number of instances)
   */
  readonly fleetSize: number;

  /**
   * Load balancer security group
   */
  readonly loadBalancerSecurityGroup: ec2.ISecurityGroup;

  /**
   * Subnets for the fleet
   */
  readonly subnets: ec2.SubnetSelection;

  /**
   * Assets bucket name
   */
  readonly assetsBucketName: string;

  /**
   * Assets bucket prefix
   */
  readonly assetsBucketPrefix: string;
}

/**
 * Nested stack that creates an EC2 auto-scaling fleet
 */
export class EC2FleetStack extends cdk.NestedStack {
  /**
   * Launch template for the fleet
   */
  public readonly launchTemplate: ec2.ILaunchTemplate;

  /**
   * Auto scaling group
   */
  public readonly autoScalingGroup: autoscaling.IAutoScalingGroup;

  /**
   * Target group for the load balancer
   */
  public readonly targetGroup: elbv2.IApplicationTargetGroup;

  private readonly cwAgentConfig: ssm.IStringParameter;

  constructor(scope: cdk.Stack, id: string, props: EC2FleetStackProps) {
    super(scope, id, props);

    const port = props.port ?? 5000;
    const cpuArch = props.cpuArch ?? ec2.InstanceArchitecture.ARM_64;
    const iamResourcePath = props.iamResourcePath ?? '/front-end/ec2-fleet/';
    // const cloudWatchAgentConfigVersion = props.cloudWatchAgentConfigVersion ?? '0.01';
    // const launchTemplateMetadataVersion = props.launchTemplateMetadataVersion ?? '0.01';

    // Create SSM parameter for CloudWatch agent config
    const cwAgentConfigPath = path.join(process.cwd(), 'src', 'cdk', 'configs', 'cw-agent-config.json');
    const cwAgentConfigContent = fs.readFileSync(cwAgentConfigPath, 'utf-8');
    const cwAgentConfigMinified = cwAgentConfigContent.replace(/("(?:[^"\\]|\\.)*")|\s+/g, '$1');

    this.cwAgentConfig = new ssm.StringParameter(this, 'cwAgentConfig', {
      stringValue: cwAgentConfigMinified,
    });

    // Create IAM managed policies
    const ec2ManagedPolicy = new iam.ManagedPolicy(this, 'ec2ManagedPolicy', {
      description: 'Allows the front ends to perform standard operational actions',
      path: iamResourcePath,
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
          actions: ['secretsmanager:GetSecretValue'],
          effect: iam.Effect.ALLOW,
          resources: [props.database.secret!.secretFullArn!],
        }),
        new iam.PolicyStatement({
          sid: 'AllowSessionManagerConnections',
          actions: [
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel',
            'ssm:UpdateInstanceInformation',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'NeededForSessionManagerEncryptedS3Logs',
          actions: ['s3:GetEncryptionConfiguration'],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'AllowSessionManagerToWriteAuditLogstoCWL',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogGroups', 'logs:DescribeLogStreams'],
          effect: iam.Effect.ALLOW,
          resources: [cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*')],
        }),
        new iam.PolicyStatement({
          sid: 'ForCfnInit',
          actions: ['cloudformation:DescribeStackResource'],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    const s3PatchingManagedPolicy = new iam.ManagedPolicy(this, 'S3PatchingManagedPolicy', {
      description: 'Allows the front ends to download patches from S3',
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          effect: iam.Effect.ALLOW,
          resources: [
            cdk.Fn.sub('arn:${AWS::Partition}:s3:::aws-ssm-${AWS::Region}/*'),
            cdk.Fn.sub('arn:${AWS::Partition}:s3:::aws-ssm-packages-${AWS::Region}/*'),
            cdk.Fn.sub('arn:${AWS::Partition}:s3:::patch-baseline-snapshot-${AWS::Region}/*'),
            cdk.Fn.sub('arn:${AWS::Partition}:s3:::${AWS::Region}-birdwatcher-prod/*'),
            cdk.Fn.sub('arn:${AWS::Partition}:s3:::amazon-ssm-${AWS::Region}/*'),
          ],
        }),
      ],
    });

    const codedeployManagedPolicy = new iam.ManagedPolicy(this, 'codedeployManagedPolicy', {
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'codedeploy-commands-secure:GetDeploymentSpecification',
            'codedeploy-commands-secure:PollHostCommand',
            'codedeploy-commands-secure:PutHostCommandAcknowledgement',
            'codedeploy-commands-secure:PutHostCommandComplete',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    const ssmParameterManagedPolicy = new iam.ManagedPolicy(this, 'ssmParameterManagedPolicy', {
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter'],
          effect: iam.Effect.ALLOW,
          resources: [this.cwAgentConfig.parameterArn],
        }),
      ],
    });

    const ssmPatchingManagedPolicy = new iam.ManagedPolicy(this, 'ssmPatchingManagedPolicy', {
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'ssm:GetDeployablePatchSnapshotForInstance',
            'ssm:PutInventory',
            'ssm:PutComplianceItems',
            'ssm:DescribeAssociation',
            'ssm:ListAssociations',
            'ssm:ListInstanceAssociations',
            'ssm:UpdateAssociationStatus',
            'ssm:UpdateInstanceAssociationStatus',
            'ssm:UpdateInstanceInformation',
            'ssm:GetDocument',
            'ssm:DescribeDocument',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    const ecrPolicy = new iam.ManagedPolicy(this, 'ecr-policy', {
      path: iamResourcePath,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'ecr:BatchCheckLayerAvailability',
            'ecr:GetDownloadUrlForLayer',
            'ecr:BatchGetImage',
            'ecr:GetAuthorizationToken',
            's3:GetObject',
            'ecr:DescribeImages',
            'ecr:DescribeRepositories',
          ],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    // Create IAM role
    const role = new iam.Role(this, 'InstanceRole', {
      description: 'The IAM role used by the front-end EC2 fleet',
      path: iamResourcePath,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'CWAgent', 'arn:aws:iam::aws:policy/CloudWatchAgentAdminPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        ec2ManagedPolicy,
        s3PatchingManagedPolicy,
        codedeployManagedPolicy,
        ssmParameterManagedPolicy,
        ssmPatchingManagedPolicy,
        ecrPolicy,
      ],
    });

    // Create security group
    const sg = new ec2.SecurityGroup(this, 'frontendSecurityGroup', {
      description: 'Allow inbound access from the load balancer and public clients',
      vpc: props.vpc,
    });

    sg.addIngressRule(ec2.Peer.securityGroupId(props.loadBalancerSecurityGroup.securityGroupId), ec2.Port.tcp(port));

    // Create user data
    const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash' });

    // Create launch template with role using high-level properties
    this.launchTemplate = new ec2.LaunchTemplate(this, 'front-end-launch-template', {
      userData,
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: cpuArch === ec2.InstanceArchitecture.ARM_64 ? ec2.AmazonLinuxCpuType.ARM_64 : ec2.AmazonLinuxCpuType.X86_64,
      }),
      instanceType: ec2.InstanceType.of(
        cpuArch === ec2.InstanceArchitecture.ARM_64 ? ec2.InstanceClass.T4G : ec2.InstanceClass.T3A,
        ec2.InstanceSize.MICRO,
      ),
      ebsOptimized: true,
      securityGroup: sg,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      requireImdsv2: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED,
      role: role
    });

    // Add tags to instances launched from this template
    const cfnLaunchTemplate = this.launchTemplate.node.defaultChild as ec2.CfnLaunchTemplate;
    const launchTemplateData = cfnLaunchTemplate.launchTemplateData as ec2.CfnLaunchTemplate.LaunchTemplateDataProperty;

    cfnLaunchTemplate.launchTemplateData = {
      ...launchTemplateData,
      tagSpecifications: [
        {
          resourceType: 'instance',
          tags: [
            { key: 'arch', value: cpuArch.toString() },
            { key: 'Name', value: 'front-end-web-server' },
          ],
        },
      ],
    };

    // Create target group
    const atg = new elbv2.ApplicationTargetGroup(this, 'front-end-target-group', {
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
      port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      loadBalancingAlgorithmType: elbv2.TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
      deregistrationDelay: cdk.Duration.seconds(90),
      vpc: props.vpc,
      protocolVersion: elbv2.ApplicationProtocolVersion.HTTP1,
    });

    atg.setAttribute('load_balancing.cross_zone.enabled', 'true');
    atg.setAttribute('target_group_health.dns_failover.minimum_healthy_targets.count', '1');

    this.targetGroup = atg;

    // Create auto scaling group
    const asg = new autoscaling.AutoScalingGroup(this, 'FrontEndASG', {
      launchTemplate: this.launchTemplate,
      minCapacity: props.fleetSize,
      maxCapacity: props.fleetSize,
      vpc: props.vpc,
      vpcSubnets: props.subnets,
      healthChecks: autoscaling.HealthChecks.withAdditionalChecks({
        additionalTypes: [autoscaling.AdditionalHealthCheckType.ELB],
        gracePeriod: cdk.Duration.seconds(240),
      }),
      defaultInstanceWarmup: cdk.Duration.seconds(120),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        minInstancesInService: 1,
        maxBatchSize: 6,
        pauseTime: cdk.Duration.minutes(5),
        waitOnResourceSignals: true,
        suspendProcesses: [
          autoscaling.ScalingProcess.ALARM_NOTIFICATION,
          autoscaling.ScalingProcess.AZ_REBALANCE,
          autoscaling.ScalingProcess.HEALTH_CHECK,
          autoscaling.ScalingProcess.REPLACE_UNHEALTHY,
          autoscaling.ScalingProcess.SCHEDULED_ACTIONS,
        ],
      }),
      signals: autoscaling.Signals.waitForCount(Math.ceil(props.fleetSize / 2), {
        timeout: cdk.Duration.minutes(10),
      }),
    });

    asg.addLifecycleHook('terminate', {
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_TERMINATING,
      heartbeatTimeout: cdk.Duration.minutes(10),
    });

    // Add CloudFormation Init configuration
    const cfnInit = ec2.CloudFormationInit.fromConfigSets({
      configSets: {
        setup: [
          '01_metadata_version',
          '02_setup_cfn_hup',
          '03_check_cfn_hup',
          '04_install_cloudwatch_agent',
          '05_config_amazon_cloudwatch_agent',
          '06_restart_amazon_cloudwatch_agent',
          '07_setup_firewalld',
          '08_set_database_details',
          '09_install_docker',
          '10_setup_web_user',
          '11_verify_docker',
          '12_install_codedeploy',
          '13_start_codedeploy_agent',
          '14_set_env',
        ],
        update: [
          '05_config_amazon_cloudwatch_agent',
          '06_restart_amazon_cloudwatch_agent',
          '08_set_database_details',
        ],
      },
      configs: {
        '01_metadata_version': new ec2.InitConfig([
          ec2.InitFile.fromString('/etc/cfn/dummy.version', `VERSION=${props.launchTemplateMetadataVersion ?? '0.01'}`),
        ]),
        '02_setup_cfn_hup': new ec2.InitConfig([
          ec2.InitFile.fromString(
            '/etc/cfn/cfn-hup.conf',
            [
              '[main]',
              cdk.Fn.sub('stack=${AWS::StackId}'),
              cdk.Fn.sub('region=${AWS::Region}'),
              'interval=10',
              'verbose=true',
              'umask=022',
            ].join('\n'),
            { mode: '000400', owner: 'root', group: 'root' }
          ),
          ec2.InitFile.fromString(
            '/etc/cfn/hooks.d/amazon-cloudwatch-agent-auto-reloader.conf',
            [
              '[amazon-cloudwatch-agent-auto-reloader-hook]',
              'triggers=post.update',
              `path=Resources.${cdk.Names.uniqueId(asg)}.Metadata.AWS::CloudFormation::Init.05_config_amazon_cloudwatch_agent`,
              cdk.Fn.sub(`action=/opt/aws/bin/cfn-init --verbose --stack \${AWS::StackId} --resource ${cdk.Names.uniqueId(asg)} --region \${AWS::Region} --configsets update`),
              'runas=root',
            ].join('\n'),
            { mode: '000400', owner: 'root', group: 'root' }
          ),
          ec2.InitService.enable('cfn-hup', {
            enabled: true,
            ensureRunning: true,
            serviceManager: ec2.ServiceManager.SYSTEMD,
          }),
        ]),
        '03_check_cfn_hup': new ec2.InitConfig([
          ec2.InitCommand.shellCommand('systemctl status cfn-hup.service'),
        ]),
        '04_install_cloudwatch_agent': new ec2.InitConfig([
          ec2.InitPackage.yum('amazon-cloudwatch-agent'),
        ]),
        '05_config_amazon_cloudwatch_agent': new ec2.InitConfig([
          ec2.InitFile.fromString(
            '/opt/aws/amazon-cloudwatch-agent/etc/dummy.version',
            `VERSION=${props.cloudWatchAgentConfigVersion ?? '0.01'}`,
            { mode: '000400', owner: 'root', group: 'root' }
          ),
        ]),
        '06_restart_amazon_cloudwatch_agent': new ec2.InitConfig([
          ec2.InitCommand.shellCommand('/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -m ec2 -a stop'),
          ec2.InitCommand.shellCommand(
            cdk.Fn.sub('/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c ssm:${ssm} -s', {
              ssm: this.cwAgentConfig.parameterName,
            })
          ),
          ec2.InitCommand.shellCommand('/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status'),
        ]),
        '07_setup_firewalld': new ec2.InitConfig([
          ec2.InitPackage.yum('firewalld'),
          ec2.InitCommand.shellCommand('systemctl enable firewalld'),
          ec2.InitCommand.shellCommand('systemctl start firewalld'),
          ec2.InitCommand.shellCommand('firewall-cmd --state'),
          ec2.InitCommand.shellCommand(`firewall-cmd --add-port=${port}/tcp --permanent`),
          ec2.InitCommand.shellCommand('firewall-cmd --reload'),
          ec2.InitCommand.shellCommand('firewall-cmd --list-all'),
        ]),
        '08_set_database_details': new ec2.InitConfig([
          ec2.InitFile.fromString('/etc/secret', props.database.secret!.secretName, {
            mode: '000444',
            owner: 'root',
            group: 'root',
          }),
        ]),
        '09_install_docker': new ec2.InitConfig([
          ec2.InitPackage.yum('docker'),
          ec2.InitCommand.shellCommand('mkdir -p /usr/libexec/docker/cli-plugins'),
          ec2.InitCommand.shellCommand(
            `aws s3 cp s3://${props.assetsBucketName}/${props.assetsBucketPrefix}docker-compose /usr/libexec/docker/cli-plugins/docker-compose --region ${cdk.Aws.REGION}`
          ),
          ec2.InitCommand.shellCommand('chmod +x /usr/libexec/docker/cli-plugins/docker-compose'),
          ec2.InitService.enable('docker', {
            enabled: true,
            ensureRunning: true,
            serviceManager: ec2.ServiceManager.SYSTEMD,
          }),
        ]),
        '10_setup_web_user': new ec2.InitConfig([
          ec2.InitUser.fromName('web', { groups: ['docker'] }),
        ]),
        '11_verify_docker': new ec2.InitConfig([
          ec2.InitCommand.shellCommand('docker ps'),
        ]),
        '12_install_codedeploy': new ec2.InitConfig([
          ec2.InitCommand.shellCommand('yum -y install ruby'),
          ec2.InitCommand.shellCommand(
            cdk.Fn.sub('curl https://aws-codedeploy-${AWS::Region}.s3.${AWS::Region}.${AWS::URLSuffix}/latest/install --output /tmp/codedeploy')
          ),
          ec2.InitCommand.shellCommand('chmod +x /tmp/codedeploy'),
          ec2.InitCommand.shellCommand('/tmp/codedeploy auto'),
          ec2.InitCommand.shellCommand('echo "" >> /etc/codedeploy-agent/conf/codedeployagent.yml'),
          ec2.InitCommand.shellCommand('echo ":enable_auth_policy: true" >> /etc/codedeploy-agent/conf/codedeployagent.yml'),
          ec2.InitCommand.shellCommand('service codedeploy-agent stop'),
          ec2.InitCommand.shellCommand('rm /tmp/codedeploy'),
        ]),
        '13_start_codedeploy_agent': new ec2.InitConfig([
          ec2.InitService.enable('codedeploy-agent', {
            enabled: true,
            ensureRunning: true,
            serviceManager: ec2.ServiceManager.SYSTEMD,
          }),
        ]),
        '14_set_env': new ec2.InitConfig([
          ec2.InitFile.fromString(
            '/etc/environment',
            [
              `AWS_REGION=${cdk.Aws.REGION}`,
              `URL_SUFFIX=${cdk.Aws.URL_SUFFIX}`,
              'ONEBOX=false',
              `ACCOUNT_ID=${cdk.Aws.ACCOUNT_ID}`,
            ].join('\n'),
            { mode: '0755', owner: 'root', group: 'root' }
          ),
          ec2.InitFile.fromString('/etc/onebox', 'ONEBOX=false'),
        ]),
      },
    });

    // Apply CloudFormation Init to the Auto Scaling Group
    asg.applyCloudFormationInit(cfnInit, {
      configSets: ['setup'],
      printLog: true,
    });

    asg.attachToApplicationTargetGroup(atg);

    this.autoScalingGroup = asg;
  }
}
