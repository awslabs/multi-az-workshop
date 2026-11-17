import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { CreStack, CreStackProps } from './cre-stack.js';

/**
 * What Workshop Studio sets up in a team account before the templates run, as contentspec.yaml asks:
 * cdk.json's `cre:workshopStudio` context, which projen writes from `workshopStudio` (.projenrc.ts),
 * the one source for both.
 */
export interface CreWorkshopAccountSettings {
  readonly participantPolicies: string[];
  readonly managedPolicies: string[];
  readonly trustedServices: string[];
  readonly serviceLinkedRoles: string[];
  readonly ec2KeyPair: boolean;
}

/** The test account's participant role (WS_PARTICIPANT_ROLE_NAME; setup sets the same, cresetup/workshop_studio.py). */
export function participantRoleName(project: string): string {
  return `${project}-participant`;
}
/** The test account's key pair (WS_EC2_KEY_PAIR_NAME), with `ec2KeyPair`. */
export function workshopKeyPairName(project: string): string {
  return `${project}-ws-keypair`;
}
/** The session name a test deploy says participants use (WS_PARTICIPANT_ASSUMED_ROLE_SESSION_NAME). */
export const PARTICIPANT_SESSION_NAME = 'Participant';

/**
 * In our own test account, what Workshop Studio makes in a team account before it deploys the
 * workshop's templates, so a test deploy runs where an event would: the participant role (its
 * policies from static/, their `{{.AccountId}}`, `{{.ParticipantRoleName}}` and
 * `{{.ParticipantRoleArn}}` filled in; the managed policies; trusted by the account and the trusted
 * services), the service-linked roles (made when missing, never deleted: other stacks may use them),
 * and with `ec2KeyPair` the key pair. Its names are the ones setup gives the WS_* deploy variables.
 *
 * Never part of the workshop: contentspec.yaml leaves it out (its kind, `workshop-account`). Stacks
 * that use the role or the key pair deploy after it: `stack.addDependency(account)`.
 */
export class CreWorkshopAccountStack extends CreStack {
  public readonly participantRole: iam.Role;

  constructor(scope: Construct, id: string, props: CreStackProps) {
    super(scope, id, props);
    this.creKind = 'workshop-account';
    const project = this.node.tryGetContext('cre:projectName') as string | undefined;
    const settings = this.node.tryGetContext('cre:workshopStudio') as CreWorkshopAccountSettings | undefined;
    if (!project || !settings) {
      throw new Error("CreWorkshopAccountStack: no cre:projectName or cre:workshopStudio in cdk.json's context: it is a CreWorkshopStudio "
        + 'project\'s, and projen writes both (run npx projen).');
    }
    const roleName = participantRoleName(project);
    const roleArn = `arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/${roleName}`;
    const magic: Record<string, string> = { AccountId: cdk.Aws.ACCOUNT_ID, ParticipantRoleName: roleName, ParticipantRoleArn: roleArn };
    const fill = (v: unknown, file: string): unknown => {
      if (typeof v === 'string') {
        return v.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, name: string) => {
          if (!(name in magic)) throw new Error(`${file}: {{.${name}}} isn't a value a participant policy can use (${Object.keys(magic).join(', ')}).`);
          return magic[name];
        });
      }
      if (Array.isArray(v)) return v.map((x) => fill(x, file));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, file)]));
      return v;
    };
    const inlinePolicies = Object.fromEntries(settings.participantPolicies.map((file, i) => {
      const p = path.resolve(file);
      if (!fs.existsSync(p)) throw new Error(`CreWorkshopAccountStack: the participant policy ${file} isn't there (workshopStudio.participantPolicies).`);
      return [`Participant${i}`, iam.PolicyDocument.fromJson(fill(JSON.parse(fs.readFileSync(p, 'utf-8')), file))];
    }));
    this.participantRole = new iam.Role(this, 'ParticipantRole', {
      roleName,
      description: 'The test account\'s stand-in for Workshop Studio\'s participant role (CreWorkshopAccountStack).',
      assumedBy: new iam.CompositePrincipal(new iam.AccountRootPrincipal(), ...settings.trustedServices.map((s) => new iam.ServicePrincipal(s))),
      inlinePolicies,
      managedPolicies: settings.managedPolicies.map((arn, i) => iam.ManagedPolicy.fromManagedPolicyArn(this, `Managed${i}`, arn)),
    });
    for (const service of settings.serviceLinkedRoles) {
      // Made when missing; an account that has it already answers InvalidInput, which is fine. Never deleted.
      const call: cr.AwsSdkCall = {
        service: 'IAM',
        action: 'createServiceLinkedRole',
        parameters: { AWSServiceName: service },
        physicalResourceId: cr.PhysicalResourceId.of(`slr-${service}`),
        ignoreErrorCodesMatching: 'InvalidInput',
      };
      new cr.AwsCustomResource(this, `Slr${service.replace(/[^A-Za-z0-9]/g, '')}`, {
        onCreate: call,
        onUpdate: call,
        installLatestAwsSdk: false,
        policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
          actions: ['iam:CreateServiceLinkedRole'],
          resources: [`arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/aws-service-role/${service}/*`],
        })]),
      });
    }
    if (settings.ec2KeyPair) {
      new ec2.CfnKeyPair(this, 'KeyPair', { keyName: workshopKeyPairName(project) });
    }
    new cdk.CfnOutput(this, 'ParticipantRoleArn', { value: this.participantRole.roleArn });
  }
}
