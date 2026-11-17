/**
 * Stack scaffolding every CRE project uses: {@link CreApp} (writes the plan the pipeline is
 * generated from), {@link CreStack} (the base class for every top-level stack: its deploy region and
 * roles, stack name = id, the S3-prefix synthesizer, the AssetsBucket* parameters, no env),
 * {@link CreCfnParameter} (a parameter with its pipeline source), {@link creSynthesizer},
 * {@link requireDeployRegion}, {@link CreIamStack} (the shared IAM stack, held to its partition's
 * control-plane region), the per-partition control-plane regions, and {@link CreVersions} (the
 * project's version file, build/versions.json).
 */
export * from './cre-stack.js';
export * from './cre-cfn-parameter.js';
export * from './partitions.js';
export * from './iam-stack.js';
export * from './names.js';
export * from './versions.js';
export * from './workshop-studio.js';
export * from './build-output-asset.js';
