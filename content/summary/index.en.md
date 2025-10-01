---
title : "Summary"
weight : 100
---

In this lab you:

1. Reviewed the operational metrics for the Wild Rydes service
2. Updated the services's architecture to be Availability Zone independent (AZI)
3. Simulated an infrastructure failure
4. Used a zonal shift to mitigate the impact
5. Enabled zonal autoshift on your supported resources and conducted a practice run
6. Used ALB Automatic Target Weights (ATW) to automatically detect and mitigate gray failures
7. Simulated a failed deployment and used a zonal shift to mitigate that impact
8. Simulated additional single-AZ faults and responded to those events

You relied on *zonal shift* as the primary mechanism to shift traffic away from an AZ, which allowed us to take only data plane dependencies for recovery. You also explored some of the capabilities of Amazon CloudWatch like dashboards, metrics, alarms, and Contributor Insights to detect single AZ impairments. These patterns can help you build more resilient multi-AZ applications on AWS.