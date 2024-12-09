---
title : "Lab 4: Perform a zonal shift"
weight : 50
---

In this lab you will mitigate the impact of the AZ failure using data plane actions to shift traffic away from the impacted AZ. The implementation of the pattern uses zonal shift in Amazon Application Recovery Controller (ARC) to reliably recover your application from an impairment in a single Availability Zone (AZ).

When you detect that an AZ has become impaired, you can initiate a zonal shift with [zonal shift in Amazon ARC](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-shift.html). Once this operation completes and existing cached DNS responses expire, all new requests are only routed to resources in the remaining AZs. The zonal shift is performed for the third AZ.

![zonal-shift](/static/zonal-shift.png)

## Amazon Application Recovery Controller Zonal Shift

Zonal shifts enable you to quickly recover from single Availability Zone issues by temporarily shifting traffic away from that Availability Zone. Starting a zonal shift helps your application recover quickly, for example, because a bad deployment is causing latency issues, or because the Availability Zone is impaired.

All zonal shifts are temporary. You must set an initial expiration when you start a zonal shift, from one hour up to three days (72 hours). But you can update active zonal shifts at any time to set new expirations. The new expiration starts from the time that you set it and has the same constraints.

In the example, if the primary database instance is not in Availability Zone 3, then performing the zonal shift is the only action required to achieve the first outcome for evacuation, preventing work from being processed in the impacted Availability Zone. If the primary node was in Availability Zone 3, then you could perform a manually initiated failover (which does rely on the Amazon RDS control plane) in coordination with the zonal shift, if Amazon RDS did not already failover automatically.

Although this workshop will demonstrate using zonal shift with the AWS Management Console, in production, you should initiate the zonal shift using CLI commands or the API in order to minimize the dependencies required to start the shift. The simpler the evacuation process, the more reliable it will be. The specific commands can be stored in a local runbook that on-call engineers can easily access. Zonal shift is the most preferred and simplest solution for evacuating an Availability Zone.

## Start the zonal shift

First, navigate to [Amazon Application Recovery Controller](https://console.aws.amazon.com/route53recovery/home). Then, on the zonal shift landing page, select the "Zonal Shift" radio button and click on "Start zonal shift".

![start-zonal-shift](/static/start-zonal-shift.png)

Select the AZ where the failure was simulated. 

::::alert{type="info" header="Automation"}
You may have also noticed that the zonal Isolated Impact alarm contained some data in its description.

![alarm-description](/static/alarm-description.png)

The multi-AZ observability solution embeds the load balancer ARN and the AZ ID as JSON data in the alarm's description. This can be used to automatically trigger a zonal shift without operator intervention. For example, if you trigger a Lambda function with your alarm, the alarm's description is part of the [data delivered in the event](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarms-and-actions) the Lambda function receives. The data can be parsed from the event and used to start a zonal shift.
::::

Select the Availability Zone ID that you want to move traffic away from in the drop down. Next, select the load balancer from the Resources table where you want to shift traffic away from, there should only be one load balancer available.

![zonal-shift-selection](/static/zonal-shift-selection.png)

For "Set zonal shift expiration", choose an expiration for the zonal shift. A zonal shift can be set to expire initially for 1 minute or up to three days (72 hours). All zonal shifts are temporary. You must set an expiration, but you can update active shifts later to set a new expiration period of up to three days. Then, enter a comment. You can update the zonal shift later to edit the comment, if you like. Finally, select the check box to acknowledge that starting a zonal shift will reduce available capacity for your application by shifting traffic away from the selected Availability Zone. Choose *`Start`*.

![zonal-shift-start](/static/zonal-shift-start.png)

## How a zonal shift works

Here's a simple explanation of how this works. Every NLB and ALB has zonal DNS A records in addition to its regional DNS A record. For example, your load balancer may provide you with this A record: `my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com`. However, there are also A records for each AZ the load balancer is deployed into, like the following:

```
us-east-1a.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
us-east-1b.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
us-east-1c.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
```

 When you start a zonal shift for a load balancer resource, Amazon Application Recovery Controlle (ARC) requests that the resource move traffic away from the Availability Zone that you've specified. This request causes the load balancer health check for the Availability Zone to be set to unhealthy so that it fails its health check. An unhealthy health check, in turn, results in Amazon Route 53 withdrawing the corresponding IP addresses for the resource from DNS, so traffic is redirected from the Availability Zone. New connections are now routed to other Availability Zones in the AWS Region instead. This action utilizes the data plane of Route 53 to shift traffic away from the impaired AZ.

When you start a zonal shift, the zonal shift is created in Amazon ARC, but because of the steps in the process, you might not see traffic move out of the Availability Zone immediately. It also can take a short time for existing, in-progress connections in the Availability Zone to complete, depending on client behavior and connection reuse. Typically, however, this takes just a few minutes.

Finally, when a zonal shift expires or you cancel it, Amazon ARC reverses the process, requesting the Route 53 health checks to be set to healthy again, so the original zonal IP addresses are restored and the Availability Zone is included in the load balancer's routing again.

## Review operational metrics

Now let's go back to the operational metrics dashboard for the `Ride` operation.

::::alert{type="info" header="Metric population"}
You may need to wait for 5 minutes or more for metric data to populate in the dashboards after the zonal shift has been initiated. 
::::

The first thing you'll notice is that the zonal *Isolated Impact* alarm is still in the `ALARM` state. 

![ride-operation-alarms](/static/ride-operation-alarms.png)

This is ok and expected because the alarm is triggered by both the server-side metrics *as well as* the canary metrics. In this case, the canary that is testing the AZ-specific endpoint like `us-east-1c.my-example-alb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com`, is still seeing the impact. But if we look at the canary testing the regional endpoint, we can see that there's no longer impact to the customer experience and the alarm is in the `OK` state.

![post-zonal-shift-canary-latency](/static/post-zonal-shift-canary-latency.png)

After we initiated the zonal shift that the latency of the regional endpoint returned to pre-impact levels. This means that the zonal shift has successfully mitigated the impact to the customer experience when accessing the web service through its regional DNS record.

## Recover the environment
Navigate back to the FIS console and find the experiment you started. Click *`Stop experiment`* to end the experiment.

![stop-experiment](/static/stop-experiment.png)

By stopping the experiment, we've simulated the infrastructure event ending. After a few minutes, you'll see latency return to normal on both the server-side and for the canary in the impacted AZ.

![latency-impact-ends](/static/latency-impact-ends.png)
 
This is how we know when it's safe to end the zonal shift and return to normal operation. Navigate back to the Amazon ARC zonal shift console tab and find the active zonal shift, then cancel it.

![cancel-zonal-shift](/static/cancel-zonal-shift.png)

And we can see through our ALB metrics that more traffic is now being processed by `use1-az6`, meaning that it's now getting both the zonal and the regional canary test traffic.

![alb-processed-bytes-after-shift-ended](/static/alb-processed-bytes-after-shift-ended.png)

## Conclusion

In this lab we initiated a zonal shift to mitigate the impact from a single-AZ impairment. We verified that the latency metrics returned to normal when being accessed through load balancer's regional DNS record. You also saw that the canary testing the zonal endpoint continued to verify impact in that AZ. For a zonal shift to be effective, it's important to be pre-scaled to handle the shifting load, otherwise, this could lead to overwhelming your existing resources. Alternatively, you may need to temporarily load shed or rate limit traffic to the remaining AZs to protect your service while you add capacity in those locations to handle the additional load. Consider using [zonal autoshift](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-autoshift.html), which will regularly test the readiness of your service to perform a zonal shift as well as initiate a zonal shift automatically when AWS telemetry indicates there could be an AZ impairment that might impact customers. This can help you build confidence that your service is ready as well as recover faster from incidents.

::::alert{type="info" header="Additional zonal shift integrations"}
While not utilized in this version of the workshop, zonal shift also integrates with [Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/zone-shift.html) and [Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-zonal-shift.html), which can be used in conjuncion with your load balancer zonal shift or independently. 
::::

In the next lab, you'll introduce a different type of failure and see how our application responds. 
