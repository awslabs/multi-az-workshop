// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.FIS;
using Amazon.CDK.AWS.IAM;
using Newtonsoft.Json;
using static Amazon.CDK.AWS.FIS.CfnExperimentTemplate;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.AutoScaling;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface IFaultInjectionStackProps : INestedStackProps
    {
        public string[] AZNames {get; set;}
        public int AZCount {get; set;}
        public DatabaseCluster Database {get; set;}
        public string LogGroupName {get; set;}
        public RetentionDays LogGroupRetention {get; set;}
        public string Interface {get; set;}
        public IAutoScalingGroup AutoScalingGroup {get; set;}
        public int LogSchemaVersion {get; set;}
        public Duration DelayMilliseconds {get; set;}
        public int PacketLossPercent {get; set;}

    }

    public class FaultInjectionStackProps : NestedStackProps, IFaultInjectionStackProps
    {
        public string[] AZNames {get; set;}
        public int AZCount {get; set;}
        public DatabaseCluster Database {get; set;}
        public string LogGroupName {get; set;}
        public RetentionDays LogGroupRetention {get; set;}
        public string Interface {get; set;} = "ens5"; //could also be eth0
        public IAutoScalingGroup AutoScalingGroup {get; set;}
        public int LogSchemaVersion {get; set;} = 2;
        public Duration DelayMilliseconds {get; set;} = Duration.Millis(100);
        public int PacketLossPercent {get; set;} = 10;
    }

    public class FaultInjectionStack : NestedStack
    {
        public CfnExperimentTemplate[] LatencyExperiments {get;}
        public CfnExperimentTemplate[] PacketLossExperiments {get;}
        public CfnExperimentTemplate[] CpuStressTestExperiments {get;}
        public ILogGroup LogGroup {get; set;}

        public FaultInjectionStack(Stack scope, string id, IFaultInjectionStackProps props) : base(scope, id, props)
        {
            this.LogGroup = new LogGroup(this, "logGroup", new LogGroupProps() {
                LogGroupName = props.LogGroupName,
                Retention = props.LogGroupRetention,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy cloudWatchManagedPolicy = new ManagedPolicy(this, "cwManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows FIS to write CWL",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
				            "logs:CreateLogStream",
				            "logs:PutLogEvents",
                            "logs:DescribeLogGroups",
                            "logs:DescribeLogStreams"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
				            "logs:GetDelivery",
                            "logs:GetDeliverySource",
                            "logs:PutDeliveryDestination",
                            "logs:GetDeliveryDestinationPolicy",
                            "logs:DeleteDeliverySource",
                            "logs:PutDeliveryDestinationPolicy",
                            "logs:CreateDelivery",
                            "logs:GetDeliveryDestination",
                            "logs:PutDeliverySource",
                            "logs:DeleteDeliveryDestination",
                            "logs:DeleteDeliveryDestinationPolicy",
                            "logs:DeleteDelivery"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] {
                            Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery:*"),
                            Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery-source:*"),
                            Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:delivery-destination:*")
                        }
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
				            "logs:DescribeDeliveryDestinations",
                            "logs:DescribeDeliverySources",
                            "logs:DescribeDeliveries",
                            "logs:CreateLogDelivery"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
				            "logs:PutResourcePolicy",
                            "logs:DescribeResourcePolicies",
                            "logs:DescribeLogGroups"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { Fn.Sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*") }
                    })
                }
            });

            Role role = new Role(this, "FISRole", new RoleProps() {
                Description = "The IAM role used by FIS",
                AssumedBy = new ServicePrincipal("fis.amazonaws.com"),
                ManagedPolicies = new IManagedPolicy[] { 
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorEC2Access"),
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorECSAccess"),
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorEKSAccess"),
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorNetworkAccess"),
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorRDSAccess"),
                    ManagedPolicy.FromAwsManagedPolicyName("service-role/AWSFaultInjectionSimulatorSSMAccess"),
                    cloudWatchManagedPolicy
                }                  
            });  

            CfnRole cfnRole = role.Node.DefaultChild as CfnRole;
            cfnRole.AssumeRolePolicyDocument = new Dictionary<string, object>() {
                {"Version", "2012-10-17"},
                {"Statement", new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        { "Effect", "Allow"},
                        { "Principal", new Dictionary<string, object>() {
                            {"Service", new string[] { "fis.amazonaws.com" }}
                        }},
                        { "Action", "sts:AssumeRole"},
                        { "Condition", new Dictionary<string, object>() {
                            { "StringEquals", new Dictionary<string, string>() {
                                {"aws:SourceAccount", Fn.Ref("AWS::AccountId")}
                            }},
                            {"ArnLike", new Dictionary<string, object>() {
                                {"aws:SourceArn", Fn.Sub("arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment/*") }
                            }}}
                        }
                    }
                }}               
            };     

            this.LatencyExperiments = new CfnExperimentTemplate[props.AZCount];
            this.PacketLossExperiments = new CfnExperimentTemplate[props.AZCount];
            this.CpuStressTestExperiments = new CfnExperimentTemplate[props.AZCount];

            for (int i = 0; i < props.AZCount; i++)
            {
                string azName = Fn.Select(i, props.AZNames);

                this.LatencyExperiments[i] = new CfnExperimentTemplate(this,"az" + i + "LatencyTemplate", new CfnExperimentTemplateProps() {
                    RoleArn = role.RoleArn,
                    Description = "Adds latency EC2 instances connecting to the database",
                    Actions = new Dictionary<string, object>() {
                        {"addLatency", new ExperimentTemplateActionProperty() {
                            ActionId = "aws:ssm:send-command",
                            Parameters = new Dictionary<string, string>() {
                                {"documentArn", Fn.Sub("arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-Network-Latency-Sources")},
                                {"documentParameters", JsonConvert.SerializeObject(new Dictionary<string, string>() {
                                    {"Interface", props.Interface},
                                    {"DelayMilliseconds", ((int)props.DelayMilliseconds.ToMilliseconds()).ToString()},
                                    {"JitterMilliseconds", "10"},
                                    {"Sources", props.Database.ClusterEndpoint.Hostname},
                                    {"TrafficType", "egress"},
                                    {"InstallDependencies", "True"},
                                    {"DurationSeconds", "3600"}
                                })},
                                {"duration", "PT60M"}
                            },
                            Targets = new Dictionary<string, string>() {
                                { "Instances", "oneAZ"}
                            }      
                        }}
                    },
                    Targets = new Dictionary<string, object>() {
                        {"oneAZ", new ExperimentTemplateTargetProperty() {
                            Filters = new ExperimentTemplateTargetFilterProperty[] {
                                new ExperimentTemplateTargetFilterProperty() {
                                    Path = "Placement.AvailabilityZone",
                                    Values = new string[] { azName }
                                }
                            },
                            ResourceTags = new Dictionary<string, string>() {
                                { "aws:autoscaling:groupName", props.AutoScalingGroup.AutoScalingGroupName}
                            },
                            SelectionMode = "ALL",
                            ResourceType = "aws:ec2:instance"
                        }}
                    },
                    StopConditions = new ExperimentTemplateStopConditionProperty[] {
                        new ExperimentTemplateStopConditionProperty() {
                            Source = "none"
                        }
                    },
                    Tags = new Dictionary<string, string>() {
                        { "Name", "Add Latency to " + azName }
                    },
                    LogConfiguration = new ExperimentTemplateLogConfigurationProperty() {
                        CloudWatchLogsConfiguration = new CloudWatchLogsConfigurationProperty() {
                            LogGroupArn = this.LogGroup.LogGroupArn
                        },
                        LogSchemaVersion = props.LogSchemaVersion
                    }
                });

                // The construct names the property incorrectly
                this.LatencyExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn", this.LogGroup.LogGroupArn);
                this.LatencyExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn", null);

                this.PacketLossExperiments[i] = new CfnExperimentTemplate(this, "az" + i + "PacketLossTemplate", new CfnExperimentTemplateProps() {
                    RoleArn = role.RoleArn,
                    Description = "Drops packets from EC2 instances connecting to the database",
                    Actions = new Dictionary<string, object>() {
                        {"packetLoss", new ExperimentTemplateActionProperty() {
                            ActionId = "aws:ssm:send-command",
                            Parameters = new Dictionary<string, string>() {
                                {"documentArn", Fn.Sub("arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-Network-Packet-Loss-Sources")},
                                {"documentParameters", JsonConvert.SerializeObject(new Dictionary<string, string>() {
                                    {"Interface", props.Interface},
                                    {"LossPercent", props.PacketLossPercent.ToString()},
                                    {"Sources", props.Database.ClusterEndpoint.Hostname},
                                    {"TrafficType", "egress"},
                                    {"InstallDependencies", "True"},
                                    {"DurationSeconds", "3600"}
                                })},
                                {"duration", "PT60M"}
                            },
                            Targets = new Dictionary<string, string>() {
                                { "Instances", "oneAZ"}
                            }
                        }}
                    },           
                    Targets = new Dictionary<string, object>() {
                        {"oneAZ", new ExperimentTemplateTargetProperty() {
                            Filters = new ExperimentTemplateTargetFilterProperty[] {
                                new ExperimentTemplateTargetFilterProperty() {
                                    Path = "Placement.AvailabilityZone",
                                    Values = new string[] { azName }
                                }
                            },
                            ResourceTags = new Dictionary<string, string>() {
                                { "aws:autoscaling:groupName", props.AutoScalingGroup.AutoScalingGroupName}
                            },
                            SelectionMode = "ALL",
                            ResourceType = "aws:ec2:instance"
                        }}
                    },
                    StopConditions = new ExperimentTemplateStopConditionProperty[] {
                        new ExperimentTemplateStopConditionProperty() {
                            Source = "none"
                        }
                    },
                    Tags = new Dictionary<string, string>() {
                        { "Name", "Add Packet Loss to " + azName}
                    },
                    LogConfiguration = new ExperimentTemplateLogConfigurationProperty() {
                        CloudWatchLogsConfiguration = new CloudWatchLogsConfigurationProperty() {
                            LogGroupArn = this.LogGroup.LogGroupArn
                        },
                        LogSchemaVersion = props.LogSchemaVersion
                    }
                });

                this.PacketLossExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn", this.LogGroup.LogGroupArn);
                this.PacketLossExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn", null);

                this.CpuStressTestExperiments[i] = new CfnExperimentTemplate(this, "az" + i + "CpuStressTestTemplate", new CfnExperimentTemplateProps() {
                    RoleArn = role.RoleArn,
                    Description = "Runs CPU stress on EC2 instances",
                    Actions = new Dictionary<string, object>() {
                        {"cpuStress", new ExperimentTemplateActionProperty() {
                            ActionId = "aws:ssm:send-command",
                            Parameters = new Dictionary<string, string>() {
                                {"documentArn", Fn.Sub("arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWSFIS-Run-CPU-Stress")},
                                {"documentParameters", JsonConvert.SerializeObject(new Dictionary<string, string>() {
                                    {"DurationSeconds", "3600"}
                                })},
                                {"duration", "PT60M"}
                            },
                            Targets = new Dictionary<string, string>() {
                                { "Instances", "oneAZ"}
                            }
                        }}
                    },           
                    Targets = new Dictionary<string, object>() {
                        {"oneAZ", new ExperimentTemplateTargetProperty() {
                            Filters = new ExperimentTemplateTargetFilterProperty[] {
                                new ExperimentTemplateTargetFilterProperty() {
                                    Path = "Placement.AvailabilityZone",
                                    Values = new string[] { azName }
                                }
                            },
                            ResourceTags = new Dictionary<string, string>() {
                                { "aws:autoscaling:groupName", props.AutoScalingGroup.AutoScalingGroupName}
                            },
                            SelectionMode = "ALL",
                            ResourceType = "aws:ec2:instance"
                        }}
                    },
                    StopConditions = new ExperimentTemplateStopConditionProperty[] {
                        new ExperimentTemplateStopConditionProperty() {
                            Source = "none"
                        }
                    },
                    Tags = new Dictionary<string, string>() {
                        { "Name", "Add CPU stress to instances in " + azName}
                    },
                    LogConfiguration = new ExperimentTemplateLogConfigurationProperty() {
                        CloudWatchLogsConfiguration = new CloudWatchLogsConfigurationProperty() {
                            LogGroupArn = this.LogGroup.LogGroupArn
                        },
                        LogSchemaVersion = props.LogSchemaVersion
                    }
                });

                this.CpuStressTestExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.LogGroupArn", this.LogGroup.LogGroupArn);
                this.CpuStressTestExperiments[i].AddOverride("Properties.LogConfiguration.CloudWatchLogsConfiguration.logGroupArn", null);
            }
        }
    }
}