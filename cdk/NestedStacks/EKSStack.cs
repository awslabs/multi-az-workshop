// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.CodeBuild;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.RDS;
using Constructs;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Newtonsoft.Json;

#if NET8_0_OR_GREATER
using System.Formats.Tar;
using System.Net.Http;
using System.Threading.Tasks;
using System.IO.Compression;
#endif

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class EKSStackProps : NestedStackProps, IEKSStackProps
    {
        public IVpc Vpc {get; set;}

        public InstanceArchitecture CpuArch {get; set;} = InstanceArchitecture.ARM_64;

        public DatabaseCluster Database {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string IAMResourcePath {get; set;} = "/front-end/eks-fleet/";

        public string AdminRoleName {get; set;}
    }

    public interface IEKSStackProps : INestedStackProps
    {
        public IVpc Vpc {get; set;}

        public InstanceArchitecture CpuArch {get; set;}

        public DatabaseCluster Database {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string IAMResourcePath {get; set;}

        public string AdminRoleName {get; set;}
    }

    public class EKSStack : NestedStackWithSource
    {
        public IApplicationTargetGroup EKSAppTargetGroup {get;}
        
        public EKSStack(Stack scope, string id, IEKSStackProps props) : base(scope, id, props)
        { 
            Dictionary<string, string> versions = JsonConvert.DeserializeObject<Dictionary<string, string>>(File.ReadAllText("../build/versions.json"));

            //BuildHelmLayer().Wait(); // No available to do in .NET 6
            IFunction uploader = this.SetupUploader();

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

            EKSCluster cluster = new EKSCluster(this, "Cluster", new EKSClusterProps() {
                AdminRole = Role.FromRoleName(this, "AdminRole", props.AdminRoleName),
                CpuArch = props.CpuArch,
                DatabaseCluster = props.Database,
                Vpc = props.Vpc,
                ContainerBuildProject = containerBuild,
                UploaderFunction = uploader,
                LoadBalancerSecurityGroup = props.LoadBalancerSecurityGroup,
                ClusterName = "multi-az-workshop-eks-cluster",
                Version = versions["EKS"] 
            });

            this.FixUpNestedStacks();
        
            Istio istio = new Istio(this, "Istio", new IstioProps() {
                Cluster = cluster.Cluster,
                ContainerBuildProject = containerBuild,
                UploaderFunction = uploader,
                Version = versions["ISTIO"]
            });

            AwsLoadBalancerController lbController = new AwsLoadBalancerController(this, "AwsLoadBalancerController", new AwsLoadBalancerControllerProps() {
                Cluster = cluster.Cluster,
                ContainerBuildProject = containerBuild,
                UploaderFunction = uploader,
                ContainerVersion = versions["LB_CONTROLLER_CONTAINER"],
                HelmVersion = versions["LB_CONTROLLER_HELM"]
            });
            lbController.Node.AddDependency(istio.WaitableNode);

            EKSApplication app = new EKSApplication(this, "EKSApp", new EKSApplicationProps() {
                Cluster = cluster.Cluster,
                ContainerBuildProject = containerBuild,
                DatabaseCluster = props.Database,
                UploaderFunction = uploader,
                ContainerObjectKey = "container.tar.gz",
                Namespace = "multi-az-workshop"
            });
            app.Node.AddDependency(istio);
            app.Node.AddDependency(lbController.WaitableNode);

            this.EKSAppTargetGroup = app.AppTargetGroup;
        }

        public void FixUpNestedStacks()
        {
            FixUpResourceProvider("@aws-cdk--aws-eks.ClusterResourceProvider");
            FixUpResourceProvider("@aws-cdk--aws-eks.KubectlProvider");

            FixUpLambdaFunctions("@aws-cdk--aws-eks.KubectlProvider");
        }

        private void FixUpLambdaFunctions(string name)
        {
            IConstruct resourceProviderNestedStack = this.Node.TryFindChild(name);

            if (resourceProviderNestedStack != null)
            {
                NestedStack nestedStack = resourceProviderNestedStack as NestedStack;

                if (nestedStack != null)
                {
                    Function lambda = nestedStack.Node.TryFindChild("Handler") as Function;

                    if (lambda != null)
                    {
                        lambda.AddEnvironment("AWS_STS_REGIONAL_ENDPOINTS", "regional");
                    }

                    IConstruct provider = nestedStack.Node.TryFindChild("Provider");
                    Function onEvent = provider.Node.TryFindChild("framework-onEvent") as Function;

                    if (onEvent != null)
                    {
                        onEvent.AddEnvironment("AWS_STS_REGIONAL_ENDPOINTS", "regional");
                    }
                }
            }
        }

        private void FixUpResourceProvider(string name)
        {
            IConstruct resourceProviderNestedStack = this.Node.TryFindChild(name);

            // Add the parameters to the actual nested stack so it can receive them
            if (resourceProviderNestedStack != null)
            {
                NestedStack nestedStack = resourceProviderNestedStack as NestedStack;

                if (nestedStack != null)
                {
                    nestedStack.Node.Children.Append(new CfnParameter(nestedStack, "AssetsBucketName", new CfnParameterProps() {
                        Type = "String"
                    }));

                    nestedStack.Node.Children.Append(new CfnParameter(nestedStack, "AssetsBucketPrefix", new CfnParameterProps() {
                        Type = "String"
                    }));
                }

                /*
                var nestedStackResource = nestedStack.NestedStackResource as CfnStack;

                if (nestedStackResource.Parameters == null || nestedStackResource.Parameters.GetType() == typeof(Amazon.JSII.Runtime.Deputy.AnonymousObject))
                {
                    Console.WriteLine("Writing new parameters");

                    nestedStackResource.Parameters = new Dictionary<string, string>() {
                        { "AssetsBucketName", Fn.Ref("AssetsBucketName")},
                        { "AssetsBucketPrefix", Fn.Ref("AssetsBucketPrefix")}
                    };
                }
                else {
                    Console.WriteLine("Adding to parameters");

                    (nestedStackResource.Parameters as Dictionary<string, string>).Add("AssetsBucketName", Fn.Ref("AssetsBucketName"));
                    (nestedStackResource.Parameters as Dictionary<string, string>).Add("AssetsBucketPrefix", Fn.Ref("AssetsBucketPrefix"));
                }
                */
            }
        }
    

        #if NET8_0_OR_GREATER
        private async Task BuildHelmLayer()
        {
            if (!File.Exists("helm-layer.zip"))
            {
                using (HttpClient client = new HttpClient())
                {
                    using (var stream = client.GetStreamAsync("https://get.helm.sh/helm-v3.15.1-linux-arm64.tar.gz"))
                    {
                        using (var fs = new FileStream("helm.tar.gz", FileMode.OpenOrCreate))
                        {
                            stream.Result.CopyTo(fs);
                        }
                    }
                }

                // Decompress the .gz file
                using (FileStream originalFileStream = File.OpenRead("helm.tar.gz"))
                {
                    using (FileStream decompressedFileStream = File.Create("helm.tar"))
                    {
                        using (GZipStream decompressionStream = new GZipStream(originalFileStream, CompressionMode.Decompress))
                        {
                            decompressionStream.CopyTo(decompressedFileStream);
                        }

                        decompressedFileStream.Seek(0, SeekOrigin.Begin);
                        Directory.CreateDirectory("helm-tar");
                        TarFile.ExtractToDirectory(decompressedFileStream, "helm-tar", true);
                    }
                }

                Directory.CreateDirectory("helm");
                File.Copy("helm-tar/linux-arm64/helm", "helm/helm");

                using (FileStream zipStream = File.Create("helm-layer.zip"))
                {
                    ZipFile.CreateFromDirectory("helm", zipStream, CompressionLevel.Optimal, true);
                }

                Directory.Delete("helm", true);
                Directory.Delete("helm-tar", true);
                File.Delete("helm.tar");
                File.Delete("helm.tar.gz");
            }
        }
        #endif

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
                        Actions = new string[] { 
                            "codebuild:StartBuild",
                            "codebuild:ListBuildsForProject",
                            "codebuild:BatchGetBuilds"
                        },
                        Resources = new string[] { "*" }
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
                Runtime = Runtime.PYTHON_3_12,
                Role = uploaderRole,
                Environment = new Dictionary<string, string>() {
                    { "AWS_ACCOUNT_ID", Fn.Ref("AWS::AccountId")}
                },
                Layers = new ILayerVersion[] {
                    new LayerVersion(this, "HelmLayer", new LayerVersionProps() {
                        Code = Code.FromAsset("./helm-layer.zip")
                    })
                },
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