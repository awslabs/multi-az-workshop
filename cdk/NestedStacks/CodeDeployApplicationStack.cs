// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.CloudWatch;
using Amazon.CDK.AWS.CodeDeploy;
using Amazon.CDK.AWS.IAM;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using static Amazon.CDK.AWS.CodeDeploy.CfnDeploymentConfig;
using static Amazon.CDK.AWS.CodeDeploy.CfnDeploymentGroup;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface ICodeDeployApplicationStackProps : INestedStackProps
    {
        public string IAMResourcePath {get; set;}
        public EC2FleetStack EC2Fleet {get; set;}
        public string ApplicationKey {get; set;}
        public int TotalEC2InstancesInFleet {get; set;}
        public int AvailabilityZoneCount {get; set;}
        public IAlarm[] Alarms {get; set;}
        public string ApplicationName {get; set;}
        public int MinimumHealthyHostsPerZone {get; set;}
    }

    public class CodeDeployApplicationStackProps: NestedStackProps, ICodeDeployApplicationStackProps
    {
        public string IAMResourcePath {get; set;} = "/codedeploy/";
        public EC2FleetStack EC2Fleet {get; set;}
        public string ApplicationKey {get; set;}
        public int TotalEC2InstancesInFleet {get; set;}
        public int AvailabilityZoneCount {get; set;}
        public IAlarm[] Alarms {get; set;}
        public string ApplicationName {get; set;}
        public int MinimumHealthyHostsPerZone {get; set;}
    }

    public class CodeDeployApplicationStack : NestedStackWithSource 
    {
        public ServerApplication Application {get;}

        public CfnDeploymentGroup FrontEndDeploymentGroup {get;}

        public CodeDeployApplicationStack(Stack scope, string id, ICodeDeployApplicationStackProps props) : base(scope, id, props)
        {
            ManagedPolicy codedeployManagedPolicy = new ManagedPolicy(this, "CodeDeployManagedPolicy", new ManagedPolicyProps() {
                Path = props.IAMResourcePath,
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] { 
                            "ec2:RunInstances",
                            "ec2:CreateTages",
							"iam:PassRole",
                            "cloudwatch:DesribeAlarms"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" } 
                    })
                }
            });    

            Role role = new Role(this, "CodeDeployRole", new RoleProps() {
                Path = props.IAMResourcePath,
                Description = "The IAM role used by CodeDeploy",
                AssumedBy = new ServicePrincipal("codedeploy.amazonaws.com"),
                ManagedPolicies = new IManagedPolicy[] { 
                    ManagedPolicy.FromManagedPolicyArn(this, "ServiceRolePolicy", "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole"),
                    ManagedPolicy.FromManagedPolicyArn(this, "ECSPolicy", "arn:aws:iam::aws:policy/AWSCodeDeployRoleForECS"),
                    ManagedPolicy.FromManagedPolicyArn(this, "LambdaPolicy", "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForLambda"),
                    codedeployManagedPolicy
                }
            }); 

            this.Application = new ServerApplication(this, "Application", new ServerApplicationProps() {
                ApplicationName = props.ApplicationName
            });

            // https://docs.aws.amazon.com/codedeploy/latest/userguide/instances-health.html#minimum-healthy-hosts
            CfnDeploymentConfig zonalDeploymentConfig = new CfnDeploymentConfig(this, "ZonalConfig", new CfnDeploymentConfigProps() {
                ComputePlatform = "Server",
                ZonalConfig = new ZonalConfigProperty() {
                    FirstZoneMonitorDurationInSeconds = 180,
                    MonitorDurationInSeconds = 60,
                    MinimumHealthyHostsPerZone = new MinimumHealthyHostsPerZoneProperty() {
                        Type = "HOST_COUNT",
                        Value = props.MinimumHealthyHostsPerZone // Only deploy to 1 at a time so canaries don't fail
                    }
                },
                MinimumHealthyHosts = new MinimumHealthyHostsProperty() {
                    Type = "HOST_COUNT",
                    Value = Math.Floor((double)props.TotalEC2InstancesInFleet / props.AvailabilityZoneCount)
                }
            });

            CfnDeploymentGroup zonalDeploymentGroup = new CfnDeploymentGroup(this, "ZonalDeploymentGroup", new CfnDeploymentGroupProps() {
                ApplicationName = this.Application.ApplicationName,
                ServiceRoleArn = role.RoleArn,
                DeploymentGroupName = "ZonalDeploymentGroup",
                LoadBalancerInfo = new LoadBalancerInfoProperty() {
                    TargetGroupInfoList = new TargetGroupInfoProperty[] {
                        new TargetGroupInfoProperty() { Name = props.EC2Fleet.TargetGroup.TargetGroupName }
                    }
                },
                DeploymentConfigName = zonalDeploymentConfig.Ref,
                DeploymentStyle = new DeploymentStyleProperty() {
                    DeploymentOption = "WITH_TRAFFIC_CONTROL",
                    DeploymentType = "IN_PLACE"
                },
                Ec2TagFilters = new EC2TagFilterProperty[] {
                    new EC2TagFilterProperty() {
                        Key = "aws:autoscaling:groupName",
                        Value = props.EC2Fleet.AutoScalingGroup.AutoScalingGroupName,
                        Type = "KEY_AND_VALUE"
                    }
                },           
                AlarmConfiguration = (props.Alarms != null && props.Alarms.Any()) ?                
                    new AlarmConfigurationProperty() {
                        Alarms = props.Alarms.Select(x => new AlarmProperty() { Name = x.AlarmName }).ToArray(),
                        Enabled = true              
                    } : null
            });
    
            CfnDeploymentGroup deploymentGroup = new CfnDeploymentGroup(this, "DeploymentGroup", new CfnDeploymentGroupProps() {
                ApplicationName = this.Application.ApplicationName,
                ServiceRoleArn = role.RoleArn,
                AutoScalingGroups = new string[] { props.EC2Fleet.AutoScalingGroup.AutoScalingGroupName },
                DeploymentConfigName = ServerDeploymentConfig.ALL_AT_ONCE.DeploymentConfigName,
                LoadBalancerInfo = new LoadBalancerInfoProperty() {
                    TargetGroupInfoList = new TargetGroupInfoProperty[] {
                        new TargetGroupInfoProperty() { Name = props.EC2Fleet.TargetGroup.TargetGroupName }
                    }
                },
                Deployment = new DeploymentProperty() {
                    Revision = new RevisionLocationProperty() {
                        RevisionType = "S3",
                        S3Location = new S3LocationProperty() {
                            Bucket = Fn.Ref("AssetsBucketName"),
                            Key = props.ApplicationKey,
                            BundleType = "zip"
                        }
                    },
                    IgnoreApplicationStopFailures = true
                },
                DeploymentStyle = new DeploymentStyleProperty() {
                    DeploymentOption = "WITH_TRAFFIC_CONTROL",
                    DeploymentType = "IN_PLACE"
                }
            });
        }
    }
}