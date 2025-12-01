---
title : "Lab 1: Review operational metrics dashboards"
weight : 20
---

Welcome to Wild Rydes! Wild Rydes is a web application that allows you to request, track, and pay for unicorn rides! 

![wild-rydes](/static/wild-rydes.png)

You may have worked with the application before in our [serverless API workshop](https://aws.amazon.com/getting-started/hands-on/build-serverless-web-app-lambda-apigateway-s3-dynamodb-cognito/). In this workshop, we've adapted it to demonstrate using AWS Availability Zones (AZ) for resilience. Before Wild Rydes became serverless, the application started as a completely Amazon EC2 based monolithic application with an Amazon Aurora database. Over time, you've started to modernize the service and have moved several APIs to EKS using the [strangler pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html). This means some of the APIs are still being run on EC2 while others are being run on EKS. Let's review the application's current architecture.

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

In this lab we'll review the operational metrics being produced by the Wild Rydes application. First, navigate to the [Amazon CloudWatch console](https://console.aws.amazon.com/cloudwatch/home).

::::alert{type="info" header="Region"}
When you open the AWS console for the workshop and any new tabs, make sure you are in the correct Region if a resource appears to be missing or you receive a permissions error.
::::

From here, select the [Dashboards](https://console.aws.amazon.com/cloudwatch/home?#dashboards:) navigation option on the left side of the console. You should see six dashboards, one for each operation in the Wild Rydes application (`Home`, `Signin`, `Pay`, `Ride`), a roll-up dashboard for the whole service, and a dashboard specific to AZ health monitoring. 

![dashboards](/static/dashboards.png)

Let's explore the service level dashboard first, click the dashboard for *`wildrydes-availability-and-latency-<region>`*. 

::::alert{type="info" header="Region selection"}
In this workshop, `<region>` is used as a placeholder for the actual AWS Region where the workshop is running. The same is done for `<az>` when used to indicate the Availability Zone (AZ) where impact is occuring. Please look for the appropriate resource names based on that Region or AZ.
::::

## Service availability and latency dashboard
This dashboard provides an aggregate view of all of the critical operations that make up the Wild Rydes service. The top of the dashboard contains a number of alarms. The top left is an aggregate alarm for any zonal or regional impact in the service's critical operations. The next is an alarm indicating if there is regional impact, and then alarms to indicate whether this impact is being seen by the synthetic canaries, the server-side, or both. Below those alarms are alarms per AZ. The top row of zonal alarms are triggered by input from either the canaries or the server-side. The row below contains alarms that are only triggered by the server side. Later in this workshop, we'll deploy changes to a single AZ and see how these alarms can be useful for identifying when impact may be caused by something like a deployment where capacity in an AZ is intentionally taken out of services. Finally, there are links to dashboards for each of the critical operations in the Wild Rydes service.

![service-top-level-alarms](/static/service-top-level-alarms.png)

Following the alarms you'll see different graphs to a number of metrics. The first section is server-side availability, latency, and request count metrics. The top row contains availability metrics for each critical API in each AZ and then a request count per AZ. Below that, graphs measure the overall fault count in each AZ and then fault count per operation in each AZ.

::::alert{type="info" header="Metric population"}
You may need to wait for 10 to 15 minutes for metric data to populate in the dashboards if the CloudFormation templates have just been deployed. 
::::

![service-server-availability-graphs](/static/service-server-availability-graphs.png)

Next, there are similar graphs for latency in each AZ. The top row measures [`p99`](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Statistics-definitions.html) latency for each operation in each AZ as well as annotations for the average and max. The second row measures the number of requests for each operation that exceeded their threshold for latency.

![service-server-latency-graphs](/static/service-server-latency-graphs.png)

::::alert{type="info" header="Dashboards"}
Your dashboards may not look exactly like the dashboards shown here, that's ok. You may see transient "blips" on your dashboards where an error or high latency response occured.
::::

Next you'll see the same availability and latency graphs, but as measured by [synthetic canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html). Synthetic canaries (commonly referred to as just "canaries" in this workshop) serve as an early warning and detection system (like a canary in a coal mine), so you can become aware of problems in your application before your customers do. Finally, you'll see a section for load balancer metrics for your [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html). We'll see later how we can use both metrics generated from custom instrumentation as well as native ELB metrics to detect single AZ impairments.

![service-load-balancer-graphs](/static/service-load-balancer-graphs.png)

These alarms and widgets help simplify the triage and troubleshooting process when something goes wrong. They can help you identify which operation is seeing impact and potentially where. That may lead you to look at one of the operation specific dashboards to get more details about what's happening. Go back to the top of the service dashboard and click the link for the `Ride` operation, *`wildrydes-ride-availability-and-latency-<region>`*.

## Per operation dashboards
Each operation in the service has its own dashboard. They provide operation-specific details about its availability and latency as measured from both the server-side and with canaries. 

#### Alarms
At the top are the regional and zonal alarms. These will indicate the scope of impact, zonal or regional, for this particular operation.

![ride-dashboard-agg-alarms](/static/ride-dashboard-agg-alarms.png)

Let's look at one of the zonal isolated impact alarms by clicking on the widget and then selecting *View details page* (you may want to right-click and open it in a new tab).

You'll see that this isolated impact alarm is a [CloudWatch composite alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html) with 2 child alarms, one evaluating server-side metrics and one evaluating canary metrics. This means that if we see isolated impact from either perspective, this alarm will trigger.

![operation-isolated-impact-alarm](/static/operation-isolated-impact-alarm.png)

If you drill down into one of those child alarms, let's pick the *`-server`* alarm, you'll see that it is also a CloudWatch composite alarm, but this time it is composed of 6 other alarms.

![operation-server-isolated-impact-alarm](/static/operation-server-isolated-impact-alarm.png)

You can view the *Alarm rule* to see how this alarm is put together.

```
(
    (
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-static-majority-errors-impact-server") AND
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-success-rate-server") AND 
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-multiple-instances-faults-server")
    ) 
OR 
    (
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-static-high-latency-impact-server") AND 
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-success-latency-server") AND 
        ALARM("arn:aws:cloudwatch:us-east-2:123456789012:alarm:use2-az1-ride-multiple-instances-high-latency-server")
    )
)
```

To consider the AZ to have isolated impact (meaning no other AZ that the operation is using is seeing impact as significantly), three things must be true for either availability or latency impact:

1. The impact must be sustained and cross a threshold, like availability drops below 99.9% or p99 latency rises above 200ms for 3 datapoints in 5 minutes. We don't want a single error or single high latency request to make the AZ appear to be unhealthy.
2. More than one instance is experiencing the impact, we don't want a single bad host to make the whole AZ appear impaired.
3. The quantity of errors or high latency responses make this AZ an outlier compared to the other AZs. 

::::alert{type="warning" header="Ensuring even distribution"}
This approach makes one major assumption, that each AZ is processing similar amounts of load. The workshop is designed with 2 EC2 instances and 2 EKS pods in each AZ with cross-zone load balancing disabled. This ensures that each AZ receives 33% of the traffic. With cross-zone load balancing enabled, each target, regardless of its AZ, receives the same amount of traffic. In this configuration, you could have an imbalance like 4 EC2 instances in one zone, and 1 in each of the other zones. If the AZ impairment affects the zone with just 1 instance in it, it may not handle enough load to make the AZ appear to be an outlier. 
::::

Outlier detection is typically the most complicated part of this pattern. There are several different statistics tests that can be used to find outliers this including [chi-squared](https://en.wikipedia.org/wiki/Chi-squared_test), [z-score](https://en.wikipedia.org/wiki/Standard_score), [median absolute deviation (MAD)](https://en.wikipedia.org/wiki/Median_absolute_deviation), and [interquartile range (IQR)](https://en.wikipedia.org/wiki/Interquartile_range), but for the workshop, we're using a static value of 70%, meaning an AZ must account for 70% of the errors or high latency requests to be considered an outlier, which also works very reliably.

#### Metrics
The rest of the dashboard contains graph widgets and associated alarms for availability and latency metrics. We will use these to determine if there is zonally isolated impact that we can mitigate using multi-AZ resilience patterns. Feel free to explore the dashboard and the alarms to see how these metrics are generated.

## Additional information on canaries and automating observability (optional reading)
The following sections provide additional details about the synthetic canaries and how this observability was built through automation with the [Cloud Development Kit (CDK)](https://aws.amazon.com/cdk/).

#### Canaries
If you'd like to see how the canaries are configured, you can go to the [AWS Lambda console](https://console.aws.amazon.com/lambda/home#/functions). Look for the function with a name similar to *`multi-az-workshop-multiaz-CanaryFunctioncanary...`*. The code package is too large to examine in the console, but if you'd like to explore it, you can download it. 

::::expand{header="Instructions for downloading canary source code" variant="container"}
Go to the [CloudFormation console](https://console.aws.amazon.com/cloudformation/home#/stacks?filteringText=&filteringStatus=active&viewNested=true) and then click on the stack named like *`multi-az-workshop-multiazobservabilityNeste-instrumentedserviceCanaryNestedStackCanary-...`* and click on it. Click the *`Template`* tab at the top to see the CloudFormation template used to deploy the Lambda function. Scroll down until you see the `AWS::Lambda::Function` resource.

![lambda-function-template](/static/lambda-function-template.png)

Copy the name of the zip file that comes after `${AssetsBucketPrefix}`. Join it with this [link](:assetUrl{path=/ source=s3}) (right-click and copy link). You should have a URL that looks like the following:
```bash
https://static.us-east-1.prod.workshops.aws/public/e700b077-7827-4455-a820-f4d545aa2712/assets/53099e290b0e54b00026ca7fa3c848a2ac701e1db20b01b5b4fec5bd1ce60a58.zip
```

The main code is in the `index.py` file.
::::

You can see the function is triggered by a number of different EventBridge events. Click on the highlighted box to see all of the events. 

![lambda-triggers](/static/lambda-triggers.png)

Click on one of the events to see its definition. Once the new tab opens, click the *`Targets`* tab and then *`View`* next to *`Input to target:`*.

![target-input](/static/target-input.png)

You'll see the input that will look similar to the following:

```json
{
  "parameters": {
    "methods": ["GET"],
    "url": "http://us-east-2a.internal-multi--ALBAE-ypBbnB8gs0tP-1311357276.us-east-2.elb.amazonaws.com/home",
    "postData": "",
    "headers": {},
    "operation": "Home",
    "faultBoundaryId": "use2-az1",
    "faultBoundary": "az",
    "metricNamespace": "canary/metrics",
    "requestCount": 60
  }
}
```

The event is scheduled to run every minute. It issues 60 HTTP requests to the url indicated in the event. The rest of the data tells the function how to record its metrics, like which AZ it is testing, what operation is being tested, and what metric namespace the metrics should be produced in. Let's go to the [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups) being produced by the function. Look for a log group named like *`/aws/lambda/multi-az-workshop-multiaz-CanaryFunctioncanary...`* (it may not be on the first page). Click on the log group and then into any one of the available log streams. You should find numerous entries like this:

![canary-log](/static/canary-log.png)

The canary is recording metrics using the [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html) (EMF). EMF provides a single approach for both producing structured logs as well as extracting custom CloudWatch metrics from those logs. This allows us to create CloudWatch dashboards and alarms on the embedded metric data as well as query the logs with tools like [Contributor Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContributorInsights.html) and [Log Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html) in a single solution. You'll see how the server-side also produces logs like this in Lab 3.

#### Simplifying observability
If the alarms, metrics, and dashboards feel a little complicated to setup and build yourself, that's because they can be. There is a lot of available information to think through and combine to provide signals about single-AZ impact. To simplify the setup and use reasonable defaults, this workshop uses an open-source CDK construct (available in TypeScript, Go, Python, Java, and .NET) to simplify setting up the necessary observability. To use the CDK construct, you define your service like this:

```csharp
var wildRydesService = new Service(new ServiceProps(){
    ServiceName = "WildRydes",
    BaseUrl = "http://www.example.com",
    FaultCountThreshold = 25,
    AvailabilityZoneNames = vpc.AvailabilityZones,
    Period = Duration.Seconds(60),
    LoadBalancer = loadBalancer,
    TargetGroups = [ ec2TargetGroup, eksTargetGroup ],
    DefaultAvailabilityMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps() {
        AlarmStatistic = "Sum",
        DatapointsToAlarm = 3,
        EvaluationPeriods = 5,
        FaultAlarmThreshold = 1,
        FaultMetricNames = new string[] { "Fault" },
        GraphedFaultStatistics = new string[] { "Sum" },
        GraphedSuccessStatistics = new string[] { "Sum" },
        MetricNamespace = metricsNamespace,
        Period = Duration.Seconds(60),
        SuccessAlarmThreshold = 99,
        SuccessMetricNames = new string[] {"Success"},
        Unit = Unit.COUNT,
    }),
    DefaultLatencyMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps(){
        AlarmStatistic = "p99",
        DatapointsToAlarm = 3,
        EvaluationPeriods = 5,
        FaultAlarmThreshold = 1,
        FaultMetricNames = new string[] { "FaultLatency" },
        GraphedFaultStatistics = new string[] { "p50" },
        GraphedSuccessStatistics = new string[] { "p50", "p99", "tm50", "tm99" },
        MetricNamespace = metricsNamespace,
        Period = Duration.Seconds(60),
        SuccessAlarmThreshold = 100,
        SuccessMetricNames = new string[] {"SuccessLatency"},
        Unit = Unit.MILLISECONDS,
    }),
    DefaultContributorInsightRuleDetails =  new ContributorInsightRuleDetails(new ContributorInsightRuleDetailsProps() {
        AvailabilityZoneIdJsonPath = azIdJsonPath,
        FaultMetricJsonPath = faultMetricJsonPath,
        InstanceIdJsonPath = instanceIdJsonPath,
        LogGroups = serverLogGroups,
        OperationNameJsonPath = operationNameJsonPath,
        SuccessLatencyMetricJsonPath = successLatencyMetricJsonPath
    }),
    CanaryTestProps = new AddCanaryTestProps() {
        RequestCount = 10,
        LoadBalancer = loadBalancer,
        Schedule = "rate(1 minute)",
        NetworkConfiguration = new NetworkConfigurationProps() {
            Vpc = vpc,
            SubnetSelection = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED }
        }
    }
});
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Signin",
    Path = "/signin",
    Service = wildRydesService,
    Critical = true,
    HttpMethods = new string[] { "GET" },
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Signin",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Signin",
        SuccessAlarmThreshold = 150,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 250
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Pay",
    Path = "/pay",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Pay",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Pay",
        SuccessAlarmThreshold = 200,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 300
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Ride",
    Path = "/ride",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Ride",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Ride",
        SuccessAlarmThreshold = 350,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 550
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Home",
    Path = "/home",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Home",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Home",
        SuccessAlarmThreshold = 100,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 200
    })
}));
```

Then you provide that service definition to the CDK construct.

```csharp
InstrumentedServiceMultiAZObservability multiAvailabilityZoneObservability = new InstrumentedServiceMultiAZObservability(this, "MultiAZObservability", new InstrumentedServiceMultiAZObservabilityProps() {
    Service = wildRydesService,
    CreateDashboards = true,
    Interval = Duration.Minutes(60), // The interval for the dashboard
    OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC
});
```
This creates the metrics, alarms, canary functions, and dashboards used in this workshop. You define the characteristics of the service, default values for metrics and alarms, and then add operations as well as any overrides for default values that you need. The construct can also automatically create synthetic canaries that test each operation with a very simple HTTP check, or you can configure your own synthetics and just tell the construct about the metric details and optionally log files. 

If you don't have service specific logs and custom metrics with per-AZ dimensions, you can still use the construct to evaluate ALB and/or NAT Gateway metrics to find single AZ impairments.

```csharp
BasicServiceMultiAZObservability multiAvailabilityZoneObservability = new BasicServiceMultiAZObservability(this, "MultiAZObservability", new BasicServiceMultiAZObservabilityProps() {
    ApplicationLoadBalancerProps = new ApplicationLoadBalancerDetectionProps() {
        AlbTargetGroupMap = [
            new AlbTargetGroupMap() {
                ApplicationLoadBalancer = this.LoadBalancer,
                TargetGroups = [
                    targetGroup1,
                    targetGroup2
                ]
            }
        ],
        LatencyStatistic = Stats.Percentile(99),
        FaultCountPercentThreshold = 1,
        LatencyThreshold = Duration.Millis(500)
    },
    NatGatewayProps = new NatGatewayDetectionProps() {
        natGateways = new Dictionary<string, CfnNatGateway>() {
            {"us-east-2a", natGateway1},
            {"us-east-2b", natGateway2},
            {"us-east-2c", natGateway3}
        },
        packetLossPercentThreshold: 0.01
    },
    CreateDashboard = true,
    DatapointsToAlarm = 2,
    EvaluationPeriods = 3,
    ServiceName = "WildRydes",
    Period = Duration.Seconds(60),
    Interval = Duration.Minutes(60),          
});
```

Both options support running workloads on EC2, ECS, Lambda, and EKS. To learn more about using the construct visit the [CDK Multi-AZ Observability github repo](https://github.com/cdklabs/cdk-multi-az-observability).

## Conclusion
We've examined the observability available to us in the Wild Rydes application to detect single-AZ impairments. In the next lab we're going to update the Wild Rydes's architecture so that we can effectively use AZs as fault boundaries that limit impact to a single AZ when it occurs.
