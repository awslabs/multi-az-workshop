---
title : "Lab 4: Perform a zonal shift"
weight : 50
---

In this lab you will mitigate the impact of the AZ impairment by using [zonal shift in Amazon Application Recovery Controller (ARC)](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-shift.html).

## Amazon Application Recovery Controller Zonal Shift

Zonal shifts enable you to quickly recover from single-AZ issues by temporarily shifting traffic away from that AZ. Starting a zonal shift helps your application recover quickly, for example, because a bad deployment is causing latency issues, or because the AZ infrastructure is impaired.

All zonal shifts are temporary. You must set an initial expiration when you start a zonal shift, from one hour up to three days (72 hours). But you can update active zonal shifts at any time to set new expirations. The new expiration starts from the time that you set it and has the same constraints.

Although this workshop will demonstrate using zonal shift with the AWS Management Console, in production, you should initiate the zonal shift using CLI commands or the API in order to minimize the dependencies required to start the shift. The simpler the recovery process, the more reliable it will be. The specific commands can be stored in a local runbook that on-call engineers can easily access.

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

For "Set zonal shift expiration", choose an expiration for the zonal shift. A zonal shift can be set to expire initially for 1 minute or up to three days (72 hours), for this lab choose 6 hours. Then, enter a comment. Finally, select the check box to acknowledge that starting a zonal shift will reduce available capacity for your application by shifting traffic away from the selected Availability Zone. Choose *`Start`*.

![zonal-shift-start](/static/zonal-shift-start.png)

## How a zonal shift works

Here's a simple explanation of how this works. Every NLB and ALB has zonal DNS A records in addition to its regional DNS A record. For example, your load balancer may provide you with this A record: `my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-2.amazonaws.com`. 

![load-balancer-dns-record](/static/load-balancer-dns-record.png)

When you resolve that DNS record, you get back the IP addresses of each load balancer node. In this workshop, the load balancer is deployed across 3 AZs, so we'd expect to see at least 3 IP addresses returned.

```
sh-5.2$ nslookup internal-multi--alb8A-yDdk2kXThgkh-1739996193.us-east-2.elb.amazonaws.com
Server:         192.168.0.2
Address:        192.168.0.2#53

Non-authoritative answer:
Name:   internal-multi--alb8A-yDdk2kXThgkh-1739996193.us-east-2.elb.amazonaws.com
Address: 192.168.1.144
Name:   internal-multi--alb8A-yDdk2kXThgkh-1739996193.us-east-2.elb.amazonaws.com
Address: 192.168.2.216
Name:   internal-multi--alb8A-yDdk2kXThgkh-1739996193.us-east-2.elb.amazonaws.com
Address: 192.168.0.41
```

Try connecting to one of your EC2 instances (choose one with a name matching `multi-az-workshop/ec2/front-end-launch-template`, the others don't have the nslookup tool installed) with session manager and retrieve the IP addresses of your ALB (you can get the A record from the [Load balancers console](https://console.aws.amazon.com/ec2/home#LoadBalancers:)). 

How many IP addresses are returned? Is that what you expected? You should only see 2 IP addresses at this point because you've already initiated the zonal shift, meaning customers of the Wild Rydes service will only access load balancer endpoints in the remaining AZs.
 
When you start a zonal shift for a load balancer, Amazon Application Recovery Controller (ARC) causes the load balancer health check for the Availability Zone to be set to unhealthy so that it fails its health check. An unhealthy health check, in turn, results in Amazon Route 53 withdrawing the corresponding IP addresses for the resource from DNS. When clients query DNS for your application, only the remaining, healthy IP addresses are returned. New connections are now routed to other Availability Zones in the AWS Region instead. Clients that have existing connections will still continue to use the withdrawn IP address, but upon re-resolving the load balancer's DNS name, they'll target the unimpacted AZs.

Finally, when a zonal shift expires or you cancel it, Amazon ARC reverses the process, requesting the Route 53 health checks to be set to healthy again, so the original zonal IP addresses are restored and the Availability Zone is included in the load balancer's routing again.

## Review operational metrics

Now let's go back to the operational metrics dashboard for the `Ride` operation. Link to the [dashboards home page](https://console.aws.amazon.com/cloudwatch/home?#dashboards:).

::::alert{type="info" header="Metric population"}
You may need to wait for 5 minutes or more for metric data to populate in the dashboards after the zonal shift has been initiated. 
::::

The first thing you'll notice is that the *isolated az impact* alarm is still in the `ALARM` state. 

![ride-operation-alarms](/static/ride-operation-alarms.png)

This is ok and expected because the alarm is triggered by both the server-side metrics *as well as* the canary metrics. In this case, the canary that is testing the AZ-specific endpoint like `us-east-2a.my-example-alb-4e2d1f8bb2751e6a.elb.us-east-2.amazonaws.com`, is still seeing the impact (zonal shift doesn't block traffic to the IP, it just stops it from being returned in DNS queries). But if we look at the canary testing the regional endpoint, we can see that there's no longer impact to the customer experience and the alarm is in the `OK` state. This means customers are no longer experiencing errors when accessing the Wild Rydes service!

![post-zonal-shift-canary-latency](/static/post-zonal-shift-canary-latency.png)

After the zonal shift, the latency of the regional endpoint returned to normal levels for customers. This means that the zonal shift has successfully mitigated the impact to the customer experience when accessing the web service through its regional DNS record. That's exactly what we wanted, to quickly mitigate the customer impact with a simple recovery mechanism. We can see this happening with our ALB metrics. Go back to the service level dashboard and scroll down to the load balancer metrics.

![alb-during-zonal-shift](/static/alb-during-zonal-shift.png)

We can see that `use2-az1` has a lower request count and lower processed bytes metrics than the other AZs. This is because it's no longer processing the regional requests from the canary, which is what's also causing the higher request rate and increased processed bytes in the other AZs. There is a canary still testing the zonal endpoint where the impact is occuring, so you'll always see some traffic being sent to the AZ. This can help us determine when the impact ends.

## Recover the environment
Navigate back to the [FIS console](https://console.aws.amazon.com/fis/home#Experiments) and find the experiment you started. Click *`Stop experiment`* to end the experiment.

![stop-experiment](/static/stop-experiment.png)

By stopping the experiment, we've simulated the infrastructure event ending. After a few minutes, you'll see latency return to normal on both the server-side and for the canary in the impacted AZ.

![latency-impact-ends](/static/latency-impact-ends.png)
 
This is how we know when it's safe to end the zonal shift and return to normal operation. Navigate back to the [Amazon ARC zonal shift console](https://console.aws.amazon.com/route53recovery/zonalshift/home) tab and find the active zonal shift, then cancel it.

![cancel-zonal-shift](/static/cancel-zonal-shift.png)

And we can see through our ALB metrics that `use2-az1` is once again processing an equal number of requests, meaning that it's now getting both the zonal and the regional canary test traffic.

![alb-after-shift-ended](/static/alb-after-shift-ended.png)

## Conclusion

In this lab we initiated a zonal shift to mitigate the impact from a single-AZ impairment. We verified that the latency metrics returned to normal when being accessed through load balancer's regional DNS record. You also saw that the canary testing the zonal endpoint continued to verify impact in that AZ. For a zonal shift to be effective, it's important to be pre-scaled to handle the shifting load, otherwise, this could lead to overwhelming your remaining resources. Alternatively, you may need to temporarily load shed or rate limit traffic to the remaining AZs to protect your service while you add capacity to handle the additional load. See the [documentation](https://docs.aws.amazon.com/r53recovery/latest/dg/route53-arc-best-practices.zonal-shifts.html) for more best practices for using zonal shift.

In the next lab, we're going to enable zonal autoshift to automatically respond to single AZ impairments.