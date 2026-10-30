import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@bb/plugin-sdk/app':fileURLToPath(new URL('./tests/sdk-app-stub.ts',import.meta.url))}}});
