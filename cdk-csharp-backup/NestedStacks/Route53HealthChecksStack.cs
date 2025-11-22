// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53RecoveryControl;
using static Amazon.CDK.AWS.Route53.CfnHealthCheck;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public class Route53HealthChecksStackProps : NestedStackProps, IRoute53HealthChecksStackProps
    {
        public EvacuationMethod EvacuationMethod {get; set;}

        public string DomainName {get; set;}

        /// <summary>
        /// "The standard path used with the domain. This template will append \"/az-id\" onto the url for each health check."
        /// </summary>
        public string ResourcePath {get; set;}

         public Dictionary<string, CfnRoutingControl> AvailabilityZoneIdToRoutingControlArns {get; set;}

        public bool Inverted {get; set;} = false;
    }

    public interface IRoute53HealthChecksStackProps : INestedStackProps
    {
        public EvacuationMethod EvacuationMethod {get; set;}

        public string DomainName {get; set;}

        public string ResourcePath {get; set;}

        public Dictionary<string, CfnRoutingControl> AvailabilityZoneIdToRoutingControlArns {get; set;}

        public bool Inverted {get; set;}
    }

    public class Route53HealthChecksStack : NestedStack
    {
        public CfnHealthCheck[] HealthChecks {get;}

        public Route53HealthChecksStack(Stack scope, string id, IRoute53HealthChecksStackProps props) : base(scope, id, props)
        {
            this.HealthChecks = new CfnHealthCheck[props.AvailabilityZoneIdToRoutingControlArns.Count];

            for (int i = 0; i < props.AvailabilityZoneIdToRoutingControlArns.Count; i++)
            {
                switch (props.EvacuationMethod)
                {
                    case EvacuationMethod.SelfManagedHttpEndpoint_S3:
                    case EvacuationMethod.SelfManagedHttpEndpoint_APIG:
                        this.HealthChecks[i] = new CfnHealthCheck(this, "az" + (i + 1), new CfnHealthCheckProps() {
                            HealthCheckConfig = new HealthCheckConfigProperty() {
                                FailureThreshold = 1,
                                FullyQualifiedDomainName = props.DomainName,
                                ResourcePath = Fn.Sub("${ResourcePath}${AZID}", new Dictionary<string, string>(){ {"ResourcePath", props.ResourcePath}, { "AZID", props.AvailabilityZoneIdToRoutingControlArns.ElementAt(i).Key} }),
                                Port = 443,
                                Type = "HTTPS",
                                Inverted = props.Inverted
                            }
                        });
                        break;
                    case EvacuationMethod.ARC:
                        this.HealthChecks[i] = new CfnHealthCheck(this, "AZ" + (i + 1), new CfnHealthCheckProps() {
                            HealthCheckConfig = new HealthCheckConfigProperty() {
                                Type = "RECOVERY_CONTROL",
                                RoutingControlArn = props.AvailabilityZoneIdToRoutingControlArns.ElementAt(i).Value.Ref                      
                            }
                        });
                        break;
                }
            }
        }
    }
}