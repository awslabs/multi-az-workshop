// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class IPV6NetworkStackProps : NestedStackProps, INestedStackProps
    {
        public string[] AvailabilityZoneNames {get; set; }
    }

    public class IpV6NetworkStack : NestedStackWithSource
    {
        public VpcIpV6 Vpc { get;}
        public string AvailabilityZoneNames {get;}

        public IpV6NetworkStack(Stack scope, string id, IPV6NetworkStackProps props) : base(scope, id, props)
        {
            this.Vpc = new VpcIpV6(this, "vpc", new VpcIpV6Props() {
                IpAddresses = IpAddresses.Cidr("192.168.0.0/16"),
                EnableDnsHostnames = true,
                EnableDnsSupport = true,
                CreateInternetGateway = false,
                AvailabilityZones = props.AvailabilityZoneNames,
                SubnetConfiguration = new ISubnetIpV6Configuration[] {
                    new SubnetIpV6Configuration() { CidrMask = 24, Name = "isolated-subnet", SubnetIpConfiguration = IPAddressType.IPv4, SubnetType = SubnetType.PRIVATE_ISOLATED},
                },
                RestrictDefaultSecurityGroup = false
            });

            this.Vpc.AddGatewayEndpoint("s3", new GatewayVpcEndpointOptions() { Service = GatewayVpcEndpointAwsService.S3 });
            this.Vpc.AddInterfaceEndpoint("vpcessm", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.SSM, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("vpcessmmessages", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.SSM_MESSAGES, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("kms", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.KMS, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("logs", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("cloudwatch", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("ec2messages", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.EC2_MESSAGES, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("cfn", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.CLOUDFORMATION, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("xray", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.XRAY, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("codedeploy", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.CODEDEPLOY, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("codedeployagent", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.CODEDEPLOY_COMMANDS_SECURE, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("secretsmanager", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.SECRETS_MANAGER, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("elasticloadbalancing", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("sts", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.STS, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("ec2", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.EC2, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("ecrapi", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.ECR, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("ecrdkr", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.ECR_DOCKER, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("eks", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.EKS, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("eksauth", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.EKS_AUTH, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("autoscaling", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.AUTOSCALING, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("lambda", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.LAMBDA, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("stepfunctions", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.STEP_FUNCTIONS, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
            this.Vpc.AddInterfaceEndpoint("stepfunctionssync", new InterfaceVpcEndpointOptions() { Service = InterfaceVpcEndpointAwsService.STEP_FUNCTIONS_SYNC, Subnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED}, PrivateDnsEnabled = true, Open = true } );
        }
    }
}