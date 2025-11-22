// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.APIGateway;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SSM;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{   
    public interface ISelfManagedHttpEndpointApigStackProps : INestedStackProps
    {
        public bool FailOpen {get; set;}

        public string[] AvailabilityZoneIds {get; set;}
    }

    public class SelfManagedHttpEndpointApigStackProps : NestedStackProps, ISelfManagedHttpEndpointApigStackProps
    {
        /// <summary>
        /// When set to true, if no record exists for the specified AZ ID, the
        /// response will be considered healthy. This means that an AZ must explicitly
        /// be set to unhealthy to fail the health check. If set to false, a missing
        /// entry will be considered as unhealthy. This means that AZs must be
        /// explicitly set to healthy.
        /// </summary>
        public bool FailOpen {get; set;} = true;

        public string[] AvailabilityZoneIds {get; set;}
    }

    public class SelfManagedHttpEndpointApigStack : NestedStack
    {
        public RestApi Api {get;}

        public string ResourcePath {get;}

        public CfnDocument AutomationDocument {get;}

        public SelfManagedHttpEndpointApigStack(Stack scope, string id, ISelfManagedHttpEndpointApigStackProps props) : base(scope, id, props)
        {
            Table table = new Table(this, "table", new TableProps() {
                BillingMode = BillingMode.PAY_PER_REQUEST,
                Encryption = TableEncryption.AWS_MANAGED,
                PartitionKey = new Attribute() { Name = "AZ-ID", Type = AttributeType.STRING },
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy ddbManagedPolicy = new ManagedPolicy(this, "ddbManagedPolicy", new ManagedPolicyProps() {
                Path = "/az-evacuation/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "dynamodb:GetItem",
							"dynamodb:UpdateItem",
							"dynamodb:PutItem"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { table.TableArn }
                    })
                }
            });
            
            Role apiGatewayRole = new Role(this, "executionRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("apigateway.amazonaws.com"),
                Path = "/az-evacuation/",
                ManagedPolicies = new ManagedPolicy[] {
                    ddbManagedPolicy
                }
            }); 

            this.Api = new RestApi(this, "api", new RestApiProps() {
                EndpointConfiguration = new EndpointConfiguration() {
                    Types = new EndpointType[] { EndpointType.REGIONAL }
                },
                Deploy = true,
                Description = "Provides an API resources can use to determine if a specific AZ ID is healthy",
                DeployOptions = new StageOptions() { Variables = new Dictionary<string, string> () { {"failOpen", props.FailOpen.ToString()} } }                
            });

            this.Api.Root
                .AddResource("status")
                .AddResource("{az-id}")
                .AddMethod("GET", new Integration(new IntegrationProps() { 
                    Type = IntegrationType.AWS, 
                    Uri = Fn.Sub("arn:${AWS::Partition}:apigateway:${AWS::Region}:dynamodb:action/GetItem") ,
                    IntegrationHttpMethod = "POST",
                    Options = new IntegrationOptions() { 
                         
                        CredentialsRole = apiGatewayRole,
                        IntegrationResponses = new IIntegrationResponse[] {
                            new IntegrationResponse() {  
                                StatusCode = "200",
                                ResponseTemplates = new Dictionary<string, string>() {
                                    { "application/json", Fn.Join("\n", new string[] {
                                        "#set($inputRoot = $input.path('$'))",
				    					"$input.json('$')",
				    					"#if ($inputRoot.Item.Healthy['BOOL'] == (false))",
				    					"    #set($context.responseOverride.status = 500)",
				    					"#end",
				    					"#if (${stageVariables.failOpen} == \"false\" && ($inputRoot.isEmpty() || $inputRoot.Item.isEmpty() || !$inputRoot.Item.containsKey(\"Healthy\")))",
				    					"    #set($context.responseOverride.status = 500)",
				    					"#end"
                                    }) }
                                }
                            }
                        },
                        PassthroughBehavior = PassthroughBehavior.NEVER,
                        RequestTemplates = new Dictionary<string, string>() { {"application/json", Fn.Sub("{\"TableName\": \"${Table}\", \"Key\": {\"AZ-ID\": {\"S\" : \"$input.params('az-id')\" } }, \"ConsistentRead\": true}", new Dictionary<string, string>() {
                            { "Table", table.TableName}
                        }) } 
                        }
                    }
                })
                ).AddMethodResponse(new MethodResponse() {
                    StatusCode = "200"
                });
        
            this.ResourcePath = Fn.Join("", new string[] { "/", this.Api.DeploymentStage.StageName, "/status/" });
            ManagedPolicy runbookManagedPolicy = new ManagedPolicy(this, "runbookManagedPolicy", new ManagedPolicyProps() {
                Path = "/az-circuit-breaker/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
							"dynamodb:UpdateItem",
							"dynamodb:PutItem"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { table.TableArn }
                    })
                }
            });
            
            Role runbookRole = new Role(this, "runbookRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("ssm.amazonaws.com"),
                Path = "/az-circuit-breaker/",
                ManagedPolicies = new ManagedPolicy[] {
                    runbookManagedPolicy
                }
            }); 

            this.AutomationDocument = new CfnDocument(this, "doc", new CfnDocumentProps() {
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
                            {"type", "Boolean"},
                            {"description", "(Required) Specifies whether the AZ should be considered healthy or not."},
                            {"allowedValues", new string[] { "true", "false" }}
                        }}
                        }
                    },
                    {"mainSteps", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"name", "UpdateAZ"},
                            {"action", "aws:executeAwsApi"},
                            { "inputs", new Dictionary<string, object>() {
                                {"Service", "dynamodb"},
                                {"Api","UpdateItem"},
                                {"TableName", table.TableName },
                                {"Key", new Dictionary<string, object>() {
                                    {"AZ-ID", new Dictionary<string, string>() {{"S", "{{AZ}}"}}}                                }
                                },                            
                                {"ExpressionAttributeValues", new Dictionary<string, object>() {
                                    {":h", new Dictionary<string, string>() {{"BOOL", "{{IsHealthy}}" }}},
                                    {":dt", new Dictionary<string, string>() { {"S", "{{global:DATE_TIME}}"}}},
                                    {":ex", new Dictionary<string, string>() {{"S", "{{automation:EXECUTION_ID}}"}}}
                                }},                
                                {"UpdateExpression", "SET Healthy = :h, LastUpdate = :dt, ExecutionId = :ex"}
                            }
                            },
                            { "isEnd", "true"}
                        }}
                    }
                }}
            );
        }
    }
}