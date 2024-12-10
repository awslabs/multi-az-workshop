// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.EC2;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface IDatabaseStackProps : INestedStackProps
    {
        public IVpcIpV6 Vpc {get; set;}
    }

    public class DatabaseStackProps : NestedStackProps, IDatabaseStackProps
    {
         public IVpcIpV6 Vpc {get; set;}
    }

    public class DatabaseStack : NestedStack
    {       
        public DatabaseCluster Database {get;}

        public DatabaseStack(Stack scope, string id, IDatabaseStackProps props) : base(scope, id, props)
        {
            this.Database = new DatabaseCluster(this, "database", new DatabaseClusterProps() {
                Vpc = props.Vpc,
                VpcSubnets = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED },
                Engine = DatabaseClusterEngine.AuroraPostgres(new AuroraPostgresClusterEngineProps() {
                    Version = AuroraPostgresEngineVersion.VER_16_1
                }),
                Writer = ClusterInstance.Provisioned("writer", new ProvisionedClusterInstanceProps() {
                    InstanceType = Amazon.CDK.AWS.EC2.InstanceType.Of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MEDIUM),
                    PubliclyAccessible = false
                }),
                DefaultDatabaseName = "workshop",
                RemovalPolicy = RemovalPolicy.DESTROY
            });

            this.Database.Connections.AllowFrom(new Amazon.CDK.AWS.EC2.Connections_(new Amazon.CDK.AWS.EC2.ConnectionsProps() {
                Peer = Peer.Ipv4(props.Vpc.VpcCidrBlock)
            }), Port.Tcp(5432));
        }
    }
}