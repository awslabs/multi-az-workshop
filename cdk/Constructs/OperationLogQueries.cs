// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CDK;
using Amazon.CDK.AWS.Logs;
using io.bamcis.cdk.MultiAZObservability;
using Constructs;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public interface IOperationLogQueriesProps
    {
        public ILogGroup[] LogGroups {get; set;}
        public IOperation Operation {get; set;}
        public string NameSuffix {get; set;}
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class OperationLogQueriesProps : IOperationLogQueriesProps
    {
        public ILogGroup[] LogGroups {get; set;}
        public IOperation Operation {get; set;}
        public string NameSuffix {get; set;}
        public string[] AvailabilityZoneIds {get; set;}
    }

    public class OperationLogQueries : Construct
    {
        public OperationLogQueries(Construct scope, string id, IOperationLogQueriesProps props) : base(scope, id)
        {
            QueryDefinition regionLogQuery = new QueryDefinition(this, props.Operation.OperationName + "RequestsLogQuery", new QueryDefinitionProps() {
                LogGroups = props.LogGroups,
                QueryDefinitionName = Fn.Ref("AWS::Region") + "-" + props.Operation.OperationName.ToLower() + "-requests" + props.NameSuffix,
                QueryString = new QueryString(new QueryStringProps() {
                    Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                    FilterStatements =  new string[] { $"Operation = \"{props.Operation.OperationName}\"" },
                    Limit = 1000,
                    Sort = "@timestamp"
                })
            });

            QueryDefinition regionHighLatencyLogQuery = new QueryDefinition(this, props.Operation.OperationName + "HighLatencyRequestsLogQuery", new QueryDefinitionProps() {
                LogGroups = props.LogGroups,
                QueryDefinitionName = Fn.Ref("AWS::Region") + "-" + props.Operation.OperationName + "-high-latency-requests" + props.NameSuffix,
                QueryString = new QueryString(new QueryStringProps() {
                    Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                    FilterStatements =  new string[] { $"Operation = \"{props.Operation.OperationName}\"", $"SuccessLatency > {props.Operation.ServerSideLatencyMetricDetails.SuccessAlarmThreshold}" },
                    Limit = 1000,
                    Sort = "@timestamp"
                })
            });

            QueryDefinition regionaFaultQuery = new QueryDefinition(this, props.Operation.OperationName + "FaultLogQuery", new QueryDefinitionProps() {
                    LogGroups = props.LogGroups,
                    QueryDefinitionName = Fn.Ref("AWS::Region") + "-" + props.Operation.OperationName + "-faults" + props.NameSuffix,
                    QueryString = new QueryString(new QueryStringProps() {
                        Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                        FilterStatements =  new string[] { $"Operation = \"{props.Operation.OperationName}\"", $"Fault = 1 or Failure = 1" },
                        Limit = 1000,
                        Sort = "@timestamp"
                    })
                });


            for (int i = 0; i < props.AvailabilityZoneIds.Length; i++)
            {
                string azId = props.AvailabilityZoneIds[i];
                
                QueryDefinition azLogQuery = new QueryDefinition(this, props.Operation.OperationName + "az" + i + "AZRequestsLogQuery", new QueryDefinitionProps() {
                    LogGroups = props.LogGroups,
                    QueryDefinitionName = azId + "-" + props.Operation.OperationName + "-requests" + props.NameSuffix,
                    QueryString = new QueryString(new QueryStringProps() {
                        Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                        FilterStatements =  new string[] { $"`AZ-ID` = \"{azId}\"", $"Operation = \"{props.Operation.OperationName}\"" },
                        Limit = 1000,
                        Sort = "@timestamp"
                    })
                });

                QueryDefinition azHighLatencyQuery = new QueryDefinition(this, props.Operation.OperationName + "az" + i + "HighLatencyLogQuery", new QueryDefinitionProps() {
                    LogGroups = props.LogGroups,
                    QueryDefinitionName = azId + "-" + props.Operation.OperationName + "-high-latency-requests" + props.NameSuffix,
                    QueryString = new QueryString(new QueryStringProps() {
                        Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                        FilterStatements =  new string[] { $"`AZ-ID` = \"{azId}\"", $"Operation = \"{props.Operation.OperationName}\"", $"SuccessLatency > {props.Operation.ServerSideLatencyMetricDetails.SuccessAlarmThreshold}" },
                        Limit = 1000,
                        Sort = "@timestamp"
                    })
                });

                QueryDefinition azFaultQuery = new QueryDefinition(this, props.Operation.OperationName + "az" + i + "FaultLogQuery", new QueryDefinitionProps() {
                    LogGroups = props.LogGroups,
                    QueryDefinitionName = azId + "-" + props.Operation.OperationName + "-faults" + props.NameSuffix,
                    QueryString = new QueryString(new QueryStringProps() {
                        Fields = new string[] { "RequestId", "SuccessLatency", "`AZ-ID`"},
                        FilterStatements =  new string[] { $"`AZ-ID` = \"{azId}\"", $"Operation = \"{props.Operation.OperationName}\"", $"Fault = 1 or Failure = 1" },
                        Limit = 1000,
                        Sort = "@timestamp"
                    })
                });
            }
        }
    }
}
