---
title : "Lab 6: Use automatic target weights"
weight : 70
---

Application Load Balancers (ALB) offer several routing algorithms. The default is `Round robin`, which distributes traffic evenly to targets. Another option is `Least outstanding requests`, which routes requests to the target with the lowest number of in progress tasks. ALB also offers a routing algorithm that can help automatically detect and mitigate gray failures, called [`Automatic target weights` (ATW)](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html#modify-routing-algorithm). 

A gray failure occurs when an ALB target passes active load balancer health checks, making it look healthy, but still returns errors. This scenario could be caused by many things, including application bugs, a dependency failure, intermittent network packet loss, a cold cache on a newly launched target, CPU overload, and more. ATW’s anomaly detection analyzes the HTTP return status codes and TCP/TLS errors to identify targets with a disproportionate ratio of errors compared to other targets in the same target group. 

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
Because ATW operates on anomaly detection of HTTP status codes, we need to introduce a failure scenario that causes `5xx` response codes, not just high latency. To do this, we're going to use packet loss that causes requests to the database to timeout which are surfaced by the application as a 500 response. The application's database client is set with a timeout of 2 seconds. The canary's http client timeout is set to 3 seconds, so we should see 500 status codes being returned back to the canary. The Lambda running the canary tests has a timeout of 240 seconds. For 60 requests, each with a timeout of 3 seconds, the Lamnbda function will have time to finish all requests (180 seconds), but this will cause the requests to this specific operation to be reduced each minute. In order to ensure we see an anomalous volume of failed requests, we're going to update one of the packet loss experiments to drop 100% of the traffic to the database.  

Go to the [AWS FIS Experiment Templates console page](https://console.aws.amazon.com/fis/home#ExperimentTemplates). Choose one of the *Add Packet Loss* experiments. In my case, I've chosen packet loss for us-east-2c.

!["packet-loss"](/static/packet-loss.png)

Click *Actions* and choose *Update experiment template*. From here, click *Edit* on *Step 2: Specify actions and targets*.

!["edit-fis-template"](/static/edit-fis-template.png)

Then, click the "..." button on the **packetLoss** action and select *Edit*.

!["edit-fis-action"](/static/edit-fis-action.png)

In this screen, find the *Document parameters* field. 

!["fis-doc-parameters"](/static/fis-doc-parameters.png)

This contains JSON configuration data used by the experiment run on the hosts. We want to change the *LossPercent* parameter from 30 to 100 to ensure every request from the instances to the database fails. Make this update and click *Save*. Click *Next*, *Next*, *Next*, and then *Update experiment template*. Confirm the update.

Now, click *Start Experiment* on the top right.

## Observe the impact and recovery
Now, go back to your operational metrics dashboard for the *Ride* operation. We should see error rates increase, originating from a single AZ. Then, the ATW anomaly mitigation will start sending less traffic to the impacted targets, reducing the error rate. 

Navigate to the *`wild-rydes-per-az-health-<region>`* dashboard. Scroll down to the bottom and look for the *Anomalous Hosts* and *Mitigated Hosts* graphs. This shows you the result of the ATW algorithm. Also, look at the server-side and load balancer request count, you should see additional requests being handled by the other AZs and a drop in the requests being processed in the impacted AZ. Because cross-zone load balancing is enabled, even the canary traffic targeting the ALB endpoints in the impacted AZ can be routed to targets in other AZs. 

After seeing an initial availability drop and elevated fault rate, you should see them start to drop off quickly. While it doesn't reduce the fault rate to 0, it does very quickly minimize the impact being seen in a single AZ. Instead of a 33% drop in availability, you likely only see an ~8% drop. 

## Perform a zonal shift.
Because we can see our anamolous hosts are all contained in a single AZ, we can use a zonal shift to mitigate the rest of the impact. Zonal shift supports both ALBs and NLBs with cross-zone load balancing enabled. When you perform a zonal shift, both the IP address for the shifted AZ is withdrawn from DNS as well as 


## Reset the environment
Go back to your two target groups and change the traffic configuration from *Weighted random* back to *Round robin* and disable cross-zone load balancing. Also, ensure you have stopped the running AWS FIS experiment. Once you've updated the target groups and ensured the experiment has ended, you can proceed to the next lab.

## Summary
In this lab you saw how to enable the Automatic Target Weights algorithm on your ALB. ATW quickly detected and partially mitigated the gray failures impacting your instances in a single AZ. You then added a zonal shift to mitigate the remaining impact. This approach allows you to 1/take advantage of the benefits of cross-zone load balancing, 2/significantly reduce the required observability to detect a single AZ impairment, and 3/quickly and automatically mitigate the impact.