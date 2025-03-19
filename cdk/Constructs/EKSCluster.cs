// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.IO;
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.EKS;
using Amazon.CDK.AWS.Events;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Lambda;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.SSM;
using Amazon.CDK.LambdaLayer.KubectlV31;
//using Amazon.CDK.LambdaLayer.KubectlV32;
using Constructs;
using static Amazon.CDK.AWS.EKS.CfnCluster;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public class EKSClusterProps : IEKSClusterProps
    {
        public IVpc Vpc {get; set;}

        public IDatabaseCluster DatabaseCluster {get; set;}

        public InstanceArchitecture CpuArch {get; set;}

        public IRole AdminRole {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string ClusterName {get; set;}

        public string Version {get; set;} = "1.32";
    }

    public interface IEKSClusterProps
    {
        public IVpc Vpc {get; set;}

        public IDatabaseCluster DatabaseCluster {get; set;}

        public InstanceArchitecture CpuArch {get; set;}

        public IRole AdminRole {get; set;}

        public ISecurityGroup LoadBalancerSecurityGroup {get; set;}

        public string ClusterName {get; set;}

        public string Version {get; set;}
    }

    public class EKSCluster : Construct
    {
        public ICluster Cluster {get;}
        public INodegroup Nodegroup {get; set;}

        public EKSCluster(Construct scope, string id, IEKSClusterProps props) : base(scope, id)
        {    
            SecurityGroup controlPlaneSG = new SecurityGroup(this, "EKSClusterControlPlaneSecurityGroup", new SecurityGroupProps() {
                Description =  "Allow inbound access from this Security Group",
                Vpc = props.Vpc
            });

            controlPlaneSG.AddIngressRule(controlPlaneSG, Port.AllUdp());
            controlPlaneSG.AddIngressRule(controlPlaneSG, Port.AllTcp());
            controlPlaneSG.AddIngressRule(controlPlaneSG, Port.AllIcmp());   
            
            ILayerVersion kubetctlLayer = new KubectlV31Layer(this, "KubectlV31Layer");        

            ILogGroup clusterLogGroup = new LogGroup(this, "cluster-log-group", new LogGroupProps() {
                LogGroupName = "/aws/eks/" + props.ClusterName + "/cluster",
                RemovalPolicy = RemovalPolicy.DESTROY,
                Retention = RetentionDays.ONE_WEEK
            });

            Cluster cluster = new Cluster(this, "EKSCluster", new ClusterProps(){
                Vpc = props.Vpc,
                VpcSubnets = new SubnetSelection[] { new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED } },
                DefaultCapacity = 0,
                Version = KubernetesVersion.Of(props.Version),
                PlaceClusterHandlerInVpc = false,
                EndpointAccess = EndpointAccess.PUBLIC_AND_PRIVATE,
                KubectlLayer = kubetctlLayer,
                SecurityGroup = controlPlaneSG,
                MastersRole = props.AdminRole,
                ClusterName = props.ClusterName,
                ClusterLogging = new ClusterLoggingTypes[] { ClusterLoggingTypes.CONTROLLER_MANAGER, ClusterLoggingTypes.AUTHENTICATOR, ClusterLoggingTypes.API, ClusterLoggingTypes.AUDIT, ClusterLoggingTypes.SCHEDULER} 
            });

            cluster.Node.AddDependency(clusterLogGroup);

            cluster.ClusterSecurityGroup.AddIngressRule(Peer.SecurityGroupId(props.LoadBalancerSecurityGroup.SecurityGroupId), Port.Tcp(80));
            cluster.ClusterSecurityGroup.AddIngressRule(Peer.SecurityGroupId(props.LoadBalancerSecurityGroup.SecurityGroupId), Port.Tcp(5000));
            cluster.ClusterSecurityGroup.AddIngressRule(Peer.SecurityGroupId(cluster.ClusterSecurityGroup.SecurityGroupId), Port.Tcp(80));
            cluster.ClusterSecurityGroup.AddIngressRule(Peer.SecurityGroupId(cluster.ClusterSecurityGroup.SecurityGroupId), Port.Tcp(5000));

            CfnAddon podIdentityAgentAddOn = new CfnAddon(this, "PodIdentityAgentAddOn", new CfnAddonProps() {
                AddonName = "eks-pod-identity-agent",
                ClusterName = cluster.ClusterName
            });

            KubernetesManifest logRoleManifest = cluster.AddManifest("LogsRole", new Dictionary<string, object>[] {
                new Dictionary<string, object>() {
                    {"apiVersion", "rbac.authorization.k8s.io/v1" },
                    {"kind", "ClusterRole"},
                    {"metadata", new Dictionary<string, object>() {
                        {"name", "log-viewer"}
                    }},
                    {"rules", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"apiGroups", new string[] { "" }},
                            {"resources", new string[] { "pods", "pods/log", "pods/exec", } },
                            {"verbs", new string[] { "get", "list", "watch", "create", "update", "patch", "delete"}}
                        },
                        new Dictionary<string, object>() {
                            {"apiGroups", new string[] { "apps" }},
                            {"resources", new string[] { "deployments" } },
                            {"verbs", new string[] { "get", "list", "watch", "create", "update", "patch", "delete"}}
                        }
                    }}
                }
            });

            (logRoleManifest.Node.FindChild("Resource") as CfnCustomResource).AddPropertyOverride("ServiceTimeout", 300);

            KubernetesManifest networkingRoleManifest = cluster.AddManifest("NetworkingRole", new Dictionary<string, object>[] {
                new Dictionary<string, object>() {
                    {"apiVersion", "rbac.authorization.k8s.io/v1" },
                    {"kind", "ClusterRole"},
                    {"metadata", new Dictionary<string, object>() {
                        {"name", "networking-manager"}
                    }},
                    {"rules", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"apiGroups", new string[] { "networking.istio.io" }},
                            {"resources", new string[] { "destinationrules" } },
                            {"verbs", new string[] { "get", "list", "watch", "create", "update", "patch", "delete"}}
                        }
                    }}
                }
            });

            (networkingRoleManifest.Node.DefaultChild as CfnCustomResource).AddPropertyOverride("ServiceTimeout", 300);

            KubernetesManifest logRoleBindingManifest = cluster.AddManifest("LogsRoleBinding", new Dictionary<string, object>[] {
                new Dictionary<string, object>() {
                    {"apiVersion", "rbac.authorization.k8s.io/v1" },
                    { "kind", "ClusterRoleBinding"},
                    {"metadata", new Dictionary<string, object>() {
                        {"name", "log-viewer-global"},
                        {"namespace", "kube-system"}
                    }},
                    { "roleRef", new Dictionary<string, object>() {
                        {"apiGroup", "rbac.authorization.k8s.io"},
                        {"kind", "ClusterRole"},
                        {"name", "log-viewer"}
                    }},
                    { "subjects", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"kind", "Group"},
                            {"name", "system:authenticated"},
                            {"apiGroup", "rbac.authorization.k8s.io"}
                        }
                    }}
                }
            });

            logRoleBindingManifest.Node.AddDependency(logRoleManifest);
            (logRoleBindingManifest.Node.DefaultChild as CfnCustomResource).AddPropertyOverride("ServiceTimeout", 300);

            KubernetesManifest networkingRoleBindingManifest = cluster.AddManifest("NetworkingRoleBinding", new Dictionary<string, object>[] {
                new Dictionary<string, object>() {
                    {"apiVersion", "rbac.authorization.k8s.io/v1" },
                    { "kind", "ClusterRoleBinding"},
                    {"metadata", new Dictionary<string, object>() {
                        {"name", "networking-manager-global"},
                        {"namespace", "multi-az-workshop"}
                    }},
                    { "roleRef", new Dictionary<string, object>() {
                        {"apiGroup", "rbac.authorization.k8s.io"},
                        {"kind", "ClusterRole"},
                        {"name", "networking-manager"}
                    }},
                    { "subjects", new Dictionary<string, object>[] {
                        new Dictionary<string, object>() {
                            {"kind", "Group"},
                            {"name", "system:authenticated"},
                            {"apiGroup", "rbac.authorization.k8s.io"}
                        }
                    }}
                }
            });

            networkingRoleBindingManifest.Node.AddDependency(networkingRoleManifest);
            (networkingRoleBindingManifest.Node.DefaultChild as CfnCustomResource).AddPropertyOverride("ServiceTimeout", 300);

            //cluster.AwsAuth.Node.AddDependency(logRoleBindingManifest);
            //cluster.AwsAuth.Node.AddDependency(networkingRoleBindingManifest);

            IRole eksWorkerRole = new Role(this, "EKSWorkerRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("ec2.amazonaws.com")
            });

            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonEKSVPCResourceController"));
            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"));
            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonSSMManagedEC2InstanceDefaultPolicy"));
            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"));
            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("AmazonEKS_CNI_Policy"));
            eksWorkerRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));
            eksWorkerRole.AddManagedPolicy(new ManagedPolicy(this, "EKSWorkerCNIIPv6ManagedPolicy", new ManagedPolicyProps() {
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] {
                            "ec2:AssignIpv6Addresses"
                        },
                        Resources = new string[] { "*" }
                    })
                }
            }));
            eksWorkerRole.AddManagedPolicy(new ManagedPolicy(this, "EKSWorkerS3ManagedPolicy", new ManagedPolicyProps() {
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] {
                            "s3:GetObject",
                            "s3:ListBucket"
                        },
                        Resources = new string[] { "*" }
                    })
                }
            }));
            eksWorkerRole.AddManagedPolicy(new ManagedPolicy(this, "EKSWorkerSSMManagedPolicy", new ManagedPolicyProps() {
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() {
                        Effect = Effect.ALLOW,
                        Actions = new string[] {
                            "ssm:GetParameter"
                        },
                        Resources = new string[] { "*" }
                    })
                }
            }));
            
            cluster.AwsAuth.AddRoleMapping(eksWorkerRole, new AwsAuthMapping() {
                Groups = new string[] { "system:masters", "system:bootstrappers", "system:nodes", "log-viewer-global"},
                Username = "system:node:{{EC2PrivateDNSName}}"
            });

            StringParameter clusterParameter = new StringParameter(this, "ClusterParameter", new StringParameterProps() {
                ParameterName = "ClusterName",
                StringValue = cluster.ClusterName
            });

            IRule rule = CreateMetadataUpdater();
                
            this.Nodegroup = cluster.AddNodegroupCapacity("ManagedNodeGroup", new NodegroupOptions() {
                AmiType = props.CpuArch == InstanceArchitecture.ARM_64 ? NodegroupAmiType.AL2023_ARM_64_STANDARD : NodegroupAmiType.AL2023_X86_64_STANDARD,
                CapacityType = CapacityType.ON_DEMAND,
                MinSize = 3,
                MaxSize = 3,
                InstanceTypes = new Amazon.CDK.AWS.EC2.InstanceType[] { Amazon.CDK.AWS.EC2.InstanceType.Of(props.CpuArch == InstanceArchitecture.ARM_64 ?  InstanceClass.T4G : InstanceClass.T3, InstanceSize.LARGE) },
                NodeRole = eksWorkerRole
            });

            this.Nodegroup.Node.AddDependency(rule);
          
            this.Cluster = cluster;
        }

        private IRule CreateMetadataUpdater()
        {
            ManagedPolicy xrayManagedPolicy = new ManagedPolicy(this, "xrayManagedPolicy", new ManagedPolicyProps() {
                Path = "/metadataupdater/",
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
                Path = "/metadataupdater/",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "ec2:DescribeTags",
                            "ec2:DescribeInstances",
                            "ec2:ModifyInstanceMetadataOptions"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                }
            });

            Role executionRole = new Role(this, "executionRole", new RoleProps() {
                AssumedBy = new ServicePrincipal("lambda.amazonaws.com"),
                Path = "/metadataupdater/",
                ManagedPolicies = new ManagedPolicy[] {
                    xrayManagedPolicy,
                    ec2ManagedPolicy
                }
            }); 

            Function instanceMetadataUpdater = new Function(this, "InstanceMetadataUpdater", new FunctionProps() {
                Runtime = MultiAZWorkshopStack.pythonRuntime,
                Code = Code.FromInline(File.ReadAllText("./ec2-metadata-update-src/index.py")),
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

            instanceMetadataUpdater.AddPermission("invokePermission", new Permission() {
                Action = "lambda:InvokeFunction",
                Principal = new ServicePrincipal("events.amazonaws.com"),
                SourceArn = Fn.Sub("arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/*")
            });

            LogGroup logs = new LogGroup(this, "logGroup", new LogGroupProps() {
                LogGroupName = $"/aws/lambda/{instanceMetadataUpdater.FunctionName}",
                Retention = RetentionDays.ONE_DAY,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            ManagedPolicy cloudWatchManagedPolicy = new ManagedPolicy(this, "cwManagedPolicy", new ManagedPolicyProps() {
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
                    Detail = new Dictionary<string, object>() { {"state", new string[] { "running" } } }
                },
                Enabled = true,
                Targets = new IRuleTarget[] { new Amazon.CDK.AWS.Events.Targets.LambdaFunction(instanceMetadataUpdater) }
            });

            return ec2Launch;
        }
    }
}
