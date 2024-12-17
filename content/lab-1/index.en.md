---
title : "Lab 1: Review operational metrics dashboards"
weight : 20
---

Welcome to your workshop service, Wild Rydes! Wild Rydes allows you to request, monitor, and pay for unicorn rides. 

![wild-rydes](/static/wild-rydes.png)

You may have worked with the service before in our [serverless API workshop](https://aws.amazon.com/getting-started/hands-on/build-serverless-web-app-lambda-apigateway-s3-dynamodb-cognito/). In this workshop, we've adapted it to demonstrate using AWS Availability Zones (AZ) for resilience. Before Wild Rydes became serverless, the service started as a completely Amazon EC2 based monolithic application with an Amazon Aurora database. Over time, you've started to modernize the service and have moved several APIs to EKS using the [strangler pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html). This means some of the APIs are still being run on EC2 while others are being run on EKS. Let's review the service's current architecture.

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

In this lab we'll review the operational metrics being produced by the Wild Rydes service. First, navigate to the [Amazon CloudWatch console](https://console.aws.amazon.com/cloudwatch/home).

From here, select the [Dashboards](https://console.aws.amazon.com/cloudwatch/home?#dashboards:) navigation option on the left side of the console. You should see five dashboards, one for each operation in the Wild Rydes service (`Home`, `Signin`, `Pay`, `Ride`) and then a roll-up dashboard for the whole service. 

![dashboards](/static/dashboards.png)

Let's explore the service level dashboard first, click the dashboard for *`wildrydes-service-availability-and-latency-<region>`*. 

::::alert{type="info" header="Region selection"}
In this workshop, `<region>` is used as a placeholder for the actual AWS Region where the workshop is running. The same is done for `<az>` when used to indicate the Availability Zone (AZ) where impact is occuring. Please look for the appropriate resource names based on that Region or AZ.
::::

::::alert{type="info" header="Metric population"}
You may need to wait for 10 to 15 minutes for metric data to populate in the dashboards if the CloudFormation templates have just been deployed. 
::::

## Service availability and latency dashboard
This dashboard provides an aggregate view of all of the critical operations that make up the service. At the top there is the service's regional alarm. This is configured to count the total number of faults on the server-side across all Availability Zones. If the total number of faults exceeds a threshold that alarm is triggered. The alarm just tells us there's a problem somewhere in the Region, it doesn't indicate whether it's confined to a single AZ or not. Below that are the composite alarms for isolated AZ impact across all critical operations. These alarms fire if one or more critical operations sees isolated impact in a single AZ. It's possible one operation, say `Signin`, sees impact in `us-east-1a` while another operation, say `Ride`, sees impact in `us-east-1b`. So it's possible for two or more of these to be in alarm; if they are, it is indicative that the impact is regional, not zonal.

::::alert{type="info" header="Region"}
When you open the AWS console for the workshop and any new tabs, make sure you are in the correct Region if a resource appears to be missing or you receive a permissions error.
::::

![service-top-level-alarms](/static/service-top-level-alarms.png)

Following the alarms you'll see different graphs to a number of metrics. The next graph shows AZ contributors to fault count. It helps us understand the total number of faults across all critical operations each AZ is producing.

![service-az-fault-contributors](/static/service-az-fault-contributors.png)

::::alert{type="info" header="Dashboards"}
Your dashboards may not look exactly like the dashboards shown here, that's ok. Some are shown with faults or latency present to be representative of the information provided by the dashboard. You may also see transient "blips" on your dashboards where an error or high latency response occured.
::::

Next, you'll see graphs for availability as measured on both the server-side and by [synthetic canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html). Synthetic canaries perform the same actions as a customer, which makes it possible to continuously verify your customer experience and discover issues before your customers do.

![service-server-availability-graphs](/static/service-server-availability-graphs.png)

![service-canary-availability-graphs](/static/service-canary-availability-graphs.png)

Finally, you'll see graphs for latency, again as measured by the server-side and by synthetic canaries. Because each operation has a different latency threshold, these graphs are measuring the count of successful, but high latency responses to requests.

![service-latency-graphs](/static/service-latency-graphs.png)

These alarms and widgets help simplify the triage and troubleshooting process when something goes wrong. They can help you identify which operation is seeing impact and potentially where. That may lead you to look at one of the operation specific dashboards to get more details about what's happening. Let's go back to the Dashboards home page and look at an operation dashboard for the `Ride` operation, *`wildrydes-ride-operation-availability-and-latency-<region>`*.

## Per operation dashboards
Each operation in the service has its own dashboard. They provide operation-specific details about its availability and latency as measured from both the server-side and with synthetic canaries. It has a similar layout to the service-level dashboard. At the top are the regional and zonal alarms, followed by graphs showing contributors to faults and latency, availability and latency metrics measured from the server-side and canary-side, as well as operational metrics for the ALB being used in the service.

### Operation alarms
The regional alarm indicates that there is a problem happening in that Region, but not necessarily across multiple AZs. Below it are the zonal isolated impact alarms that do indicate when an Availability Zone shows isolated impact. 

![ride-dashboard-agg-alarms](/static/ride-dashboard-agg-alarms.png)

Let's look at one of the zonal isolated impact alarms by clicking on the widget and then selecting *View details page* (you may want to open it in a new tab).

You'll see that this isolated impact alarm is a CloudWatch composite alarm with 2 child alarms, one for the server-side and one for the canary-side. This means that if we see isolated impact from either perspective, this alarm will trigger.

![operation-isolated-impact-alarm](/static/operation-isolated-impact-alarm.png)

If you drill down into one of those child alarms, let's pick the *`-server`* alarm, you'll see that it is also a CloudWatch composite alarm, but this time it is composed of 6 other alarms.

![operation-server-isolated-impact-alarm](/static/operation-server-isolated-impact-alarm.png)

You can view the *Alarm rule* to see how this alarm is put together.

```
(
    (
        ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-chi-squared-majority-errors-impact-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-success-rate-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-multiple-instances-faults-server")
    ) 
OR 
    (
        ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-chi-squared-majority-high-latency-impact-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-success-latency-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-multiple-instances-high-latency-server")
    )
)
```

To consider the AZ to have isolated impact (meaning no other AZ that the operation is using is seeing impact this badly), three things must be true for either availability or latency impact:

1. The impact must cross a threshold, like availability drops below 99.9% or latency rises above 200ms.
2. There is more than one instance causing the impact so that we know one bad instance doesn't make the whole AZ to appear impaired.
3. The quantity of errors or high latency responses make this AZ an outlier as compared to the other AZs. There are several different statistics tests that can be used to determine this (for example chi-squared and z-score), but for the workshop, we're using a static metric of 70%, meaning an AZ must account for 70% of the errors to be considered an outlier, which also works very reliably.

### Operation metrics
The rest of the dashboard contains graph widgets and associated alarms for availability and latency metrics. We will use these to determine if there is zonally isolated impact that we can mitigate using multi-AZ resilience patterns. Feel free to explore the dashboard and the alarms to see how these metrics are generated.

## Additional information on canaries and automating observability (optional reading)
The following sections provide additional details about the synthetic canaries and how this observability was built through automation with the [Cloud Development Kit (CDK)](https://aws.amazon.com/cdk/).

### Canaries
If you'd like to see how the canaries are configured, you can go to the [AWS Lambda console](https://console.aws.amazon.com/lambda/home#/functions). Look for the function with a name similar to *`multi-az-workshop-MultiAZ-CanaryFunctioncanary...`*. The code package is too large to examine in the console, but if you'd like to explore it, you can download it. 

::::expand{header="Instructions for downloading canary source code" variant="container"}
Go to the [CloudFormation console](https://console.aws.amazon.com/cloudformation/home#/stacks?filteringText=&filteringStatus=active&viewNested=true) and then click on the stack named like *`multi-az-workshop-MultiAZObservabilityStack-MultiAZObservabilityCanaryNestedStackCanar-...`* and click on it. Click the *`Template`* tab at the top to see the CloudFormation template used to deploy the Lambda function. Scroll down until you see the `AWS::Lambda::Function` resource.

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
    "url": "http://us-east-1a.internal-multi--ALBAE-ypBbnB8gs0tP-1311357276.us-east-1.elb.amazonaws.com/home",
    "postData": "",
    "headers": {},
    "operation": "Home",
    "faultBoundaryId": "use1-az2",
    "faultBoundary": "az",
    "metricNamespace": "canary/metrics",
    "requestCount": 60
  }
}
```

The event is scheduled to run every minute. It issues 60 HTTP requests to the url indicated in the event. The rest of the data tells the function how to record its metrics, like which AZ it is testing, what operation is being tested, and what metric namespace the metrics should be produced in. Let's go to the [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups) being produced by the function. Look for a log group named like *`/aws/lambda/multi-az-workshop-MultiAZ-CanaryFunctioncanary...`* (it may not be on the first page). Click on the log group and then into any one of the available log streams. You should find numerous entries like this:

![canary-log](/static/canary-log.png)

The canary is recording metrics using the [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html) (EMF). EMF provides a single approach for both producing structured logs as well as extracting custom CloudWatch metrics from those logs. This allows us to create CloudWatch dashboards and alarms on the embedded metric data as well as query the logs with tools like Contributor Insights in a single solution. You'll see how the server-side also produces logs like this in Lab 3.

### Simplifying observability
If the alarms, metrics, and dashboards feel a little complicated to setup and build yourself, that's because they are. There is a lot of available information to think through and combine to provide signals about single-AZ impact. To simplify the setup and use reasonable defaults, this workshop uses an open-source CDK construct (available in TypeScript, Go, Python, and .NET [Java coming soon]) to simplify setting up the necessary observability. To use the CDK construct, you define your service like this:

```csharp
var wildRydesService = new Service(new ServiceProps(){
    ServiceName = "WildRydes",
    BaseUrl = "http://www.example.com",
    FaultCountThreshold = 25,
    AvailabilityZoneNames = vpc.AvailabilityZones,
    Period = Duration.Seconds(60),
    LoadBalancer = loadBalancer,
    DefaultAvailabilityMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps() {
        AlarmStatistic = "Sum",
        DatapointsToAlarm = 3,
        EvaluationPeriods = 5,
        FaultAlarmThreshold = 1,
        FaultMetricNames = new string[] { "Fault", "Error" },
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
This creates the metrics, alarms, and dashboards used in this workshop. You define some characteristics of service, default values for metrics and alarms, and then add operations as well as any overrides for default values that you need. The construct can also automatically create synthetic canaries that test each operation with a very simple HTTP check, or you can configure your own synthetics and just tell the construct about the metric details and optionally log files. 

If you don't have service specific logs and custom metrics with per-AZ dimensions, you can still use the construct to evaluate ALB and NAT Gateway metrics to find single AZ faults.

```csharp
BasicServiceMultiAZObservability multiAvailabilityZoneObservability = new BasicServiceMultiAZObservability(this, "MultiAZObservability", new BasicServiceMultiAZObservabilityProps() {
    ApplicationLoadBalancers = new IApplicationLoadBalancer[] { loadBalancer },
    NatGateways = new Dictionary<string, CfnNatGateway>() {
        { "us-east-1a", natGateway1},
        { "us-east-1b", natGateway2},
        { "us-east-1c", natGateway3},
    },
    CreateDashboard = true,
    OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC,
    FaultCountPercentageThreshold = 1.0, // The fault rate to alarm on for errors seen from the ALBs in the same AZ
    PacketLossImpactPercentageThreshold = 0.01, // The percentage of packet loss to alarm on for the NAT Gateways in the same AZ
    ServiceName = "WildRydes",
    Period = Duration.Seconds(60), // The period for metric evaluation
    Interval = Duration.Minutes(60) // The interval for the dashboards
    EvaluationPeriods = 5,
    DatapointsToAlarm = 3
});
```

Both options support running workloads on EC2, ECS, Lambda, and EKS. To learn more about using the construct visit the [github repo](https://github.com/cdklabs/cdk-multi-az-observability).

## Conclusion
We've examined the observability available to us in the Wild Rydes service to detect single-AZ impairments. In the next lab we're going to update Wild Rydes' architecture so that we can effectively use AZs as fault boundaries that contain impact to a single AZ.
