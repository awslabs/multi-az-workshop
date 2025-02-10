using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.CodeBuild;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Logs;
using Constructs;
using System.IO;
using Amazon.CDK.AWS.ECR;
using System;
using Amazon.CDK.AWS.StepFunctions;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public class RepoAndContainerProps
    {
        public string RepositoryName {get; set;}
        public string ContainerImageS3ObjectKey {get; set;}
    }

    public class RepoAndHelmChartProps
    {
        public string RepositoryName {get; set;}
        public string HelmChartName {get; set;}
        public string Version {get; set;}
    }

    public class WaitableResponse
    {
        public IDependable Dependable {get; set;}

        public Repository Repository {get; set;}
    }

    public class ContainerAndRepo : Construct, IConstruct
    {
        public IFunction UploaderFunction;

        public IProject ContainerBuildProject;

        public ContainerAndRepo(NestedStackWithSource scope, string id) : base(scope, id)
        {
            UploaderFunction = SetupUploader(scope);
            ContainerBuildProject = SetupContainerBuildProject(scope);
        }

        /// <summary>
        /// Creates a new ECR repository and uploads a container image to the repo
        /// </summary>
        /// <param name="props"></param>
        /// <returns>The image URI</returns>
        public WaitableResponse AddContainerAndRepo(RepoAndContainerProps props)
        {
            Repository applicationRepo = new Repository(this, props.RepositoryName.Replace("/", "-") + "-repo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = props.RepositoryName
            });

            CustomResource appContainerImage = new CustomResource(this, props.RepositoryName.Replace("/", "-") + "-container", new CustomResourceProps() {
                ServiceToken = this.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Docker" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + props.ContainerImageS3ObjectKey },
                    { "ProjectName", this.ContainerBuildProject.ProjectName },
                    { "Repository", applicationRepo.RepositoryName },
                    { "Nonce", new Random().NextInt64() }
                }
            });

            return new WaitableResponse() {
                Dependable = appContainerImage,
                Repository = applicationRepo
            };
        }

        public WaitableResponse CreateRepoAndHelmChart(RepoAndHelmChartProps props)
        {
            Repository repo = new Repository(this, props.HelmChartName + "-repo", new RepositoryProps() {
                EmptyOnDelete = true,
                RemovalPolicy = RemovalPolicy.DESTROY,
                RepositoryName = props.RepositoryName
            });

            CustomResource chart = new CustomResource(this, props.HelmChartName + "-helm-chart", new CustomResourceProps() {
                ServiceToken = this.UploaderFunction.FunctionArn,
                Properties = new Dictionary<string, object> {
                    { "Type", "Helm" },
                    { "Bucket", Fn.Ref("AssetsBucketName") },
                    { "Key", Fn.Ref("AssetsBucketPrefix") + props.HelmChartName + "-" + props.Version + ".tgz" },
                    { "Repository", repo.RepositoryName }
                }
            });

            return new WaitableResponse() {
                Dependable = chart,
                Repository = repo
            };
        }

        private static IFunction SetupUploader(Construct scope)
        {
            IManagedPolicy uploaderPolicy = new ManagedPolicy(scope, "UploaderPolicy", new ManagedPolicyProps(){
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

            IRole uploaderRole = new Role(scope, "UploaderRole", new RoleProps() {
                 AssumedBy = new ServicePrincipal("lambda.amazonaws.com"),
                 ManagedPolicies = new IManagedPolicy[] {
                    uploaderPolicy
                 }
            });

            IFunction uploader = new Function(scope, "EcrUploader", new FunctionProps() {
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
                    new LayerVersion(scope, "HelmLayer", new LayerVersionProps() {
                        Code = Code.FromAsset("./helm-layer.zip")
                    })
                ],
                Code = Code.FromInline(File.ReadAllText("./uploader-src/index.py"))
            });

            LogGroup logs = new LogGroup(scope, "logGroup", new LogGroupProps() {
                LogGroupName = $"/aws/lambda/{uploader.FunctionName}",
                Retention = RetentionDays.ONE_DAY,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy cloudWatchManagedPolicy = new ManagedPolicy(scope, "CloudWatchManagedPolicy", new ManagedPolicyProps() {
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

        private static IProject SetupContainerBuildProject(Construct scope)
        {
            // This will download the container tar.gz from S3, unzip it, then
            // push to the ECR repository
            Project containerBuild = new Project(scope, "AppBuild", new ProjectProps() {      
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
                Role = new Role(scope, "CodeBuildRole", new RoleProps() {
                    AssumedBy = new ServicePrincipal("codebuild.amazonaws.com"),
                    ManagedPolicies = new IManagedPolicy[] {
                        new ManagedPolicy(scope, "CodeBuildPolicy", new ManagedPolicyProps() {
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

            LogGroup logs = new LogGroup(scope, "BuildProjectLogGroup", new LogGroupProps() {
                LogGroupName = "/aws/codebuild/" + containerBuild.ProjectName,
                Retention = RetentionDays.ONE_WEEK,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            return containerBuild;
        }

    }
}