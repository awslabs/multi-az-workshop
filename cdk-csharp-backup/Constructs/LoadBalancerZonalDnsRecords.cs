// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System;
using System.Collections.Generic;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.Route53;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public class LoadBalancerZonalDnsRecordsProps : ILoadBalancerZonalDnsRecordsProps
    {
        public ILoadBalancerV2 LoadBalancer {get; set;}
        public IHostedZone HostedZone {get; set;}
        public bool AddWeightedRecord {get; set;}
        public string TopLevelDomainPrefix {get; set;}
        public Dictionary<string, string> AvailabilityZoneMap {get; set;}
    }

    public interface ILoadBalancerZonalDnsRecordsProps
    {
        public ILoadBalancerV2 LoadBalancer {get; set;}
        public IHostedZone HostedZone {get; set;}
        public bool AddWeightedRecord {get; set;}
        public string TopLevelDomainPrefix {get; set;}
        public Dictionary<string, string> AvailabilityZoneMap {get; set;}
    }

    public static class LoadBalancerExtensionMethods
    {
        //TODO not used, need to validate this works and includes
        // all necessary functionality, not tested yet
        public static ILoadBalancerV2 AddZoneIdRecords(this ILoadBalancerV2 loadBalancer, IHostedZone hostedZone, CustomResource azMap, string az, bool addWeightedRecord)
        {

            CfnRecordSet recordSet = new CfnRecordSet(loadBalancer.Stack, "record" + new Random().Next(), new CfnRecordSetProps() {
                AliasTarget = new CfnRecordSet.AliasTargetProperty() {
                    DnsName = Fn.Join(".", new string[] { az, loadBalancer.LoadBalancerDnsName }),
                    EvaluateTargetHealth = true,
                    HostedZoneId = loadBalancer.LoadBalancerCanonicalHostedZoneId
                },
                Name = Fn.Join("", new string[] { az, ".", hostedZone.ZoneName, "." }), //Fn.Join("", new string[] { zoneId, ".", hostedZone.ZoneName, "." }),
                Type = "A",
                HostedZoneId = hostedZone.HostedZoneId
            });

            if (addWeightedRecord)
            {
                CfnRecordSet weightedRecordSet = new CfnRecordSet(loadBalancer.Stack, "record" + new Random().Next(), new CfnRecordSetProps() {
                    AliasTarget = new CfnRecordSet.AliasTargetProperty() {
                        DnsName = Fn.Join(".", new string[] { az, loadBalancer.LoadBalancerDnsName }),
                        EvaluateTargetHealth = true,
                        HostedZoneId = loadBalancer.LoadBalancerCanonicalHostedZoneId
                    },
                    Name = Fn.Join("", new string[] { az, ".", hostedZone.ZoneName, "." }), //Fn.Join("", new string[] { zoneId, ".", hostedZone.ZoneName, "." }),
                    Type = "A",
                    HostedZoneId = hostedZone.HostedZoneId,
                    Weight = 100,
                    SetIdentifier = Fn.Join("-", new string[] { azMap.GetAttString(Fn.Sub("$AWS::Region")), az })
                });
            }

            return loadBalancer;
        }
    }

    public class LoadBalancerZonalDnsRecords : Construct
    {
        public string[] ZonalDnsNames {get;}
        public string RegionalDnsName {get;}

        public Dictionary<string, string> ZoneNameToZoneIdDnsNames {get;}

        public LoadBalancerZonalDnsRecords(Stack scope, string id, ILoadBalancerZonalDnsRecordsProps props) : base(scope, id)
        {
            this.ZoneNameToZoneIdDnsNames = new Dictionary<string, string>();
            this.ZonalDnsNames = new string[props.AvailabilityZoneMap.Count];

            this.RegionalDnsName = Fn.Join("", new string[] { props.TopLevelDomainPrefix, ".", props.HostedZone.ZoneName, "." });

            for (int i = 0; i < props.AvailabilityZoneMap.Count; i++)
            {
                CfnRecordSet recordSet = new CfnRecordSet(this, $"Record{i}", new CfnRecordSetProps() {
                    AliasTarget = new CfnRecordSet.AliasTargetProperty() {
                        DnsName = Fn.Join(".", new string[] { props.AvailabilityZoneMap.ElementAt(i).Key, props.LoadBalancer.LoadBalancerDnsName }),
                        EvaluateTargetHealth = true,
                        HostedZoneId = props.LoadBalancer.LoadBalancerCanonicalHostedZoneId
                    },
                    Name = Fn.Join("", new string[] { props.AvailabilityZoneMap.ElementAt(i).Value, ".", props.HostedZone.ZoneName, "." }),
                    Type = "A",
                    HostedZoneId = props.HostedZone.HostedZoneId
                });

                this.ZonalDnsNames[i] = recordSet.Name;
                this.ZoneNameToZoneIdDnsNames.Add(props.AvailabilityZoneMap.ElementAt(i).Key, recordSet.Name);

                CfnRecordSet weightedRecordSet = new CfnRecordSet(this, $"WeightedRecord{i}", new CfnRecordSetProps() {
                    AliasTarget = new CfnRecordSet.AliasTargetProperty() {
                        DnsName = Fn.Join(".", new string[] { props.AvailabilityZoneMap.ElementAt(i).Key, props.LoadBalancer.LoadBalancerDnsName }),
                        EvaluateTargetHealth = true,
                        HostedZoneId = props.LoadBalancer.LoadBalancerCanonicalHostedZoneId
                    },
                    Name = this.RegionalDnsName,
                    Type = "A",
                    HostedZoneId = props.HostedZone.HostedZoneId,
                    Weight = 100,
                    SetIdentifier = props.AvailabilityZoneMap.ElementAt(i).Value
                });
            }      
        }
    }
}