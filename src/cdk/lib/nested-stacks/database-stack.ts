// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { IVpcIpV6 } from '../constructs/vpc-ipv6-construct';

/**
 * Props for Database Stack
 */
export interface DatabaseStackProps extends cdk.NestedStackProps {
  /**
   * VPC where the database will be deployed
   */
  readonly vpc: IVpcIpV6;
}

/**
 * Nested stack that creates an Aurora PostgreSQL database cluster
 */
export class DatabaseStack extends cdk.NestedStack {
  /**
   * The Aurora database cluster
   */
  public readonly database: rds.DatabaseCluster;

  constructor(scope: cdk.Stack, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Create Aurora PostgreSQL database cluster
    this.database = new rds.DatabaseCluster(this, 'database', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
        publiclyAccessible: false,
      }),
      defaultDatabaseName: 'workshop',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Allow connections from VPC CIDR
    this.database.connections.allowFrom(
      new ec2.Connections({
        peer: ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      }),
      ec2.Port.tcp(5432),
    );
  }
}
