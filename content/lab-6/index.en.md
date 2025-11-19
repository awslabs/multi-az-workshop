---
title : "Lab 6: Use automatic target weights"
weight : 70
---

Application Load Balancers (ALB) offer several routing algorithms. The default is `Round robin`, which distributes traffic evenly to targets. Another option is `Least outstanding requests`, which routes requests to the target with the lowest number of in progress tasks. ALB also offers a routing algorithm that can help automatically detect and mitigate gray failures, called [`Automatic target weights` (ATW)](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html#modify-routing-algorithm). 

A gray failure occurs when an ALB target passes active load balancer health checks, making it look healthy, but still returns errors to clients. This scenario could be caused by many things, including application bugs, a dependency failure, intermittent network packet loss, a cold cache on a newly launched target, CPU overload, and more. ATW’s anomaly detection analyzes the HTTP return status codes and TCP/TLS errors to identify targets with a disproportionate ratio of errors compared to other targets in the same target group. 

When ATW identifies anomalous targets, it reduces traffic to the under-performing targets and gives a larger portion of the traffic to targets that are not exhibiting these errors. When the gray failures decrease or stop, ALB will slowly increase traffic back onto these targets. 

In this lab, you'll update the ALB to use ATW and then introduce failures that are automatically mitigated by the routing algorithm.

## Enable Automatic Target Weights
First, navigate to the [Target groups console page](https://console.aws.amazon.com/ec2/home#TargetGroups:). Select the first target group in the list. On the bottom half of the page, click the *Attributes* tab and then *Edit*.

!["edit-target-group-attributes"](/static/edit-target-group-attributes.png)

On the *Edit target group attributes* page, select the **Weighted random** traffic configuration and ensure the checkbox for **Turn on anomaly mitigation - *recommended*** is checked. Next, enable cross-zone load balancing. When cross-zone is enabled, ATW detects and mitigates failures on up to 50% of all targets in a target group. When cross-zone is disabled, ATW detects and mitigates failures on up to 50% of targets per AZ. Given that we only have 2 nodes in each AZ, mitigating just one node will help, but allowing ATW to mitigate all of the nodes in a single AZ will have a larger impact, so we need cross-zone enabled to do that.

Then click *Save changes* on the bottom of the screen. **Do the same thing for the second target group.**

!["traffic-configuration"](/static/traffic-configuration.png)

Now that we've enabled ATW and cross-zone load balancing for our two target groups, let's see how it responds when we introduce failures to a single AZ.

## Simulate single-AZ impairment
Because ATW operates on anomaly detection of HTTP status codes, we need to introduce a failure scenario that causes `5xx` response codes, not just high latency. To do this, we're going to use packet loss that causes requests to the database to timeout which are surfaced by the application as a 500 response. The application's database client is set with a timeout of 2 seconds. The canary's http client timeout is set to 3 seconds, so we should see 500 status codes being returned back to the canary. The Lambda running the canary tests has a timeout of 240 seconds. For 60 requests, each with a timeout of 3 seconds, the Lambda function will have time to finish all requests (180 seconds), but this will cause the requests to this specific operation to be reduced each minute. In order to ensure we see an anomalous volume of failed requests, we're going to update one of the packet loss experiments to drop 100% of the traffic to the database.  

Go to the [AWS FIS Experiment Templates console page](https://console.aws.amazon.com/fis/home#ExperimentTemplates). Choose one of the *Add Packet Loss* experiments. In my case, I've chosen packet loss for us-east-2c.

!["packet-loss"](/static/packet-loss.png)

Click *Actions* and choose *Update experiment template*. From here, click *Edit* on *Step 2: Specify actions and targets*.

!["edit-fis-template"](/static/edit-fis-template.png)

Then, click the "..." button on the **packetLoss** action and select *Edit*.

!["edit-fis-action"](/static/edit-fis-action.png)

In this screen, find the *Document parameters* field. 

!["fis-doc-parameters"](/static/fis-doc-parameters.png)

This contains JSON configuration data used by the experiment run on the hosts. We want to change the *LossPercent* parameter from `30` to `100` to ensure every request from the instances to the database fails. Make this update and click *Save*. Click *Next*, *Next*, *Next*, and then *Update experiment template*. Confirm the update.

Now, click *Start Experiment* on the top right.

## Observe the impact and recovery
Go back to the service level operational metrics dashboard and review your load balancer metrics. What you should see is a brief spike in faults and then a very quick, automated response that reduces that error rate. The graph on the left shows that traffic is automatically rebalanced to the other AZs where success rate increases. On the right-hand side, you will see the error rate spike and then quickly reduce as the traffic is weighted away from that AZ.

![atw-recovery](/static/atw-recovery.png)

You should also see is a drop in the number of requests being handled by the instances in the AZ where you injected the failure. The ALB automatically reduces the amount of traffic being sent to the targets that have anomalous behavior and we can see that the ALB is emitting metrics to tell us that the 2 anomalous targets are being automatically mitigated.

![mitigated-targets](/static/mitigated-targets.png)

If we look at the fault rate being recorded by our load balancer metrics, in this example, it hits a high of a little over 20% and then quickly drops to around 5-7%. Without needing to take any action, the ALB has automatically mitigated a significant portion of the impact. While it doesn't reduce the fault rate to 0, it does very quickly minimize the impact being seen in a single AZ. Because we are using cross-zone load balancing, the impact from the instances in the selected AZ is observed by all customers, as shown by the canary metrics.

![atw-canary-impact](/static/atw-canary-impact.png)

This is a great first start to quick impact mitigation, but we'd like to fully mitigate the impact our customers are experiencing in Wild Rydes.

## Perform a zonal shift.
Because we can see our anamolous hosts are all contained in a single AZ, we can use a zonal shift to mitigate the rest of the impact. Zonal shift supports both ALBs and NLBs with cross-zone load balancing enabled and disabled. When you perform a zonal shift on a load balancer with cross-zone enabled, the IP address for the shifted AZ is withdrawn from DNS and load balancers are instructed not to send traffic to the impaired AZ. Using the same procedure from [Lab 4](/content/lab-4), start a zonal shift on the AZ where you injected the failure. Then, go back to your service level operational dashboard. You'll be able to see results similar to this.

![atw-and-zonal-shift](/static/atw-and-zonal-shift.png)

After the zonal shift, all traffic is prevented from being sent to the impacted AZ, even with cross-zone load balancing enabled. This means that even the canary traffic targeting the impacted AZ is redirected to targets in other AZs. This can present a challenge, because no traffic is being sent to the impacted AZ, it may be hard to determine when the impact is over when you use cross-zone enabled load balancing and perform a zonal shift. You will need to decide whether cross-zone enabled or disabled is a better choice for your environment.

Because no traffic is being sent to the shifted AZ, the targets that were producing errors are no longer mitigated by ATW.

![mitigated-hosts-after-zonal-shift](/static/mitigated-hosts-after-zonal-shift.png)

Now you've mitigated the impact completely for your customers using both ATW and zonal shift without any additional observability required beyond the metrics ALB provides for each target group for anomalous hosts. You can also create an alarm on the anomalous host metric using our outlier detection logic. 

#### Optional challenge
As an optional challenge, try creating a Cloudwatch Alarm to detect when a single AZ is an outlier for anomalous hosts. If you want step by step instructions, they are provided below.

::::expand{header="Anomalous host outlier alarm instructions"}
The simplest way to do this is by using the existing metric on the service level dashboard. Navigate to the *`wildrydes-availability-and-latency-<region>`* dashboard and scroll to the bottom where the Anomalous Hosts graph is located. Click the three dots and select *View in metrics*.

![anomalous-hosts-view-in-metrics](/static/anomalous-hosts-view-in-metrics.png)

Here, we can see the metrics being displayed. First, click the "edit" button next to first "m1" and hit apply, then rename the second "m1" to "m2", and the third "m1" to "m3". Then Click *Add math* and *Start with empty expression*.

![anomalous-hosts-metrics](/static/anomalous-hosts-metrics.png)

Create a math expression to determine the percent of anomalous hosts in each AZ. After you create the first one, you can copy it and just update the numerator in the equation.

![anomalous-hosts-math-expression](/static/anomalous-hosts-math-expression.png)

From here, you can use the alarm icon shortcut to create an alarm for each of these new math expressions.

![alarm-shortcut](/static/alarm-shortcut.png)

This brings you to the alarm creation wizard. Specify "Greater/Equal" and define a threshold, in this example we're using 0.7, meaning 70%.

![alarm-wizard](/static/alarm-wizard.png)

In the *Additional configuration*, update the *Datapoints to alarm* to be 2 out 3.

Click *Next*, choose to remove the *Notification*, click *Next*, give the alarm a name like `use2-az1-anomalous-hosts-outlier`, click *Next*, then *Create alarm*. You can do the same thing to create alarms for the other 2 AZs.

You might also want to ensure that it's not a single anomalous host that triggers this alarm, so you could create a composite alarm, combining this alarm with one that triggers if it's 2 or more anomalous hosts in the same AZ. Create a new metric alarm and select the `AnomalousHostCount` metric for one of the AZs and the EC2 target group named like `targetgroup/multi-front-...`. 

![anomalous-host-metric](/static/anomalous-host-metric.png)

Select this metric, specify the condition as *Greater/Equal* and specify a threshold of 2. Use the same 2 out of 3 datapoint configuration. Remove the notification, and give the alarm a name like `use2-az1-multiple-anomalous-hosts`. Finally, we need to create a composite alarm. Select the two alarms we've created for the same AZ, and click *Create composite alarm*.

![create-composite-alarm](/static/create-composite-alarm.png)

Update the composite alarm to use `AND`.

```json
ALARM("use2-az1-anomalous-hosts-outlier") AND ALARM("use2-az1-multiple-anomalous-hosts")
```

Click *Next*, remove the notification, give the alarm a name like `use2-az1-anomalous-host-isolated-impact` and complete creating the alarm. Now you have a simple composite alarm that you can use with ATW and cross-zone enabled load balancing to detect single-AZ impact. This allows ATW to quickly mitigate a majority of the impact and then provides you a signal for initiating a zonal shift to fully mitigate the impact.
::::

## Reset the environment
First, end the zonal shift you started. 

::::alert{type="info" header="Optional step"}
If you chose to do the optional step to create the anomalous hosts outlier alarms, go to the alarm you created that corresponds to the AZ where you are running the packet loss experiment, like `usw2-az1-anomalous-host-isolated-impact`. In a few minutes you should see that alarm transition into the `ALARM` state because the FIS experiment is still running and causing hosts in that AZ to produce errors. This would be your notification that the AZ is an outlier because of its percentage of targets being mitigated by ATW and could indicate that a zonal shift would help mitigate impact further.
::::

Next, go back to your two target groups and change the traffic configuration from *Weighted random* back to *Round robin* and disable cross-zone load balancing. Finally, stop the running AWS FIS experiment if it hasn't already ended. Once you've ended the zonal shift, updated the target groups, and ensured the experiment has ended, you can proceed to the next lab.

## Summary
In this lab you saw how to enable the Automatic Target Weights (ATW) algorithm on your ALB. ATW quickly detected and partially mitigated the gray failures impacting your instances in a single AZ. You then added a zonal shift to mitigate the remaining impact. This approach allows you to 1/take advantage of the benefits of cross-zone load balancing, 2/significantly reduce the required observability to detect a single AZ impairment, and 3/quickly and automatically mitigate a majority of the impact.