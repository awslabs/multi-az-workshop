using System;
using System.Collections.Generic;
using System.IO;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Amazon.CDK;
using Amazon.CDK.AWS.CodeBuild;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.Logs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class ApplicationStackProps: IStackProps
    {
        public string ContainerImageObjectKey {get; set;}

        public string ContainerImageWithFaultObjectKey {get; set;}
    }

    public class ApplicationStack : NestedStackWithSource
    {
        public string applicationImage;

        public string applicationFaultImage;

        public string cloudwatchContainerImage;

        public IFunction uploaderFunction;

        public IProject containerBuildProject;


        public ApplicationStack(Stack scope, string id, ApplicationStackProps props) : base(scope, id)
        {
           this.uploaderFunction = this.SetupUploader();
           this.containerBuildProject = this.SetupContainerBuildProject();

            // Create the repo for the container running the wild rydes app
            // and upload the container to the repo via the custom resource
            Repository applicationRepo = new Repository(this, "AppContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "multi-az-workshop"
            });

            this.applicationImage = applicationRepo.RepositoryUri + ":latest";

            CustomResource appContainerImage = new CustomResource(this, "AppContainer", new CustomResourceProps() {
                ServiceToken = this.uploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + props.ContainerImageObjectKey },
                    { "ProjectName", this.containerBuildProject.ProjectName },
                    { "Repository", applicationRepo.RepositoryName },
                    { "Nonce", new Random().NextInt64() }
                }
            });

            // Create the repo for the container running the wild rydes app
            // and upload the container to the repo via the custom resource
            Repository faultApplicationRepo = new Repository(this, "AppFaultContainerImageRepo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "multi-az-workshop-fault"
            });

            this.applicationFaultImage = faultApplicationRepo.RepositoryUri + ":latest";

            CustomResource appContainerWithFaultImage = new CustomResource(this, "AppContainer", new CustomResourceProps() {
                ServiceToken = this.uploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + props.ContainerImageWithFaultObjectKey },
                    { "ProjectName", this.containerBuildProject.ProjectName },
                    { "Repository", faultApplicationRepo.RepositoryName },
                    { "Nonce", new Random().NextInt64() }
                }
            });

            Repository cloudwatchAgentRepo = new Repository(this, "CloudWatchAgentRepository", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = "cloudwatch-agent/cloudwatch-agent"
            });

            this.cloudwatchContainerImage = cloudwatchAgentRepo.RepositoryUri + ":latest";

            CustomResource cloudwatchAgentContainerImage = new CustomResource(this, "CloudWatchAgentContainerImage", new CustomResourceProps() {
                ServiceToken = this.uploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + "cloudwatch-agent.tar.gz" },
                    { "ProjectName", this.containerBuildProject.ProjectName },
                    { "Repository", cloudwatchAgentRepo.RepositoryName }
                }
            });
        }

        private IProject SetupContainerBuildProject()
        {
            // This will download the container tar.gz from S3, unzip it, then
            // push to the ECR repository
            Project containerBuild = new Project(this, "AppBuild", new ProjectProps() {      
                Environment = new BuildEnvironment() {
                    BuildImage = LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
                    Privileged = true
                },
                BuildSpec = BuildSpec.FromObjectToYaml(new Dictionary<string, object>() {
                    { "version", "0.2"},
                    { "phases", new Dictionary<string, object>() {
                        {"build", new Dictionary<string, object>() {
                            {"commands", new string[] {
                                "ACCOUNT=$(echo $CODEBUILD_BUILD_ARN | cut -d':' -f5)",
                                "echo $ACCOUNT",
                                "echo $BUCKET",
                                "echo $KEY",
                                "file=${KEY#*/}",
                                "echo $file",
                                "aws s3 cp s3://$BUCKET/$KEY $file",
                                "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION." + Fn.Ref("AWS::URLSuffix"),
                                "output=$(docker load --input $file)",
                                "echo $output",
                                "IMAGE=$(echo $output | cut -d':' -f2 | xargs)",
                                "echo $IMAGE",
                                "VER=$(echo $output | cut -d':' -f3 | xargs)",
                                "echo $VER",
                                "docker tag ${IMAGE}:${VER} $ACCOUNT.dkr.ecr.$AWS_REGION." + Fn.Ref("AWS::URLSuffix") + "/${REPO}:${VER}",                                              
                                "docker push $ACCOUNT.dkr.ecr.$AWS_REGION." + Fn.Ref("AWS::URLSuffix") + "/${REPO}:${VER}"
                            }}
                        }}
                    }}
                }),
                Role = new Role(this, "CodeBuildRole", new RoleProps() {
                    AssumedBy = new ServicePrincipal("codebuild.amazonaws.com"),
                    ManagedPolicies = new IManagedPolicy[] {
                        new ManagedPolicy(this, "CodeBuildPolicy", new ManagedPolicyProps() {
                            Statements = new PolicyStatement[] {
                                new PolicyStatement(new PolicyStatementProps() {
                                    Effect = Effect.ALLOW,
                                    Resources = new string[] { "*" },
                                    Actions = new string[] {
                                        "s3:GetObject",
                                        "ecr:CompleteLayerUpload",
                                        "ecr:UploadLayerPart",
                                        "ecr:InitiateLayerUpload",
                                        "ecr:BatchCheckLayerAvailability",
                                        "ecr:PutImage",
                                        "ecr:DescribeImages",
                                        "ecr:DescribeRepositories",
                                        "ecr:GetAuthorizationToken",
                                        "ecr:BatchGetImage"
                                    }
                                }),
                                new PolicyStatement(new PolicyStatementProps() {
                                    Effect = Effect.ALLOW,
                                    Resources = new string[] { "*" },
                                    Actions = new string[] {
                                        "kms:Decrypt"
                                    }
                                }),
                                new PolicyStatement(new PolicyStatementProps() {
                                    Effect = Effect.ALLOW,
                                    Resources = new string[] { 
                                        //Fn.Sub("arn:${AWS::Partition}:${AWS::Region}:${AWS::AccountId}:report-group/*")
                                        "*"
                                     },
                                    Actions = new string[] {
                                        "codebuild:CreateReportGroup",
                                        "codebuild:CreateReport",
                                        "codebuild:UpdateReport",
                                        "codebuild:BatchPutTestCases",
                                        "codebuild:BatchPutCodeCoverages"
                                    }
                                }),
                                new PolicyStatement(new PolicyStatementProps() {
                                    Effect = Effect.ALLOW,
                                    Resources = new string[] { 
                                        //Fn.Sub("arn:${AWS::Partition}:${AWS::Region}:${AWS::AccountId}:log-group/aws/codebuild/*")
                                        "*"
                                    },
                                    Actions = new string[] {
                                        "logs:CreateLogGroup",
                                        "logs:CreateLogStream",
                                        "logs:PutLogEvents"
                                    }
                                })
                            }
                        })
                    }
                })
            });

            LogGroup logs = new LogGroup(this, "BuildProjectLogGroup", new LogGroupProps() {
                LogGroupName = "/aws/codebuild/" + containerBuild.ProjectName,
                Retention = RetentionDays.ONE_WEEK,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            return containerBuild;
        }

        private IFunction SetupUploader()
        {
            IManagedPolicy uploaderPolicy = new ManagedPolicy(this, "UploaderPolicy", new ManagedPolicyProps(){
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] { "s3:GetObject" },
                        Resources = new string[] { "*" }
                    }),
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] { "kms:Decrypt" },
                        Resources = new string[] { "*" }
                    }),
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] { 
                            "ecr:CompleteLayerUpload",
                            "ecr:UploadLayerPart",
                            "ecr:InitiateLayerUpload",
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:PutImage",
                            "ecr:DescribeImages",
                            "ecr:DescribeRepositories",
                            "ecr:GetAuthorizationToken",
                            "ecr:BatchGetImage"
                        },
                        Resources = new string[] { "*" }
                    }),
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = [ 
                            "codebuild:StartBuild",
                            "codebuild:ListBuildsForProject",
                            "codebuild:BatchGetBuilds"
                        ],
                        Resources = ["*"]
                    })
                }
            });

            IRole uploaderRole = new Role(this, "UploaderRole", new RoleProps() {
                 AssumedBy = new ServicePrincipal("lambda.amazonaws.com"),
                 ManagedPolicies = new IManagedPolicy[] {
                    uploaderPolicy
                 }
            });

            IFunction uploader = new Function(this, "EcrUploader", new FunctionProps() {
                Architecture = Architecture.ARM_64,
                Handler = "index.handler",
                MemorySize = 512,
                Timeout = Duration.Seconds(300),
                Runtime = MultiAZWorkshopStack.pythonRuntime,
                Role = uploaderRole,
                Environment = new Dictionary<string, string>() {
                    { "AWS_ACCOUNT_ID", Fn.Ref("AWS::AccountId")}
                },
                Layers = [
                    new LayerVersion(this, "HelmLayer", new LayerVersionProps() {
                        Code = Code.FromAsset("./helm-layer.zip")
                    })
                ],
                Code = Code.FromInline(File.ReadAllText("./uploader-src/index.py"))
            });

            LogGroup logs = new LogGroup(this, "logGroup", new LogGroupProps() {
                LogGroupName = $"/aws/lambda/{uploader.FunctionName}",
                Retention = RetentionDays.ONE_DAY,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy cloudWatchManagedPolicy = new ManagedPolicy(this, "CloudWatchManagedPolicy", new ManagedPolicyProps() {
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { logs.LogGroupArn }
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "logs:CreateLogGroup"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                },
                Roles = new IRole[] { uploaderRole }
            });

            return uploader;
        }  
    }
}
