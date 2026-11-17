#!/usr/bin/env node
import { CreApp, CreWorkshopAccountStack } from '@cre/constructs';
import { MultiAZWorkshopStack } from './lib/multi-az-workshop-stack';
import { EvacuationMethod } from './lib/types';

// Where our test deploy goes. Workshop Studio deploys the template to the region an event picks
// (workshopStudio.deployableRegions in .projenrc.ts).
const REGION = 'us-east-1';

const app = new CreApp({
  context: {
    evacuationMethod: EvacuationMethod.ZonalShift,
  },
});

// Our test account set up as Workshop Studio sets up a team account (the participant role and the
// service-linked roles). Not part of the workshop: contentspec.yaml leaves it out.
const account = new CreWorkshopAccountStack(app, app.stackId('workshop-account'), { region: REGION });

// The workshop's template. It takes the participant role's name, so it deploys after the account stack.
new MultiAZWorkshopStack(app, app.stackId(), { region: REGION, dependsOn: [account] });

app.synth();
