---
title : "Lab 3: Simulate infrastructure failure"
weight : 40
---

In this lab you will simulate a gray failure that impacts a single AZ. Then, you will review your operational metrics and alarms to see if you can identify which AZ is impacted.

## Simulate failure with a runbook

First, navigate to the [AWS Systems Manager console](https://console.aws.amazon.com/systems-manager/automation/execute#) for automation documents. 

::::alert{type="info" header="Check your AWS Region"}
The link may open the AWS SSM console in a different Region than the one you're running in the workshop, please validate you are in the correct Region.
::::

Select the tab *Owned by me*. There are several SSM documents here that will start FIS experiments to inject faults into the workshop environment. To test our new architecture, let's use the runbook with *`addLatency`* in the title.

![simulate-failure-runbook](/static/add-latency-runbook.png)

Click the *Execute automation* button on the top of the console. This will open a new tab with the automation document.

![execute-automation](/static/execute-automation.png)

On this page, do not update any of the default input parameters for *`LatencyExperiments`*. Click *Execute* on the bottom right of the page. This will randomly select an in use AZ to simulate the failure in. Execution may take up to a few minutes and should complete successfully.

![execute-automation-complete](/static/simulate-failure-runbook-completion.png)

## Observe the failure

Navigate back to the Wild Rydes service level dashboard we reviewed during [Lab 1](/lab-1). 

::::alert{type="info" header="Alarms take time to be triggered"}
The alarm may take up to 3 minutes to change state to `ALARM`. It is using an [M of N](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation) configuration, requiring 2 datapoints in 3 minutes. Making alarms that react quickly while not being overly sensitive to transient issues is a careful balance. Using a "2 of 3" or "3 of 5" configuration is common.
::::

While you wait, feel free to explore the other operational metrics dashboards. After a few minutes, you should see one of the zonal alarms transition to the `ALARM` state. 

![service-az-isolated-impact-alarm](/static/service-az-isolated-impact-alarm.png)

::::alert{type="info" header="Dashboard refresh"}
You may need to press the refresh button on the dashboard to see the updated metrics

![dashboard-refresh](/static/dashboard-refresh.png)
::::

In this case, the failure was simulated for the ```use2-az1``` AZ. Let's see if we can figure out what operation is causing impact. Scroll down to the server-side metrics section and review the latency metrics. In this instance, we can see the `Ride` operation has an elevated number of high latency responses as measured from the server-side.

![service-server-side-single-az-high-latency](/static/service-server-side-single-az-high-latency.png)

Now that we've pinpointed the impacted operation, let's check its dashboard to confirm the impact matches what we observed at the service level. Scroll back to the top of the service dashboard and open the `Ride` operation dashboard from the link there. The alarms here confirm what we saw on the service level dashboard. There's impact occuring, but it's scope is limited to a single AZ.

![ride-operation-alarms](/static/ride-operation-alarms.png)

Scroll down the dashboard and review the server-side metrics. You should be able to confirm how the additional latency is impacting the `Ride` operation. Next, let's scroll down to the canary metrics to see how this failure is impacting the customer experience for the `Ride` operation.

![ride-operation-canary-high-latency](/static/ride-operation-canary-high-latency.png)

This perspective reveals that the increased latency in `use2-az1` is also impacting the p99 latency all clients experience when accessing the service in `us-east-2` through the regional ALB endpoint. In fact, the canary alarms show that there's latency impact from testing both the zonal endpoint for `use2-az1` and the regional endpoint.

![ride-operation-canary-high-latency-alarms](/static/ride-operation-canary-high-latency-alarms.png)

This is to be expected. When accessing the service through the regional load balancer endpoint, requests are routed to each AZ the load balancer is deployed in, so 33% of those requests get sent to the impaired AZ. But our AZI implementation is preventing the faults from cascading into the other two AZs, which is what we wanted to achieve. We'll come back to these metrics after we mitigate the problem.

### Review composite alarm definition
Next, review the structure of the composite alarm that indicates we have isolated AZ impact. Go to the top of the dashboard and click on the alarm widget for the zonal isolated impact alarm and right click *`View details page`* to open it in a new tab.

![alarm-details](/static/alarm-details.png)

We can see that both the server-side and canary alarms are in the `ALARM` state, confirming that both perspectives see the impact of the failure. If you recall, one of the requirements for the server-side alarm to identify single AZ impact was to ensure more than one server was being impacted. Said another way, we want to ensure that the failure impact is seen broadly in that AZ. Otherwise, replacing a single bad instance is a more efficient mitigation strategy. The next section will explore that specific requirement.

### Look at Contributor Insights Data

Click the link for the *`<az>-ride-isolated-impact-alarm-server`* child alarm. In this composite alarm page, click the link for the *`<az>-ride-multiple-instances-high-latency-server`* child alarm. On this page, look at the *Math expression* in the alarm *Details* pane.

![insight-rule-metric-math](/static/insight-rule-metric-math.png)

The first parameter of the `INSIGHT_RULE_METRIC` CloudWatch metric math function is the name of a CloudWatch Contributor Insights rule. The name will be in the form `<az>-ride-per-instance-high-latency-server`. Note the name and navigate to the [Contributor Insights console](https://console.aws.amazon.com/cloudwatch/home#contributor-insights:rules) and open the rule of that name.

![contributor-insight-high-latency](/static/contributor-insights-high-latency.png)

::::alert{type="info" header="Graph Time Range"}
Depending on how much time has passed since you simulated the failure, you may want to decrease the displayed time range to 5 or 15 minutes to see more detail in the graph.
::::

This graph shows us that two instances started to return responses that exceed the defined latency threshold. This helps us know that the impact is more than a single instance. In fact, for this workshop, the impact is seen by every instance in the AZ. Feel free to examine the rule's definition. We are able to use Contributor Insights because the application is writing CloudWatch Logs using the [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html) (EMF). EMF provides a single approach for both producing structured logs as well as extracting custom CloudWatch metrics from those logs. This allows us to create CloudWatch dashboards and alarms on the embedded metric data as well as query the logs with tools like Contributor Insights and [Log Insights](https://console.aws.amazon.com/cloudwatch/home?#logsV2:logs-insights) in a single solution. You can use EMF with applications running on [EC2, ECS, EKS, and Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Generation_CloudWatch_Agent.html). Here's an example of the logs produced by the EKS pods in the Wild Rydes fleet.

```json
{
    "_aws": {
        "Timestamp": 1719073281270,
        "CloudWatchMetrics": [
            {
                "Namespace": "multi-az-workshop/frontend",
                "Metrics": [
                    {
                        "Name": "SuccessLatency",
                        "Unit": "Milliseconds"
                    },
                    {
                        "Name": "Success",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Fault",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Error",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Failure",
                        "Unit": "Count"
                    }
                ],
                "Dimensions": [
                    [
                        "Operation",
                        "Region",
                        "AZ-ID"
                    ],
                    [
                        "Operation",
                        "Region"
                    ]
                ]
            }
        ],
        "LogGroupName": "/multi-az-workshop/frontend"
    },
    "RequestId": "9aeb228b-5833-4c4a-90a2-b4efe86f9bdb",
    "InstanceId": "multi-az-workshop-app-7bfcb9657f-vhscl",
    "Ec2InstanceId": "i-0623c1307f7d06028",
    "AZ": "us-east-2a",
    "HttpStatusCode": 200,
    "Host": "us-east-2a.internal-multi--alb8a-ghkyzldbal7g-1689442580.us-east-2.elb.amazonaws.com",
    "SourceIp": "192.168.0.145",
    "XRayTraceId": "Self=1-6676fa01-2362a70c18704d6560ea5c7f;Root=1-6676f9f4-17945ac70e1cea2158bf253f;Parent=44dc880efaeade3c;Sampled=1;Lineage=00f48b1e:0",
    "TraceId": "00-e59bc76562570eda97f5f003edb009ad-aa6c83f6b69ded41-00",
    "Path": "/home",
    "OneBox": false,
    "Operation": "Home",
    "Region": "us-east-2",
    "AZ-ID": "use2-az1",
    "LogGroupName": "/multi-az-workshop/frontend",
    "SuccessLatency": 18,
    "Success": 1,
    "Fault": 0,
    "Error": 0,
    "Failure": 0
}
```

# Conclusion
After simulating the zonal failure, we can see that the changes you made to the Wild Rydes architecture correctly isolates the scope of impact to a single AZ. Our alarms were also able to detect the impact and correctly identified that the AZ was an outlier for latency and was being caused by more than one instance. In the next lab we will start to take action to mitigate the impact to customers.
