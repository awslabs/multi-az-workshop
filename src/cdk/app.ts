#!/usr/bin/env node
import { CreApp } from '@cre/constructs';
import { MultiAZWorkshopStack } from './lib/multi-az-workshop-stack';
import { EvacuationMethod } from './lib/types';

const app = new CreApp({
  context: {
    evacuationMethod: EvacuationMethod.ZonalShift,
  },
});

// The workshop's one template. `region` is where our test deploy goes; Workshop Studio deploys it to
// the region an event picks (workshopStudio.deployableRegions in .projenrc.ts).
new MultiAZWorkshopStack(app, app.stackId(), { region: 'us-east-2' });

app.synth();
