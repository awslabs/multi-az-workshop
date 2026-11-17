/**
 * Each partition's control-plane region for partition-wide services. A region belongs to exactly
 * one partition, so "the deploy region is one of these" is the same as "the deploy region is this
 * partition's control-plane region", which a CloudFormation Rule can check without knowing the
 * partition. The project type holds the same tables to check the plan; a test keeps them in step.
 */

/** IAM's control-plane region per partition: where a CreIamStack deploys. */
export const IAM_CONTROL_PLANE_REGIONS: Readonly<Record<string, string>> = {
  'aws': 'us-east-1',
  'aws-us-gov': 'us-gov-west-1',
  'aws-cn': 'cn-north-1',
  'aws-eusc': 'eusc-de-east-1',
};

/** Route 53's control-plane region per partition: where a CreDnsStack deploys. */
export const DNS_CONTROL_PLANE_REGIONS: Readonly<Record<string, string>> = {
  'aws': 'us-east-1',
  'aws-us-gov': 'us-gov-west-1',
  'aws-cn': 'cn-northwest-1',
  'aws-eusc': 'eusc-de-east-1',
};
