import { IntegrationInstaller } from "../dist/integrations/installer.js";

const installer = new IntegrationInstaller(process.cwd());
console.log(JSON.stringify(await installer.install(), null, 2));
