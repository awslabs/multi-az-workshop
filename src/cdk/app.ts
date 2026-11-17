#!/usr/bin/env node
import { CreApp } from '@cre/constructs';
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

// The workshop's one template.
new MultiAZWorkshopStack(app, app.stackId(), { region: REGION });

app.synth();
