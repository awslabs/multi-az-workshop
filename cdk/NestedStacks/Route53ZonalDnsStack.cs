// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.Route53;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop
{
    public interface IRoute53ZonalDnsStackProps : INestedStackProps
    {
        public IVpc Vpc {get; set;}
        public string Domain {get; set; }
        public ILoadBalancerV2 LoadBalancer {get; set;}
        public Dictionary<string, string> AvailabilityZoneMap {get; set;} 
    }
    public class Route53ZonalDnsStackProps: NestedStackProps, IRoute53ZonalDnsStackProps
    {
        public IVpc Vpc {get; set;}
        public string Domain {get; set; } = "example.com";
        public ILoadBalancerV2 LoadBalancer {get; set;}
        public Dictionary<string, string> AvailabilityZoneMap {get; set;}
    }

    public class Route53ZonalDnsStack : NestedStack
    {
        public HostedZone HostedZone {get;}
        public string[] FrontEndZonalDnsNames {get;}
        public string FrontEndRegionalDnsName {get;}

        public Route53ZonalDnsStack(Stack scope, string id, IRoute53ZonalDnsStackProps props) : base(scope, id, props)
        {
            this.HostedZone = new PrivateHostedZone(this, "phz", new PrivateHostedZoneProps() {
                Vpc = props.Vpc,
                ZoneName = $"{props.Domain}",
                AddTrailingDot = !props.Domain.EndsWith(".")                 
            });

            LoadBalancerZonalDnsRecords dns = new LoadBalancerZonalDnsRecords(this, "zonalDns", new LoadBalancerZonalDnsRecordsProps() {
                HostedZone = this.HostedZone,
                LoadBalancer = props.LoadBalancer,
                TopLevelDomainPrefix = "www",
                AvailabilityZoneMap = props.AvailabilityZoneMap
            });

            this.FrontEndZonalDnsNames = dns.ZonalDnsNames;
            this.FrontEndRegionalDnsName = "www." + this.HostedZone.ZoneName + ".";
        }
    }
}