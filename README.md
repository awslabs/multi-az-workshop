## Advanced Multi-AZ Resilience Patterns
### Building, operating, and testing resilient multi-AZ applications
In this workshop you will build, operate, and test a resilient multi-AZ application. You will use Amazon CloudWatch to observe the health of your application. You'll inject faults using the AWS Fault Injection Service (FIS) to simulate a variety of single AZ impairments. You'll also learn how to leverage AWS CodeDeploy to perform zonal deployments and experience deployment failures. Finally, you'll leverage Amazon Application Recovery Controller (ARC) zonal shift to recover from these failures.

You can access the workshop through [Workshop Studio](https://catalog.workshops.aws/multi-az-gray-failures/en-US/introduction). The workhop is also available in Japanese. In the [on your own] instructions, you can download all of the compiled workshop content for deployment into your own account as well as through the packages on this repo.

## Build instructions
The build process for the workshop is complex and uses CodePipeline to generate the builds. If you'd like to build from source, there is a linked CDK construct to build a pipeline. The steps are generally:

1. Synthesize the content in the `./cdk` directory and upload asset content to S3. [This is an example CodeBuild project buildspec.](https://github.com/awslabs/multi-az-workshop/blob/main/build/build-cfn-package.yml).
2. Build the web application for your desired CPU architecture(s) (there is an included `buildspec.yml` for this).
3. Build the failing deployment version of the web application for your desired CPU architecture(s) (there is an included `buildspec.yml` for this).
4. Build the EKS container package (there is an included `buildspec.yml` for this).
5. Package the content. [This is an example CodeBuild project buildspec.](https://github.com/awslabs/multi-az-workshop/blob/main/build/bundle.yml). It calls a script, [pacakage.py](https://github.com/awslabs/multi-az-workshop/blob/main/build/package.py) that does much of the heavy lifting in updating nested stack files to use the bucket and prefix provided by Workshop Studio.
6. Download the `workshop.zip` file produced in the bundle stage. This contains the workshop content, static assets, application binaries, and CloudFormation templates.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
