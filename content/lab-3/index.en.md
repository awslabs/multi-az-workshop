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

Select the tab *Owned by me*. We're going to re-run the *`addLatency`* experiment, select that document.

![simulate-failure-runbook](/static/add-latency-runbook.png)

Click the *Execute automation* button on the top of the console. This will open a new tab with the automation document.

![execute-automation](/static/execute-automation.png)

On this page, do not update any of the default input parameters for *`LatencyExperiments`*. Click *Execute* on the bottom right of the page. This will randomly select an in use AZ to simulate the failure in. Execution may take up to a few minutes and should complete successfully.

![execute-automation-complete](/static/simulate-failure-runbook-completion.png)

## Observe the failure

Navigate back to the Wild Rydes service level dashboard we reviewed during [Lab 1](/lab-1). 

::::alert{type="info" header="Alarms take time to be triggered"}
Alarms may take up to 3 minutes to change state to `ALARM`. It is using an [M of N](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation) configuration, requiring 2 datapoints in 3 minutes. Making alarms that react quickly while not being overly sensitive to transient issues is a careful balance. Using a "2 of 3" or "3 of 5" configuration is common.
::::

While you wait, feel free to explore the other operational metrics dashboards. After a few minutes, you should see one of the zonal alarms transition to the `ALARM` state. 

![service-az-isolated-impact-alarm](/static/service-az-isolated-impact-alarm.png)

In this case, the failure was simulated for the ```use2-az1``` AZ. Let's see if we can figure out what operation is causing impact. Scroll down to the server-side metrics section and review the latency metrics. In this instance, we can see the `Ride` operation has an elevated number of high latency responses as measured from the server-side.

![service-server-side-single-az-high-latency](/static/service-server-side-single-az-high-latency.png)

Now that we've pinpointed the impacted operation, let's check its dashboard to confirm the impact matches what we observed at the service level. Scroll back to the top of the service dashboard and open the `Ride` operation dashboard from the link there. The alarms here confirm what we saw on the service level dashboard. There's impact occuring, but its scope is limited to a single AZ.

![ride-operation-alarms](/static/ride-operation-alarms.png)

Scroll down the dashboard and review the server-side metrics. You should be able to confirm how the additional latency is impacting the `Ride` operation. Next, let's scroll down to the canary metrics to see how this failure is impacting the customer experience.

![ride-operation-canary-high-latency](/static/ride-operation-canary-high-latency.png)

The canary perspective tells us 2 things. First, we can see that the impact is still affecting all customers that access the application through the ALB's regional DNS record. This is to be expected, 33% of the requests using the *`Round robin`* load balancing algorithm are going to land on the ALB node in the impacted AZ and be sent to targets in that same AZ. Second, we can see that the per-zone canary tests are only seeing impact in the AZ where we have injected the failure. This means that our AZI implementation was successful in preventing failure from cascading from one AZ to the others. Our alarms validate these observations.

![ride-operation-canary-high-latency-alarms](/static/ride-operation-canary-high-latency-alarms.png)

#### Review composite alarm definition
Next, review the structure of the composite alarm that indicates we have isolated AZ impact. Go to the top of the dashboard and click on the alarm widget for the zonal isolated impact alarm and right click *`View details page`* to open it in a new tab.

![alarm-details](/static/alarm-details.png)

We can see that both the server-side and canary alarms are in the `ALARM` state, confirming that both perspectives see the impact of the failure. If you recall from Lab 1, one of the requirements for the server-side zonal impact alarm is for more than one server being impacted. Said another way, we want to ensure that the failure impact is seen broadly in that AZ. Otherwise, replacing a single bad instance is a more efficient mitigation strategy. The next section will explore that specific requirement.

#### Look at Contributor Insights Data

Click the link for the *`<az>-ride-isolated-impact-alarm-server`* child alarm. In this composite alarm page, click the link for the *`<az>-ride-multiple-instances-high-latency-server`* child alarm. On this page, look at the *Math expression* in the alarm *Details* pane.

![insight-rule-metric-math](/static/insight-rule-metric-math.png)

The first parameter of the `INSIGHT_RULE_METRIC` CloudWatch metric math function is the name of a CloudWatch Contributor Insights rule. The name will be in the form `<az>-ride-per-instance-high-latency-server`. Note the name and navigate to the [Contributor Insights console](https://console.aws.amazon.com/cloudwatch/home#contributor-insights:rules) and open the rule of that name.

![contributor-insight-high-latency](/static/contributor-insights-high-latency.png)

::::alert{type="info" header="Graph Time Range"}
Depending on how much time has passed since you simulated the failure, you may want to decrease the displayed time range to 5 or 15 minutes to see more detail in the graph.
::::

This graph shows us that two instances started to return responses that exceed the defined latency threshold. This helps us know that the impact is more than a single instance. In fact, for this workshop, the impact is seen by every instance in the AZ supporting the `Ride` operation. We are able to use Contributor Insights because the application is writing CloudWatch Logs using the [Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html) (EMF), just like the canary is. 

Contributor Insights lets us visualize the Top-N contributors to high cardinality metrics. In this case, we want to look at instance contributors to high latency. This is the Contributor Insights rule:

```json
{
    "Schema": {
        "Name": "CloudWatchLogRule",
        "Version": 1
    },
    "AggregateOn": "Count",
    "Contribution": {
        "Keys": ["$.InstanceId"],
        "Filters":[
            {"Match": "$.AZ-ID", "In": ["use2-az1"]},
            {"Match": "$.Operation", "In": ["Ride"]},
            {"Match": "$.SuccessLatency", "GreaterThan": 350}
        ]
    },
    "LogFormat":"JSON",
    "LogGroupNames":["/multi-az-workshop/frontend"]
}
```

Contributor Insights filters our log files against the rules and then counts the number of matches per instance id. Navigate to the server-side log group [here](https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups/log-group/$252Fmulti-az-workshop$252Ffrontend). Then select one of the log streams and review the format of the log files. Because we have log data and metric data combined into one solution, we can query and filter this metric data using log analysis tools like Contributor Insights or Log Insights. Contributor Insights rules are only evaluated against log data as it is ingested, it isn't applied retroactively to existing logs. If you haven't pre-materialized those types of rules, you can run ad-hoc Log Insights queries. Navigate to the [Log Insights console](https://console.aws.amazon.com/cloudwatch/home#logsV2:logs-insights). See if you can write a Log Insights QL or OpenSearch SQL statement to identify the top contributors to Latency in the Ride operation.

::::expand{header="Solution"}

Log Insights QL (make sure to select the `/multi-az-workshop/frontend` log group):
```sql
fields InstanceId
| filter SuccessLatency > 350 and Operation = "Ride"
| stats count() by InstanceId
```

Optional Log Insights QL with AZ-ID of each instance:
```sql
fields InstanceId, `AZ-ID`
| filter SuccessLatency > 350 and Operation = "Ride"
| stats count() by InstanceId, `AZ-ID`
```

OpenSearch SQL statement:
```sql
SELECT InstanceId, count(*) FROM `/multi-az-workshop/frontend` WHERE SuccessLatency>350 AND Operation="Ride" GROUP BY InstanceId
```

Optional OpenSearch SQL statement with AZ-ID of each instance:
```sql
SELECT InstanceId, `AZ-ID`, count(*) FROM `/multi-az-workshop/frontend` WHERE SuccessLatency>350 AND Operation="Ride" GROUP BY InstanceId, `AZ-ID`
```

You may see a few requests from instances in the other AZs as contributors in these queries. That's to be expected, but you should be able to identify which AZ is an outlier by comparing the quantity of high latency requests per AZ.
::::

# Conclusion
After simulating the zonal failure, we can see that the changes you made to the Wild Rydes architecture correctly isolates the scope of impact to a single AZ. Our alarms were also able to detect the impact and correctly identified that the AZ was an outlier for latency and was being caused by more than one instance. In the next lab we will start to take action to mitigate the impact to customers.
