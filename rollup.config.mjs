import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import license from 'rollup-plugin-license'
import resolve from '@rollup/plugin-node-resolve'

const here = dirname(fileURLToPath(import.meta.url))
const root = here

// The policies and their settings are inlined at build time: the plugin ships
// the policies it was built against, and `npm run build` is what promotes a
// revision into the plugin.
//
//   segmentation.md  where one document ends and the next begins
//   metadata.md      what is recorded about each one
//   pricing.json     what a run costs, on Anthropic's schedule not ours
//
// Neither is code. Anything true only of one collection belongs in these
// files, not in `src/`.
function policy() {
  const id = 'virtual:policy'
  return {
    name: 'policy',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null

      const pkg = JSON.parse(
        readFileSync(resolvePath(root, 'package.json'), 'utf-8'))
      const md = readFileSync(resolvePath(root, 'segmentation.md'), 'utf-8')
      const recording = readFileSync(resolvePath(root, 'metadata.md'), 'utf-8')
      const settings = JSON.parse(
        readFileSync(resolvePath(root, 'segmentation.json'), 'utf-8'))
      const pricing = JSON.parse(
        readFileSync(resolvePath(root, 'pricing.json'), 'utf-8'))

      // Keys prefixed with _ are documentation for the humans editing the file.
      const defaults = Object.fromEntries(
        Object.entries(settings).filter(([k]) => !k.startsWith('_')))

      this.addWatchFile(resolvePath(root, 'package.json'))
      this.addWatchFile(resolvePath(root, 'segmentation.md'))
      this.addWatchFile(resolvePath(root, 'metadata.md'))
      this.addWatchFile(resolvePath(root, 'segmentation.json'))
      this.addWatchFile(resolvePath(root, 'pricing.json'))

      // A short digest of each policy, so an item's note can say which rules
      // it was segmented under. The policies are the prompt: without this,
      // "was this judged under the current policy?" has no answer.
      const digest = (text) =>
        createHash('sha256').update(text).digest('hex').slice(0, 8)

      return [
        `export const POLICY = ${JSON.stringify(md)}`,
        `export const RECORDING = ${JSON.stringify(recording)}`,
        `export const DEFAULTS = ${JSON.stringify(defaults)}`,
        `export const VERSION = ${JSON.stringify(pkg.version)}`,
        `export const PRICING = ${JSON.stringify(
          Object.fromEntries(Object.entries(pricing)
            .filter(([k]) => !k.startsWith('_'))))}`,
        `export const DIGESTS = ${JSON.stringify({
          segmentation: digest(md),
          metadata: digest(recording)
        })}`
      ].join('\n')
    }
  }
}

export default {
  input: 'src/plugin.js',
  output: {
    file: 'index.js',
    format: 'cjs',
    exports: 'default',
    generatedCode: 'es2015'
  },
  external: [
    'electron'
  ],
  plugins: [
    policy(),
    resolve({
      exportConditions: ['node'],
      preferBuiltins: true
    }),
    commonjs(),
    json(),
    license({
      thirdParty: {
        includePrivate: true,
        output: {
          file: resolvePath(here, 'third-party-licenses.txt')
        }
      }
    })
  ]
}
