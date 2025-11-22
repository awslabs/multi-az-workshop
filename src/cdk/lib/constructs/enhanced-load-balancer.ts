// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

/**
 * Interface for enhanced load balancer with additional properties
 */
export interface IEnhancedLoadBalancerV2 extends elbv2.ILoadBalancerV2 {
  /**
   * Subnets the load balancer is deployed in
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * Availability zones the load balancer is deployed in
   */
  readonly availabilityZones: string[];

  /**
   * Name of the load balancer
   */
  readonly loadBalancerName: string;

  /**
   * Full name of the load balancer
   */
  readonly loadBalancerFullName: string;

  /**
   * ARN of the load balancer
   */
  readonly loadBalancerArn: string;
}

/**
 * Enhanced Network Load Balancer with additional subnet and AZ information
 */
export class EnhancedNetworkLoadBalancer extends elbv2.NetworkLoadBalancer implements IEnhancedLoadBalancerV2 {
  public readonly subnets: ec2.ISubnet[];
  public readonly availabilityZones: string[];

  constructor(scope: cdk.Stack, id: string, props: elbv2.NetworkLoadBalancerProps) {
    super(scope, id, props);

    const selectedSubnets = props.vpc.selectSubnets(props.vpcSubnets);
    this.subnets = selectedSubnets.subnets;
    this.availabilityZones = selectedSubnets.subnets.map((x) => x.availabilityZone);
  }
}

/**
 * Enhanced Application Load Balancer with additional subnet and AZ information
 */
export class EnhancedApplicationLoadBalancer
  extends elbv2.ApplicationLoadBalancer
  implements IEnhancedLoadBalancerV2, elbv2.IApplicationLoadBalancer
{
  public readonly subnets: ec2.ISubnet[];
  public readonly availabilityZones: string[];

  constructor(scope: cdk.Stack, id: string, props: elbv2.ApplicationLoadBalancerProps) {
    super(scope, id, props);

    const selectedSubnets = props.vpc.selectSubnets(props.vpcSubnets);
    this.subnets = selectedSubnets.subnets;
    this.availabilityZones = selectedSubnets.subnets.map((x) => x.availabilityZone);
  }
}
