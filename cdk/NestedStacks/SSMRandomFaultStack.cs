// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.FIS;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SSM;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface ISSMRandomFaultStackProps : INestedStackProps
    {
        public CfnExperimentTemplate[] LatencyExperiments {get; set;}
        public CfnExperimentTemplate[] PacketLossExperiments {get; set;}
    }

    public class SSMRandomFaultStackProps : NestedStackProps, ISSMRandomFaultStackProps
    {
        public CfnExperimentTemplate[] LatencyExperiments {get; set;}
        public CfnExperimentTemplate[] PacketLossExperiments {get; set;}
    }

    public class SSMRandomFaultStack : NestedStackWithSource
    {
        public SSMRandomFaultStack(Stack scope, string id, ISSMRandomFaultStackProps props) : base(scope, id, props)
        {
            ManagedPolicy fisManagedPolicy = new ManagedPolicy(this, "fisManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows SSM to start an experiment",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "fis:StartExperiment"
                        },
                        Effect = Effect.ALLOW,
                        Resources = props.LatencyExperiments.Concat(props.PacketLossExperiments).Select(x => Fn.Sub("arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment-template/${id}", new Dictionary<string, string>() {
                            {"id", x.Ref}
                        }))
                        .Append(Fn.Sub("arn:${AWS::Partition}:fis:${AWS::Region}:${AWS::AccountId}:experiment/*"))
                        .ToArray()
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "codedeploy:CreateDeployment",
                            "codedeploy:GetApplicationRevision",
                            "codedeploy:GetDeploymentConfig",
                            "codedeploy:RegisterApplicationRevision"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                }
            });
            
            Role role = new Role(this, "SSMRole", new RoleProps() {
                Description = "The IAM role used by ssm to start an experiment",
                AssumedBy = new ServicePrincipal("ssm.amazonaws.com"),
                ManagedPolicies = new IManagedPolicy[] { 
                    fisManagedPolicy
                }
            });  

            CfnDocument randomFaults = new CfnDocument(this, "randomFaultSelect", new CfnDocumentProps() {
                DocumentType =  "Automation",
                DocumentFormat = "YAML",
                Content = new Dictionary<string, object>() {
                    {"schemaVersion", "0.3"},
                    {"assumeRole", role.RoleArn},
                    {"parameters", new Dictionary<string, object>() {
                        {"LatencyExperiments", new Dictionary<string, object>() {
                            {"type", "StringList"},
                            {"minItems", "1"},
                            {"description", "(Required) The latency experiment templates to choose from"},
                            {"default", props.LatencyExperiments.Select(x => x.Ref).ToArray()}
                        }},
                        {"PacketLossExperiments", new Dictionary<string, object>() {
                            {"type", "StringList"},
                            {"minItems", "1"},
                            {"description", "(Required) The latency experiment templates to choose from"},
                            {"default", props.PacketLossExperiments.Select(x => x.Ref).ToArray()}
                        }},
                        /*{"ApplicationDeployment", new Dictionary<string, object>() {
                            {"type", "StringMap"},
                            {"description", "(Required) The application and deployment group"},
                            {"default", new Dictionary<string, string>() {
                                {"ApplicationName", props.DeploymentGroup.ApplicationName},
                                {"DeploymentGroupName", props.DeploymentGroup.Ref},
                                {"ApplicationKey", props.ApplicationKey},
                                {"Bucket", Fn.Ref("AssetsBucket")}
                            }}
                        }}*/
                    }},
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"name", "StartExperiment"},
                            {"action", "aws:executeScript"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Runtime", "python3.8"},
                                {"Handler", "handler"},
                                {"InputPayload", new Dictionary<string, object>() {
                                    {"LatencyExperiments", "{{LatencyExperiments}}"},
                                    {"PacketLossExperiments", "{{PacketLossExperiments}}"},
                                    /*{"Deployment", "{{ApplicationDeployment}}"}*/
                                }},
                                {"Script", File.ReadAllText("./Configs/fault-injector.py")}
                            }},
                            {"outputs", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"Name", "Result"},
                                    {"Selector", "$.Payload"},
                                    {"Type", "String"}
                                }
                            }},
                            {"isEnd", true}
                        }
                    }},
                    {"outputs", new string[] { "StartExperiment.Result"}}
                }
            });
        
            CfnDocument induceLatency = new CfnDocument(this, "addLatency", new CfnDocumentProps() {
                DocumentType =  "Automation",
                DocumentFormat = "YAML",
                Content = new Dictionary<string, object>() {
                    {"schemaVersion", "0.3"},
                    {"assumeRole", role.RoleArn},
                    {"parameters", new Dictionary<string, object>() {
                        {"LatencyExperiments", new Dictionary<string, object>() {
                            {"type", "StringList"},
                            {"minItems", "1"},
                            {"description", "(Required) The latency experiment templates to choose from"},
                            {"default", props.LatencyExperiments.Select(x => x.Ref).ToArray()}
                        }}
                    }},
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"name", "StartExperiment"},
                            {"action", "aws:executeScript"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Runtime", "python3.8"},
                                {"Handler", "handler"},
                                {"InputPayload", new Dictionary<string, object>() {
                                    {"LatencyExperiments", "{{LatencyExperiments}}"}
                                }},
                                {"Script", File.ReadAllText("./Configs/start-latency-experiment.py")}
                            }},
                            {"outputs", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"Name", "Result"},
                                    {"Selector", "$.Payload"},
                                    {"Type", "String"}
                                }
                            }},
                            {"isEnd", true}
                        }
                    }},
                    {"outputs", new string[] { "StartExperiment.Result"}}
                }
            });
        
            CfnDocument addPacketLoss = new CfnDocument(this, "addPacketLoss", new CfnDocumentProps() {
                DocumentType =  "Automation",
                DocumentFormat = "YAML",
                Content = new Dictionary<string, object>() {
                    {"schemaVersion", "0.3"},
                    {"assumeRole", role.RoleArn},
                    {"parameters", new Dictionary<string, object>() {
                        {"PacketLossExperiments", new Dictionary<string, object>() {
                            {"type", "StringList"},
                            {"minItems", "1"},
                            {"description", "(Required) The latency experiment templates to choose from"},
                            {"default", props.PacketLossExperiments.Select(x => x.Ref).ToArray()}
                        }},
                    }},
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"name", "StartExperiment"},
                            {"action", "aws:executeScript"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Runtime", "python3.8"},
                                {"Handler", "handler"},
                                {"InputPayload", new Dictionary<string, object>() {
                                    {"PacketLossExperiments", "{{PacketLossExperiments}}"}
                                }},
                                {"Script", File.ReadAllText("./Configs/start-packet-loss-experiment.py")}
                            }},
                            {"outputs", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"Name", "Result"},
                                    {"Selector", "$.Payload"},
                                    {"Type", "String"}
                                }
                            }},
                            {"isEnd", true}
                        }
                    }},
                    {"outputs", new string[] { "StartExperiment.Result"}}
                }
            });
        
            /*        
            CfnDocument startFailedDeployment = new CfnDocument(this, "failedDeployment", new CfnDocumentProps() {
                DocumentType =  "Automation",
                DocumentFormat = "YAML",
                Content = new Dictionary<string, object>() {
                    {"schemaVersion", "0.3"},
                    {"assumeRole", role.RoleArn},
                    {"parameters", new Dictionary<string, object>() {
                        {"ApplicationDeployment", new Dictionary<string, object>() {
                            {"type", "StringMap"},
                            {"description", "(Required) The application and deployment group"},
                            {"default", new Dictionary<string, string>() {
                                {"ApplicationName", props.DeploymentGroup.ApplicationName},
                                {"DeploymentGroupName", props.DeploymentGroup.Ref},
                                {"ApplicationKey", props.ApplicationKey},
                                {"Bucket", Fn.Ref("AssetsBucket")}
                            }}
                        }}
                    }},
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"name", "StartExperiment"},
                            {"action", "aws:executeScript"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Runtime", "python3.8"},
                                {"Handler", "handler"},
                                {"InputPayload", new Dictionary<string, object>() {
                                    {"Deployment", "{{ApplicationDeployment}}"}
                                }},
                                {"Script", File.ReadAllText("./Configs/start-deployment-failure.py")}
                            }},
                            {"outputs", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"Name", "Result"},
                                    {"Selector", "$.Payload"},
                                    {"Type", "String"}
                                }
                            }},
                            {"isEnd", true}
                        }
                    }},
                    {"outputs", new string[] { "StartExperiment.Result"}}
                }
            });*/
        }
    }
}