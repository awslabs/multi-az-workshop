---
title : "Lab 5: Enable zonal autoshift"
weight : 60
---

[Zonal autoshift]((https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-autoshift.html)) is a feature of Application Recovery Controller that allows you to automatically and safely shift your application's traffic away from an AZ when AWS's telemetry indicates that there is a potential impairment impacting AWS services or customer workloads. Detecting single-AZ impairments can sometime be difficult if the source of the interruption is from the underlying AWS infrastructure. We use our own AWS internal monitoring tools and metrics to decide when to trigger a network traffic shift. The shift starts automatically; there is no API to call. When we detect that a zone has a potential failure, such as a power or network disruption, we automatically trigger an autoshift of your enrolled resources.

As a best practice, you should have enough capacity pre-provisioned to absorb the increased load in the remaining AZs after the traffic has shifted. In order to ensure that you're confident that your application can do this succesfully when there truly is an AZ impairment, zonal autoshift includes a practice mode where we regularly test the shift during a maintenance window. Let's enable autoshift on our load balancer, auto scaling group, and EKS cluster. 

## Enable zonal shift
The workshop automatically enables zonal shift on your ALB, but it hasn't been enabled for your EC2 Auto Scaling Group or your EKS cluster. We need to enable it first before we can turn on autoshift. Go to the [auto scaling console](https://console.aws.amazon.com/ec2/home#AutoScalingGroups:) and select the auto scaling group named like *`multi-az-workshop-ec2Nested...`*. Click on the *Integrations* tab and select *Edit* next to ARC Zonal Shift.

![asg-integrations](/static/asg-integrations.png)

Select the checkbox to *Enable zonal shift*, then select the checkbox for *Skip zonal shift validation*, and finally select *Replace unhealthy* for the health check behavior. You can learn more about these options in the [auto scaling documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-zonal-shift.html).

![asg-zonal-shift](/static/asg-zonal-shift.png)

Next, navigate to our [EKS cluster](https://console.aws.amazon.com/eks/clusters/multi-az-workshop-eks-cluster) and select *Manage* next to the zonal shift box.

![eks-zonal-shift-manage](/static/eks-zonal-shift-manage.png)

Select *Enabled* and *Save changes*. Now that all of our supported resources have zonal shift enabled, we can turn on autoshift.

## Configure zonal authoshift
First, we need to get an alarm ARN that is used by zonal autoshift to stop practice runs in case there is impact. We'll use the *`wildrydes-impact-alarm`* since it is an aggregate alarm of any impact to the application. You can get its ARN from the console [here](https://console.aws.amazon.com/cloudwatch/home#alarmsV2:alarm/wildrydes-impact-alarm).

Next, navigate to the [ARC zonal autoshift console](https://console.aws.amazon.com/route53recovery/zonalshift/home#/autoshift).

![configure-autoshift](/static/configure-autoshift.png)

Enable autoshift for your EKS cluster, auto scaling group, and ALB. Use the same alarm ARN for each resource. You don't need to specify a maintenance window.

![zonal-autoshift-resources](/static/zonal-autoshift-resources.png)

## Perform a practice run
Pick any of the three resources and select the *Actions* drop down. Then click *Start practice run*, select an AZ to test against, write a comment, and then click *Start*. This will initiate a zonal autoshift against whichever resource you selected. If you chose your ALB, review your operational dashboards to see the traffic shift. If you chose your auto scaling group, terminate an EC2 instance in the impacted AZ and observe auto scaling launch a new instance in one of the unimpacted AZs. If you chose EKS, you'll need to use `kubectl` to terminate a pod and see it rescheduled in a different AZ.

::::expand{header="Instructions for terminating a pod"}
First, navigate to the EKS console and review your cluster. Click the *Resources* tab, click *Deployments* on the left, and the select the *multi-az-workshop-app*. There should be 6 running pods. The easiest way to find a pod in the AZ you selected is by its IP address. The workshop uses the 192.168.0.0/16 address space. The first subnet uses 192.168.0.0/24, the next 192.168.1.0/24, and the last 192.168.2.0/24. So AZ "a" has 0.x addresses, AZ "b" has 1.x addresses, and AZ "c" has 2.x addresses. Select a pod name based on its IP mapping to the AZ you selected to run the practice in.

Next, navigate to the EC2 console and use session manager to access the worker node the same way you did in [Lab 2](/lab-2). Run the following command.

```bash
/tmp/kubectl delete pod <pod name> --namespace multi-az-workshop
```
::::

::::alert{type="info" header="Transient failures"}
It's possible transient conditions could cause the practice run to fail, such as temporary elevated latency that transitions the alarm we picked into the `ALARM` state. Feel free to rerun and practice you selected.
::::

