import { Construct } from 'constructs';
import { CreStack, CreStackProps, requireDeployRegion } from './cre-stack.js';
import { IAM_CONTROL_PLANE_REGIONS } from './partitions.js';

/**
 * The project's shared IAM stack: roles and policies every region's stacks use, kept out of any
 * regional stack so a regional failover or rebuild never touches them. Always in its partition's
 * IAM control-plane region ({@link IAM_CONTROL_PLANE_REGIONS}: us-east-1 in `aws`): the synth refuses another
 * `region`, and a CloudFormation Rule fails a deploy anywhere else. Stacks that use a role take its
 * ARN through a CreCfnParameter:
 *
 * ```ts
 * class IamStack extends CreIamStack {
 *   public readonly taskRole: iam.Role;
 *   constructor(scope: Construct, id: string) {
 *     super(scope, id, { region: 'us-east-1' });
 *     this.taskRole = new iam.Role(this, 'TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
 *   }
 * }
 * const shared = new IamStack(app, app.stackId('iam'));
 * // in an app stack:
 * new CreCfnParameter(this, 'TaskRoleArn', { from: { stack: shared, value: shared.taskRole.roleArn } });
 * ```
 *
 * IAM names are account-wide, so name roles with the project prefix (or let CloudFormation name
 * them) and never create the same role in two stacks.
 */
export class CreIamStack extends CreStack {
  constructor(scope: Construct, id: string, props: CreStackProps) {
    super(scope, id, props);
    this.creKind = 'iam';
    if (!Object.values(IAM_CONTROL_PLANE_REGIONS).includes(props.region)) {
      throw new Error(`CreIamStack ${id}: region must be its partition's IAM control-plane region (${Object.values(IAM_CONTROL_PLANE_REGIONS).join(', ')}), not ${props.region}.`);
    }
    requireDeployRegion(this, 'IamControlPlaneRegion', Object.values(IAM_CONTROL_PLANE_REGIONS),
      "the project's shared IAM lives in its partition's IAM control-plane region");
  }
}
