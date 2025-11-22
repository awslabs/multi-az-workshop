// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as route53recoverycontrol from 'aws-cdk-lib/aws-route53recoverycontrol';
import { Construct } from 'constructs';

export interface ApplicationRecoveryControllerStackProps extends cdk.NestedStackProps {
  readonly availabilityZoneIds: string[];
}

export class ApplicationRecoveryControllerStack extends cdk.NestedStack {
  public readonly routingControlsPerAvailabilityZoneId: Record<string, route53recoverycontrol.CfnRoutingControl>;

  constructor(scope: Construct, id: string, props: ApplicationRecoveryControllerStackProps) {
    super(scope, id, props);

    const cluster = new route53recoverycontrol.CfnCluster(this, 'Cluster', {
      name: 'AZEvacuationCluster',
    });

    const cp = new route53recoverycontrol.CfnControlPanel(this, 'ControlPlane', {
      clusterArn: cluster.attrClusterArn,
      name: 'AZEvacuationControlPanel',
    });

    this.routingControlsPerAvailabilityZoneId = {};

    for (let i = 0; i < props.availabilityZoneIds.length; i++) {
      this.routingControlsPerAvailabilityZoneId[props.availabilityZoneIds[i]] = 
        new route53recoverycontrol.CfnRoutingControl(this, `AZ${i + 1}`, {
          clusterArn: cluster.attrClusterArn,
          controlPanelArn: cp.attrControlPanelArn,
          name: props.availabilityZoneIds[i],
        });
    }

    new route53recoverycontrol.CfnSafetyRule(this, 'Assertion', {
      controlPanelArn: cp.attrControlPanelArn,
      name: 'AtMost1AZOff',
      assertionRule: {
        assertedControls: Object.values(this.routingControlsPerAvailabilityZoneId).map(x => x.ref),
        waitPeriodMs: 5000,
      },
      ruleConfig: {
        inverted: false,
        threshold: 2,
        type: 'ATLEAST',
      },
    });
  }
}
