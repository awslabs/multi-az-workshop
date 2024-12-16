// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using Amazon.CDK;
using Amazon.CDK.AWS.Events;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.Logs;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class AZTaggerStack : NestedStackWithSource
    {
        public string FunctionArn {get;}

        public AZTaggerStack(Stack scope, string id, NestedStackProps props) : base(scope, id, props)
        {
            ManagedPolicy xrayManagedPolicy = new ManagedPolicy(this, "xrayManagedPolicy", new ManagedPolicyProps() {
                Path = "/aztagger/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "xray:PutTraceSegments",
                            "xray:PutTelemetryRecords",
                            "xray:GetSamplingRules",
                            "xray:GetSamplingTargets",
                            "xray:GetSamplingStatisticSummaries"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                }
            });
            ManagedPolicy ec2ManagedPolicy = new ManagedPolicy(this, "ec2ManagedPolicy", new ManagedPolicyProps() {
                Path = "/aztagger/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "ec2:DescribeAvailabilityZones",
                            "ec2:DescribeTags",
                            "ec2:CreateTags",
                            "ec2:DescribeInstances"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                }
            });

            Role executionRole = new Role(this, "executionRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("lambda.amazonaws.com"),
                Path = "/aztagger/",
                ManagedPolicies = new ManagedPolicy[] {
                    xrayManagedPolicy,
                    ec2ManagedPolicy
                }
            }); 

            Function azTagger = new Function(this, "azTagger", new FunctionProps() {
                Runtime = Runtime.PYTHON_3_12,
                Code = Code.FromInline(File.ReadAllText("./az-tagger-src/index.py")),
                Handler = "index.handler",
                Role = executionRole,
                Architecture = Architecture.ARM_64,
                Tracing = Tracing.ACTIVE,
                Timeout = Duration.Seconds(60),
                MemorySize = 512,
                Environment = new Dictionary<string, string>() {
                    {"REGION", Fn.Ref("AWS::Region")},
                    {"PARTITION", Fn.Ref("AWS::Partition")}
                }
            });

            this.FunctionArn = azTagger.FunctionArn;

            azTagger.AddPermission("invokePermission", new Permission() {
                Action = "lambda:InvokeFunction",
                Principal = new ServicePrincipal("events.amazonaws.com"),
                SourceArn = Fn.Sub("arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/*")
            });

            LogGroup logs = new LogGroup(this, "logGroup", new LogGroupProps() {
                LogGroupName = $"/aws/lambda/{azTagger.FunctionName}",
                Retention = RetentionDays.ONE_DAY,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy cloudWatchManagedPolicy = new ManagedPolicy(this, "cwManagedPolicy", new ManagedPolicyProps() {
                Path = "/azmapper/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "cloudwatch:PutMetricData"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { logs.LogGroupArn }
                    })
                },
                Roles = new Role[] { executionRole }
            });             

            Rule ec2Launch = new Rule(this, "ec2Launch", new RuleProps() {
                EventPattern = new EventPattern() {
                    Source = new string[] { "aws.ec2" },
                    DetailType = new string[] { "EC2 Instance State-change Notification" },
                    Detail = new Dictionary<string, object>() { {"state", new string[] { "pending" } } }
                },
                Enabled = true,
                Targets = new IRuleTarget[] { new Amazon.CDK.AWS.Events.Targets.LambdaFunction(azTagger) }
            });
        }
    }
}