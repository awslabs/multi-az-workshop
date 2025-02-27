---
title : "Lab 5: Simulate a deployment failure"
weight : 60
---

Up to now we've been injecting failures by adding latency. However, building AZI architectures and using zonal shift can be beneficial for other types of failures as well. In this lab, we'll create a new deployment of the application that gets deployed one AZ at a time. The deployment will fail and we can leverage zonal shift to recover the same way we did in the previous lab.

::::alert{type="warning" header="End the zonal shift"} 
If you did not end the zonal shift in the previous lab, please do so now.
::::

## Start the deployment
First, we need to register a new deployment artifact in CodeDeploy. First, get the bucket path that contains the assets for the workshop, it's stored in an SSM Parameter. Go to the [SSM Parameter Store console for the `DeploymentAsset` parameter](https://console.aws.amazon.com/systems-manager/parameters/DeploymentAsset/). Copy the string from the *`Value`* property, it should be something like:

```
s3://ws-assets-us-east-1/e9383b42-6c6f-416b-b50a-9313e476e372/assets/app_arm64_fail.zip
```

Next, go to the [CodeDeploy application console](https://console.aws.amazon.com/codesuite/codedeploy/applications/multi-az-workshop).

![codedeploy-application](/static/codedeploy-application.png)

Click on the deployment group named *`ZonalDeploymentGroup`*. Then click on *`Create Deployment`*.

![create-deployment](/static/create-deployment.png)

Enter the S3 path from the parameter you retrieved earlier in the revision location field.

![app-revision](/static/app-revision.png)

In the *`Additional deployment behavior settings`* select the *`Overwrite the content`* radio button.

![app-overwrite](/static/app-overwrite.png)

Then finally click *`Create deployment`* at the bottom of the screen.

The application will begin deploying to one server in the first AZ. This deployment is using a feature of AWS CodeDeploy called zonal deployments. It allows you to deploy your applications one AZ at a time. This allows you to respond to failed deployments in the same way you respond to single-AZ infrastructure events. While rollbacks are an essential part of a CI/CD system, they can take awhile to finish, and not every change can be rolled back. Shifting away from an AZ can be a simpler and faster solution. It also means you don't have to spend precious time during an event trying to figure out if a failure is deployment-related or due to an infrastructure event. For more details see [Fault-isolated, zonal deployments with AWS CodeDeploy](https://aws.amazon.com/blogs/devops/fault-isolated-zonal-deployments-with-aws-codedeploy/).

The deployment will take a few minutes (typically about 3.5 to 4 minutes) and you can see the progress on the bottom of the page.

![deployment-progress](/static/deployment-progress.png)

A few minutes after the first instance completes, the deployment will stop with an error displayed at the top of the page.

![deployment-error](/static/deployment-error.png)

::::alert{type="info" header="Deployment doesn't fail"} 
If it has been more than 5 minutes and you haven't seen an error, there's a possibility the deployment has stalled. Stop the current deployment and retry it. 
::::

It looks like our deployment failed because it triggered an alarm and stopped before moving on to the next AZ. The deployment is not configured to automatically rollback in order to you give you time to observe what's happening as well as perform a zonal shift.

## Observe the failure
Navigate back to the Wild Rydes service level dashboard, *`wildrydes-service-availability-and-latency-<region>`*. Can you determine which operation has been impacted by the deployment?

::::expand{header="Based on the dashboard, can you tell which operation has been impacted and in which AZ?"}
It looks like the *`Pay`* operation has been impacted. 

![pay-zonal-impact](/static/pay-zonal-impact.png)

In this example, the impact is happening in `use1-az2`. 

![service-zonal-impact](/static/service-zonal-impact.png)
![single-az-fault-count](/static/single-az-fault-count.png)
::::

Go to the impacted operation's dashboard and confirm the impact there.

::::expand{header="See the dashboard"}
![pay-dashboard](/static/pay-dashboard.png)
::::

## Perform a zonal shift

Following the same steps you followed in the last lab, perform a zonal shift to mitigate the impact. Confirm that the impact has been mitigated by specifically looking at the canary availability metrics for the regional endpoint.

::::expand{header="See the dashboard"}
![deployment-recovery-after-shift](/static/deployment-recovery-after-shift.png)
::::

After the zonal shift, you should see the alarm that stopped the unsuccessful deployment transition back to the `OK` state. [Navigate to the CloudWatch alarms console](https://console.aws.amazon.com/cloudwatch/home?#alarmsV2:) and search for the alarm name, *`<region>-wildrydes-canary-availability-aggregate-alarm`*.

![after-redeployment](/static/after-redeployment.png)

This indicates that we're able to start a rollback to the previous version.

## Rollback the deployment

Now that we've mitigated the customer impact, we can rollback the deployment to recover the environment. Go to your [CodeDeploy application revisions](https://console.aws.amazon.com/codesuite/codedeploy/applications/multi-az-workshop/revisions).

Select the revision named like *`app_arm64.zip`* and click *`Deploy application`*

![app-revisions](/static/app-revisions.png)

Select the deployment group *`ZonalDeploymentGroup`* and select *`Overwrite the content`*.

![deployment-group](/static/deployment-group.png)

Finally, click *`Create deployment`*. This will rollout the previous version of the application to all of the instances in the Auto Scaling group. After the deployment is complete in the first AZ, you should see availability return to 100%. This is the indication once again that you can end the zonal shift. Go ahead and do so now.

::::alert{type="info" header="Redeployment"}
The redeployment will deploy to 1 instance at a time with bake time in between each AZ. This could take up to 30 minutes to complete. You do not need to wait for the entire deployment to complete, just the first AZ before ending the zonal shift and then moving on to the next lab. It's also possible that a transient condition affecting the canary could produce errors that cause the alarm to trigger and stop the deployment. If you experience this, you can attempt to redeploy the original revision again. You only need it to succeed on the instances in the first AZ.
::::

## Conclusion

In this lab you used zonal deployments with AWS CodeDeploy to contain the impact from a bad change to a single AZ. You were able to use the same observability and recovery tools for this type of failure as you did for the previous infrastructure failure. In a production environment, you can combine this approach with automated rollbacks to both quickly and safely mitigate the impact of failed deployments.
