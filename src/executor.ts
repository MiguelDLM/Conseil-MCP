import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from './config.js';

export const execAsync = promisify(exec);

export async function runCommandInContainer(containerType: 'mariadb' | 'web', command: string): Promise<{ stdout: string; stderr: string }> {
  let fullCommand = '';

  if (config.mode === 'kubectl') {
    const podName = containerType === 'mariadb' ? config.kubectl.mariadbPod : config.kubectl.webPod;
    const containerName = containerType === 'web' ? `-c ${config.kubectl.webContainer}` : '';
    fullCommand = `kubectl exec -n ${config.kubectl.namespace} ${podName} ${containerName} -- ${command}`;
  } else if (config.mode === 'docker') {
    const containerName = containerType === 'mariadb' ? config.docker.mariadbContainer : config.docker.webContainer;
    fullCommand = `docker exec ${containerName} ${command}`;
  } else {
    // In direct mode, we assume the commands (like mysql or python) are available locally or we shouldn't be calling this
    fullCommand = command;
  }

  return execAsync(fullCommand, { maxBuffer: 50 * 1024 * 1024 });
}

export async function runPythonInWebContainer(script: string): Promise<{ stdout: string; stderr: string }> {
  const tmpFile = `/tmp/mcp_script_${Date.now()}.py`;
  const encoded = Buffer.from(script).toString('base64');

  // 1. Write script
  const writeCmd = `bash -c "echo ${JSON.stringify(encoded)} | base64 -d > ${tmpFile}"`;
  await runCommandInContainer('web', writeCmd);

  // 2. Execute script
  const appDir = config.specify.appDir || '/opt/specify7';
  const runCmd = `bash -c "cd ${appDir} && python3 manage.py shell < ${tmpFile}"`;
  const result = await runCommandInContainer('web', runCmd);

  // 3. Cleanup (don't await, it's fine)
  runCommandInContainer('web', `rm -f ${tmpFile}`).catch(() => {});

  return result;
}
