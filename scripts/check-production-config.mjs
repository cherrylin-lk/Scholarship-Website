import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCognitoConfig } from '../src/services/cognito.js';

// Stage 1: public AWS scholarship discovery; private workspaces remain browser-local.
export const productionEnvironment = JSON.parse(readFileSync(new URL('../deployment/amplify-environment.json', import.meta.url), 'utf8'));
export function productionConfigErrors(env) {
  const errors = [];
  for (const [key, expected] of Object.entries(productionEnvironment)) {
    if (env[key] !== expected) errors.push(`Set ${key} to the documented production value.`);
  }
  if (env.VITE_ACCOUNT_API_BASE_URL?.trim()) errors.push('Leave VITE_ACCOUNT_API_BASE_URL unset until students are provisioned and private APIs are tested.');
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && /secret|password|token|access.?key|private.?key|credential/i.test(key)) {
      errors.push(`Remove sensitive frontend variable ${key}.`);
    }
  }
  const origin = new URL(productionEnvironment.VITE_COGNITO_REDIRECT_URI).origin;
  if (!readCognitoConfig(env, { origin }).configured) errors.push('Production Cognito configuration is invalid.');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Read only explicitly supplied build environment, never a developer .env.local.
  const errors = productionConfigErrors(process.env);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Production public configuration verified. No AWS requests made.');
}
