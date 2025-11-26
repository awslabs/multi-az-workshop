---
title : "Lab 5: Enable zonal autoshift"
weight : 60
---

[Zonal autoshift]((https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-autoshift.html)) is a feature of Application Recovery Controller that allows you to automatically and safely shift your application's traffic away from an AZ when AWS's telemetry indicates that there is a potential impairment impacting AWS services or customer workloads in a single AZ. Detecting single-AZ impairments can sometimes be difficult if the source of the interruption is from the underlying AWS infrastructure. We use our own internal AWS monitoring tools and metrics to decide when to trigger a zonal shift for AWS services and customer resources with zonal autoshift enabled. The shift starts automatically; there is no API to call. When we detect that a zone has a potential failure, such as a power or network disruption, we automatically trigger an autoshift of your enrolled resources.

As a best practice, you should have enough capacity pre-provisioned to absorb the increased load in the remaining AZs after the traffic has shifted. In order to ensure that you're confident that your application can do this succesfully when there truly is an AZ impairment, zonal autoshift includes a practice mode where we regularly test the shift during a maintenance window. Let's enable autoshift on our load balancer, auto scaling group, and EKS cluster. 

## Enable zonal shift
The workshop automatically enables zonal shift on your ALB, but it hasn't been enabled for your EC2 Auto Scaling Group or your EKS cluster. We need to enable it first before we can turn on autoshift. Go to the [auto scaling console](https://console.aws.amazon.com/ec2/home#AutoScalingGroups:) and select the auto scaling group named like *`multi-az-workshop-ec2Nested...`*. Click on the *Integrations* tab and select *Edit* next to ARC zonal shift.

![asg-integrations](/static/asg-integrations.png)

Select the checkbox to *Enable zonal shift*, then select the checkbox for *Skip zonal shift validation*, and finally select *Ignore unhealthy* for the health check behavior. In this case, we don't want auto scaling to replace instances that are terminated because we want to prevent the automatic AZ rebalancing that is performed. This prevents new instances from being launched in the impacted AZ due to rebalancing. If you select *Replace unhealthy*, auto scaling will replace terminated or unhealthy instances in the other AZs, but will then launch new instances in the impacted AZ to rebalance. You can learn more about these options in the [auto scaling documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-zonal-shift.html). Finally, click *Update*.

![asg-zonal-shift](/static/asg-zonal-shift.png)

Next, navigate to our [EKS cluster](https://console.aws.amazon.com/eks/clusters/multi-az-workshop-eks-cluster) and select *Manage* next to the *ARC Zonal shift* box.

![eks-zonal-shift-manage](/static/eks-zonal-shift-manage.png)

Select *Enabled* and *Save changes*. Now that all of our supported resources have zonal shift enabled, we can turn on autoshift.

## Configure zonal autoshift
First, we need to get an alarm ARN that is used by zonal autoshift to stop practice runs in case there is impact. We'll use the *`wildrydes-server-side-regional-impact`* since it is an aggregate alarm for any impact to the application, but won't be affected by transient latency that the canary may experience. You can get its ARN from the console [here](https://console.aws.amazon.com/cloudwatch/home#alarmsV2:alarm/wildrydes-server-side-regional-impact).

Next, navigate to the [ARC zonal autoshift console](https://console.aws.amazon.com/route53recovery/zonalshift/home#/autoshift) and click *Configure zonal autoshift*.

![configure-autoshift](/static/configure-autoshift.png)

Enable autoshift for your EKS cluster, auto scaling group, and ALB. Use the alarm ARN you retrieved for the *Monitor practice run health: outcome alarm* ARN value. You don't need to specify a maintenance window. 

![zonal-autoshift-resources](/static/zonal-autoshift-resources.png)

## Perform a practice run
Pick any of the three resources and select the *Actions* drop down. Then click *Start practice run*, select an AZ to test against, write a comment, and then click *Start*. This will initiate a zonal autoshift against whichever resource you selected. If you chose your ALB, review your operational dashboards to see the traffic shift. If you chose your auto scaling group, terminate an EC2 instance in the impacted AZ. If you chose EKS, you'll need to use `kubectl` to terminate a pod and see it rescheduled in a different AZ. The practice run lasts for 30 minutes but it's not necessary to wait for it to complete and you can cancel the practice run at any time.

::::expand{header="Instructions for terminating a pod"}
First, navigate to the [EKS console](https://console.aws.amazon.com/eks/clusters/multi-az-workshop-eks-cluster) and review your cluster. Click the *Resources* tab, click *Deployments* on the left, and the select the *multi-az-workshop-app*. There should be 6 running pods. The easiest way to find a pod in the AZ you selected is by its IP address. The workshop uses the 192.168.0.0/16 address space. The first subnet uses 192.168.0.0/24, the next 192.168.1.0/24, and the last 192.168.2.0/24. So AZ "a" has 0.x addresses, AZ "b" has 1.x addresses, and AZ "c" has 2.x addresses. Select a pod name based on its IP mapping to the AZ you selected to run the practice in.

Next, navigate to the [EC2 console](https://console.aws.amazon.com/ec2/home#Instances:) and use session manager to access the worker node **with the same IP address subnet as the Pod you want to delete** the same way you did in [Lab 2](/lab-2). You may have to download `kubectl` if it's not the same node you used in Lab 2. 

```bash
BUCKET_PATH=$(aws ssm get-parameter --name BucketPath --query 'Parameter.Value' | tr -d '"')
aws s3 cp ${BUCKET_PATH}kubectl /tmp/kubectl
chmod +x /tmp/kubectl
CLUSTER=$(aws ssm get-parameter --name ClusterName --query 'Parameter.Value' | tr -d '"')
REGION=$(aws ssm get-parameter --name Region --query 'Parameter.Value' | tr -d '"')
aws eks update-kubeconfig --name $CLUSTER --region $REGION
```

Then, run the following command.

```bash
/tmp/kubectl delete pod <pod name> --namespace multi-az-workshop
```

Worker nodes are only authorized to delete pods that are running on themself for security reasons, while there are other ways to accomplish this task, it simplifies the required authentication and authorization for the scope of the workshop.
::::

::::alert{type="info" header="Transient failures"}
It's possible transient conditions could cause the practice run to fail, such as temporary elevated latency that transitions the alarm we picked into the `ALARM` state. Feel free to redo any practice run you selected.
::::

## Review the results
If there weren't any transient problems that occured, your practice run should have succeeded (if you chose to wait for the whole time), but it's not critical for the sake of the workshop if it didn't. The goal here was to understand how to enable autoshift and how practice runs are conducted. For ALB, you should have observed the same results as performing the zonal shift in the last lab where there was a noticeable drop in requests being processed in the selected AZ. For auto scaling, you should have observed that EC2 Auto Scaling doesn't take any action in response to the instance termination. If an auto scaling rule was triggered, new capacity would have been deployed into the other AZs. After the practice run ended, auto scaling  rebalanced your auto scaling group evenly back into all AZs. For EKS, you should have observed a new pod being scheduled in a different AZ. Rebalancing won't occur with 1 pod termination because we allow a `maxSkew` of 1. To see the rebalancing, try terminating 2 pods in the same AZ.

::::alert{type="info" header="EKS zonal shift availability impact"}
During the zonal shift, the pods in the selected AZ are deregistered from the load balancer, but because the load balancer has 2 target groups, it still has healthy targets in that AZ and still receives requests for the operations hosted on your EKS cluster on load balancer nodes in that AZ. With cross-zone load balancing disabled, there are no available targets for the `Signin` and `Home` operations in that AZ and it results in a 503 response from the load balancer. If you use zonal shift on your EKS cluster that uses an AWS load balancer to route external traffic, you should perform a zonal shift on the load balancer first, then on the EKS cluster. Alternatively, you can use cross-zone enabled load balancing. If you only have a single target group registered with the load balancer, this isn't a problem. When the targets are removed, the load balancer will withdraw its IP address from that zone and stop receiving traffic there, preventing the impact.
::::

## Turn on autoshift observer notifications
Another feature of zonal autoshift is [observer notifications](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-autoshift.how-it-works.notifications.html). You can choose to be notified about practice runs and autoshifts for your resource by setting up Amazon EventBridge notifications. You can set up EventBridge notifications even when you haven't enabled zonal autoshift for any resources. In case you don't want AWS to start the zonal shift for you, you can use the observer notifications as an input to decide whether to use a manual zonal shift.

Navigate to the [autoshift home page](https://console.aws.amazon.com/route53recovery/zonalshift/home#/autoshift). Expand the *Getting started with zonal autoshift* and click *Set up zonal autoshift observer notifications*.

![setup-observer-notifications](/static/setup-observer-notifications.png)

Select the check box to *Enable zonal autoshift observer notification*, type a name for the EventBridge rule, select the default EventBridge event bus, and click *Complete*. You can either create EventBridge rules to process those events and trigger automation or define an SNS topic where you can receive emails or other alerts when AWS starts or stops an autoshift. Using the default configuration, the EventBridge rule that is created looks like this:

```json
{
  "source": ["aws.arc-zonal-shift"],
  "detail-type": ["Autoshift In Progress", "Autoshift Completed"]
}
```
See the [zonal autoshift EventBridge documentation](https://docs.aws.amazon.com/r53recovery/latest/dg/eventbridge-zonal-autoshift.html) for more details.

## Conclusion
Once you've completed your practice runs, you can move on to the next lab. Make sure you've ended all of your practice runs if you haven't already.