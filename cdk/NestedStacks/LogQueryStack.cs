// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.Logs;
using Amazon.AWSLabs.MultiAZWorkshop.Constructs;
using Cdklabs.MultiAZObservability;
//using io.bamcis.cdk.MultiAZObservability;

namespace Amazon.AWSLabs.MultiAZWorkshop.NestedStacks
{
    public interface ILogQueryStackProps : INestedStackProps
    {
        public ILogGroup ServerSideLogGroup {get; set;}
        public ILogGroup CanaryLogGroup {get; set;}
        public IService Service {get; set;}
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class LogQueryStackProps : NestedStackProps, ILogQueryStackProps
    {
        public ILogGroup ServerSideLogGroup {get; set;}
        public ILogGroup CanaryLogGroup {get; set;}
        public IService Service {get; set;}
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class LogQueryStack : NestedStack
    {
        public LogQueryStack(Stack scope, string id, ILogQueryStackProps props) : base(scope, id, props)
        {
            foreach (IOperation operation in props.Service.Operations)
            {
                new OperationLogQueries(this, operation.OperationName + "ServerLogQueries", new OperationLogQueriesProps() {
                    LogGroups = new ILogGroup[] { props.ServerSideLogGroup },
                    Operation = operation,
                    NameSuffix = "-server",
                    AvailabilityZoneIds = props.AvailabilityZoneIds
                });

                if (props.CanaryLogGroup != null)
                {
                    new OperationLogQueries(this, operation.OperationName + "CanaryLogQueries", new OperationLogQueriesProps() {
                        LogGroups = new ILogGroup[] { props.CanaryLogGroup },
                        Operation = operation,
                        NameSuffix = "-canary",
                        AvailabilityZoneIds = props.AvailabilityZoneIds
                    });
                }
            }
        }
    }
}
