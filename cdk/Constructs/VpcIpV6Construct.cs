// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Constructs;
using System.Linq;
using System;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    /// <summary>
    /// Class that adds an IPAddressType enum to specify if subnet should be IPv4 only, dual stack, or IPv6 only
    /// </summary>
    public class SubnetIpV6Configuration : SubnetConfiguration, ISubnetIpV6Configuration
    {
        public IPAddressType SubnetIpConfiguration {get; set;}
        public string AvailabilityZone {get; set;}

        public SubnetIpV6Configuration() : base ()
        {
            this.SubnetIpConfiguration = IPAddressType.DualStack;
            this.AvailabilityZone = String.Empty;
        }
    }

    /// <summary>
    /// Interface for IPv6 subnet configuration in the VpcProps
    /// </summary>
    public interface ISubnetIpV6Configuration : ISubnetConfiguration
    {
        public IPAddressType SubnetIpConfiguration {get; set;}
        public string AvailabilityZone {get; set;}
    }

    /// <summary>
    /// Interface for new VpcProps to allow ipv6 subnet configuration
    /// </summary>
    public interface IVpcIpV6Props : IVpcProps
    {
        new public ISubnetIpV6Configuration[] SubnetConfiguration {get; set;}
    }

    /// <summary>
    /// New VpcProps to include IPv6 subnet configuration
    /// </summary>
    public class VpcIpV6Props : VpcProps, IVpcIpV6Props
    {
        private ISubnetIpV6Configuration[] _subnetConfiguration;

        new public ISubnetIpV6Configuration[] SubnetConfiguration {get {
            return this._subnetConfiguration;
        } set {
            base.SubnetConfiguration = value;
            this._subnetConfiguration = value;
        }}

        public bool DisableCustomResourceCreation {get; set;} = false;

        public VpcIpV6Props() : base()
        {
            this.SubnetConfiguration = Array.Empty<ISubnetIpV6Configuration>();
            this.IpAddresses = Amazon.CDK.AWS.EC2.IpAddresses.Cidr("10.0.0.0/16");
        }
    }

    public interface IVpcIpV6 : IVpc
    {
        public bool IpV6Only {get;}

        public bool IpV6Enabled {get;}

        public string[] VpcIpv6CidrBlocks {get;}
    }

    /// <summary>
    /// The actual IPv6 Vpc construct
    /// </summary>
    public class VpcIpV6 : Vpc, IVpcIpV6
    {
        public bool IpV6Only {get;}

        public bool IpV6Enabled {get;}

        public VpcIpV6(Construct scope, string id, IVpcIpV6Props props): base(scope, id, props)
        {
            bool dualStack = props.SubnetConfiguration.Any(x => x.SubnetIpConfiguration == IPAddressType.DualStack);
            bool ipv6 = props.SubnetConfiguration.Any(x => x.SubnetIpConfiguration == IPAddressType.IPv6);
            this.IpV6Only = props.SubnetConfiguration.All(x => x.SubnetIpConfiguration == IPAddressType.IPv6);
            this.IpV6Enabled = dualStack || ipv6;

            if (dualStack || ipv6)
            {
                // Create IPv6 CIDR block
                CfnVPCCidrBlock ipv6Block = new CfnVPCCidrBlock(this, "IPv6CidrBlock", new CfnVPCCidrBlockProps() {
                    AmazonProvidedIpv6CidrBlock = true,
                    VpcId = this.VpcId
                });

                string[] iPv6SubnetCidrBlocks = Fn.Cidr(Fn.Select(0, this.VpcIpv6CidrBlocks), 256, "64");

                int ipv6Counter = 0;  

                foreach (Subnet subnet in this.PublicSubnets)
                {
                    ISubnetIpV6Configuration config = props.SubnetConfiguration.Where(x => x.SubnetType == SubnetType.PUBLIC).FirstOrDefault();
                    subnet.Node.AddDependency(ipv6Block);
                    CfnSubnet sub = subnet.Node.DefaultChild as CfnSubnet;
                    sub.Ipv6CidrBlock = Fn.Select(ipv6Counter++, iPv6SubnetCidrBlocks);
                    
                    if (!String.IsNullOrEmpty(this.InternetGatewayId))
                    {
                        subnet.AddRoute("IPv6DefaultRoute", new AddRouteOptions() {
                            DestinationIpv6CidrBlock = "::/0",
                            EnablesInternetConnectivity = true,
                            RouterType = RouterType.GATEWAY,
                            RouterId = this.InternetGatewayId
                        });
                    }

                    if (config.SubnetIpConfiguration == IPAddressType.IPv6)
                    {
                        sub.CidrBlock = null;
                        sub.Ipv6Native = true;
                    }
                }

                if (this.PrivateSubnets.Any())
                {
                    CfnEgressOnlyInternetGateway egw = new CfnEgressOnlyInternetGateway(this, "EgressGateway", new CfnEgressOnlyInternetGatewayProps() {
                        VpcId = this.VpcId
                    });
                
                    foreach (Subnet subnet in this.PrivateSubnets)
                    {
                        ISubnetIpV6Configuration config = props.SubnetConfiguration.Where(x => x.SubnetType == SubnetType.PRIVATE_WITH_EGRESS).FirstOrDefault();

                        subnet.Node.AddDependency(ipv6Block);
                        CfnSubnet sub = subnet.Node.DefaultChild as CfnSubnet;
                        sub.Ipv6CidrBlock = Fn.Select(ipv6Counter++, iPv6SubnetCidrBlocks);
                        subnet.AddRoute("IPv6DefaultRoute", new AddRouteOptions() {
                            DestinationIpv6CidrBlock = "::/0",
                            EnablesInternetConnectivity = true,
                            RouterType = RouterType.GATEWAY,
                            RouterId = egw.AttrId
                        });

                        if (config.SubnetIpConfiguration == IPAddressType.IPv6)
                        {
                            sub.CidrBlock = null;
                            sub.Ipv6Native = true;
                        }
                    }
                }

                ISubnetIpV6Configuration isolatedSubnetConfig = props.SubnetConfiguration.FirstOrDefault(x => x.SubnetType == SubnetType.PRIVATE_ISOLATED);

                foreach (Subnet subnet in this.IsolatedSubnets)
                {
                    subnet.Node.AddDependency(ipv6Block);
                    CfnSubnet sub = subnet.Node.DefaultChild as CfnSubnet;
                    sub.Ipv6CidrBlock = Fn.Select(ipv6Counter++, iPv6SubnetCidrBlocks);
                    
                    if (isolatedSubnetConfig != null && isolatedSubnetConfig.SubnetIpConfiguration == IPAddressType.IPv6)
                    {
                        sub.CidrBlock = null;
                        sub.Ipv6Native = true;
                    }
                }
            }

            // Not needed since list of AZs is already provided in the VPC
            // configuration, can just copy that for output
            //List<string> temp = new List<string>();

            //foreach (ISubnet subnet in this.Vpc.IsolatedSubnets)
            //{
            //    temp.Add(Fn.GetAtt((subnet.Node.DefaultChild as CfnElement).LogicalId, "AvailabilityZone").ToString());
            //}

            CfnOutput azs = new CfnOutput(this, "AvailabilityZones", new CfnOutputProps() {
                Value = Fn.Join(",", props.AvailabilityZones),
                ExportName = Fn.Sub("${AWS::StackName}-AvailabilityZones")
            });

            if (this.IpV6Enabled)
            {
                CfnOutput ipv6Blocks = new CfnOutput(this, "VpcIpv6CidrBlocks", new CfnOutputProps() {
                    Value =  Fn.Join(",", this.VpcIpv6CidrBlocks)
                });
            }
        }
    }
}