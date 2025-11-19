---
title : "Introduction"
weight : 1
---

AWS Availability Zones (AZ) give customers the ability to operate production applications and databases that are more highly available, fault tolerant, and scalable than would be possible from a single data center. All AZs in an AWS Region are interconnected with high-bandwidth, low-latency networking, over fully redundant, dedicated metro fiber providing high-throughput, low-latency networking between AZs. AZs make partitioning applications for high availability easy. If an application is partitioned across AZs, companies are better isolated and protected from issues such as power outages, lightning strikes, tornadoes, earthquakes, and more.

However, not all failures manifest in an easily detectable way. Some failures are perceived differently from different perspectives, a concept called *differential observability*. A web server may encounter a networking impairment that prevents accessing the database but continues to pass its health checks. Users of the service get errors, but the application believes all of its web servers are healthy. This is a [gray failure](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/gray-failures.html). 

Because AZs provide fault isolation in the AWS infrastructure, resources and services within a single AZ can experience isolated impact that is not seen in other AZs. Sometimes, these kinds of AZ impairments are gray failures, meaning your application experiences impact that evades standard telemetry and mitigation tools. This workshop will provide hands-on guidance on designing applications to limit the scope of impact to a single AZ and prevent cascading failure, creating the necessary observability to detect single-AZ impairments, testing single-AZ impairments, and implementing recovery mechanisms. By the end of this workshop, you should understand:

1. How to implement Availability Zone independent (AZI) architectures for both EC2 and containerized workloads.
2. Strategies and patterns to detect single AZ failures.
3. Testing patterns to inject partial AZ impairments and gray failures.
4. Tools and patterns you can use to shift traffic away from an impaired AZ.

You can adapt these strategies and patterns for your own services to operate more resilient multi-AZ architectures that can withstand a variety of gray failures.

## Workshop flow

- **Lab 1 -** You'll start by reviewing the operational metrics dashboards for the environment. This will present how availability and latency are being measured and tracked.

- **Lab 2 -** You'll inject a failure and observe its impact. Then you'll make changes to the application's architecture to implement AZI that will help contain the scope of impact from future zonal impairments.

- **Lab 3 -** After implementing AZI, you'll inject a single-AZ impairment using AWS Fault Injection Service (FIS).

- **Lab 4 -** You will perform a zonal shift to mitigate the impact of the single-AZ impairment.

- **Lab 5 -** In this lab, you will enable zonal autoshift on your resources and conduct a practice run.

- **Lab 6 -** Next you'll use the Automatic Target Weights (ATW) feature of ALB to automatically detect and recover from a gray failure.

- **Lab 7 -** You will introduce a deployment related failure so you can see how the same obervability and recovery patterns can be used for both infrastructure impairments as well as deployment related problems.

## Architecture
This workload is representative of a traditional 3-tier web architecture, shown below.

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

For the purpose of the workshop, the VPC network is completely private and uses VPC endpoints for communication with AWS services. The workload is composed of an internal Application Load Balancer (ALB) distributed across three Availability Zones. Behind the load balancer is an auto scaling group of Amazon EC2 instances, also using three AZs. These instances connect to an Aurora database. There's also an EKS cluster hosting pods that support several operations in your service.

## Level: Intermediate

This workshop primarily makes use of Amazon EC2 instances, Amazon Elastic Kubernetes Services (EKS), Elastic Load Balancers (ELB), EC2 Auto Scaling, Amazon CloudWatch, and AWS Systems Manager. Reading the [Advanced Multi-AZ Resilience Patterns](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/advanced-multi-az-resilience-patterns.html) white paper is a good primer before taking this workshop, but not required. Basic understanding of AWS Availability Zones, Amazon CloudWatch, [control planes and data planes](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/control-planes-and-data-planes.html), and [static stability](https://aws.amazon.com/builders-library/static-stability-using-availability-zones) are beneficial for this workshop.

## Duration

This workshop will take between 1 to 2 hours to complete.

## Costs

We estimate that the costs of the resources that you will spin up in this lab will be about $15 per day. Please remember to cleanup your environment to minimize costs if you are running the workshop in your own account.