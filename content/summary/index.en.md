---
title : "Summary"
weight : 100
---

In this workshop you:

1. Reviewed the operational metrics for the Wild Rydes application
2. Updated the application's architecture to be Availability Zone independent (AZI)
3. Simulated an infrastructure failure
4. Used a zonal shift to mitigate the impact
5. Enabled zonal autoshift on your supported resources and conducted a practice run
6. Used ALB Automatic Target Weights (ATW) to automatically detect and mitigate gray failures and combined the strategy with zonal shift
7. Simulated a failed deployment and used a zonal shift to mitigate the impact

This workshop explored a number of options on how you build, test, and operate resilient multi-AZ applications. You saw how to effectively utilize zonal shift to quickly mitigate impact in a single AZ. You explored how zonal autoshift can simplify automatically recovering from single AZ impairments and build confidence that your application can recover through continuous testing. You also utilized the ATW capability of ALB to automatically detect and respond to gray failures, providing another option that doesn't require you to analyze failure rates among the AZs you use to detect outliers. In each lab we used the AWS Fault Injection Service to create single-AZ gray failures and test the resilience of our application. Finally, you used zonal deployments with AWS CodeDeploy and used the same recovery tool for both infrastructure and deployment failures.