// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System.Collections.Generic;
using System.Linq;
using Amazon.CDK;
using Amazon.CDK.AWS.Route53RecoveryControl;
using static Amazon.CDK.AWS.Route53RecoveryControl.CfnSafetyRule;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface IApplicationRecoveryControllerStackProps : INestedStackProps
    {
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class ApplicationRecoveryControllerStackProps : NestedStackProps, IApplicationRecoveryControllerStackProps
    {
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class ApplicationRecoveryControllerStack : NestedStack
    {
        public Dictionary<string, CfnRoutingControl> RoutingControlsPerAvailabilityZoneId {get;}

        public ApplicationRecoveryControllerStack(Stack scope, string id, IApplicationRecoveryControllerStackProps props) : base(scope, id, props)
        {
            CfnCluster cluster = new CfnCluster(this, "Cluster", new CfnClusterProps() { Name = "AZEvacuationCluster" });
            CfnControlPanel cp = new CfnControlPanel(this, "ControlPlane", new CfnControlPanelProps() {
                ClusterArn = cluster.AttrClusterArn,
                Name = "AZEvacuationControlPanel"
            });

            this.RoutingControlsPerAvailabilityZoneId = new Dictionary<string, CfnRoutingControl>();

            for (int i = 0; i < props.AvailabilityZoneIds.Length; i++)
            {
                this.RoutingControlsPerAvailabilityZoneId.Add(props.AvailabilityZoneIds[i], new CfnRoutingControl(this, "AZ" + (i + 1), new CfnRoutingControlProps() {
                    ClusterArn = cluster.AttrClusterArn,
                    ControlPanelArn = cp.AttrControlPanelArn,
                    Name = props.AvailabilityZoneIds[i]
                }));
            }
                       
            CfnSafetyRule assertionRule = new CfnSafetyRule(this, "Assertion", new CfnSafetyRuleProps() {
                ControlPanelArn = cp.AttrControlPanelArn,
                Name = "AtMost1AZOff",
                AssertionRule = new AssertionRuleProperty() {
                    AssertedControls = this.RoutingControlsPerAvailabilityZoneId.Select(x => x.Value.Ref).ToArray(),
                    WaitPeriodMs = 5000
                },
                RuleConfig = new CfnSafetyRule.RuleConfigProperty() {
                    Inverted = false,
                    Threshold = 2,
                    Type = "ATLEAST"
                }
            });
        }
    }
}