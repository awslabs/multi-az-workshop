# ECR import (`ecr-import`, CreModule.ECR_IMPORT)

Add it with `CreModule.ECR_IMPORT` in `constructModules` (.projenrc.ts), then `npx projen`.

**What it is.** `CreEcrImport` loads container images and Helm charts into ECR in the account the
stack deploys to, from S3 assets. Use it where a `DockerImageAsset` can't be pushed ahead of the
deploy: an account that has no registry of ours, such as a Workshop Studio team account (a
`CreWorkshopStudio` project can't use `containerImages`). One CodeBuild project (Docker, arm64) and
one custom resource per artifact, which completes only when its build has.

```ts
import { buildOutputAsset, CreEcrImport } from '@cre/constructs';

const built = (id: string, file: string) => buildOutputAsset(this, id, `dist/ecr-import/${file}`, { builtBy: 'build:assets' });

const ecrImport = new CreEcrImport(this, 'Ecr');
const app = ecrImport.addImage('App', {
  tarball: built('AppImage', 'app.tar'),   // `docker save` output
  repositoryName: 'my-workshop/app', tag: '1.4.0',
});
const chart = ecrImport.addHelmChart('Istio', {
  chart: built('BaseChart', 'base-1.32.0.tgz'),   // `helm package` output
  name: 'base', version: '1.32.0', repositoryPrefix: 'charts/',
});
service.node.addDependency(app.ready);          // pull app.uri only after it is in ECR
helmChart.node.addDependency(chart.ready);      // chart.uri is the oci:// repository, chart.tag its version
```

### Gotchas (MANDATORY)

- **Build the tarball before synth.** The asset is a file: the project's build makes it (`docker save
  -o dist/ecr-import/app.tar <image>`, `helm package`), in a task the build runs before its synth.
  Take it with `buildOutputAsset`: `npx projen`'s plan synth runs before anything is built and gets a
  placeholder (so does jest); any other synth without the file fails, naming the task. Keep the
  files out of `assets/`, which is uploaded as a whole: each is uploaded as its own CDK asset. An image is pushed as `docker save` wrote it, so save the
  architecture the cluster runs (`--platform linux/arm64`).
- **A new tag pushes again; the same tag doesn't.** The custom resource runs its build when its
  properties change (the asset's key or the tag). Change the tag with the image.
- **Depend on `ready`.** Anything that pulls the artifact (a task definition, a Helm release) must
  depend on it, or its first pull can race the push.
- **Deleted with the stack.** Each repository is `emptyOnDelete` and destroyed, and every log group
  the construct makes is deleted: nothing outlives the stack in a recycled account.
- **No helm in the build.** A chart is pushed as `helm push` makes it (an OCI manifest with Chart.yaml
  as the config), through ECR's API; `helm pull oci://<registry>/<prefix><name> --version <v>` reads it.
