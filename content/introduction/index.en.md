---
title : "Introduction"
weight : 1
---

This workshop is intended to demonstrate resilience patterns for multi-Availability Zone (AZ) architectures. These patterns can help you create Availability Zone Independent (AZI) architectures that allow you to use AZs as fault isolation boundaries that contain the impact of failures when they occur. In addition to the architectural aspects of resilience, you'll also review the operational considerations, most importantly, the observability required to detect when the scope of failure is a single AZ. This includes the use of outlier detection to discover when the impact to a single AZ makes it an outlier. 

[Gray failures](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/gray-failures.html) can impact systems in the cloud. They are defined by the characteristic of *differential observability*, meaning that failures are observed differently from different perspectives. Your service may observe itself to be healthy, but users of the service see impact, typically though a drop in availability (the presence of errors) or increased latency. Gray failures can impact individual hosts as well as individual AZs. In this workshop, you'll see how the observability solution turns what may been a gray failure impacting a single AZ into a *detected failure* that you are able to respond to and mitigate.

You'll introduce failures to the environment using the [AWS Fault Injection Service](https://docs.aws.amazon.com/fis/latest/userguide/what-is.html) (AWS FIS). You'll have the ability to randomly inject failures with a zonal scope of impact and try and determine what the actual failure was based on your observability. You can also create a failed deployment using AWS CodeDeploy zonal deployment configurations. Then you'll use Amazon Application Recovery Controller (ARC) zonal shift to mitigate the failure's impact. 

While multi-Region architectures can be used to deal with single-AZ impairments, you may need to make significant tradeoffs to implement them compared to multi-AZ solutions. These tradeoffs include cost, complexity, data consistency, and recovery time. In particular, performing a regional failover can have a longer recovery time objective (RTO) and recovery point objective (RPO) than staying within a single Region. By the end of this workshop, you should understand:

1. How to implement Availability Zone Independent (AZI) architectures for both EC2 and containerized workloads.
2. The considerations and principles for the required observability to detect single AZ failures as well as a standardized approach for implementing the observability.
3. How you can use AWS FIS to inject partial AZ impairments and gray failures and learn about your service's behavior under different failure conditions.
4. Tools you can use to shift traffic away from an AZ that is experiencing an impairment of infrastructure services or within your service.

You can adapt these strategies and patterns for your own services to operate more resilient multi-AZ architectures with lower RTOs and RPOs than using a multi-Region approach for mitigation.

## Workshop flow

1. **Lab 1 -** You'll start by reviewing the operational metrics dashboards for the environment. This will present how availability and latency are being measured and tracked.

2. **Lab 2 -** You'll inject a failure and observe its impact. Then you'll make changes to the application's architecture to implement AZI that will help contain the scope of impact from future zonal impairments.

3. **Lab 3 -** Consists of introducing a single-AZ impairment and observing the impact it has on your customer experience.

4. **Lab 4 -** You will perform a zonal shift to mitigate the impact of the single-AZ impairment.

5. **Lab 5 -** You will introduce a deployment related failure so you can see how the same obervability and recovery patterns can be used for both infrastructure impairments as well as deployment related problems.

6. **Lab 6 -** Is optional. You will have the opportunity to experiment with different types of fault injection tests where you can see how the application responds and practice using zonal shift in response.

## Architecture
This workload is representative of a traditional 3-tier web architecture, shown below.

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

For the purpose of the workshop, the VPC network is completely private and uses VPC endpoints for communication with AWS services. The workload is composed of an internal Application Load Balancer (ALB) distributed across three Availability Zones. Behind the load balancer is an auto scaling group of Amazon EC2 instances, also using three AZs. These instances connect to an Aurora database. There's also an EKS cluster hosting pods that support several operations in your service.

## Control planes and data planes
AWS makes a distinction between control planes and data planes. Control planes are the machinery involved in making changes to a system—adding resources, deleting resources, modifying resources—and getting those changes propagated to wherever they need to go to take effect, such as updating a network configuration for an ALB or creating an AWS Lambda function. Data planes are the daily business of those resources, things such as the running EC2 instances, or getting items from or putting items into an Amazon DynamoDB table.  For a more detailed discussion of control planes and data planes, refer to [Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/). 

For the purposes of this workshop, consider that control planes tend to have more moving parts than data planes, and operate at lower volumes (often by orders of magnitude). These facts alone make it statistically more likely that the control plane becomes impaired compared to the data plane. This is especially relevant for services that provide Availability Zone Independence, such as Amazon EC2 and EBS, because their control planes are also zonally independent and can be impacted during a single-AZ event.

While control plane actions can be used to perform failure mitigation, based on the previous information, they may have a lower probability of success, especially during a failure event. To increase the probability of successfully mitigating impact, we will prefer to use data plane driven actions for recovery. By avoiding the control plane, we also prevent making changes at runtime to the configuration of resources. Systems that don't have to change in response to failure tend to be the most reliable.

## Level: Intermediate

This workshop primarily makes use of Amazon EC2 instances, Elastic Load Balancers (ELB), Auto Scaling, CloudWatch, EKS, and AWS Systems Manager. Reading the [Advanced Multi-AZ Resilience Patterns](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/advanced-multi-az-resilience-patterns.html) white paper is a good primer before taking this workshop. Basic understanding of AWS Availability Zones, Amazon CloudWatch, [control planes and data planes](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/control-planes-and-data-planes.html), and [static stability](https://aws.amazon.com/builders-library/static-stability-using-availability-zones) are beneficial for this workshop.

## Duration

This workshop will take between 1 to 2 hours to complete.

## Costs

We estimate that the costs of the resources that you will spin up in this lab will be about $10 per day. Please remember to cleanup your environment to minimize costs if you are running the workshop in your own account.
