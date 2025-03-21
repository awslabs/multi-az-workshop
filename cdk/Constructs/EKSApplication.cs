// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.EKS;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.RDS;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IEKSApplicationProps
    {
        public ICluster Cluster {get; set;}
        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}
        public IDatabaseCluster DatabaseCluster {get; set;}
        public string Namespace {get; set;}
    }

    public class EKSApplicationProps : IEKSApplicationProps
    {
        public ICluster Cluster {get; set;}
        public ContainerAndRepo ContainerAndRepoBuilder {get; set;}
        public IDatabaseCluster DatabaseCluster {get; set;}
        public string Namespace {get; set;}
    }

    public class EKSApplication : Construct
    {
        public IApplicationTargetGroup AppTargetGroup {get;}
        
        public EKSApplication(Construct scope, string id, IEKSApplicationProps props) : base(scope, id)
        {
            string app = props.Namespace + "-app";
            string svc = props.Namespace + "-service";
            string sa = props.Namespace + "-sa";

            var appContainer = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "container.tar.gz",
                RepositoryName = props.Namespace
            });

            var cwAgentContainer = props.ContainerAndRepoBuilder.AddContainerAndRepo(new RepoAndContainerProps() {
                ContainerImageS3ObjectKey = "cloudwatch-agent.tar.gz",
                RepositoryName = "cloudwatch-agent/cloudwatch-agent"
            });

            Role podRole = new Role(this, "PodRole", new RoleProps() {
                Description = "The IAM role used by the front-end EKS fleet",
                AssumedBy = new ServicePrincipal("pods.eks.amazonaws.com").WithSessionTags()
            });

            ManagedPolicy podManagedPolicy = new ManagedPolicy(this, "PodManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows the EKS pod front end to perform standard operational actions",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {"s3:GetObject", "s3:GetObjectVersion"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:s3:::*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {"kms:Decrypt"},
                        Effect = Effect.ALLOW,
                        Resources = new string[] {Fn.Sub("arn:${AWS::Partition}:kms:*:${AWS::AccountId}:key/*")}
                    }),
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = [
                            "secretsmanager:GetSecretValue",
                            "secretsmanager:DescribeSecret"
                        ],
                        Effect = Effect.ALLOW,
                        Resources = [
                            (props.DatabaseCluster as DatabaseCluster).Secret.SecretFullArn
                        ]
                    })
                },
                Roles = new IRole[] { podRole }
            });
            ManagedPolicy podCloudWatchManagedPolicy = new ManagedPolicy(this, "PodCloudWatchManagedPolicy", new ManagedPolicyProps() {
                Description = "Allows the EKS pod front ends to write CWL and put metrics",
                Statements = new PolicyStatement[] {
                    new PolicyStatement(new PolicyStatementProps() { 
                        Actions = new string[] {
                            "cloudwatch:PutMetricData",
				            "logs:CreateLogStream",
				            "logs:PutLogEvents",
                            "logs:DescribeLogGroups",
                            "logs:DescribeLogStreams"
                        },
                        Effect = Effect.ALLOW,
                        Resources = new string[] { "*" }
                    })
                },
                Roles = new IRole[] { podRole }
            });
            ManagedPolicy xrayManagedPolicy = new ManagedPolicy(this, "xrayManagedPolicy", new ManagedPolicyProps() {
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
                },
                Roles = new IRole[] { podRole }
            });

            KubernetesManifest appNamespace = new KubernetesManifest(this, "AppNamespace", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "v1"},
                        {"kind", "Namespace"},
                        {"metadata", new Dictionary<string, object>() {
                            { "labels", new Dictionary<string, object>() {
                                {"name", props.Namespace },
                                {"istio-injection", "enabled"}
                            }},
                            {"name", props.Namespace}
                        }}
                    }
                }
            }); 

            ((appNamespace.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            KubernetesManifest appServiceAccount = new KubernetesManifest(this, "AppServiceAccount", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "v1"},
                        {"kind", "ServiceAccount"},
                        {"metadata", new Dictionary<string, object>() {
                            {"name", sa},
                            {"namespace", props.Namespace}
                        }}
                    }
                }
            });      

            ((appServiceAccount.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            appServiceAccount.Node.AddDependency(appNamespace);

            CfnPodIdentityAssociation podIdentity = new CfnPodIdentityAssociation(this, "PodIdentityAssociation", new CfnPodIdentityAssociationProps() {
                ClusterName = props.Cluster.ClusterName,
                Namespace = props.Namespace,
                ServiceAccount = sa,
                RoleArn = podRole.RoleArn
            });

            podIdentity.Node.AddDependency(appServiceAccount);

            /*KubernetesManifest istioGateway = new KubernetesManifest(this, "IstioGateway", new KubernetesManifestProps() {
                Cluster = eksCluster,
                Manifest = new IDictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "networking.istio.io/v1alpha3"},
                        {"kind", "Gateway"},
                        {"metadata", new Dictionary<string, object>() {
                            {"name", props.Namespace + "-gateway" },
                            {"namespace", props.Namespace}
                        }},
                        {"spec", new Dictionary<string, object>() {
                            {"selector", new Dictionary<string, object>() {
                                {"istio", "ingressgateway"}
                            }},
                            {"servers", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"port", new Dictionary<string, object>() {
                                        {"number", 5000 },
                                        {"name", "http"},
                                        {"protocol", "HTTP"}
                                    }},
                                    {"hosts", new string[] {"*"}}
                                }
                            }}
                        }}
                    }
                }
            });

            istioGateway.Node.AddDependency(gateway);
            istioGateway.Node.AddDependency(appNamespace);*/

            KubernetesManifest appService = new KubernetesManifest(this, "AppService", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "v1"},
                        {"kind", "Service"},
                        {"metadata", new Dictionary<string, object>() {
                            { "labels", new Dictionary<string, object>() {
                                {"app", app }
                            }},
                            {"name", svc},
                            {"namespace", props.Namespace},
                            {"annotations", new Dictionary<string, object>() {
                                {"service.kubernetes.io/topology-mode", "auto"}
                            }}
                        }},
                        {"spec", new Dictionary<string, object>() {
                            { "type", "ClusterIP" },
                            { "ports", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"port", 5000 },
                                    {"targetPort", 5000},
                                    {"protocol", "TCP" },
                                    {"name", "http"}
                                }
                            }},
                            {"selector", new Dictionary<string, object>() {
                                {"app", app}
                            }}
                        }}
                    }
                }
            });

            appService.Node.AddDependency(appNamespace);
            ((appService.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            KubernetesManifest istioVirtualService = new KubernetesManifest(this, "IstioVirtualService", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new IDictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "networking.istio.io/v1alpha3"},
                        {"kind", "VirtualService"},
                        {"metadata", new Dictionary<string, object>() {
                            {"name", props.Namespace + "-virtual-service" },
                            {"namespace", props.Namespace}
                        }},
                        {"spec", new Dictionary<string, object>() {
                            {"hosts", new string[] {"*.local"}},
                            {"http", new Dictionary<string, object>[] {
                                new Dictionary<string, object>() {
                                    {"match", new Dictionary<string, object>[] {
                                        new Dictionary<string, object>() {
                                            {"uri", new Dictionary<string, object>() {
                                                {"prefix", "/"}
                                            }}
                                        }
                                    }},
                                    {"route", new Dictionary<string, object>[] {
                                        new Dictionary<string, object>() {
                                            {"destination", new Dictionary<string, object>() {
                                                {"host", svc },
                                                {"port", new Dictionary<string, object>() {
                                                    {"number", 5000}
                                                }}
                                            }}
                                        }
                                    }}
                                }
                            }}
                        }}
                    }
                }
            });

            istioVirtualService.Node.AddDependency(appService);
            ((istioVirtualService.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            KubernetesManifest agentConfigMap = props.Cluster.AddManifest("CloudWatchAgentConfigMap", new Dictionary<string, object>[] {
                new Dictionary<string, object>() {
                    {"apiVersion", "v1"},
                    {"kind", "ConfigMap"},
                    {"metadata", new Dictionary<string, object>() {
                        {"name", "cwagentemfconfig"},
                        {"namespace", props.Namespace}
                    }},
                    {"data", new Dictionary<string, object>() {
                        {"cwagentconfig.json", "{\"agent\":{\"omit_hostname\":true},\"logs\":{\"metrics_collected\":{\"emf\":{}}},\"traces\":{\"traces_collected\":{\"xray\":{},\"otlp\":{}}}}"}
                    }}
                }
            });
            agentConfigMap.Node.AddDependency(appNamespace);
            ((agentConfigMap.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            KubernetesManifest appDeployment = new KubernetesManifest(this, "AppDeployment", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "apps/v1"},
                        {"kind", "Deployment"},
                        {"metadata", new Dictionary<string, object>() {
                            {"name", app},
                            {"namespace", props.Namespace},
                            {"labels", new Dictionary<string, object>() {
                                {"app", app }
                            }},
                        }},
                        {"spec", new Dictionary<string, object>() {
                            { "replicas", 6 },
                            { "selector", new Dictionary<string, object>() {
                                {"matchLabels", new Dictionary<string, object>() {
                                    {"app", app }
                                }}
                            }},
                            { "strategy", new Dictionary<string, object>() {
                                    {"type", "RollingUpdate"},
                                    {"rollingUpdate", new Dictionary<string, object>(){
                                        {"maxUnavailable", 1},
                                        {"maxSurge", 1}
                                    }}
                                }
                            },
                            { "template", new Dictionary<string, object> {                             
                                {"metadata", new Dictionary<string, object>() {
                                    {"labels", new Dictionary<string, object>() {
                                        { "app", app }
                                    }},
                                    {"annotations", new Dictionary<string, object>() {
                                        {"version", "2"}
                                    }}
                                }},
                                { "spec", new Dictionary<string, object>() {
                                    {"serviceAccountName", sa },
                                    {"volumes", new Dictionary<string, object>[] {
                                        new Dictionary<string, object>() {
                                            {"name", "cwagentconfig"},
                                            {"configMap", new Dictionary<string, object>() {
                                                {"name", "cwagentemfconfig"}
                                            }}
                                        }
                                    }},
                                    {"containers", new Dictionary<string, object>[] {
                                        new Dictionary<string, object>() {
                                            {"image", appContainer.Repository.RepositoryUri + ":latest" },
                                            {"imagePullPolicy", "Always"},
                                            {"name", props.Namespace },
                                            {"ports", new Dictionary<string, object>[] {
                                                new Dictionary<string, object>() {
                                                    {"containerPort", 5000}
                                                }
                                            }},
                                            {"env", new Dictionary<string, object>[] {
                                                new Dictionary<string, object>() {
                                                    {"name", "DB_SECRET"},
                                                    {"value", (props.DatabaseCluster as DatabaseCluster).Secret.SecretName}
                                                }
                                            }}
                                        },
                                        new Dictionary<string, object>() {
                                            {"image", cwAgentContainer.Repository.RepositoryUri + ":latest" },
                                            {"imagePullPolicy", "IfNotPresent"},
                                            {"name", "cloudwatch-agent" },
                                            {"resources", new Dictionary<string, object>() {
                                                {"limits", new Dictionary<string, object>() {
                                                    {"cpu", "200m"},
                                                    {"memory", "100Mi"}
                                                }},
                                                {"requests", new Dictionary<string, object>() {
                                                    {"cpu", "200m"},
                                                    {"memory", "100Mi"}
                                                }}
                                            }},
                                            {"volumeMounts", new Dictionary<string, object>[] {
                                                new Dictionary<string, object>() {
                                                    {"name", "cwagentconfig"},
                                                    {"mountPath", "/etc/cwagentconfig"}
                                                }
                                            }},
                                            {"ports", new Dictionary<string, object>[] {
                                                new Dictionary<string, object>() {
                                                    {"containerPort", 25888}, // cloudwatch agent
                                                    {"protocol", "TCP"}
                                                },
                                                new Dictionary<string, object>() {
                                                    {"containerPort", 2000}, // xray
                                                    {"protocol", "TCP"}
                                                },
                                                new Dictionary<string, object>() {
                                                    {"containerPort", 4317}, // otlp grpc
                                                    {"protocol", "TCP"}
                                                },
                                                new Dictionary<string, object>() {
                                                    {"containerPort", 4318}, // otlp http
                                                    {"protocol", "TCP"}
                                                }
                                            }}
                                        }
                                    }}
                                }}
                            }}
                        }}
                    }
                }
            });

            appDeployment.Node.AddDependency(appService);
            appDeployment.Node.AddDependency(istioVirtualService);
            appDeployment.Node.AddDependency(podIdentity);
            appDeployment.Node.AddDependency(agentConfigMap);
            appDeployment.Node.AddDependency(appContainer.Dependable);
            appDeployment.Node.AddDependency(cwAgentContainer.Dependable);
            ((appDeployment.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");

            ApplicationTargetGroup tgp = new ApplicationTargetGroup(this, "AppTargetGroup", new ApplicationTargetGroupProps() {
                HealthCheck = new HealthCheck() { 
                    Enabled = true,
                    Port = "traffic-port",
                    Interval = Duration.Seconds(10),
                    Protocol = Protocol.HTTP,
                    Timeout = Duration.Seconds(2),
                    HealthyThresholdCount = 2,
                    UnhealthyThresholdCount = 2,
                    Path = "/health"                  
                },
                Port = 5000,
                Protocol = ApplicationProtocol.HTTP,
                TargetType = TargetType.IP,
                LoadBalancingAlgorithmType = TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
                DeregistrationDelay = Duration.Seconds(90),
                Vpc = props.Cluster.Vpc,
                ProtocolVersion = ApplicationProtocolVersion.HTTP1              
            });

            tgp.SetAttribute("load_balancing.cross_zone.enabled", "true");
            this.AppTargetGroup = tgp;

            KubernetesManifest targetGroupBinding = new KubernetesManifest(this, "TargetGroupBinding", new KubernetesManifestProps() {
                Cluster = props.Cluster,
                Manifest = new Dictionary<string, object>[] {
                    new Dictionary<string, object>() {
                        {"apiVersion", "elbv2.k8s.aws/v1beta1"},
                        {"kind", "TargetGroupBinding"},
                        {"metadata", new Dictionary<string, object>() {
                            { "name", props.Namespace + "-target-group-binding"},
                            { "namespace", props.Namespace}
                        }},
                        {"spec", new Dictionary<string, object>() {
                            {"serviceRef", new Dictionary<string, object>() {
                                {"name", svc },
                                {"port", 5000 }
                            }},
                            {"targetGroupARN", tgp.TargetGroupArn},
                            {"targetType", "ip"}
                        }}
                    }
                }
            });

            targetGroupBinding.Node.AddDependency(appService);
            ((targetGroupBinding.Node.FindChild("Resource") as CustomResource).Node.DefaultChild as CfnResource).AddPropertyOverride("ServiceTimeout", "300");
        }
    }
}