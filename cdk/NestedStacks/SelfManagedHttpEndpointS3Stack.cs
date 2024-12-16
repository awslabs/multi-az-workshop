// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.S3;
using Amazon.CDK.AWS.SSM;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class SelfManagedHttpEndpointS3StackProps : NestedStackProps
    {
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class SelfManagedHttpEndpointS3Stack : NestedStack
    {
        public string BucketUrl {get;}
        public Bucket Bucket {get;}
        public string ResourcePath = "/";

        public SelfManagedHttpEndpointS3Stack(Stack scope, string id, SelfManagedHttpEndpointS3StackProps props) : base(scope, id, props)
        {
            this.Bucket = new Bucket(this, "bucket", new BucketProps() {
                RemovalPolicy = RemovalPolicy.DESTROY,
                ObjectOwnership = ObjectOwnership.BUCKET_OWNER_ENFORCED,
                BlockPublicAccess = new BlockPublicAccess(new BlockPublicAccessOptions() {
                    BlockPublicAcls = true,
                    BlockPublicPolicy = false,
                    IgnorePublicAcls = true,
                    RestrictPublicBuckets = false
                })
            });

            this.Bucket.AddToResourcePolicy(new PolicyStatement(
                new PolicyStatementProps() {
                    Actions = new string[] {
                        "s3:GetObject"
                    },
                    Effect = Effect.ALLOW,
                    Principals = new IPrincipal[] { new AnyPrincipal() },
                    Resources = new string[] {
                        this.Bucket.BucketArn + "/*"
                    },
                    Conditions = new Dictionary<string, object>() {
                        {"StringEquals", new Dictionary<string, string>() {
                            {"s3:ExistingObjectTag/public", "true"}
                        }}
                    }
                }
            ));

            this.BucketUrl = "https://" + this.Bucket.BucketRegionalDomainName + "/";

            ManagedPolicy runbookManagedPolicy = new ManagedPolicy(this, "runbookManagedPolicy", new ManagedPolicyProps() {
                Path = "/az-evacuation/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
							"s3:PutObject",
                            "s3:PutObjectTagging",
							"s3:DeleteObject"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { this.Bucket.BucketArn + "/*" }
                    })
                }
            });
            
            Role runbookRole = new Role(this, "runbookRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("ssm.amazonaws.com"),
                Path = "/az-evacuation/",
                ManagedPolicies = new ManagedPolicy[] {
                    runbookManagedPolicy
                }
            }); 

            CfnDocument doc = new CfnDocument(this, "doc", new CfnDocumentProps() {
                DocumentType = "Automation",
                DocumentFormat = "JSON",
                Content = new Dictionary<string, object> {
                    {"schemaVersion", "0.3"},
                    {"assumeRole", runbookRole.RoleArn},
                    {"parameters", new Dictionary<string, object>() {
                        {"AZ", new Dictionary<string, object> {
                            {"type", "String"},
                            {"description", "(Required) The AZ to update."},
                            {"allowedValues", props.AvailabilityZoneIds}
                            }
                        },
                        {"IsHealthy", new Dictionary<string, object>() {
                            {"type", "String"},
                            {"description", "(Required) Specifies whether the AZ should be considered healthy or not."},
                            {"allowedValues", new string[] { "true", "false" }}
                        }}
                        }
                    },
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>(){ 
                            {"name", "DecideAction"},
                            {"action", "aws:branch"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Choices", new Dictionary<string, string>[] {
                                       new Dictionary<string, string>() {
                                           {"NextStep", "EvacuateAZ"},
                                           {"Variable", "{{IsHealthy}}"},
                                           {"StringEquals", "false"}
                                       },
                                       new Dictionary<string, string>() {
                                           {"NextStep", "RecoverAZ"},
                                           {"Variable", "{{IsHealthy}}"},
                                           {"StringEquals", "true"}
                                       }
                                    }
                                }
                            }}
                        },
                        new Dictionary<string, object>(){ 
                            {"name", "EvacuateAZ"},
                            {"action", "aws:executeScript"},
                            {"inputs", new Dictionary<string, object>() {
                                {"Runtime", "python3.8"},
                                {"Handler", "handler"},
                                {"InputPayload", new Dictionary<string, string>(){ { "AZ", "{{AZ}}"}, {"Bucket", this.Bucket.BucketName}}},
                                {"Script", Fn.Join("\n", new string[] {"import boto3", "s3_client = boto3.client('s3')", "def handler(event, context):", "  return s3_client.put_object(Bucket=event['Bucket'], Key=event['AZ'], Body='', Tagging='public=true')" })}                   
                            }
                            },
                            { "isEnd", "true"}                     
                        },
                        new Dictionary<string, object>(){ 
                            {"name", "RecoverAZ"},
                            {"action", "aws:executeAwsApi"},
                            { "inputs", new Dictionary<string, object>() {
                                {"Service", "s3"},
                                {"Api","DeleteObject"},
                                {"Bucket", this.Bucket.BucketName },
                                {"Key", "{{AZ}}"}                          
                            }
                            },
                            { "isEnd", "true"}            
                        }
                        }
                    }
                }}
            );
        }
    }
}