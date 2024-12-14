---
title : "...on your own"
weight : 7
---

## Introduction
This workshop is designed to be run in a single AWS account in any Region. You will deploy a single parent CloudFormation template to configure the environment. This will launch a number of child templates. 

::::alert{type="warning" header="Notice"}
You only need to follow these steps if you are planning on running this workshop in an AWS account NOT provided by AWS as part of an event like **re\:Invent** or an **Immersion Day**. If you are at an AWS event like re\:Invent, follow the instructions at [start the workshop at an AWS event](/prerequisites/aws-event). Otherwise follow the rest of the instructions.
::::

1. Download the [workshop content](:assetUrl{path=/content.zip source=s3}). This is a zip file named `content.zip`.
2. Extract the content locally and **upload all of it to an S3 bucket in the SAME Region that you wish to run the workshop**. Ensure the bucket you use will allow the roles used in the workshop to access the content. If the bucket does not have a bucket policy, there is nothing you need to do. If you do have a bucket policy, make sure it is not explicitly denying access.
3. Copy the S3 path to the `multi-az-workshop.template` file. Use this CloudFormation template to launch the primary stack. You will need to update 2 or 3 input parameters for the stack. 
4. Specify the `AssetsBucketName` parameter as the S3 Bucket name where you uploaded all of the content. 
5. If you uploaded the content with an additional path (like putting all of the content in a specific S3 \"folder\"), specify the `AssetsBucketPrefix` parameter. If the content was uploaded to the root of the bucket, leave this parameter blank. 
6. For `AdminRoleName`, specify the name of the IAM Role you will use to conduct the workshop. The workshop will not modify any existing permissions of the role, but it will add the role to the internal permissions of the EKS cluster that is provisioned.
7. Launch the stack and wait for the stack to be in the `CREATE_COMPLETE` state. This will take approximately 35 minutes.
8. After the stack has been created, wait for 10 to 15 minutes before starting the lab in order to give CloudWatch metrics time to populate in the dashboards that will be used in this workshop.

## Cleanup
After you have completed the lab or are done with the environment, please be sure to [clean up the resources](/cleanup) created in the CloudFormation template.