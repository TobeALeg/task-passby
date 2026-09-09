import { IntegrationInstaller } from "../dist/integrations/installer.js";
import { createDefaultExecutors } from "../dist/executors/defaults.js";
const executors=createDefaultExecutors({launcher:{openNewConversation:async()=>{throw new Error('Install only');}}});
console.log(JSON.stringify(await new IntegrationInstaller(process.cwd(),executors).install(),null,2));
