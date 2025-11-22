// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{

    public interface IEnhancedLoadBalancerV2 : ILoadBalancerV2
    {
        public ISubnet[] Subnets {get;}
        public string[] AvailabilityZones {get;}
        public string LoadBalancerName {get;}
        public string LoadBalancerFullName {get;}
        public string LoadBalancerArn {get;}
    }

    public class EnhancedNetworkLoadBalancer : NetworkLoadBalancer, IEnhancedLoadBalancerV2
    {
        public ISubnet[] Subnets {get;}
        public string[] AvailabilityZones {get;}

        public EnhancedNetworkLoadBalancer(Stack scope, string id, INetworkLoadBalancerProps props) : base(scope, id, props)
        {
            this.Subnets = props.Vpc.SelectSubnets(props.VpcSubnets).Subnets;
            this.AvailabilityZones = props.Vpc.SelectSubnets(props.VpcSubnets).Subnets.Select(x => x.AvailabilityZone).ToArray();
        }
    }

    public class EnhancedApplicationLoadBalancer : ApplicationLoadBalancer, IEnhancedLoadBalancerV2, IApplicationLoadBalancer
    {
        public ISubnet[] Subnets {get;}
        public string[] AvailabilityZones {get;}

        public EnhancedApplicationLoadBalancer(Stack scope, string id, IApplicationLoadBalancerProps props) : base(scope, id, props)
        {
            this.Subnets = props.Vpc.SelectSubnets(props.VpcSubnets).Subnets;
            this.AvailabilityZones = props.Vpc.SelectSubnets(props.VpcSubnets).Subnets.Select(x => x.AvailabilityZone).ToArray();
        }
    }
}
