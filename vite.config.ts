
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { dependencies } from './package.json';


export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'aivmlib-web',
            formats: ['es'],
        },
        sourcemap: true,
        modulePreload: {
            polyfill: false,
        },
        rollupOptions: {
            external: Object.keys(dependencies),
            output: {
                preserveModules: true,
                entryFileNames: '[name].mjs',
                preserveModulesRoot: 'src',
            },
        },
    },
    plugins: [
        dts({
            outDir: 'dist/',
            include: ['src'],
        }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
});
