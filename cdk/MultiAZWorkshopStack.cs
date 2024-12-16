// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.CloudWatch;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.Route53RecoveryControl;
using Amazon.CDK.AWS.SSM;
using io.bamcis.cdk.MultiAZObservability;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Amazon.AWSLabs.MultiAZWorkshop.NestedStacks;

namespace Amazon.AWSLabs.MultiAZWorkshop
{
    public enum LoadBalancerType
    {
        APPLICATION_LOAD_BALANCER,
        NETWORK_LOAD_BALANCER
    }

    public class MultiAZWorkshopStack : Stack
    {
        EvacuationMethod evacuationMethod = EvacuationMethod.ZonalShift;
        const string domain = "example.com";
        const string metricsNamespace = "multi-az-workshop/frontend";
        const string canaryMetricsNamespace = "canaries/frontend";
        const string ec2LogGroupName = "/multi-az-workshop/frontend";
        const string faultMetricJsonPath = "$.Fault";
        const string successLatencyMetricJsonPath = "$.SuccessLatency";
        const string azIdJsonPath = "$.AZ-ID";
        const string operationNameJsonPath = "$.Operation";
        const string instanceIdJsonPath = "$.InstanceId";
        const InstanceArchitecture arch = InstanceArchitecture.ARM_64;

        private IpV6NetworkStack NetworkStack {get;}

        private DatabaseStack DatabaseStack {get;}

        private EC2FleetStack EC2Stack {get;}

        private EKSStack EKSStack {get;}

        private CodeDeployApplicationStack CodeDeployStack {get;}

        private Route53ZonalDnsStack Route53Stack {get;}

        private AZTaggerStack AZTaggerStack {get;}

        private Route53HealthChecksStack HealthCheckStack {get;}

        private FaultInjectionStack FaultInjectionStack {get;}

        private LogQueryStack LogQueryStack {get;}

        private SSMRandomFaultStack SSMRandomFaultStack {get;}

        private CodeDeployApplicationStack DeploymentFailureStack {get;}

        private IApplicationLoadBalancer LoadBalancer {get;}

        public MultiAZWorkshopStack(App scope, string id, StackProps props) : base(scope, id, props)
        {
            #region Parameters

            Amazon.CDK.CfnParameter assetsBucketName = new Amazon.CDK.CfnParameter(this, "AssetsBucketName", new Amazon.CDK.CfnParameterProps() {
                Type = "String",
                MinLength = 1,
                Default = "{{.AssetsBucketName}}"
            });

            Amazon.CDK.CfnParameter assetsBucketPrefix = new Amazon.CDK.CfnParameter(this, "AssetsBucketPrefix", new Amazon.CDK.CfnParameterProps() {
                Type = "String",
                Default = "{{.AssetsBucketPrefix}}"
            }); 

            Amazon.CDK.CfnParameter participantRole = new Amazon.CDK.CfnParameter(this, "ParticipantRoleName", new Amazon.CDK.CfnParameterProps() {
                Type = "String",
                Default = "{{.ParticipantRoleName}}"
            }); 

            #endregion   

            #region Constants
               
            string[] availabilityZoneNames = new string[] {
                Fn.Ref("AWS::Region") + 'a',
                Fn.Ref("AWS::Region") + 'b',
                Fn.Ref("AWS::Region") + 'c',
            };
         
            int fleetSize = availabilityZoneNames.Length * 2;

            #endregion

            #region Stacks 

            StringParameter bucket = new StringParameter(this, "BucketParameter", new StringParameterProps() {
                ParameterName = "BucketPath",
                StringValue = Fn.Sub("s3://${AssetsBucketName}/${AssetsBucketPrefix}")
            });

            // Creates the VPC network, subnets, routes, and VPC endpoints
            this.NetworkStack = new IpV6NetworkStack(this, "Network", new IPV6NetworkStackProps() {
                AvailabilityZoneNames = availabilityZoneNames,
                 
            });

            AvailabilityZoneMapper azMapper =new AvailabilityZoneMapper(this, "AZMapper", new AvailabilityZoneMapperProps() {
                AvailabilityZoneNames = availabilityZoneNames
            });

            Dictionary<string, string> availabilityZoneMap = new Dictionary<string, string>();

            string[] availabilityZoneIds = availabilityZoneNames.Select(x => {
                string azId = azMapper.AvailabilityZoneIdFromAvailabilityZoneLetter(x.Substring(x.Length - 1));
                availabilityZoneMap.Add(x, azId);
                return azId;
            }).ToArray();

            // Creates the Lambda function that automatically tags new instances with their AZ-ID
            // Can be used to target CodeDeploy deployments
            this.AZTaggerStack = new AZTaggerStack(this, "az-tagger-", new NestedStackProps() {
            });

            // Create the aurora database
            this.DatabaseStack = new DatabaseStack(this, "database-", new DatabaseStackProps() {
                Vpc = this.NetworkStack.Vpc
            });

            ILogGroup frontEndLogGroup = new LogGroup(this, "logGroup", new LogGroupProps() {
                LogGroupName = ec2LogGroupName,
                Retention = RetentionDays.ONE_WEEK,
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            SecurityGroup albSG = new SecurityGroup(this, "ALBSecurityGroup", new SecurityGroupProps() {
                Vpc = this.NetworkStack.Vpc,
                AllowAllOutbound = true,
                AllowAllIpv6Outbound = this.NetworkStack.Vpc.IpV6Enabled ? true : false
            });

            albSG.AddIngressRule(Peer.Ipv4(this.NetworkStack.Vpc.VpcCidrBlock), Port.Tcp(80));

            if (this.NetworkStack.Vpc.IpV6Enabled)
            {
                albSG.AddIngressRule(Peer.Ipv6(Fn.Select(0, this.NetworkStack.Vpc.VpcIpv6CidrBlocks)), Port.Tcp(80));
            }

            // Deploys the EC2 auto scaling groups, load balancers, and target groups
            // with accompanying resources like IAM and log groups
            this.EC2Stack = new EC2FleetStack(this, "ec2-", new EC2FleetStackProps() {
                Vpc = this.NetworkStack.Vpc,
                InstanceSize = InstanceSize.NANO,
                LogGroup = frontEndLogGroup,
                FleetSize = fleetSize,
                CpuArch = arch,
                IAMResourcePath = "/front-end/ec2-fleet/",
                Database = this.DatabaseStack.Database,
                LoadBalancerSecurityGroup = albSG,
                Subnets = new SubnetSelection() {  SubnetType = SubnetType.PRIVATE_ISOLATED }
            });        

            this.EC2Stack.Node.AddDependency(this.AZTaggerStack);   
            this.EC2Stack.Node.AddDependency(frontEndLogGroup);   

            this.EKSStack = new EKSStack(this, "eks-", new EKSStackProps() {
                CpuArch = arch,
                Vpc = this.NetworkStack.Vpc,
                Database = this.DatabaseStack.Database,
                LoadBalancerSecurityGroup = albSG,
                AdminRoleName = participantRole.ValueAsString,
                IAMResourcePath = "/front-end/eks-fleet/",
            });

            this.EKSStack.Node.AddDependency(this.AZTaggerStack);
            this.EKSStack.Node.AddDependency(frontEndLogGroup);        

            EnhancedApplicationLoadBalancer alb = new EnhancedApplicationLoadBalancer(this, "ALB", new ApplicationLoadBalancerProps() {
                InternetFacing = false,
                Vpc = this.NetworkStack.Vpc,
                VpcSubnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED },
                Http2Enabled = true,
                SecurityGroup = albSG 
            });

            alb.SetAttribute("zonal_shift.config.enabled", "true");

            this.LoadBalancer = alb;

            // Creates the route 53 records on top of the load balancer
            // to create both an easy regional endpoint as well as zonal endpoints
            if (evacuationMethod != EvacuationMethod.ZonalShift)
            {
                this.Route53Stack = new Route53ZonalDnsStack(this, "route-53-", new Route53ZonalDnsStackProps() {
                    LoadBalancer = this.LoadBalancer,
                    Vpc = this.NetworkStack.Vpc,         
                    Domain = domain             
                });
            }

            // Creates the resources/stack for the AZ evacuation
            switch (evacuationMethod)
            {
                case EvacuationMethod.SelfManagedHttpEndpoint_APIG:
                {
                    SelfManagedHttpEndpointApigStack apigStack = new SelfManagedHttpEndpointApigStack(this, "apig-", new SelfManagedHttpEndpointApigStackProps() {
                        AvailabilityZoneIds = availabilityZoneIds,
                        FailOpen = true                     
                    });

                    this.HealthCheckStack = new Route53HealthChecksStack(this, "health-checks-", new Route53HealthChecksStackProps() {
                        DomainName = Fn.Join(".", new string[] { apigStack.Api.RestApiId, "execute-api", Fn.Sub("${AWS::Region}"), Fn.Sub("${AWS::URLSuffix}") }),
                        ResourcePath = apigStack.ResourcePath,
                        EvacuationMethod = evacuationMethod,
                        AvailabilityZoneIdToRoutingControlArns = availabilityZoneIds.ToDictionary(x => x, x => default(CfnRoutingControl))
                    });
                    break;
                }
                case EvacuationMethod.ARC:
                {
                    ApplicationRecoveryControllerStack arcStack = new ApplicationRecoveryControllerStack(this, "ARC", new ApplicationRecoveryControllerStackProps() {
                        AvailabilityZoneIds = availabilityZoneIds
                    });
                    
                    this.HealthCheckStack = new Route53HealthChecksStack(this, "health-checks-", new Route53HealthChecksStackProps() {
                        AvailabilityZoneIdToRoutingControlArns = arcStack.RoutingControlsPerAvailabilityZoneId
                    });

                    break;
                }
                case EvacuationMethod.SelfManagedHttpEndpoint_S3:
                {
                    SelfManagedHttpEndpointS3Stack s3Stack = new SelfManagedHttpEndpointS3Stack(this, "s3-", new SelfManagedHttpEndpointS3StackProps() {
                        AvailabilityZoneIds = availabilityZoneIds                      
                    });

                    this.HealthCheckStack = new Route53HealthChecksStack(this, "health-checks-", new Route53HealthChecksStackProps() {
                        DomainName = s3Stack.Bucket.BucketRegionalDomainName,
                        ResourcePath = s3Stack.ResourcePath,
                        EvacuationMethod = evacuationMethod,
                        Inverted = true,
                        AvailabilityZoneIdToRoutingControlArns = availabilityZoneIds.ToDictionary(x => x, x => default(CfnRoutingControl))
                    });
                    break;
                }
                default:
                case EvacuationMethod.ZonalShift:
                {
                    // Don't need to do anything, no resources to deploy for this
                    break;
                }
            }

            IService wildRydesService = CreateService(this.LoadBalancer, this.NetworkStack.Vpc, new ILogGroup[] {frontEndLogGroup});

            var mazNestedStack = new NestedStackWithSource(this, "multi-az-observability-");
            InstrumentedServiceMultiAZObservability multiAvailabilityZoneObservability = new InstrumentedServiceMultiAZObservability(mazNestedStack, "instrumented-service-", new InstrumentedServiceMultiAZObservabilityProps() {
                Service = wildRydesService,
                OutlierThreshold = .70,
                CreateDashboards = true,
                Interval = Duration.Minutes(60),
                AssetsBucketParameterName = "AssetsBucketName",
                AssetsBucketPrefixParameterName = "AssetsBucketPrefix",
                OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC
            });
          
            /*
            BasicServiceMultiAZObservability multiAZObservability = new BasicServiceMultiAZObservability(this, "basic-service-", new BasicServiceMultiAZObservabilityProps() {
                ApplicationLoadBalancers = new IApplicationLoadBalancer[] { loadBalancer },
                NatGateways = new Dictionary<string, CfnNatGateway>() {
                    { "us-east-1a", natGateway1},
                    { "us-east-1b", natGateway2},
                    { "us-east-1c", natGateway3},
                },
                CreateDashboard = true,
                OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC,
                FaultCountPercentageThreshold = 1.0,
                PacketLossImpactPercentageThreshold = 0.01,
                ServiceName = "WildRydes",
                Period = Duration.Seconds(60),
                Interval = Duration.Minutes(60),          
            });*/

            ApplicationListener listener = this.LoadBalancer.AddListener("Http80Listener", new BaseApplicationListenerProps() {
                Port = 80,
                Protocol = ApplicationProtocol.HTTP,
                DefaultAction = new ListenerAction(new CfnListener.ActionProperty() {
                    TargetGroupArn = this.EC2Stack.TargetGroup.TargetGroupArn,
                    Type = "forward",
                    Order = 2
                })                     
            });

            // Make sure the alarms used for CodeDeploy are created before creating the listener,
            // otherwise the listener gets created and the CodeDeploy stack is still waiting for the
            // the alarms to finish and nodes start to fail their health checks while it waits
            listener.Node.AddDependency(mazNestedStack);

/*
            ApplicationListenerRule eksRoutes = new ApplicationListenerRule(this, "EKSRoutes", new ApplicationListenerRuleProps() {
                Action = ListenerAction.Forward(new IApplicationTargetGroup[] { this.EKSStack.EKSAppTargetGroup }),
                Conditions = new ListenerCondition[] {
                    ListenerCondition.PathPatterns(new string[] {"/home", "/signin" })
                },
                Priority = 1,
                Listener = listener
            });
  */ 
            this.FaultInjectionStack = new FaultInjectionStack(this, "fault-injection-", new FaultInjectionStackProps() {
                AZCount = availabilityZoneNames.Length,
                AZNames = this.NetworkStack.Vpc.AvailabilityZones,
                Database = this.DatabaseStack.Database,
                LogGroupName = "/fis/experiments",
                LogGroupRetention = RetentionDays.ONE_WEEK,
                AutoScalingGroup = this.EC2Stack.AutoScalingGroup,
                DelayMilliseconds = Duration.Millis(100),
                PacketLossPercent = 30
            });

            SSMRandomFaultStack randomFaultStack = new SSMRandomFaultStack(this, "ssm-random-fault-", new SSMRandomFaultStackProps() {
                LatencyExperiments = this.FaultInjectionStack.LatencyExperiments,
                PacketLossExperiments = this.FaultInjectionStack.PacketLossExperiments
            });
        
            this.LogQueryStack = new LogQueryStack(this, "log-query-", new LogQueryStackProps() {
                CanaryLogGroup = multiAvailabilityZoneObservability.CanaryLogGroup,
                ServerSideLogGroup = frontEndLogGroup,
                Service = wildRydesService,
                AvailabilityZoneIds = availabilityZoneIds
            });
            
            //Creates the CodeDeploy application that is deployed
            //to the servers
            this.CodeDeployStack = new CodeDeployApplicationStack(this, "codedeploy-", new CodeDeployApplicationStackProps() {
                EC2Fleet = this.EC2Stack,
                ApplicationKey = assetsBucketPrefix.ValueAsString + (arch == InstanceArchitecture.ARM_64 ? "app_arm64.zip" : "app_x64.zip"),
                AvailabilityZoneCount = availabilityZoneIds.Length,
                TotalEC2InstancesInFleet = fleetSize,
                ApplicationName = "multi-az-workshop",
                MinimumHealthyHostsPerZone = 1,     
                Alarms = new IAlarm[] { multiAvailabilityZoneObservability.ServiceAlarms.RegionalAvailabilityCanaryAlarm}
            });  

            CodeDeployStack.Node.AddDependency(listener);

            StringParameter deploymentAsset = new StringParameter(this, "DeploymentParameter", new StringParameterProps() {
                ParameterName = "DeploymentAsset",
                StringValue = Fn.Sub("s3://${AssetsBucketName}/${AssetsBucketPrefix}") + (arch == InstanceArchitecture.ARM_64 ? "app_arm64_fail.zip" : "app_x64_fail.zip")
            });

            #endregion
        }

        internal static IService CreateService(ILoadBalancerV2 loadBalancer, IVpc vpc, ILogGroup[] serverLogGroups)
        {
            var newService = new Service(new ServiceProps(){
                ServiceName = "WildRydes",
                BaseUrl = "http://www.example.com",
                FaultCountThreshold = 25,
                AvailabilityZoneNames = vpc.AvailabilityZones,
                Period = Duration.Seconds(60),
                LoadBalancer = loadBalancer,
                DefaultAvailabilityMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps() {
                    AlarmStatistic = "Sum",
                    DatapointsToAlarm = 2,
                    EvaluationPeriods = 3,
                    FaultAlarmThreshold = 1,
                    FaultMetricNames = new string[] { "Fault", "Failure" },
                    GraphedFaultStatistics = new string[] { "Sum" },
                    GraphedSuccessStatistics = new string[] { "Sum" },
                    MetricNamespace = metricsNamespace,
                    Period = Duration.Seconds(60),
                    SuccessAlarmThreshold = 99,
                    SuccessMetricNames = new string[] {"Success"},
                    Unit = Unit.COUNT,
                }),
                DefaultLatencyMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps(){
                    AlarmStatistic = "p99",
                    DatapointsToAlarm = 2,
                    EvaluationPeriods = 3,
                    FaultAlarmThreshold = 1,
                    FaultMetricNames = new string[] { "FaultLatency" },
                    GraphedFaultStatistics = new string[] { "p50" },
                    GraphedSuccessStatistics = new string[] { "p50", "p99", "tm50", "tm99" },
                    MetricNamespace = metricsNamespace,
                    Period = Duration.Seconds(60),
                    SuccessAlarmThreshold = 100,
                    SuccessMetricNames = new string[] {"SuccessLatency"},
                    Unit = Unit.MILLISECONDS,
                }),
                DefaultContributorInsightRuleDetails =  new ContributorInsightRuleDetails(new ContributorInsightRuleDetailsProps() {
                    AvailabilityZoneIdJsonPath = azIdJsonPath,
                    FaultMetricJsonPath = faultMetricJsonPath,
                    InstanceIdJsonPath = instanceIdJsonPath,
                    LogGroups = serverLogGroups,
                    OperationNameJsonPath = operationNameJsonPath,
                    SuccessLatencyMetricJsonPath = successLatencyMetricJsonPath
                }),
                CanaryTestProps = new AddCanaryTestProps() {
                    RequestCount = 60,
                    RegionalRequestCount = 60,
                    LoadBalancer = loadBalancer,
                    Schedule = "rate(1 minute)",
                    Timeout = Duration.Seconds(3),
                    NetworkConfiguration = new NetworkConfigurationProps() {
                        Vpc = vpc,
                        SubnetSelection = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED }
                    }            
                }
            });

            newService.AddOperation(new Operation(new OperationProps() {
                OperationName = "Signin",
                Path = "/signin",
                Service = newService,
                Critical = true,
                HttpMethods = new string[] { "GET" },
                ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Signin",
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
                }, newService.DefaultAvailabilityMetricDetails),
                ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Signin",
                    SuccessAlarmThreshold = 150,
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
                }, newService.DefaultLatencyMetricDetails),
                CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
                    SuccessAlarmThreshold = 500
                })
            }));

            newService.AddOperation(new Operation(new OperationProps() {
                OperationName = "Pay",
                Path = "/pay",
                Service = newService,
                HttpMethods = new string[] { "GET" },
                Critical = true,
                ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Pay",
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
                }, newService.DefaultAvailabilityMetricDetails),
                ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Pay",
                    SuccessAlarmThreshold = 200,
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
                }, newService.DefaultLatencyMetricDetails),
                CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
                    SuccessAlarmThreshold = 500
                })
            }));

            newService.AddOperation(new Operation(new OperationProps() {
                OperationName = "Ride",
                Path = "/ride",
                Service = newService,
                HttpMethods = new string[] { "GET" },
                Critical = true,
                ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Ride",
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
                }, newService.DefaultAvailabilityMetricDetails),
                ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Ride",
                    SuccessAlarmThreshold = 350,
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
                }, newService.DefaultLatencyMetricDetails),
                CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
                    SuccessAlarmThreshold = 650
                })
            }));

            newService.AddOperation(new Operation(new OperationProps() {
                OperationName = "Home",
                Path = "/home",
                Service = newService,
                HttpMethods = new string[] { "GET" },
                Critical = true,
                ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Home",
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Home"}}, "AZ-ID", "Region")
                }, newService.DefaultAvailabilityMetricDetails),
                ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
                    OperationName = "Home",
                    SuccessAlarmThreshold = 100,
                    MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Home"}}, "AZ-ID", "Region")
                }, newService.DefaultLatencyMetricDetails),
                CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
                    SuccessAlarmThreshold = 500
                })
            }));

            return newService;
        }
    }
}
