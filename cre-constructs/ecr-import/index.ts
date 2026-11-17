/**
 * ECR import: {@link CreEcrImport} loads container images (`docker save` tarballs) and Helm charts
 * (`helm package` .tgz) from S3 assets into ECR in the account a stack deploys to, for an account
 * with no registry of ours (a Workshop Studio team account).
 */
export * from './ecr-import.js';
