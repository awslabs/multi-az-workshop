/**
 * The values AWS Workshop Studio passes a workshop's team-account templates ("magic variables",
 * `{{.Name}}` in contentspec.yaml). A CreCfnParameter takes one with `fromMagic`; the generated
 * contentspec.yaml maps it to the variable, and a test deploy in our own account takes it from the
 * deploy variable {@link magicVariable} names (setup sets the participant role's).
 *
 * The assets bucket and prefix are not here: every CreStack already takes them (AssetsBucketName,
 * AssetsBucketPrefix), and contentspec.yaml maps them to `{{.AssetsBucketName}}` and
 * `{{.AssetsBucketPrefix}}` itself. A new magic variable is added here, never typed as a string.
 * Source: catalog.workshops.aws/docs/en-US/detailed-documentation/contentspec (magic variables).
 */
export enum WorkshopStudioMagic {
  /** The team's id, e.g. `d30035ed-7bef-405a-8741-6144faa15e17`. */
  TEAM_ID = 'TeamID',
  /** The team's 0-based index. */
  TEAM_INDEX = 'TeamIndex',
  /** The role participants use in the console, e.g. `WSParticipantRole` (never hard-code it). */
  PARTICIPANT_ROLE_NAME = 'ParticipantRoleName',
  /** That role's ARN. */
  PARTICIPANT_ROLE_ARN = 'ParticipantRoleArn',
  /** The session name participants assume the role with, e.g. `Participant`. */
  PARTICIPANT_ASSUMED_ROLE_SESSION_NAME = 'ParticipantAssumedRoleSessionName',
  /** The participants' assumed-role session ARN (`arn:aws:sts::<account>:assumed-role/<role>/<session>`). */
  PARTICIPANT_ASSUMED_ROLE_ARN = 'ParticipantAssumedRoleArn',
  /** The role a Lambda named `WSRestricted*` may run as for actions participants can't take. */
  RESTRICTED_ACTIONS_ROLE_NAME = 'RestrictedActionsRoleName',
  /** That role's ARN. */
  RESTRICTED_ACTIONS_ROLE_ARN = 'RestrictedActionsRoleArn',
  /** The EC2 key pair Workshop Studio creates with `ec2KeyPair: true` (`ws-default-keypair`). */
  EC2_KEY_PAIR_NAME = 'EC2KeyPairName',
}

/**
 * The deploy variable a test deploy (our own account, not Workshop Studio) takes a magic value
 * from: `WS_` and the name in capitals, e.g. `WS_PARTICIPANT_ROLE_NAME`.
 */
export function magicVariable(magic: WorkshopStudioMagic): string {
  const key = Object.entries(WorkshopStudioMagic).find(([, v]) => v === magic)?.[0];
  if (!key) throw new Error(`'${magic}' is not a WorkshopStudioMagic value.`);
  return `WS_${key}`;
}
