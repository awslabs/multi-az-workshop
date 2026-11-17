// Public surface of the CRE projen package. A demo's .projenrc.ts imports from './projenrc/cre'.
export { CreDemoTemplateApp, PROJEN_VERSION } from './cre-demo-template-app';
export type {
  CreDemoTemplateAppOptions,
  CreDemoTemplateAppBaseOptions,
  CreBuildSetup,
  GithubOptions,
  GitlabOptions,
  ProviderOptions,
} from './cre-demo-template-app';
export { CreResilienceDemo, CreFailureScenario, CreCustomerSandbox, CreWorkshopStudio } from './project-types';
export type { CreFailureScenarioOptions, CreWorkshopStudioOptions } from './project-types';
export { DEFAULT_DEPLOYABLE_REGIONS, WorkshopAccountSource, WORKSHOP_STUDIO_REGIONS } from './components/workshop-studio';
export type { WorkshopStudioOptions, WorkshopRegionChoice, WorkshopStudioRegion } from './components/workshop-studio';
export type { CrePartition, SynthesizedStack } from './components/stack-plan';
export { DNS_CONTROL_PLANE_REGION, IAM_CONTROL_PLANE_REGION } from './components/stack-plan';
export { DEFAULT_BINDLE_ID } from './components/deploy-tasks';
export type { GitProvider } from './components/git-tasks';
export type { ProjectLayout } from './layout';
export { STANDARD_LAYOUT, FAILURE_SCENARIO_LAYOUT } from './layout';
export { CURL_RETRY, curlRetry } from './workflows/container-tools';
export { ALL_MODULES, CreModule, INTERNAL_MODULES } from './modules';
