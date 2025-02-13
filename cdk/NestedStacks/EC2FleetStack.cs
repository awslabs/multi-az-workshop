// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Amazon.CDK;
using Amazon.CDK.AWS.AutoScaling;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.SSM;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class EC2FleetStackProps : NestedStackProps, INestedStackProps 
    {
        public IVpcIpV6 Vpc {get; set;}

        public InstanceSize InstanceSize {get; set;} = InstanceSize.NANO;

        public ILogGroup LogGroup {get; set;}

        public InstanceArchitecture CpuArch {get; set;} = InstanceArchitecture.ARM_64;

        public int Port {get; set; } = 5000;

        public string CloudWatchAgentConfigVersion {get; set;} = "0.01";

        public string LaunchTemplateMetadataVersion {get; set;} = "0.01";

        public string IAMResourcePath {get; set;} = "/front-end/ec2-fleet/";

        public DatabaseCluster Database {get; set;}

        public int FleetSize {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public ISubnetSelection Subnets {get; set;}

        public string AssetsBucketName {get; set;}

        public string AssetsBucketPrefix {get; set;}
    }

    public class EC2FleetStack : NestedStack
    {
        public ILaunchTemplate LaunchTemplate {get;}

        public IAutoScalingGroup AutoScalingGroup {get;}

        private IStringParameter CWAgentConfig {get;}

        public IApplicationTargetGroup TargetGroup {get;}

        private static IDictionary<string, string[]> configSets = new Dictionary<string, string[]>() {
            { "setup", new string[] {
                    "01_metadata-version",
                    "02_setup-cfn-hup",
                    "03_check-cfn-hup",
                    "04_install-cloudwatch-agent",
                    "05_config-amazon-cloudwatch-agent",
                    "06_restart-amazon-cloudwatch-agent",
                    "10_setup-firewalld",                
                    "13_install_icu_support",
                    "14_set_database_details",
                    "15_install-docker",
                    "16_setup-web-user",
                    "17_verify-docker",
                    "18_install-codedeploy",
                    "19_start-codedeploy-agent",
                    "20_set-env"
                }
            },
            {
                "update", new string[] {
                    "05_config-amazon-cloudwatch-agent",
                    "06_restart-amazon-cloudwatch-agent",
                    "14_set_database_details"
                }
            }
        };     
        
        public EC2FleetStack(Stack scope, string id, EC2FleetStackProps props) : base(scope, id, props)
        {       
            #region SSM Parameters

            this.CWAgentConfig = new StringParameter(this, "cwAgentConfig", new StringParameterProps() {
                StringValue = Regex.Replace(File.ReadAllText("./Configs/cw-agent-config.json"), "(\"(?:[^\"\\\\]|\\\\.)*\")|\\s+", "$1")
            });
            
            #endregion

            #region IAM Resources

            ManagedPolicy ec2ManagedPolicy = new ManagedPolicy(this, "ec2ManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows the front ends to perform standard operational actions",
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {"s3:GetObject", "s3:GetObjectVersion"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:s3:::*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {"kms:Decrypt"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:kms:*:${AWS::AccountId}:key/*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {"secretsmanager:GetSecretValue"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {props.Database.Secret.SecretFullArn}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Sid = "AllowSessionManagerConnections",
                        Actions = new string[] {
                            "ssmmessages:CreateControlChannel",
                            "ssmmessages:CreateDataChannel",
                            "ssmmessages:OpenControlChannel",
                            "ssmmessages:OpenDataChannel",
                            "ssm:UpdateInstanceInformation"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {"*"}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Sid = "NeededForSessionManagerEncryptedS3Logs",
                        Actions = new string[] {"s3:GetEncryptionConfiguration"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {"*"}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Sid = "AllowSessionManagerToWriteAuditLogstoCWL",
                        Actions = new string[] {
                            "logs:CreateLogStream",
                            "logs:PutLogEvents",
                            "logs:DescribeLogGroups",
                            "logs:DescribeLogStreams"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Sid = "ForCfnInit",
                        Actions = new string[] {"cloudformation:DescribeStackResource"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {"*"}
                    }),
                }
            });

            ManagedPolicy s3PatchingManagedPolicy = new ManagedPolicy(this, "S3PatchingManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows the front ends to download patches from S3",
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { "s3:GetObject" },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { 
                            Fn.Sub("arn:${AWS::Partition}:s3:::aws-ssm-${AWS::Region}/*"),
                            Fn.Sub("arn:${AWS::Partition}:s3:::aws-ssm-packages-${AWS::Region}/*"),
                            Fn.Sub("arn:${AWS::Partition}:s3:::patch-baseline-snapshot-${AWS::Region}/*"),
                            Fn.Sub("arn:${AWS::Partition}:s3:::${AWS::Region}-birdwatcher-prod/*"),
                            Fn.Sub("arn:${AWS::Partition}:s3:::amazon-ssm-${AWS::Region}/*") 
                        }
                    })
                }
            });

            ManagedPolicy codedeployManagedPolicy = new ManagedPolicy(this, "codedeployManagedPolicy", new ManagedPolicyProps() {
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { 
                            "codedeploy-commands-secure:GetDeploymentSpecification",
                            "codedeploy-commands-secure:PollHostCommand",
                            "codedeploy-commands-secure:PutHostCommandAcknowledgement",
                            "codedeploy-commands-secure:PutHostCommandComplete"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" } 
                    })
                }
            });           
            ManagedPolicy ssmParameterManagedPolicy = new ManagedPolicy(this, "ssmParameterManagedPolicy", new ManagedPolicyProps() {
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { 
                            "ssm:GetParameter"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { 
                            this.CWAgentConfig.ParameterArn
                        } 
                    })
                }
            });
            ManagedPolicy ssmPatchingManagedPolicy = new ManagedPolicy(this, "ssmPatchingManagedPolicy", new ManagedPolicyProps() {
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { 
                            "ssm:GetDeployablePatchSnapshotForInstance",
                            "ssm:PutInventory",
                            "ssm:PutComplianceItems",
                            "ssm:DescribeAssociation",
                            "ssm:ListAssociations",
                            "ssm:ListInstanceAssociations",
                            "ssm:UpdateAssociationStatus",
                            "ssm:UpdateInstanceAssociationStatus",
                            "ssm:UpdateInstanceInformation",
                            "ssm:GetDocument",
                            "ssm:DescribeDocument"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" } 
                    })
                }
            });
            ManagedPolicy ecrPolicy = new ManagedPolicy(this, "ecr-policy", new ManagedPolicyProps() {
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { 
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:BatchGetImage",
                            "ecr:GetAuthorizationToken",
                            "s3:GetObject",
                            "ecr:DescribeImages",
                            "ecr:DescribeRepositories"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" } 
                    })
                }
            });
                     
            Role role = new Role(this, "InstanceRole", new RoleProps() {
                Description = "The IAM role used by the front-end EC2 fleet",
                Path = props.IAMResourcePath,
                AssumedBy = new ServicePrincipal("ec2.amazonaws.com"),
                ManagedPolicies = new IManagedPolicy[] { 
                    ManagedPolicy.FromManagedPolicyArn(this, "CWAgent", "arn:aws:iam::aws:policy/CloudWatchAgentAdminPolicy"),
                    ManagedPolicy.FromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
                    ec2ManagedPolicy,
                    s3PatchingManagedPolicy,
                    codedeployManagedPolicy,
                    ssmParameterManagedPolicy,
                    ssmPatchingManagedPolicy,
                    ecrPolicy
                }
            });                
            InstanceProfile profile = new InstanceProfile(this, "InstanceProfile", new InstanceProfileProps() {
                Role = role,
                Path = props.IAMResourcePath
            });
            
            #endregion

            #region Security Group

            SecurityGroup sg = new SecurityGroup(this, "frontendSecurityGroup", new SecurityGroupProps() {
                Description =  "Allow inbound access from the load balancer and public clients",
                Vpc = props.Vpc
            });

            sg.AddIngressRule(Peer.SecurityGroupId(props.LoadBalancerSecurityGroup.SecurityGroupId), Port.Tcp(5000));
            
            #endregion

            #region Launch Template

            UserData userData = UserData.ForLinux(new LinuxUserDataOptions() { Shebang =  "#!/bin/bash" });

            this.LaunchTemplate = new LaunchTemplate(this, "front-end-launch-template", new LaunchTemplateProps() {
                UserData = userData,
                MachineImage = MachineImage.LatestAmazonLinux2023(new AmazonLinux2023ImageSsmParameterProps() { CpuType = props.CpuArch == InstanceArchitecture.ARM_64 ? AmazonLinuxCpuType.ARM_64 : AmazonLinuxCpuType.X86_64 }),
                InstanceType = Amazon.CDK.AWS.EC2.InstanceType.Of(props.CpuArch == InstanceArchitecture.ARM_64 ? InstanceClass.T4G : InstanceClass.T3A, InstanceSize.MICRO),
                EbsOptimized  = true,
                InstanceProfile = profile,
                SecurityGroup = sg,
                BlockDevices = new Amazon.CDK.AWS.EC2.BlockDevice[] {
                    new Amazon.CDK.AWS.EC2.BlockDevice() {
                        DeviceName = "/dev/xvda",
                        Volume = new Amazon.CDK.AWS.EC2.BlockDeviceVolume(new Amazon.CDK.AWS.EC2.EbsDeviceProps() {
                            VolumeType = Amazon.CDK.AWS.EC2.EbsDeviceVolumeType.GP3,
                            VolumeSize = 8
                         })
                    }
                },
                RequireImdsv2 = true,
                InstanceMetadataTags = true,
                HttpTokens = LaunchTemplateHttpTokens.REQUIRED                
            });    
        
            TagManager.Of(this.LaunchTemplate).SetTag("arch", props.CpuArch.ToString(), null, true);   
            TagManager.Of(this.LaunchTemplate).SetTag("Name", "front-end-web-server", null, true);

            #endregion

            #region Target Group

            ApplicationTargetGroup atg = new ApplicationTargetGroup(this, "front-end-target-group", new ApplicationTargetGroupProps() {
                HealthCheck = new Amazon.CDK.AWS.ElasticLoadBalancingV2.HealthCheck() { 
                    Enabled = true,
                    Port = "traffic-port",
                    Interval = Duration.Seconds(10),
                    Protocol = Amazon.CDK.AWS.ElasticLoadBalancingV2.Protocol.HTTP,
                    Timeout = Duration.Seconds(2),
                    HealthyThresholdCount = 2,
                    UnhealthyThresholdCount = 2,
                    Path = "/health"             
                },
                Port = props.Port,
                Protocol = ApplicationProtocol.HTTP,
                TargetType = TargetType.INSTANCE,
                LoadBalancingAlgorithmType = TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
                DeregistrationDelay = Duration.Seconds(90),
                Vpc = props.Vpc,
                ProtocolVersion = ApplicationProtocolVersion.HTTP1                         
            });
                    
            atg.SetAttribute("load_balancing.cross_zone.enabled", "true");
            atg.SetAttribute("target_group_health.dns_failover.minimum_healthy_targets.count", "1");

            this.TargetGroup = atg;

            #endregion

            #region Autoscaling Resources

            GroupMetrics asgMetrics = new GroupMetrics(GroupMetric.MIN_SIZE, GroupMetric.MAX_SIZE, GroupMetric.DESIRED_CAPACITY, GroupMetric.IN_SERVICE_INSTANCES, GroupMetric.PENDING_INSTANCES, GroupMetric.STANDBY_INSTANCES, GroupMetric.TERMINATING_INSTANCES, GroupMetric.TOTAL_INSTANCES);

            AutoScalingGroup asg = new AutoScalingGroup(this, "FrontEndASG", new AutoScalingGroupProps() {
                LaunchTemplate = this.LaunchTemplate,
                MinCapacity = props.FleetSize,
                MaxCapacity = props.FleetSize,
                Vpc = props.Vpc,
                VpcSubnets = props.Subnets,
                // Typically takes 3.5 - 4 minutes to deploy the application to a new instance
                HealthCheck = Amazon.CDK.AWS.AutoScaling.HealthCheck.Elb(new ElbHealthCheckOptions() { Grace = Duration.Seconds(240) }),
                GroupMetrics = new GroupMetrics[] { asgMetrics },
                Signals = Signals.WaitForCount(Math.Ceiling((double)(props.FleetSize / 2)), new SignalsOptions(){ Timeout = Duration.Minutes(10)}),
                DefaultInstanceWarmup = Duration.Seconds(120),
                UpdatePolicy = UpdatePolicy.RollingUpdate(new RollingUpdateOptions() {
                    MinInstancesInService = 1,
                    MaxBatchSize = 6,
                    PauseTime = Duration.Minutes(5),
                    WaitOnResourceSignals = true,
                    SuspendProcesses = [
                        ScalingProcess.ALARM_NOTIFICATION,
                        ScalingProcess.AZ_REBALANCE,
                        ScalingProcess.HEALTH_CHECK,
                        ScalingProcess.REPLACE_UNHEALTHY,
                        ScalingProcess.SCHEDULED_ACTIONS
                    ]     
                })
            });

            asg.AddLifecycleHook("terminate", new BasicLifecycleHookProps() {
                LifecycleTransition = LifecycleTransition.INSTANCE_TERMINATING,
                HeartbeatTimeout = Duration.Minutes(10)
            });

            asg.ApplyCloudFormationInit(CloudFormationInit.FromConfigSets(new ConfigSetProps() {
                    ConfigSets = configSets,
                    Configs = asg.GenerateInitConfig(this, props, this.CWAgentConfig.ParameterName)
                }),
                new Amazon.CDK.AWS.AutoScaling.ApplyCloudFormationInitOptions() {
                    ConfigSets = new string[] { "setup" },
                    PrintLog = true           
                }
            );

            //userData.AddCommands(File.ReadAllLines("./NestedStacks/send_cfn_init_to_logs.sh"));

            asg.AttachToApplicationTargetGroup(atg);

            this.AutoScalingGroup = asg;

            #endregion         
        }
    }

    static class ExtensionMethods
    {
        internal static Dictionary<string, InitConfig> GenerateInitConfig(
            this IAutoScalingGroup resource,
            Construct scope,
            EC2FleetStackProps props,
            string cwAgentConfigParameterName
        )
        {
            InitServiceRestartHandle cfnHupHandle = new InitServiceRestartHandle();
            InitServiceRestartHandle dockerHandle = new InitServiceRestartHandle();

            return new Dictionary<string, InitConfig>() {
                {
                    "01_metadata-version", 
                    new InitConfig( 
                        new InitElement[] {
                            // Update the version to simulate the update of metadata
                            InitFile.FromString("/etc/cfn/dummy.version",$"VERSION={props.LaunchTemplateMetadataVersion}") 
                        }
                    )                           
                },
                {
                    "02_setup-cfn-hup", 
                    new InitConfig( 
                        new InitElement[] {
                            InitFile.FromString("/etc/cfn/cfn-hup.conf", new StringBuilder()
                                .AppendLine("[main]")
                                .AppendLine(Fn.Sub("stack=${AWS::StackId}"))
                                .AppendLine(Fn.Sub("region=${AWS::Region}"))
                                .AppendLine("interval=10")
                                .AppendLine("verbose=true")
                                .AppendLine("umaks=022")
                                .ToString(),
                                new InitFileOptions() { 
                                    Mode = "000400", 
                                    Owner = "root", 
                                    Group = "root", 
                                    ServiceRestartHandles = [ cfnHupHandle ]
                                }
                            ),
                            InitFile.FromString("/etc/cfn/hooks.d/amazon-cloudwatch-agent-auto-reloader.conf", new StringBuilder()
                                .AppendLine("[amazon-cloudwatch-agent-auto-reloader-hook]")
                                .AppendLine("triggers=post.update")
                                .AppendLine("path=Resources." + Names.UniqueId(resource) + ".Metadata.AWS::CloudFormation::Init.05_config-amazon-cloudwatch-agent")
                                .AppendLine(Fn.Sub("action=/opt/aws/bin/cfn-init --verbose --stack ${AWS::StackId} --resource " + Names.UniqueId(resource) + " --region ${AWS::Region} --configsets update"))
                                .AppendLine("runas=root")
                                .ToString(),
                                new InitFileOptions() { 
                                    Mode = "000400", 
                                    Owner = "root", 
                                    Group = "root",
                                    ServiceRestartHandles = [ cfnHupHandle ]
                                }
                            ),
                            InitFile.FromString("/etc/cfn/hooks.d/cfn-auto-reloader-configsets.conf", new StringBuilder()
                                .AppendLine("[cfn-configset-auto-reloader-hook]")
                                .AppendLine("triggers=post.update")
                                .AppendLine("path=Resources." + Names.UniqueId(resource) + ".Metadata.AWS::CloudFormation::Init.configSets")
                                .AppendLine(Fn.Sub("action=/opt/aws/bin/cfn-init --verbose --stack ${AWS::StackId} --resource " + Names.UniqueId(resource) + " --region ${AWS::Region} --configsets setup"))
                                .AppendLine("runas=root")
                                .ToString(),
                                new InitFileOptions() { 
                                    Mode = "000400", 
                                    Owner = "root", 
                                    Group = "root",
                                    ServiceRestartHandles = [ cfnHupHandle ]
                                }
                            ),
                            InitFile.FromString("/etc/cfn/hooks.d/cfn-auto-reloader-version.conf", new StringBuilder()
                                .AppendLine("[cfn-version-auto-reloader-hook]")
                                .AppendLine("triggers=post.update")
                                .AppendLine("path=Resources." + Names.UniqueId(resource) + ".Metadata.AWS::CloudFormation::Init.01_metadata-version")
                                .AppendLine(Fn.Sub("action=/opt/aws/bin/cfn-init --verbose --stack ${AWS::StackId} --resource " + Names.UniqueId(resource) + " --region ${AWS::Region} --configsets setup"))
                                .AppendLine("runas=root")
                                .ToString(),
                                new InitFileOptions() { 
                                    Mode = "000400", 
                                    Owner = "root", 
                                    Group = "root",
                                    ServiceRestartHandles = [ cfnHupHandle ]
                                }
                            ),
                            InitService.Enable("cfn-hup", new InitServiceOptions() {
                                Enabled = true,
                                EnsureRunning = true,
                                ServiceManager = ServiceManager.SYSTEMD,
                                ServiceRestartHandle = cfnHupHandle
                            })
                        }
                    )                           
                },
                {
                    "03_check-cfn-hup",
                    new InitConfig(new InitElement[] {
                        InitCommand.ShellCommand("systemctl status cfn-hup.service")
                    })                        
                },
                {
                    "04_install-cloudwatch-agent",
                    new InitConfig(new InitElement[] {
                        InitPackage.Yum("amazon-cloudwatch-agent"),
                        //InitCommand.ShellCommand("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a set-log-level -l DEBUG"),
                    })
                    
                },
                {
                    "05_config-amazon-cloudwatch-agent",
                    new InitConfig(new InitElement[] {
                        InitFile.FromString(
                            "/opt/aws/amazon-cloudwatch-agent/etc/dummy.version", 
                            $"VERSION=${props.CloudWatchAgentConfigVersion}",
                            new InitFileOptions() { 
                                Mode = "000400", 
                                Owner = "root",
                                Group = "root"
                            }
                        )
                    })                        
                },
                {
                    "06_restart-amazon-cloudwatch-agent",
                    new InitConfig(new InitElement[] {
                        InitCommand.ShellCommand("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -m ec2 -a stop"),
                        InitCommand.ShellCommand(Fn.Sub("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c ssm:${ssm} -s", new Dictionary<string, string>(){ {"ssm", cwAgentConfigParameterName} })),
                        InitCommand.ShellCommand("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status")
                    })                        
                },
                {
                    "10_setup-firewalld",
                    new InitConfig(new InitElement[] {
                        InitPackage.Yum("firewalld"),
                        InitCommand.ShellCommand("systemctl enable firewalld"),
                        InitCommand.ShellCommand("systemctl start firewalld"),
                        InitCommand.ShellCommand("firewall-cmd --state"),
                        InitCommand.ShellCommand($"firewall-cmd --add-port={props.Port}/tcp --permanent"),
                        InitCommand.ShellCommand("firewall-cmd --add-port=80/tcp --permanent"),
                        InitCommand.ShellCommand("firewall-cmd --reload"),
                        InitCommand.ShellCommand("firewall-cmd --list-all"),
                    })                        
                },
                
                {
                    "13_install_icu_support",
                    new InitConfig(new InitElement[] {
                        InitPackage.Yum("icu")
                    })                        
                },
                {
                    "14_set_database_details",
                    new InitConfig( 
                        new InitElement[] {
                            InitFile.FromString("/etc/secret", props.Database.Secret.SecretName, new InitFileOptions() { Mode = "000444", Owner = "root", Group = "root"}) 
                        }
                    )                   
                },
                {
                    "15_install-docker",
                    new InitConfig(
                        new InitElement[] {
                            InitPackage.Yum("docker", new NamedPackageOptions(){
                                ServiceRestartHandles = [ dockerHandle ]
                            }),
                            InitCommand.ShellCommand("mkdir -p /usr/libexec/docker/cli-plugins"),
                            InitCommand.ShellCommand("aws s3 cp s3://" + props.AssetsBucketName + "/" + props.AssetsBucketPrefix + "docker-compose /usr/libexec/docker/cli-plugins/docker-compose --region " + Aws.REGION),
                            InitCommand.ShellCommand("chmod +x /usr/libexec/docker/cli-plugins/docker-compose"),
                            InitService.Enable("docker", new InitServiceOptions() {
                                Enabled = true,
                                EnsureRunning = true,
                                ServiceManager = ServiceManager.SYSTEMD,
                                ServiceRestartHandle = dockerHandle                      
                            })
                        }
                    )
                },
                {
                    "16_setup-web-user",
                    new InitConfig(new InitElement[] {
                        new InitUser("web", new InitUserOptions() {      
                            Groups = ["docker"]           
                        })
                    })                        
                },
                {
                    "17_verify-docker",
                    new InitConfig(
                        new InitElement[] {
                            InitCommand.ShellCommand("docker ps"),
                            //InitCommand.ShellCommand("docker compose version")
                        }
                    )
                },
                {
                    "18_install-codedeploy",
                    new InitConfig(new InitElement[] {
                        InitCommand.ShellCommand("yum -y install ruby"),
                        InitCommand.ShellCommand(Fn.Sub("curl https://aws-codedeploy-${AWS::Region}.s3.${AWS::Region}.${AWS::URLSuffix}/latest/install --output /tmp/codedeploy")),
                        InitCommand.ShellCommand("chmod +x /tmp/codedeploy"),
                        InitCommand.ShellCommand("/tmp/codedeploy auto"),
                        InitCommand.ShellCommand("echo \"\" >> /etc/codedeploy-agent/conf/codedeployagent.yml"),
                        InitCommand.ShellCommand("echo \":enable_auth_policy: true\" >> /etc/codedeploy-agent/conf/codedeployagent.yml"),
                        InitCommand.ShellCommand("service codedeploy-agent stop"),
                        InitCommand.ShellCommand("rm /tmp/codedeploy")
                    })                        
                },
                {
                    "19_start-codedeploy-agent",
                    new InitConfig(new InitElement[] {
                        InitService.Enable("codedeploy-agent", new InitServiceOptions() {
                            Enabled = true,
                            EnsureRunning = true,
                            ServiceManager = ServiceManager.SYSTEMD
                        })
                    })                        
                },
                {
                    "20_set-env",
                    new InitConfig(
                        new InitElement[] {
                            InitFile.FromString(
                                "/etc/environment",
                                Fn.Join("\n",
                                    [
                                        "AWS_REGION=" + Aws.REGION,
                                        "URL_SUFFIX=" + Aws.URL_SUFFIX,
                                        "ONEBOX=false",
                                        "ACCOUNT_ID=" + Aws.ACCOUNT_ID
                                    ]
                                ),
                                new InitFileOptions() {
                                    Mode = "0755",
                                    Owner = "root",
                                    Group = "root"
                                }
                            ),
                            InitFile.FromString(
                                "/etc/onebox",
                                "ONEBOX=false"
                            )
                        }
                    )
                }
            };
        }
    }
}
